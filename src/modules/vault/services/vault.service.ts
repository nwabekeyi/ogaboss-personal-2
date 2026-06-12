import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PrismaService,
  TransactionContext,
  TransactionStatus,
  TransactionType,
  VaultStatus,
} from '../../../infrastructure/databases/prisma';
import { TempStoreService } from '../../../infrastructure/databases/redis';
import { CryptoCurrencyCacheService } from '../../../infrastructure/databases/redis/crypto-currency-cache.service';
import { CryptoCurrencyRateCacheService } from '../../../infrastructure/databases/redis/crypto-currency-rate-cache.service';
import { v4 as uuidv4 } from 'uuid';
import {
  LockVaultDto,
  UnlockVaultDto,
  VaultQuoteDto,
  VaultPreviewDto,
} from '../dto/vault.dto';
import { ConvertCurrency } from '../../../shared/utils/currency-precision.util';
import {
  VAULT_TRANSACTION_FEE,
  VAULT_QUOTE_TTL_SECONDS,
} from '../../../modules/transaction/constants';
import {
  IVaultQuote,
  IVaultPreview,
} from '../../../modules/transaction/services/types';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { CryptoNetwork, toDecimal } from '../../../shared';
import { QUIDAX_COMPANY_USERID } from '../../transaction/constants';
import { compareHash } from '../../../shared/services/hash';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import Decimal from 'decimal.js';
import { TransactionService } from '../../transaction/services';
import { CompanyLiquidityService } from '../../transaction/services/company-liquidity.service';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import axios from 'axios';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tempStore: TempStoreService,
    private readonly cryptoCurrencyCache: CryptoCurrencyCacheService,
    private readonly cryptoCurrencyRateCache: CryptoCurrencyRateCacheService,
    private readonly tickerService: QuidaxTickerService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly queueService: QueueService,
  ) {}

  private normalizeBufferPercent(value: any): Decimal | null {
    if (value === null || value === undefined) return null;

    const percent = new Decimal(value as any);
    return percent.isFinite() && percent.gte(0) ? percent : null;
  }

  private normalizeBufferTierAmount(value: any): bigint | null {
    if (value === null || value === undefined) return null;

    return BigInt(new Decimal(value as any).toFixed(0));
  }

  private async getCurrencyBufferPercent(
    symbol: string,
    amountMinor: bigint,
    orderType: 'buy' | 'sell' = 'sell',
  ): Promise<Decimal> {
    let currency = await this.cryptoCurrencyCache.getBySymbol(symbol);
    if (!currency) {
      await this.cryptoCurrencyCache.refreshCryptoCurrencyCache(symbol);
      currency = await this.cryptoCurrencyCache.getBySymbol(symbol);
    }

    if (!currency) {
      throw new BadRequestException(
        `Buffer not configured for ${symbol}. Cannot create vault quote.`,
      );
    }

    const bufferTiers = (currency.buffer_tiers || []).map((tier: any) => ({
      ...tier,
      bufferPercent: this.normalizeBufferPercent(tier.bufferPercent),
      minAmount: this.normalizeBufferTierAmount(tier.minAmount),
      maxAmount: this.normalizeBufferTierAmount(tier.maxAmount),
    }));

    const matchingTier = bufferTiers.find((tier: any) => {
      const typeMatch =
        !tier.orderType || tier.orderType.toLowerCase() === orderType;
      if (!typeMatch) return false;
      if (tier.minAmount === null || tier.maxAmount === null) return false;
      if (amountMinor < tier.minAmount) return false;
      if (amountMinor > tier.maxAmount) return false;
      return true;
    });

    let bufferPercent = matchingTier?.bufferPercent;
    if (!bufferPercent) {
      bufferPercent = this.normalizeBufferPercent(
        currency.defaultBufferPercent,
      );
    }

    if (!bufferPercent) {
      throw new BadRequestException(
        `Buffer not configured for ${symbol}. Cannot create vault quote.`,
      );
    }

    const maxBufferPercent = this.normalizeBufferPercent(
      currency.maxBufferPercent,
    );
    if (maxBufferPercent?.gt(0) && bufferPercent.gt(maxBufferPercent)) {
      return maxBufferPercent;
    }

    return bufferPercent;
  }

  async getVaultQuote(userId: string, dto: VaultQuoteDto) {
    let crypto = await this.cryptoCurrencyCache.getById(dto.currencyId);
    if (!crypto) {
      await this.cryptoCurrencyCache.refreshAllCryptoCurrenciesCache();
      crypto = await this.cryptoCurrencyCache.getById(dto.currencyId);
    }

    if (!crypto) throw new NotFoundException('Cryptocurrency not found');

    const symbol = crypto.symbol.toUpperCase();
    if (!['BTC', 'USDT', 'USDC'].includes(symbol)) {
      throw new BadRequestException(
        'Vault only available for BTC, USDT and USDC',
      );
    }

    const wallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        currencyId: { equals: dto.currencyId, mode: 'insensitive' },
      },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (!wallet.defaultNetwork) {
      throw new BadRequestException('Wallet default network not configured');
    }

    // Calculate principal in minor units
    const principalMinor = ConvertCurrency.toBase(
      dto.amount.toString(),
      symbol,
    ).toString();

    // Calculate buffer (BTC only)
    let bufferAmountMinor = 0n;
    let bufferPercent = new Decimal(0);

    if (symbol === 'BTC') {
      bufferPercent = await this.getCurrencyBufferPercent(
        symbol,
        BigInt(principalMinor),
        'sell',
      );
      bufferAmountMinor = BigInt(
        new Decimal(principalMinor)
          .mul(bufferPercent)
          .div(100)
          .floor()
          .toFixed(0),
      );
    }

    const totalChargeMinor = BigInt(principalMinor) + bufferAmountMinor;

    // Balance check
    const availableBalance =
      BigInt(wallet.baseBalance.toFixed(0)) -
      BigInt(wallet.reservedBalance.toFixed(0));
    if (availableBalance < totalChargeMinor) {
      throw new BadRequestException(
        `Insufficient balance for principal and buffer`,
      );
    }

    const usdtWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const usdtNetwork =
      (usdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';

    // Store rate in base units (USDT as quote currency)
    // For BTC, rate will be set after swap execution in webhook (default 0)
    // For stablecoins, rate is 1:1
    const rateMinor =
      symbol === 'BTC' ? '0' : ConvertCurrency.toBase('1', 'USDT').toString();

    const maturityDate = new Date();
    maturityDate.setDate(maturityDate.getDate() + dto.durationDays);

    const quoteId = uuidv4();
    const internalQuote: IVaultQuote = {
      quoteId,
      userId,
      side: 'vault',
      currencyId: dto.currencyId,
      currencySymbol: symbol,
      network: wallet.defaultNetwork as CryptoNetwork,
      baseBalanceMinor: wallet.baseBalance.toFixed(0),
      rateMinor,
      expiresAt: Date.now() + VAULT_QUOTE_TTL_SECONDS * 1000,
      pinVerified: false,
      amountMinor: principalMinor,
      bufferAmountMinor: bufferAmountMinor.toString(),
      totalChargeMinor: totalChargeMinor.toString(),
      durationDays: dto.durationDays,
      maturityDate: maturityDate.getTime(),
      bufferPercent: bufferPercent.toString(),
    };

    await this.tempStore.set(
      `vault:${quoteId}`,
      JSON.stringify(internalQuote),
      VAULT_QUOTE_TTL_SECONDS,
    );

    const rateDisplay =
      symbol === 'BTC'
        ? ConvertCurrency.fromBase(rateMinor, 'USDT')
        : ConvertCurrency.fromBase(rateMinor, 'USDT');

    return {
      success: true,
      data: {
        id: quoteId,
        currency: symbol,
        principalAmount: ConvertCurrency.fromBase(principalMinor, symbol),
        bufferAmount: ConvertCurrency.fromBase(
          bufferAmountMinor.toString(),
          symbol,
        ),
        totalCharge: ConvertCurrency.fromBase(
          totalChargeMinor.toString(),
          symbol,
        ),
        duration: dto.durationDays.toString(),
        rate: rateDisplay,
        rateSymbol: 'USDT',
        bufferPercent: bufferPercent.toFixed(2),
        expiresIn: `${VAULT_QUOTE_TTL_SECONDS}s`,
      },
    };
  }

  async getVaultPreview(userId: string, dto: VaultPreviewDto) {
    const quoteKey = `vault:${dto.quoteId}`;
    const quoteJson = await this.tempStore.get(quoteKey);
    if (!quoteJson) throw new NotFoundException('Quote not found');

    const quote =
      typeof quoteJson === 'string' ? JSON.parse(quoteJson) : quoteJson;
    const symbol = quote.currencySymbol;

    // Ensure network is present (fallback for legacy quotes)
    let network = quote.network as CryptoNetwork;
    if (!network) {
      const wallet = await this.prisma.wallet.findFirst({
        where: { userId, currencyId: quote.currencyId },
      });
      if (!wallet?.defaultNetwork) {
        throw new BadRequestException('Wallet network not configured');
      }
      network = wallet.defaultNetwork as CryptoNetwork;
      quote.network = network;
      await this.tempStore.set(
        quoteKey,
        JSON.stringify(quote),
        Math.ceil((quote.expiresAt - Date.now()) / 1000),
      );
    }

    let cryptoRate = await this.cryptoCurrencyRateCache.getByCryptoId(
      quote.currencyId,
    );
    if (!cryptoRate) {
      await this.cryptoCurrencyRateCache.refreshCryptoRateCache(
        quote.currencyId,
      );
      cryptoRate = await this.cryptoCurrencyRateCache.getByCryptoId(
        quote.currencyId,
      );
    }

    if (!cryptoRate || cryptoRate.lockedFundsInterestRatePercent <= 0) {
      throw new BadRequestException(
        'Interest rate not configured for this currency',
      );
    }

    const principalMinor = BigInt(quote.amountMinor);
    const bufferAmountMinor = BigInt(quote.bufferAmountMinor);
    const totalChargeMinor = BigInt(quote.totalChargeMinor);

    // Interest on Principal ONLY
    const annualRate = BigInt(
      Math.floor(cryptoRate.lockedFundsInterestRatePercent),
    );
    const expectedInterestMinor =
      (principalMinor * annualRate * BigInt(quote.durationDays)) / 36500n;

    const totalPayoutBeforeFee = principalMinor + expectedInterestMinor;
    const transactionFeeMinor =
      (totalPayoutBeforeFee *
        BigInt(Math.floor(VAULT_TRANSACTION_FEE * 10000))) /
      1000000n;
    const amountToReceiveMinor = totalPayoutBeforeFee - transactionFeeMinor;

    const preview: IVaultPreview = {
      ...quote,
      interestRatePerAnum: cryptoRate.lockedFundsInterestRatePercent.toString(),
      expectedInterestMinor: expectedInterestMinor.toString(),
      transactionFeeMinor: transactionFeeMinor.toString(),
      amountToReceiveMinor: amountToReceiveMinor.toString(),
    };

    await this.tempStore.set(
      quoteKey,
      JSON.stringify(preview),
      Math.ceil((quote.expiresAt - Date.now()) / 1000),
    );

    const decimals = ConvertCurrency.getDecimals(symbol);
    // Get USDT network for rate display
    const usdtWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const usdtNetwork =
      (usdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';
    const rateDisplay =
      symbol === 'BTC'
        ? quote.rateMinor === '0'
          ? '0'
          : ConvertCurrency.fromBase(quote.rateMinor, 'USDT')
        : '1';

    const transactionFee = ConvertCurrency.fromBase(
      transactionFeeMinor.toString(),
      symbol,
    );
    return {
      success: true,
      data: {
        id: dto.quoteId,
        currency: symbol,
        principalAmount: ConvertCurrency.fromBase(
          principalMinor.toString(),
          symbol,
        ),
        bufferAmount: ConvertCurrency.fromBase(
          bufferAmountMinor.toString(),
          symbol,
        ),
        totalCharge: ConvertCurrency.fromBase(
          totalChargeMinor.toString(),
          symbol,
        ),
        interestRate: preview.interestRatePerAnum,
        expectedInterest: ConvertCurrency.fromBase(
          expectedInterestMinor.toString(),
          symbol,
        ),
        transactionFee: transactionFee,
        amountToReceive: ConvertCurrency.fromBase(
          amountToReceiveMinor.toString(),
          symbol,
        ),
        rate: rateDisplay,
        rateSymbol: 'USDT',
        bufferPercent: quote.bufferPercent,
      },
    };
  }

  async confirmVault(userId: string, quoteId: string) {
    const lockKey = `vault_confirm_lock:${userId}:${quoteId}`;
    const lockAcquired = await this.tempStore.setNx(lockKey, 'true', 10);

    if (!lockAcquired) {
      throw new BadRequestException('Please wait before submitting again');
    }

    try {
      const quoteKey = `vault:${quoteId}`;
      const previewJson = await this.tempStore.get(quoteKey);

      if (!previewJson)
        throw new NotFoundException('Quote not found or expired');
      const preview =
        typeof previewJson === 'string' ? JSON.parse(previewJson) : previewJson;

      if (preview.userId !== userId)
        throw new UnauthorizedException('Unauthorized quote');
      if (Date.now() > preview.expiresAt)
        throw new BadRequestException('Quote expired');
      if (
        !preview.expectedInterestMinor ||
        !preview.transactionFeeMinor ||
        !preview.amountToReceiveMinor ||
        !preview.interestRatePerAnum
      ) {
        throw new BadRequestException('Preview quote before confirming vault');
      }

      const isBTC = preview.currencySymbol?.toUpperCase() === 'BTC';

      const result = await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findFirst({
          where: { userId, currencyId: preview.currencyId },
        });

        if (!wallet) throw new NotFoundException('Wallet not found');

        const principalMinor = BigInt(preview.amountMinor);
        const bufferAmountMinor = BigInt(preview.bufferAmountMinor);
        const totalChargeMinor = BigInt(preview.totalChargeMinor);

        const walletBaseMinor = BigInt(wallet.baseBalance.toFixed(0));
        const walletReservedMinor = BigInt(wallet.reservedBalance.toFixed(0));
        const walletLockedMinor = BigInt(
          wallet.lockedAmount?.toFixed(0) || '0',
        );

        const available = walletBaseMinor - walletReservedMinor;
        if (available < totalChargeMinor)
          throw new BadRequestException('Insufficient balance');

        // Balance management
        if (isBTC) {
          await this.transactionService.reserveBalance(
            tx,
            userId,
            'BTC',
            totalChargeMinor,
          );
        } else {
          const newBaseBalance = walletBaseMinor - totalChargeMinor;
          const newLockedAmount = walletLockedMinor + principalMinor;

          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              baseBalance: toDecimal(newBaseBalance),
              lockedAmount: toDecimal(newLockedAmount),
              originalBalance: ConvertCurrency.fromBase(
                newBaseBalance.toString(),
                preview.currencySymbol,
              ),
            },
          });
        }

        // Calculate interest
        let cryptoRateForVault =
          await this.cryptoCurrencyRateCache.getByCryptoId(preview.currencyId);
        if (!cryptoRateForVault) {
          await this.cryptoCurrencyRateCache.refreshCryptoRateCache(
            preview.currencyId,
          );
          cryptoRateForVault = await this.cryptoCurrencyRateCache.getByCryptoId(
            preview.currencyId,
          );
        }

        if (
          !cryptoRateForVault ||
          cryptoRateForVault.lockedFundsInterestRatePercent <= 0
        ) {
          throw new BadRequestException(
            'Interest rate not configured for this currency',
          );
        }

        // Use pre-calculated interest from preview (already validated + calculated)
        const expectedInterestMinor = BigInt(preview.expectedInterestMinor);

        // Create vault
        const vault = await tx.vault.create({
          data: {
            userId,
            currencyId: preview.currencyId,
            quoteId,
            amountLocked: toDecimal(principalMinor),
            bufferAmount: toDecimal(bufferAmountMinor),
            bufferPercent: parseFloat(preview.bufferPercent || '0'),
            maturityDate: new Date(preview.maturityDate),
            totalGain: toDecimal(expectedInterestMinor),
            interestRatePerAnum: preview.interestRatePerAnum,
            transactionFee: toDecimal(BigInt(preview.transactionFeeMinor)),
            rate: toDecimal(BigInt(preview.rateMinor)),
            amountToReceive: toDecimal(BigInt(preview.amountToReceiveMinor)),
            status: isBTC ? VaultStatus.PENDING : VaultStatus.ACTIVE,
          },
        });

        // Update company liquidity for stablecoins
        if (!isBTC) {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              totalLockedInterest: {
                increment: expectedInterestMinor.toString(),
              },
            },
          });
          const symbol = preview.currencySymbol.toUpperCase();
          await tx.$executeRaw`
            UPDATE "company_liquidity"
            SET "totalLockedPrincipal" = "totalLockedPrincipal" + ${principalMinor.toString()}::decimal,
                "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${expectedInterestMinor.toString()}::decimal
            WHERE LOWER("currency") = LOWER(${symbol})
          `;
        }

        // Create transaction records for BTC
        let transaction = null;
        let swapTx = null;

        if (isBTC) {
          transaction = await tx.transaction.create({
            data: {
              userId,
              currency: 'BTC',
              network: wallet.defaultNetwork as CryptoNetwork,
              transactionContext: TransactionContext.VAULT_SWAP,
              transactionType: TransactionType.DEBIT,
              transactionUniqueId: quoteId,
              cryptoAmountBase: toDecimal(principalMinor),
              cryptoAmountOriginal: ConvertCurrency.fromBase(
                preview.amountMinor,
                'BTC',
              ),
              platformFeeBase: toDecimal(bufferAmountMinor),
              platformFeeOriginal: ConvertCurrency.fromBase(
                preview.bufferAmountMinor,
                'BTC',
              ),
              totalAmountSentBase: toDecimal(totalChargeMinor),
              totalAmountSentOriginal: ConvertCurrency.fromBase(
                totalChargeMinor.toString(),
                'BTC',
              ),
              status: TransactionStatus.PENDING,
              description: `Vault Protection Swap: BTC to USDT`,
            },
          });

          swapTx = await tx.swapTransaction.create({
            data: {
              userId,
              quidaxAccountId: QUIDAX_COMPANY_USERID,
              fromCurrency: 'BTC',
              toCurrency: 'USDT',
              amountOriginal: ConvertCurrency.fromBase(
                totalChargeMinor.toString(),
                'BTC',
              ),
              quoteId: quoteId,
              status: TransactionStatus.PENDING,
              description: `vault_swap:${vault.id}`,
            },
          });
        }

        return { vault, transaction, swapTx, wallet };
      });

      // Execute BTC swap if needed
      if (isBTC) {
        let reservedExpectedUsdtMinor = 0n;
        try {
          const swapReq = await this.quidaxSwapService.createInstantSwapRequest(
            QUIDAX_COMPANY_USERID,
            {
              from_currency: 'btc',
              to_currency: 'usdt',
              from_amount: ConvertCurrency.fromBase(
                preview.totalChargeMinor,
                'BTC',
              ),
            },
          );

          if (!swapReq?.data?.id) throw new Error('Quote refresh Failed');
          const quotedToAmount =
            (swapReq.data as any)?.to_amount ||
            (swapReq.data as any)?.swap_quotation?.to_amount;
          if (!quotedToAmount)
            throw new Error('Swap quotation missing USDT amount');
          reservedExpectedUsdtMinor = ConvertCurrency.toBase(
            String(quotedToAmount),
            'USDT',
          );
          const reservedCompanyLiquidity =
            await this.companyLiquidityService.reserveLiquidity(
              'USDT',
              reservedExpectedUsdtMinor,
            );
          if (!reservedCompanyLiquidity) {
            throw new BadRequestException(
              'Insufficient company USDT liquidity for vault',
            );
          }

          const confirmRes = await this.quidaxSwapService.confirmInstantSwap({
            user_id: QUIDAX_COMPANY_USERID,
            quotation_id: swapReq.data.id,
          });

          if (confirmRes?.status === 'success' && confirmRes?.data?.id) {
            await this.prisma.$transaction(async (tx) => {
              await tx.transaction.update({
                where: { id: result.transaction.id },
                data: { transactionUniqueId: confirmRes.data.id },
              });
              await tx.swapTransaction.update({
                where: { id: result.swapTx.id },
                data: {
                  swapId: confirmRes.data.id,
                  toAmountOriginal:
                    confirmRes.data.swap_quotation?.to_amount ||
                    String(quotedToAmount),
                },
              });
            });
          } else {
            throw new Error('Quote Confirmation Failed');
          }
        } catch (error) {
          this.logger.error(`BTC Vault Swap Failed: ${error.message}`);

          await this.prisma.$transaction(async (tx) => {
            await this.transactionService.releaseBalance(
              tx,
              userId,
              'BTC',
              BigInt(preview.totalChargeMinor),
            );
            await tx.transaction.update({
              where: { id: result.transaction.id },
              data: { status: TransactionStatus.FAILED },
            });
            await tx.swapTransaction.update({
              where: { id: result.swapTx.id },
              data: { status: TransactionStatus.FAILED },
            });
            await tx.vault.update({
              where: { id: result.vault.id },
              data: { status: VaultStatus.TERMINATED },
            });
            if (reservedExpectedUsdtMinor > 0n) {
              await this.companyLiquidityService.releaseLiquidity(
                'USDT',
                reservedExpectedUsdtMinor,
                tx as any,
              );
            }
          });

          throw new BadRequestException(
            'Exchange failed. BTC balance has been released.',
          );
        }
      }

      const crypto = await this.prisma.cryptoCurrency.findUnique({
        where: { id: result.vault.currencyId },
      });
      const decimals = ConvertCurrency.getDecimals(crypto.symbol);
      await this.tempStore.del(quoteKey);

      // Send FCM notification for vault creation
      try {
        const amountToReceive = ConvertCurrency.fromBase(
          result.vault.amountToReceive.toFixed(0),
          crypto.symbol,
        );
        await this.queueService.sendPushNotification({
          userId,
          title: 'Vault Created Successfully',
          body: `Your ${crypto.symbol.toUpperCase()} vault has been created. Amount locked: ${ConvertCurrency.fromBase(result.vault.amountLocked.toFixed(0), crypto.symbol)} ${crypto.symbol.toUpperCase()}. You will receive ${amountToReceive} ${crypto.symbol.toUpperCase()} at maturity.`,
          data: {
            type: 'vault_created',
            vaultId: result.vault.id,
            currency: crypto.symbol.toUpperCase(),
            amountLocked: ConvertCurrency.fromBase(
              result.vault.amountLocked.toFixed(0),
              crypto.symbol,
            ),
            maturityDate: result.vault.maturityDate.toISOString(),
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `Failed to send vault creation FCM notification: ${err.message}`,
        );
      }

      return {
        success: true,
        message:
          result.vault.status === VaultStatus.PENDING
            ? 'Vault pending swap'
            : 'Vault created',
        data: {
          id: result.vault.id,
          currency: crypto.symbol.toUpperCase(),
          amountLocked: ConvertCurrency.fromBase(
            result.vault.amountLocked.toFixed(0),
            crypto.symbol,
          ),
          interestRate: `${result.vault.interestRatePerAnum}%`,
          maturityDate: result.vault.maturityDate,
          status: result.vault.status,
        },
      };
    } finally {
      await this.tempStore.del(lockKey);
    }
  }

  async unlock(userId: string, dto: UnlockVaultDto) {
    const lockKey = `vault_unlock_lock:${userId}:${dto.vaultId}`;
    const lockAcquired = await this.tempStore.setNx(lockKey, 'true', 10);
    if (!lockAcquired) {
      throw new BadRequestException('Please wait before submitting again');
    }

    try {
      const vault = await this.prisma.vault.findFirst({
        where: {
          id: dto.vaultId,
          userId,
          status: VaultStatus.ACTIVE,
        },
        include: { cryptoCurrency: true },
      });

      if (!vault) {
        throw new NotFoundException('Vault not found or already completed');
      }

      const userVaultWallet = await this.prisma.wallet.findFirst({
        where: { userId, currencyId: vault.currencyId },
        select: { defaultNetwork: true },
      });
      if (!userVaultWallet?.defaultNetwork) {
        throw new BadRequestException('Wallet configuration error');
      }

      const isEarlyTermination = new Date() < vault.maturityDate;
      if (isEarlyTermination) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { pin: true },
        });
        if (!user?.pin) throw new BadRequestException('Set PIN first');
        const pinValid = await compareHash(dto.pin, user.pin);
        if (!pinValid) throw new BadRequestException('Invalid PIN');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "vaults"
          WHERE "id" = ${vault.id}
          FOR UPDATE
        `;
        const lockedVault = await tx.vault.findFirst({
          where: { id: vault.id, userId, status: VaultStatus.ACTIVE },
          include: { cryptoCurrency: true },
        });
        if (!lockedVault) {
          throw new BadRequestException('Vault already processed');
        }

        const wallet = await tx.wallet.findFirst({
          where: {
            userId,
            currencyId: lockedVault.currencyId,
          },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found for this currency');
        }

        const amountLocked = BigInt(lockedVault.amountLocked.toFixed(0));
        const totalGain = BigInt(lockedVault.totalGain.toFixed(0));

        let newBaseBalance: bigint;
        let newLockedAmount: bigint;
        let newStatus: 'MATURED' | 'TERMINATED';
        let returnedAmount: bigint;
        let interestReceived: bigint;

        const earlyTerminationPenaltyPercent = 5n;
        const penaltyMinor =
          (amountLocked * earlyTerminationPenaltyPercent) / 100n;

        if (isEarlyTermination) {
          const amountAfterPenalty = amountLocked - penaltyMinor;
          newBaseBalance =
            BigInt(wallet.baseBalance.toFixed(0)) + amountAfterPenalty;
          newLockedAmount =
            BigInt(wallet.lockedAmount?.toFixed(0) || 0) > amountLocked
              ? BigInt(wallet.lockedAmount?.toFixed(0) || 0) - amountLocked
              : 0n;
          newStatus = VaultStatus.TERMINATED;
          returnedAmount = amountAfterPenalty;
          interestReceived = 0n;
        } else {
          const amountToReceive = BigInt(
            lockedVault.amountToReceive.toFixed(0),
          );
          newBaseBalance =
            BigInt(wallet.baseBalance.toFixed(0)) + amountToReceive;
          newLockedAmount =
            BigInt(wallet.lockedAmount?.toFixed(0) || 0) > amountLocked
              ? BigInt(wallet.lockedAmount?.toFixed(0) || 0) - amountLocked
              : 0n;
          newStatus = VaultStatus.MATURED;
          returnedAmount = amountToReceive;
          interestReceived =
            amountToReceive > amountLocked
              ? amountToReceive - amountLocked
              : 0n;
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            baseBalance: newBaseBalance.toString(),
            lockedAmount: newLockedAmount.toString(),
            totalLockedInterest: { decrement: totalGain.toString() },
            originalBalance: ConvertCurrency.fromBase(
              newBaseBalance.toString(),
              lockedVault.cryptoCurrency.symbol,
            ),
          },
        });

        await tx.vault.update({
          where: { id: lockedVault.id },
          data: { status: newStatus },
        });

        const normalizedCurrency =
          lockedVault.cryptoCurrency.symbol.toUpperCase();
        if (normalizedCurrency === 'USDT' || normalizedCurrency === 'USDC') {
          await tx.$executeRaw`
            UPDATE "company_liquidity"
            SET "totalLockedPrincipal" = GREATEST("totalLockedPrincipal" - ${amountLocked.toString()}::decimal, 0),
                "totalAccruedLockedInterest" = GREATEST("totalAccruedLockedInterest" - ${totalGain.toString()}::decimal, 0),
                "totalLockedInterestPaid" = "totalLockedInterestPaid" + ${interestReceived.toString()}::decimal
            WHERE LOWER("currency") = LOWER(${normalizedCurrency})
          `;
        }

        return {
          amount: returnedAmount,
          gain: interestReceived,
          penalty: penaltyMinor,
        };
      });

      const decimals = ConvertCurrency.getDecimals(vault.cryptoCurrency.symbol);
      const penalty = result.penalty?.toString() || '0';

      const penaltyAmount = isEarlyTermination
        ? ConvertCurrency.fromBase(penalty, vault.cryptoCurrency.symbol)
        : '0';

      // Send FCM notification for vault unlock/maturity
      try {
        await this.queueService.sendPushNotification({
          userId,
          title: isEarlyTermination
            ? 'Vault Terminated Early'
            : 'Vault Unlocked Successfully',
          body: isEarlyTermination
            ? `Your ${vault.cryptoCurrency.symbol.toUpperCase()} vault was terminated early. Amount returned: ${ConvertCurrency.fromBase(result.amount.toString(), vault.cryptoCurrency.symbol)} ${vault.cryptoCurrency.symbol.toUpperCase()}. Penalty charged: ${penaltyAmount} ${vault.cryptoCurrency.symbol.toUpperCase()}.`
            : `Your ${vault.cryptoCurrency.symbol.toUpperCase()} vault has matured. Total amount received: ${ConvertCurrency.fromBase(result.amount.toString(), vault.cryptoCurrency.symbol)} ${vault.cryptoCurrency.symbol.toUpperCase()}. Interest earned: ${ConvertCurrency.fromBase(result.gain.toString(), vault.cryptoCurrency.symbol)} ${vault.cryptoCurrency.symbol.toUpperCase()}.`,
          data: {
            type: isEarlyTermination ? 'vault_terminated' : 'vault_matured',
            vaultId: vault.id,
            currency: vault.cryptoCurrency.symbol.toUpperCase(),
            amountUnlocked: ConvertCurrency.fromBase(
              result.amount.toString(),
              vault.cryptoCurrency.symbol,
            ),
            interestEarned: ConvertCurrency.fromBase(
              result.gain.toString(),
              vault.cryptoCurrency.symbol,
            ),
            penaltyCharged: penaltyAmount,
            isEarlyTermination: isEarlyTermination ? 'true' : 'false',
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to send vault unlock FCM notification: ${err.message}`,
        );
      }

      return {
        success: true,
        message: isEarlyTermination
          ? 'Vault terminated early (5% penalty charged, interest forfeited)'
          : 'Vault unlocked successfully',
        data: {
          unlockedAmount: ConvertCurrency.fromBase(
            result.amount.toString(),
            vault.cryptoCurrency.symbol,
          ),
          interestEarned: ConvertCurrency.fromBase(
            result.gain.toString(),
            vault.cryptoCurrency.symbol,
          ),
          penaltyCharged: penaltyAmount,
        },
      };
    } finally {
      await this.tempStore.del(lockKey);
    }
  }

  async getUserVaults(
    userId: string,
    page = 1,
    limit = 10,
    includeAllStates = false,
  ) {
    const safeLimit = Math.min(Math.max(limit || 10, 1), 20);
    const safePage = Math.max(page || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    const where: any = includeAllStates
      ? { userId }
      : { userId, status: { in: [VaultStatus.PENDING, VaultStatus.ACTIVE] } };
    const vaults = await this.prisma.vault.findMany({
      where,
      include: { cryptoCurrency: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
    });
    const totalCount = await this.prisma.vault.count({ where });

    if (vaults.length === 0) {
      return {
        success: true,
        message: 'Vaults retrieved successfully',
        data: {
          vaults: [],
          totalLocked: '0.00',
          totalGain: '0.00',
          pagination: {
            page: safePage,
            limit: safeLimit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / safeLimit),
          },
        },
      };
    }

    let totalLockedNgn = new Decimal(0);
    let totalGainNgn = new Decimal(0);
    const ngnRateCache = new Map<string, Decimal>();

    const usdtWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const usdtNetwork =
      (usdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';

    const vaultResponses = await Promise.all(
      vaults.map(async (vault) => {
        const amountLocked = BigInt(vault.amountLocked.toFixed(0));
        const totalGainVal = BigInt(vault.totalGain.toFixed(0));

        // Fetch the wallet for the vault's currency
        const vaultWallet = await this.prisma.wallet.findFirst({
          where: { userId, currencyId: vault.currencyId },
        });
        if (!vaultWallet?.defaultNetwork) {
          throw new BadRequestException(
            `Wallet default network not configured for ${vault.cryptoCurrency.symbol}`,
          );
        }

        // Totals should be NGN and only include ACTIVE vaults
        if (vault.status === VaultStatus.ACTIVE) {
          let ngnRate = ngnRateCache.get(
            vault.cryptoCurrency.symbol.toUpperCase(),
          );
          if (!ngnRate) {
            const symbol = vault.cryptoCurrency.symbol.toUpperCase();
            const pair =
              symbol === 'NGN'
                ? '1'
                : await this.tickerService.getPrice(
                    `${symbol.toLowerCase()}ngn`,
                  );
            ngnRate = new Decimal(pair || '0');
            ngnRateCache.set(symbol, ngnRate);
          }

          const amountLockedMajor = new Decimal(
            ConvertCurrency.fromBase(
              amountLocked.toString(),
              vault.cryptoCurrency.symbol,
            ),
          );
          const totalGainMajor = new Decimal(
            ConvertCurrency.fromBase(
              totalGainVal.toString(),
              vault.cryptoCurrency.symbol,
            ),
          );

          totalLockedNgn = totalLockedNgn.plus(amountLockedMajor.mul(ngnRate));
          totalGainNgn = totalGainNgn.plus(totalGainMajor.mul(ngnRate));
        }

        const decimals = ConvertCurrency.getDecimals(
          vault.cryptoCurrency.symbol,
        );

        return {
          id: vault.id,
          currencyId: vault.currencyId,
          currency: vault.cryptoCurrency.symbol,
          amountLocked: ConvertCurrency.fromBase(
            vault.amountLocked.toFixed(0),
            vault.cryptoCurrency.symbol,
          ),
          maturityDate: vault.maturityDate,
          totalGain: ConvertCurrency.fromBase(
            vault.totalGain.toFixed(0),
            vault.cryptoCurrency.symbol,
          ),
          interestRatePerAnum: vault.interestRatePerAnum.toString(),
          transactionFee: ConvertCurrency.fromBase(
            vault.transactionFee.toFixed(0),
            vault.cryptoCurrency.symbol,
          ),
          rate: ConvertCurrency.fromBase(vault.rate.toFixed(0), 'USDT'),
          amountToReceive: ConvertCurrency.fromBase(
            vault.amountToReceive.toFixed(0),
            vault.cryptoCurrency.symbol,
          ),
          bufferAmount: ConvertCurrency.fromBase(
            vault.bufferAmount.toFixed(0),
            vault.cryptoCurrency.symbol,
          ),
          bufferPercent: vault.bufferPercent.toString(),
          status: vault.status,
          createdAt: vault.createdAt,
          requestedAt: vault.requestedAt,
        };
      }),
    );

    return {
      success: true,
      message: 'Vaults retrieved successfully',
      data: {
        vaults: vaultResponses,
        totalLocked: totalLockedNgn.toFixed(2),
        totalGain: totalGainNgn.toFixed(2),
        pagination: {
          page: safePage,
          limit: safeLimit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / safeLimit),
        },
      },
    };
  }

  async getAllUserVaults(userId: string, page = 1, limit = 10) {
    return this.getUserVaults(userId, page, limit, true);
  }

  async getVaultById(userId: string, vaultId: string) {
    const vault = await this.prisma.vault.findFirst({
      where: { id: vaultId, userId },
      include: { cryptoCurrency: true },
    });

    if (!vault) {
      throw new NotFoundException('Vault not found');
    }

    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currencyId: vault.currencyId },
    });
    const userUsdtWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });

    if (!wallet?.defaultNetwork) {
      throw new BadRequestException('Wallet default network not configured');
    }

    const decimals = ConvertCurrency.getDecimals(vault.cryptoCurrency.symbol);
    const usdtNetwork =
      (userUsdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';

    return {
      success: true,
      message: 'Vault retrieved successfully',
      data: {
        id: vault.id,
        currencyId: vault.currencyId,
        currency: vault.cryptoCurrency.symbol,
        amountLocked: ConvertCurrency.fromBase(
          vault.amountLocked.toFixed(0),
          vault.cryptoCurrency.symbol,
        ),
        maturityDate: vault.maturityDate,
        totalGain: ConvertCurrency.fromBase(
          vault.totalGain.toFixed(0),
          vault.cryptoCurrency.symbol,
        ),
        interestRatePerAnum: vault.interestRatePerAnum.toString(),
        transactionFee: ConvertCurrency.fromBase(
          vault.transactionFee.toFixed(0),
          vault.cryptoCurrency.symbol,
        ),
        rate: ConvertCurrency.fromBase(vault.rate.toFixed(0), 'USDT'),
        amountToReceive: ConvertCurrency.fromBase(
          vault.amountToReceive.toFixed(0),
          vault.cryptoCurrency.symbol,
        ),
        bufferAmount: ConvertCurrency.fromBase(
          vault.bufferAmount.toFixed(0),
          vault.cryptoCurrency.symbol,
        ),
        bufferPercent: vault.bufferPercent.toString(),
        status: vault.status,
        createdAt: vault.createdAt,
        requestedAt: vault.requestedAt,
      },
    };
  }

  async cancelPendingVault(userId: string, vaultId: string) {
    const vault = await this.prisma.vault.findFirst({
      where: { id: vaultId, userId, status: VaultStatus.PENDING },
      include: { cryptoCurrency: true },
    });
    if (!vault) throw new NotFoundException('Pending vault not found');

    const swapTx = await this.prisma.swapTransaction.findFirst({
      where: { userId, description: `vault_swap:${vault.id}` },
    });
    if (swapTx?.swapId) {
      const swap = await this.quidaxSwapService.getSwapTransaction(
        { user_id: QUIDAX_COMPANY_USERID, swap_transaction_id: swapTx.swapId },
        { skipCircuitBreaker: true },
      );
      const status = String(swap?.data?.status || '').toLowerCase();
      if (['completed', 'done'].includes(status))
        throw new BadRequestException(
          'Vault swap already processed and cannot be cancelled',
        );
      await axios.post(
        `${process.env.QUIDAX_API_URL}/users/${QUIDAX_COMPANY_USERID}/swap_transactions/${swapTx.swapId}/cancel`,
        {},
        {
          headers: {
            Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
          },
        },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vault.update({
        where: { id: vault.id },
        data: { status: VaultStatus.TERMINATED },
      });
      if (vault.cryptoCurrency.symbol.toUpperCase() === 'BTC') {
        const principalMinor = BigInt(vault.amountLocked.toFixed(0));
        const bufferAmountMinor = BigInt(vault.bufferAmount.toFixed(0));
        const totalChargeMinor = principalMinor + bufferAmountMinor;
        await this.transactionService.releaseBalance(
          tx,
          userId,
          'BTC',
          totalChargeMinor,
        );
        if (swapTx?.toAmountOriginal) {
          await this.companyLiquidityService.releaseLiquidity(
            'USDT',
            ConvertCurrency.toBase(String(swapTx.toAmountOriginal), 'USDT'),
            tx as any,
          );
        }
      }
    });

    return { success: true, message: 'Pending vault cancelled successfully' };
  }
}
