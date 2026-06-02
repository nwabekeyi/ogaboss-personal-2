import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService, TransactionContext, TransactionStatus, TransactionType, VaultStatus } from '../../../infrastructure/databases/prisma';
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
import {
  ConvertCurrency,
  getCurrencyDecimals,
} from '../../../shared/utils/currency-precision.util';
import {
  VAULT_TRANSACTION_FEE,
  VAULT_QUOTE_TTL_SECONDS,
} from '../../../modules/transaction/constants';
import {
  IVaultQuote,
  IVaultPreview,
} from '../../../modules/transaction/services/types';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { COMPANY_NGN_WALLET_ID, CryptoNetwork, toDecimal } from '../../../shared';
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
      bufferPercent = this.normalizeBufferPercent(currency.defaultBufferPercent);
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
      throw new BadRequestException('Vault only available for BTC, USDT and USDC');
    }

    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currencyId: { equals: dto.currencyId, mode: 'insensitive' } },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (!wallet.defaultNetwork) {
      throw new BadRequestException('Wallet default network not configured');
    }

    // Calculate principal in minor units
    const principalMinor = ConvertCurrency.toBase(
      dto.amount.toString(),
      symbol,
      wallet.defaultNetwork as CryptoNetwork,
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
    const availableBalance = BigInt(wallet.baseBalance.toFixed(0)) - BigInt(wallet.reservedBalance.toFixed(0));
    if (availableBalance < totalChargeMinor) {
      throw new BadRequestException(`Insufficient balance for principal and buffer`);
    }

    const usdtWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const usdtNetwork = (usdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';

    // Store rate in base units (USDT as quote currency)
    // For BTC, rate will be set after swap execution in webhook (default 0)
    // For stablecoins, rate is 1:1
    const rateMinor =
      symbol === 'BTC' ? '0' : ConvertCurrency.toBase('1', 'USDT', usdtNetwork).toString();

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

    await this.tempStore.set(`vault:${quoteId}`, JSON.stringify(internalQuote), VAULT_QUOTE_TTL_SECONDS);

    const rateDisplay = symbol === 'BTC'
      ? ConvertCurrency.fromBase(rateMinor, 'USDT', usdtNetwork)
      : ConvertCurrency.fromBase(rateMinor, 'USDT', usdtNetwork);

    return {
      success: true,
      data: {
        id: quoteId,
        currency: symbol,
        principalAmount: ConvertCurrency.fromBase(
          principalMinor,
          symbol,
          wallet.defaultNetwork as CryptoNetwork,
        ),
        bufferAmount: ConvertCurrency.fromBase(bufferAmountMinor.toString(), symbol, wallet.defaultNetwork as CryptoNetwork),
        totalCharge: ConvertCurrency.fromBase(totalChargeMinor.toString(), symbol, wallet.defaultNetwork as CryptoNetwork),
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

    const quote = typeof quoteJson === 'string' ? JSON.parse(quoteJson) : quoteJson;
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
      await this.tempStore.set(quoteKey, JSON.stringify(quote), Math.ceil((quote.expiresAt - Date.now()) / 1000));
    }

    let cryptoRate = await this.cryptoCurrencyRateCache.getByCryptoId(quote.currencyId);
    if (!cryptoRate) {
      await this.cryptoCurrencyRateCache.refreshCryptoRateCache(quote.currencyId);
      cryptoRate = await this.cryptoCurrencyRateCache.getByCryptoId(quote.currencyId);
    }

    if (!cryptoRate || cryptoRate.lockedFundsInterestRatePercent <= 0) {
      throw new BadRequestException('Interest rate not configured for this currency');
    }

    const principalMinor = BigInt(quote.amountMinor);
    const bufferAmountMinor = BigInt(quote.bufferAmountMinor);
    const totalChargeMinor = BigInt(quote.totalChargeMinor);

    // Interest on Principal ONLY
    const annualRate = BigInt(Math.floor(cryptoRate.lockedFundsInterestRatePercent));
    const expectedInterestMinor = (principalMinor * annualRate * BigInt(quote.durationDays)) / 36500n;

    const totalPayoutBeforeFee = principalMinor + expectedInterestMinor;
    const transactionFeeMinor = (totalPayoutBeforeFee * BigInt(Math.floor(VAULT_TRANSACTION_FEE * 10000))) / 1000000n;
    const amountToReceiveMinor = totalPayoutBeforeFee - transactionFeeMinor;

    const preview: IVaultPreview = {
      ...quote,
      interestRatePerAnum: cryptoRate.lockedFundsInterestRatePercent.toString(),
      expectedInterestMinor: expectedInterestMinor.toString(),
      transactionFeeMinor: transactionFeeMinor.toString(),
      amountToReceiveMinor: amountToReceiveMinor.toString(),
    };

    await this.tempStore.set(quoteKey, JSON.stringify(preview), Math.ceil((quote.expiresAt - Date.now()) / 1000));

    const decimals = getCurrencyDecimals(symbol, network);
    // Get USDT network for rate display
    const usdtWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const usdtNetwork = (usdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';
    const rateDisplay = symbol === 'BTC'
      ? (quote.rateMinor === '0' ? '0' : ConvertCurrency.fromBase(quote.rateMinor, 'USDT', usdtNetwork))
      : '1';

    const transactionFee = ConvertCurrency.fromBase(transactionFeeMinor.toString(), symbol, decimals);
    return {
      success: true,
      data: {
        id: dto.quoteId,
        currency: symbol,
        principalAmount: ConvertCurrency.fromBase(principalMinor.toString(), symbol, decimals),
        bufferAmount: ConvertCurrency.fromBase(bufferAmountMinor.toString(), symbol, decimals),
        totalCharge: ConvertCurrency.fromBase(totalChargeMinor.toString(), symbol, decimals),
        interestRate: preview.interestRatePerAnum,
        expectedInterest: ConvertCurrency.fromBase(expectedInterestMinor.toString(), symbol, decimals),
        transactionFee: transactionFee,
        amountToReceive: ConvertCurrency.fromBase(amountToReceiveMinor.toString(), symbol, decimals),
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

      if (!previewJson) throw new NotFoundException('Quote not found or expired');
      const preview = typeof previewJson === 'string' ? JSON.parse(previewJson) : previewJson;

      if (preview.userId !== userId) throw new UnauthorizedException('Unauthorized quote');
      if (Date.now() > preview.expiresAt) throw new BadRequestException('Quote expired');

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
        const walletLockedMinor = BigInt(wallet.lockedAmount?.toFixed(0) || '0');

        const available = walletBaseMinor - walletReservedMinor;
        if (available < totalChargeMinor) throw new BadRequestException('Insufficient balance');

        // Balance management
        if (isBTC) {
          await this.transactionService.reserveBalance(tx, userId, 'BTC', totalChargeMinor);
          const reservedCompanyLiquidity = await this.companyLiquidityService.reserveLiquidity('USDT', principalMinor, tx);
          if (!reservedCompanyLiquidity) throw new BadRequestException('Something went wrong, try again later');
        } else {
          const newBaseBalance = walletBaseMinor - totalChargeMinor;
          const newLockedAmount = walletLockedMinor + principalMinor;

          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              baseBalance: toDecimal(newBaseBalance),
              lockedAmount: toDecimal(newLockedAmount),
              originalBalance: newBaseBalance.toString(),
            },
          });
        }

        // Calculate interest
        let cryptoRateForVault = await this.cryptoCurrencyRateCache.getByCryptoId(preview.currencyId);
        if (!cryptoRateForVault) {
          await this.cryptoCurrencyRateCache.refreshCryptoRateCache(preview.currencyId);
          cryptoRateForVault = await this.cryptoCurrencyRateCache.getByCryptoId(preview.currencyId);
        }

        if (!cryptoRateForVault || cryptoRateForVault.lockedFundsInterestRatePercent <= 0) {
          throw new BadRequestException('Interest rate not configured for this currency');
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
          await tx.wallet.update({ where: { id: wallet.id }, data: { totalLockedInterest: { increment: expectedInterestMinor.toString() } } });
          const symbol = preview.currencySymbol.toUpperCase();
          await tx.$executeRaw`
            UPDATE "company_liquidity"
            SET "totalLockedPrincipal" = "totalLockedPrincipal" + ${principalMinor.toString()}::decimal,
                "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${expectedInterestMinor.toString()}::decimal
            WHERE "currency" = ${symbol}
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
              cryptoAmountOriginal: ConvertCurrency.fromBase(preview.amountMinor, 'BTC', wallet.defaultNetwork as CryptoNetwork),
              platformFeeBase: toDecimal(bufferAmountMinor),
              platformFeeOriginal: ConvertCurrency.fromBase(preview.bufferAmountMinor, 'BTC', wallet.defaultNetwork as CryptoNetwork),
              totalAmountSentBase: toDecimal(totalChargeMinor),
              totalAmountSentOriginal: ConvertCurrency.fromBase(totalChargeMinor.toString(), 'BTC', wallet.defaultNetwork as CryptoNetwork),
              status: TransactionStatus.PENDING,
              description: `Vault Protection Swap: BTC to USDT`,
            },
          });

          swapTx = await tx.swapTransaction.create({
            data: {
              userId,
              quidaxAccountId: 'me',
              fromCurrency: 'BTC',
              toCurrency: 'USDT',
              amountOriginal: ConvertCurrency.fromBase(totalChargeMinor.toString(), 'BTC', wallet.defaultNetwork as CryptoNetwork),
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
        try {
          const swapReq = await this.quidaxSwapService.createInstantSwapRequest('me', {
            from_currency: 'btc',
            to_currency: 'usdt',
            from_amount: ConvertCurrency.fromBase(preview.totalChargeMinor, 'BTC', result.wallet.defaultNetwork as CryptoNetwork),
          });

          if (!swapReq?.data?.id) throw new Error('Quote refresh Failed');

          const confirmRes = await this.quidaxSwapService.confirmInstantSwap({
            user_id: COMPANY_NGN_WALLET_ID,
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
                data: { swapId: confirmRes.data.id, toAmountOriginal: confirmRes.data.swap_quotation?.to_amount || '0' },
              });
            });
          } else {
            throw new Error('Quote Confirmation Failed');
          }
        } catch (error) {
          this.logger.error(`BTC Vault Swap Failed: ${error.message}`);

          await this.prisma.$transaction(async (tx) => {
            await this.transactionService.releaseBalance(tx, userId, 'BTC', BigInt(preview.totalChargeMinor));
            await tx.transaction.update({ where: { id: result.transaction.id }, data: { status: TransactionStatus.FAILED } });
            await tx.swapTransaction.update({ where: { id: result.swapTx.id }, data: { status: TransactionStatus.FAILED } });
            await tx.vault.update({ where: { id: result.vault.id }, data: { status: VaultStatus.TERMINATED } });
          });

          throw new BadRequestException('Exchange failed. BTC balance has been released.');
        }
      }

        const crypto = await this.prisma.cryptoCurrency.findUnique({ where: { id: result.vault.currencyId } });
      const decimals = getCurrencyDecimals(crypto.symbol, result.wallet.defaultNetwork as CryptoNetwork);
      await this.tempStore.del(quoteKey);

      // Send FCM notification for vault creation
      try {
        const amountToReceive = ConvertCurrency.fromBase(result.vault.amountToReceive.toFixed(0), crypto.symbol, decimals);
        await this.queueService.sendPushNotification({
          userId,
          title: 'Vault Created Successfully',
          body: `Your ${crypto.symbol.toUpperCase()} vault has been created. Amount locked: ${ConvertCurrency.fromBase(result.vault.amountLocked.toFixed(0), crypto.symbol, decimals)} ${crypto.symbol.toUpperCase()}. You will receive ${amountToReceive} ${crypto.symbol.toUpperCase()} at maturity.`,
          data: {
            type: 'vault_created',
            vaultId: result.vault.id,
            currency: crypto.symbol.toUpperCase(),
            amountLocked: ConvertCurrency.fromBase(result.vault.amountLocked.toFixed(0), crypto.symbol, decimals),
            maturityDate: result.vault.maturityDate.toISOString(),
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to send vault creation FCM notification: ${err.message}`);
      }

      return {
        success: true,
        message: result.vault.status === VaultStatus.PENDING ? 'Vault pending swap' : 'Vault created',
        data: {
          id: result.vault.id,
          currency: crypto.symbol.toUpperCase(),
          amountLocked: ConvertCurrency.fromBase(result.vault.amountLocked.toFixed(0), crypto.symbol, decimals),
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
        const wallet = await tx.wallet.findFirst({
          where: {
            userId,
            currencyId: vault.currencyId,
          },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found for this currency');
        }

        const amountLocked = BigInt(vault.amountLocked.toFixed(0));
        const totalGain = BigInt(vault.totalGain.toFixed(0));

        let newBaseBalance: bigint;
        let newLockedAmount: bigint;
        let newStatus: 'MATURED' | 'TERMINATED';
        let returnedAmount: bigint;
        let interestReceived: bigint;

        const earlyTerminationPenaltyPercent = 5n;
        const penaltyMinor = (amountLocked * earlyTerminationPenaltyPercent) / 100n;

        if (isEarlyTermination) {
          const amountAfterPenalty = amountLocked - penaltyMinor;
          newBaseBalance = BigInt(wallet.baseBalance.toFixed(0)) + amountAfterPenalty;
          newLockedAmount = BigInt(wallet.lockedAmount?.toFixed(0) || 0) - amountLocked;
          newStatus = VaultStatus.TERMINATED;
          returnedAmount = amountAfterPenalty;
          interestReceived = 0n;
        } else {
          const totalAmount = amountLocked + totalGain;
          newBaseBalance = BigInt(wallet.baseBalance.toFixed(0)) + totalAmount;
          newLockedAmount = BigInt(wallet.lockedAmount?.toFixed(0) || 0) - amountLocked;
          newStatus = VaultStatus.MATURED;
          returnedAmount = totalAmount;
          interestReceived = totalGain;
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            baseBalance: newBaseBalance.toString(),
            lockedAmount: newLockedAmount.toString(),
            totalLockedInterest: { decrement: totalGain.toString() },
            originalBalance: newBaseBalance.toString(),
          },
        });

        await tx.vault.update({
          where: { id: vault.id },
          data: { status: newStatus },
        });

        const normalizedCurrency = vault.cryptoCurrency.symbol.toUpperCase();
        if (normalizedCurrency === 'USDT' || normalizedCurrency === 'USDC') {
          await tx.$executeRaw`
            UPDATE "company_liquidity"
            SET "totalLockedPrincipal" = "totalLockedPrincipal" - ${amountLocked.toString()}::decimal,
                "totalAccruedLockedInterest" = "totalAccruedLockedInterest" - ${totalGain.toString()}::decimal,
                "totalLockedInterestPaid" = "totalLockedInterestPaid" + ${interestReceived.toString()}::decimal
            WHERE "currency" = ${normalizedCurrency}
          `;
        }

        return {
          amount: returnedAmount,
          gain: interestReceived,
          penalty: penaltyMinor,
        };
      });

      const decimals = getCurrencyDecimals(
        vault.cryptoCurrency.symbol,
        userVaultWallet.defaultNetwork as CryptoNetwork,
      );
       const penalty = result.penalty?.toString() || '0';

      const penaltyAmount = isEarlyTermination
        ? ConvertCurrency.fromBase(penalty, vault.cryptoCurrency.symbol, decimals)
        : '0';

      // Send FCM notification for vault unlock/maturity
      try {
        await this.queueService.sendPushNotification({
          userId,
          title: isEarlyTermination ? 'Vault Terminated Early' : 'Vault Unlocked Successfully',
          body: isEarlyTermination
            ? `Your ${vault.cryptoCurrency.symbol.toUpperCase()} vault was terminated early. Amount returned: ${ConvertCurrency.fromBase(result.amount.toString(), vault.cryptoCurrency.symbol, decimals)} ${vault.cryptoCurrency.symbol.toUpperCase()}. Penalty charged: ${penaltyAmount} ${vault.cryptoCurrency.symbol.toUpperCase()}.`
            : `Your ${vault.cryptoCurrency.symbol.toUpperCase()} vault has matured. Total amount received: ${ConvertCurrency.fromBase(result.amount.toString(), vault.cryptoCurrency.symbol, decimals)} ${vault.cryptoCurrency.symbol.toUpperCase()}. Interest earned: ${ConvertCurrency.fromBase(result.gain.toString(), vault.cryptoCurrency.symbol, decimals)} ${vault.cryptoCurrency.symbol.toUpperCase()}.`,
            data: {
            type: isEarlyTermination ? 'vault_terminated' : 'vault_matured',
            vaultId: vault.id,
            currency: vault.cryptoCurrency.symbol.toUpperCase(),
            amountUnlocked: ConvertCurrency.fromBase(result.amount.toString(), vault.cryptoCurrency.symbol, decimals),
            interestEarned: ConvertCurrency.fromBase(result.gain.toString(), vault.cryptoCurrency.symbol, decimals),
            penaltyCharged: penaltyAmount,
            isEarlyTermination: isEarlyTermination ? 'true' : 'false',
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to send vault unlock FCM notification: ${err.message}`);
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
            decimals,
          ),
          interestEarned: ConvertCurrency.fromBase(
            result.gain.toString(),
            vault.cryptoCurrency.symbol,
            decimals,
          ),
          penaltyCharged: penaltyAmount,
        },
      };
    } finally {
      await this.tempStore.del(lockKey);
    }
  }

  async getUserVaults(userId: string, page = 1, limit = 10) {
    const safeLimit = Math.min(Math.max(limit || 10, 1), 20);
    const safePage = Math.max(page || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    const vaults = await this.prisma.vault.findMany({
      where: { userId, status: { in: [VaultStatus.PENDING, VaultStatus.ACTIVE] } },
      include: { cryptoCurrency: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
    });
    const totalCount = await this.prisma.vault.count({ where: { userId, status: { in: [VaultStatus.PENDING, VaultStatus.ACTIVE] } } });

    if (vaults.length === 0) {
      return {
        success: true,
        message: 'Vaults retrieved successfully',
        data: {
          vaults: [],
          totalLocked: '0.00',
          totalGain: '0.00',
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
     const usdtNetwork = (usdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';

     const vaultResponses = await Promise.all(
       vaults.map(async (vault) => {
         const amountLocked = BigInt(vault.amountLocked.toFixed(0));
         const totalGainVal = BigInt(vault.totalGain.toFixed(0));

         // Fetch the wallet for the vault's currency
         const vaultWallet = await this.prisma.wallet.findFirst({
           where: { userId, currencyId: vault.currencyId },
         });
         if (!vaultWallet?.defaultNetwork) {
           throw new BadRequestException(`Wallet default network not configured for ${vault.cryptoCurrency.symbol}`);
         }

         // Totals should be NGN and only include ACTIVE vaults
         if (vault.status === VaultStatus.ACTIVE) {
           let ngnRate = ngnRateCache.get(vault.cryptoCurrency.symbol.toUpperCase());
           if (!ngnRate) {
             const symbol = vault.cryptoCurrency.symbol.toUpperCase();
             const pair = symbol === 'NGN' ? '1' : await this.tickerService.getPrice(`${symbol.toLowerCase()}ngn`);
             ngnRate = new Decimal(pair || '0');
             ngnRateCache.set(symbol, ngnRate);
           }

           const amountLockedMajor = new Decimal(
             ConvertCurrency.fromBase(
               amountLocked.toString(),
               vault.cryptoCurrency.symbol,
               vaultWallet.defaultNetwork as CryptoNetwork,
             ),
           );
           const totalGainMajor = new Decimal(
             ConvertCurrency.fromBase(
               totalGainVal.toString(),
               vault.cryptoCurrency.symbol,
               vaultWallet.defaultNetwork as CryptoNetwork,
             ),
           );

           totalLockedNgn = totalLockedNgn.plus(amountLockedMajor.mul(ngnRate));
           totalGainNgn = totalGainNgn.plus(totalGainMajor.mul(ngnRate));
         }

         const decimals = getCurrencyDecimals(vault.cryptoCurrency.symbol, vaultWallet.defaultNetwork as CryptoNetwork);

         return {
           id: vault.id,
           currencyId: vault.currencyId,
           currency: vault.cryptoCurrency.symbol,
           amountLocked: ConvertCurrency.fromBase(
             vault.amountLocked.toFixed(0),
             vault.cryptoCurrency.symbol,
             vaultWallet.defaultNetwork as CryptoNetwork,
           ),
           maturityDate: vault.maturityDate,
           totalGain: ConvertCurrency.fromBase(
             vault.totalGain.toFixed(0),
             vault.cryptoCurrency.symbol,
             vaultWallet.defaultNetwork as CryptoNetwork,
           ),
           interestRatePerAnum: vault.interestRatePerAnum.toString(),
           transactionFee: ConvertCurrency.fromBase(
             vault.transactionFee.toFixed(0),
             vault.cryptoCurrency.symbol,
             vaultWallet.defaultNetwork as CryptoNetwork,
           ),
           rate: ConvertCurrency.fromBase(
             vault.rate.toFixed(0),
             'USDT',
             usdtNetwork,
           ),
           amountToReceive: ConvertCurrency.fromBase(
             vault.amountToReceive.toFixed(0),
             vault.cryptoCurrency.symbol,
             vaultWallet.defaultNetwork as CryptoNetwork,
           ),
           bufferAmount: ConvertCurrency.fromBase(
             vault.bufferAmount.toFixed(0),
             vault.cryptoCurrency.symbol,
             vaultWallet.defaultNetwork as CryptoNetwork,
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

    const decimals = getCurrencyDecimals(vault.cryptoCurrency.symbol, wallet.defaultNetwork as CryptoNetwork);
    const usdtNetwork = (userUsdtWallet?.defaultNetwork as CryptoNetwork) || 'erc20';

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
          decimals,
        ),
        maturityDate: vault.maturityDate,
        totalGain: ConvertCurrency.fromBase(
          vault.totalGain.toFixed(0),
          vault.cryptoCurrency.symbol,
          decimals,
        ),
        interestRatePerAnum: vault.interestRatePerAnum.toString(),
        transactionFee: ConvertCurrency.fromBase(
          vault.transactionFee.toFixed(0),
          vault.cryptoCurrency.symbol,
          decimals,
        ),
        rate: ConvertCurrency.fromBase(
          vault.rate.toFixed(0),
          'USDT',
          usdtNetwork,
        ),
        amountToReceive: ConvertCurrency.fromBase(
          vault.amountToReceive.toFixed(0),
          vault.cryptoCurrency.symbol,
          decimals,
        ),
        bufferAmount: ConvertCurrency.fromBase(
          vault.bufferAmount.toFixed(0),
          vault.cryptoCurrency.symbol,
          decimals,
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

    const swapTx = await this.prisma.swapTransaction.findFirst({ where: { userId, description: `vault_swap:${vault.id}` } });
    if (swapTx?.swapId) {
      const swap = await this.quidaxSwapService.getSwapTransaction({ user_id: 'me', swap_transaction_id: swapTx.swapId }, { skipCircuitBreaker: true });
      const status = String(swap?.data?.status || '').toLowerCase();
      if (['completed', 'done'].includes(status)) throw new BadRequestException('Vault swap already processed and cannot be cancelled');
      await axios.post(`${process.env.QUIDAX_API_URL}/users/me/swap_transactions/${swapTx.swapId}/cancel`, {}, { headers: { Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}` } });
    }

     await this.prisma.$transaction(async (tx) => {
       await tx.vault.update({ where: { id: vault.id }, data: { status: VaultStatus.TERMINATED } });
       if (vault.cryptoCurrency.symbol.toUpperCase() === 'BTC') {
         const principalMinor = BigInt(vault.amountLocked.toFixed(0));
         const bufferAmountMinor = BigInt(vault.bufferAmount.toFixed(0));
         const totalChargeMinor = principalMinor + bufferAmountMinor;
         await this.transactionService.releaseBalance(tx, userId, 'BTC', totalChargeMinor);
         await this.companyLiquidityService.releaseLiquidity('USDT', principalMinor, tx as any);
       }
     });

    return { success: true, message: 'Pending vault cancelled successfully' };
  }
}
