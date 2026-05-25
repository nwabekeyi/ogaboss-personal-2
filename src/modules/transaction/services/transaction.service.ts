import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  PrismaService,
  TransactionStatus,
} from '../../../infrastructure/databases/prisma';
import { COOLDOWN_KEY_PREFIX, QUOTE_COOLDOWN_SECONDS } from '../constants';
import { TempStoreService } from '../../../infrastructure';
import { CreatedTransaction, CreateTransactionParams } from './types';
import { toBigInt, toDecimal, Decimalish } from '../../../shared';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import Decimal from 'decimal.js';
import { CompanyLiquidityService } from './company-liquidity.service';

@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tempStore: TempStoreService,
    private readonly quidaxTickerService: QuidaxTickerService,
    private readonly companyLiquidityService: CompanyLiquidityService,
  ) {}

  async syncCompanyLiquidityCache(): Promise<void> {
    await this.companyLiquidityService.syncAllToCache();
  }

  async getQuidaxUserId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { quidaxAccountId: true },
    });

    if (!user?.quidaxAccountId) {
      throw new BadRequestException('Quidax account not linked for this user');
    }

    return user.quidaxAccountId;
  }

  async reserveBalance(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: string,
    amount: bigint,
  ): Promise<void> {
    const dec = toDecimal(amount);
    const result = await tx.$executeRaw`
      UPDATE "wallets"
      SET "reservedBalance" = "reservedBalance" + ${dec}
      WHERE "userId" = ${userId}
        AND LOWER("currency") = LOWER(${currency})
        AND ("baseBalance" - "reservedBalance" - COALESCE("lockedAmount",0) - COALESCE("stackedAmount",0)) >= ${dec}
    `;

    if (result === 0) {
      throw new BadRequestException(`Insufficient ${currency} balance`);
    }
  }

  async releaseBalance(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: string,
    amount: Decimalish,
  ): Promise<void> {
    const dec = toDecimal(toBigInt(amount));
    const result = await tx.$executeRaw`
      UPDATE "wallets"
      SET "reservedBalance" = "reservedBalance" - ${dec}
      WHERE "userId" = ${userId}
        AND LOWER("currency") = LOWER(${currency})
        AND "reservedBalance" >= ${dec}
    `;

    if (result === 0) {
      throw new BadRequestException(`Reserved balance inconsistency`);
    }
  }

  async enforceConfirmationCooldown(userId: string): Promise<void> {
      const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}`;

      const lastConfirmationTimeStr = await this.tempStore.get(cooldownKey);

      if (lastConfirmationTimeStr) {
          const lastTime = parseInt(lastConfirmationTimeStr, 10);
          const now = Date.now();
          const secondsSinceLast = (now - lastTime) / 1000;

          if (secondsSinceLast < QUOTE_COOLDOWN_SECONDS) {
              const remaining = Math.ceil(QUOTE_COOLDOWN_SECONDS - secondsSinceLast);
              throw new BadRequestException(
                  `Please wait ${remaining} second${remaining > 1 ? 's' : ''} before making another confirmation.`,
              );
          }
      }
  }

  /**
   * Check for price slippage against a quoted price
   * @param cryptoSymbol The cryptocurrency symbol (e.g., 'BTC')
   * @param fiatSymbol The fiat currency symbol (e.g., 'NGN')
   * @param quotedPrice The quoted price from the quote (as string or number)
   * @param isBuy True if checking for buy (price should not exceed quoted price), false for sell (price should not go below quoted price)
   * @throws BadRequestException if price has slipped beyond acceptable limits
   */
  async checkPriceSlippage(
      cryptoSymbol: string,
      fiatSymbol: string,
      quotedPrice: string,
      isBuy: boolean
  ): Promise<void> {
      const pair = `${cryptoSymbol.toLowerCase()}${fiatSymbol.toLowerCase()}`;
      let currentPriceStr = await this.quidaxTickerService.fetchSingleTicker(pair);
      
      if (!currentPriceStr) {
          // Fallback to getPrice method if fetchSingleTicker fails
          const price = await this.quidaxTickerService.getPrice(pair);
          if (!price || parseFloat(price) <= 0) {
              throw new BadRequestException('Unable to fetch current market price for slippage protection');
          }
          currentPriceStr = price;
      }

      const currentPriceDec = new Decimal(currentPriceStr);
      const quotedPriceDec = new Decimal(quotedPrice);

      if (isBuy) {
          // For buy: current price should not exceed quoted buffered price
          if (currentPriceDec.gt(quotedPriceDec)) {
              throw new BadRequestException(
                  `Price has slipped beyond the guaranteed rate. Current price: ${currentPriceStr}, guaranteed rate: ${quotedPrice}. Please request a new quote.`,
              );
          }
      } else {
          // For sell: current price should not go below quoted buffered price
          if (currentPriceDec.lt(quotedPriceDec)) {
              throw new BadRequestException(
                  `Price has slipped below the guaranteed rate. Current price: ${currentPriceStr}, guaranteed rate: ${quotedPrice}. Please request a new quote.`,
              );
          }
      }
  }

  /**
   * Check if the user has a PaymentAddress for the given currency and network.
   * Throws error if not found.
   */
  async validateNetworkExists(
    userId: string,
    currency: string,
    network: string | undefined,
  ): Promise<void> {
    if (!network) return;
    const addressExists = await this.prisma.paymentAddress.findFirst({
      where: {
        wallet: {
          userId,
          currency: {
            equals: currency,
            mode: 'insensitive',
          },
        },
        network: {
          equals: network,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });
    if (!addressExists) {
      throw new BadRequestException(
        `Network ${network} is not supported for ${currency}.`,
      );
    }
  }

  private toDecimalField(
    value: bigint | string | null | undefined,
  ): Prisma.Decimal | null {
    if (value == null) return null;
    return toDecimal(toBigInt(value));
  }

  async createTransaction(
    tx: Prisma.TransactionClient,
    params: CreateTransactionParams,
  ): Promise<CreatedTransaction> {
    const transaction = await tx.transaction.create({
      data: {
        userId: params.userId,
        receiverWalletAddress: params.receiverWalletAddress ?? null,
        senderWalletAddress: params.senderWalletAddress ?? null,
        paymentType: params.paymentType ?? null,
        paymentMetadata: params.paymentMetadata ?? null,
        platformWalletAddress: params.platformWalletAddress ?? null,
        transactionUniqueId: params.transactionUniqueId,
        network: params.network ?? null,
        currency: params.currency,
        cryptoAmountBase: this.toDecimalField(params.cryptoAmountBase),
        fiatAmountBase: toDecimal(toBigInt(params.fiatAmountBase)),
        cryptoAmountOriginal: params.cryptoAmountOriginal ?? null,
        fiatAmountOriginal: params.fiatAmountOriginal ?? null,
        platformFeeBase: this.toDecimalField(params.platformFeeBase),
        bufferAmountBase: this.toDecimalField(params.bufferAmountBase),
        platformFeeOriginal: params.platformFeeOriginal ?? null,
        bufferAmountOriginal: params.bufferAmountOriginal ?? null,
        transactionType: params.transactionType,
        transactionContext: params.transactionContext,
        status: params.status ?? TransactionStatus.PENDING,
      },
    });

    return transaction;
  }
}
