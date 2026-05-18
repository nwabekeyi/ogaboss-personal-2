import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';
import { CompanyLiquidityService } from './company-liquidity.service';
import {
  OrderStatus,
  PaymentStatus,
  TransactionContext,
  TransactionStatus,
  WithdrawalStatus,
  PaymentType,
} from '../../../infrastructure/databases/prisma/generated/prisma/client';
import {
  QuidaxOrderService,
  QuidaxSwapService,
  QuidaxWithdrawalService,
  TradingPair,
} from '../../../infrastructure/providers/quidax';

import { PaystackService } from '../../../infrastructure/providers/paystack';
import {
  BASE_CURRENCY,
  LiquidityReservationStatus,
  toBigInt,
} from '../../../shared';

@Injectable()
export class FailedCompanyLiquidityService {
  private readonly logger = new Logger(FailedCompanyLiquidityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly quidaxOrderService: QuidaxOrderService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly quidaxWithdrawalService: QuidaxWithdrawalService,
    private readonly paystackService: PaystackService,
  ) {}

  async getPending(limit = 100) {
    return this.prisma.failedCompanyLiquidityTransaction.findMany({
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        Transaction: {
          select: {
            id: true,
            transactionUniqueId: true,
            transactionContext: true,
            currency: true,
            status: true,
            userId: true,
          },
        },
      },
    });
  }

  async activateAndProcess(id: string) {
    const failed =
      await this.prisma.failedCompanyLiquidityTransaction.findUnique({
        where: { id },
        include: { Transaction: true },
      });

    if (!failed || !failed.Transaction)
      return { activated: false, reason: 'not_found' };

    const available = await this.companyLiquidityService.getAvailableLiquidity(
      failed.currency,
    );
    if (available < toBigInt(failed.amountBase)) {
      return { activated: false, reason: 'insufficient_liquidity' };
    }

    return this.processFailedRecord(failed.id);
  }

  async autoProcessEligible(limit = 20) {
    const pendings = await this.getPending(limit);
    let processed = 0;

    for (const item of pendings) {
      const available =
        await this.companyLiquidityService.getAvailableLiquidity(item.currency);
      if (available < toBigInt(item.amountBase)) continue;

      const res = await this.processFailedRecord(item.id);
      if (res.activated) processed += 1;
    }

    return { scanned: pendings.length, processed };
  }

  private async processFailedRecord(id: string) {
    const failed =
      await this.prisma.failedCompanyLiquidityTransaction.findUnique({
        where: { id },
        include: { Transaction: true },
      });

    if (!failed || !failed.Transaction) {
      return { activated: false, reason: 'not_found' };
    }

    const txRecord = failed.Transaction;

    await this.prisma.$transaction(async (tx) => {
      const reserved = await this.companyLiquidityService.reserveLiquidity(
        failed.currency,
        toBigInt(failed.amountBase),
        tx,
      );

      if (!reserved) {
        throw new Error('Failed to reserve liquidity');
      }
    });

    let success = false;

    if (txRecord.transactionContext === TransactionContext.SELL) {
      success = await this.resumeSell(txRecord.id);
    } else if (txRecord.transactionContext === TransactionContext.SWAP) {
      success = await this.resumeSwap(txRecord.id);
    } else if (txRecord.transactionContext === TransactionContext.WITHDRAWAL) {
      success = await this.resumeWithdrawal(txRecord.id);
    } else if (txRecord.transactionContext === TransactionContext.BUY) {
      success = await this.resumeBuy(txRecord.id);
    }

    if (!success) {
      this.logger.warn(`Retry execution failed for transaction ${txRecord.id}`);

      await this.companyLiquidityService.releaseLiquidity(
        failed.currency,
        toBigInt(failed.amountBase),
      );

      return { activated: false, reason: 'provider_failed' };
    }

    await this.prisma.failedCompanyLiquidityTransaction.delete({
      where: { id },
    });

    return { activated: true, transactionId: txRecord.id };
  }

  private async resumeSell(transactionId: string) {
    const order = await this.prisma.order.findUnique({
      where: { transactionId },
    });
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!order || !transaction || !order.cryptoAmountOriginal) return false;

    const market =
      `${transaction.currency.toLowerCase()}${BASE_CURRENCY}` as TradingPair;

    const orderResponse = await this.quidaxOrderService.buyOrSellOrderRequest(
      'me',
      {
        market,
        side: 'sell',
        ord_type: 'market',
        volume: Number(order.cryptoAmountOriginal),
      },
    );

    if (orderResponse.status !== 'success') {
      this.logger.warn(`Failed sell retry for ${transactionId}`);
      return false;
    }

    const providerReference =
      orderResponse.data.reference || orderResponse.data.id;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          referenceNo: providerReference,
          status: OrderStatus.PROCESSING,
          paymentStatus: PaymentStatus.PENDING,
          gatewayResponse: JSON.stringify(orderResponse.data),
        },
      });

      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          transactionUniqueId: providerReference,
          status: TransactionStatus.PENDING,
        },
      });
    });
    return true;
  }

  private async resumeSwap(transactionId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    const swap = await this.prisma.swapTransaction.findFirst({
      where: { quoteId: tx?.transactionUniqueId, userId: tx?.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!tx || !swap) return false;

    const quotationRes = await this.quidaxSwapService.createInstantSwapRequest(
      'me',
      {
        from_currency: swap.fromCurrency.toLowerCase(),
        to_currency: swap.toCurrency.toLowerCase(),
        from_amount: swap.amountOriginal,
      },
    );

    if (!quotationRes?.data?.id) return false;

    const confirmRes = await this.quidaxSwapService.confirmInstantSwap({
      user_id: 'me',
      quotation_id: quotationRes.data.id,
    });

    if (!confirmRes?.data?.id) return false;

    await this.prisma.swapTransaction.update({
      where: { id: swap.id },
      data: {
        swapId: confirmRes.data.id,
        status: 'processing',
        confirmed: true,
      },
    });
    return true;
  }

  private async resumeWithdrawal(transactionId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { transactionId },
    });
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!withdrawal || !tx) return false;

    const response = await this.quidaxWithdrawalService.createWithdrawerRequest(
      {
        user_id: 'me',
        currency: withdrawal.currency,
        amount: withdrawal.amount.toString(),
        fund_uid: withdrawal.recipientAddress || '',
        fund_uid2: withdrawal.destinationTag || undefined,
        network: withdrawal.network || undefined,
        reference: withdrawal.reference || tx.transactionUniqueId,
        transaction_note: 'External crypto withdrawal',
        narration: withdrawal.narration || 'Liquidity retry',
      },
    );

    if (response.status !== 'success' || !response.data?.id) {
      return false;
    }

    await this.prisma.$transaction(async (db) => {
      await db.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          providerWithdrawalId: response.data.id,
          status: WithdrawalStatus.PROCESSING,
        },
      });

      await db.transaction.update({
        where: { id: transactionId },
        data: {
          transactionUniqueId: response.data.id,
          status: TransactionStatus.PENDING,
        },
      });
    });
    return true;
  }

  private async resumeBuy(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { User: { select: { email: true } } },
    });

    if (!transaction || !transaction.User?.email) return false;

    const metadata = (transaction.paymentMetadata || {}) as Record<string, any>;
    const paymentType = transaction.paymentType;
    const totalFiatMinor = Number(transaction.fiatAmountBase ?? 0n);

    if (!Number.isFinite(totalFiatMinor) || totalFiatMinor <= 0) {
      this.logger.warn(
        `Invalid fiat amount for queued buy transaction ${transactionId}`,
      );
      return false;
    }

    if (paymentType === PaymentType.CARD) {
      const cardId = metadata.cardId as string | undefined;
      if (!cardId) return false;

      const chargeResponse = await this.paystackService.chargeSavedCard({
        paymentCardId: cardId,
        amount: totalFiatMinor,
        reference: transaction.transactionUniqueId,
        metadata: {
          userId: transaction.userId,
          quoteId: transaction.transactionUniqueId,
          companyDepositReference: metadata.companyDepositReference,
          resumedFromFailedLiquidity: true,
        },
      });

      if (!chargeResponse?.status) {
        this.logger.warn(
          `Failed card charge resume for buy transaction ${transactionId}`,
        );
        return false;
      }

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          paymentMetadata: {
            ...metadata,
            paystackReference: chargeResponse.data.reference,
            liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
          },
          status: TransactionStatus.PENDING,
        },
      });

      return true;
    }

    const initializeResponse = await this.paystackService.initializePayment({
      email: transaction.User.email,
      amount: totalFiatMinor,
      reference: transaction.transactionUniqueId,
      currency: BASE_CURRENCY.toUpperCase(),
      channels: ['bank_transfer'],
      metadata: {
        userId: transaction.userId,
        quoteId: transaction.transactionUniqueId,
        companyDepositReference: metadata.companyDepositReference,
        resumedFromFailedLiquidity: true,
      },
    });

    if (!initializeResponse?.status) {
      this.logger.warn(
        `Failed paystack init resume for buy transaction ${transactionId}`,
      );
      return false;
    }

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        paymentMetadata: {
          ...metadata,
          paystackReference: initializeResponse.data.reference,
          channels: ['bank_transfer'],
          authorizationUrl: initializeResponse.data.authorization_url,
          liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
        },
        status: TransactionStatus.PENDING,
      },
    });
    return true;
  }
}
