import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  PrismaService,
  TransactionContext,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
} from '../../../infrastructure';
import { CreateSendPreviewDto, ConfirmSendDto } from '../dto';
import {
  ConvertCurrency,
  CryptoNetwork,
  getCurrencyDecimals,
  toDecimal,
  CURRENCY_PRECISION,
} from '../../../shared';
import {
  PLATFORM_SPREAD,
  QUOTE_TTL_SECONDS,
  COOLDOWN_KEY_PREFIX,
  QUOTE_COOLDOWN_SECONDS,
  MIN_TRANSACTION_USDT,
  QUIDAX_COMPANY_USERID,
} from '../constants';
import { TransactionService } from './transaction.service';
import { TempStoreService } from '../../../infrastructure';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import axios from 'axios';
import { CompanyLiquidityService } from './company-liquidity.service';
import { TransactionNotificationService } from './transaction-notification.service';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly tempStore: TempStoreService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly transactionNotificationService: TransactionNotificationService,
  ) {}

   async previewSend(userId: string, dto: CreateSendPreviewDto) {
     const { currency, amount, toAddress, network, destinationTag } = dto;
     const normalizedCurrency = currency.toLowerCase();
     const normalizedNetwork = network?.toLowerCase();
    await this.transactionService.validateNetworkExists(
      userId,
      normalizedCurrency,
      normalizedNetwork,
    );

    // ── EARLY CURRENCY & NETWORK VALIDATION (BEFORE QUIDAX CALL) ──────────────
    // Validate that the currency is supported for withdrawals
    if (
      !CURRENCY_PRECISION[normalizedCurrency as keyof typeof CURRENCY_PRECISION]
    ) {
      this.logger.warn(`Withdrawal preview rejected: unsupported currency`, {
        userId,
        currency: normalizedCurrency,
        network: normalizedNetwork,
      });
      throw new BadRequestException(
        `Currency "${currency.toUpperCase()}" is not supported for withdrawals.`,
      );
    }

    // Validate that the network is valid for this currency
    const supportedNetworks = CURRENCY_PRECISION[
      normalizedCurrency as keyof typeof CURRENCY_PRECISION
    ].map((n) => n.id);
    if (normalizedNetwork && !supportedNetworks.includes(normalizedNetwork)) {
      this.logger.warn(
        `Withdrawal preview rejected: unsupported network for currency`,
        {
          userId,
          currency: normalizedCurrency,
          network: normalizedNetwork,
          supportedNetworks,
        },
      );
      throw new BadRequestException(
        `Network "${network.toUpperCase()}" is not supported for ${currency.toUpperCase()}. Supported networks: ${supportedNetworks
          .map((n) => n.toUpperCase())
          .join(', ')}`,
      );
    }
    // ────────────────────────────────────────────────────────────────────────────

    const decimals = getCurrencyDecimals(
      normalizedCurrency,
      normalizedNetwork as CryptoNetwork,
    );

    const requestedAmountBase = ConvertCurrency.toBase(
      amount.toString(),
      normalizedCurrency,
      normalizedNetwork as CryptoNetwork,
    );

    const feeRes = await axios.get(`${process.env.QUIDAX_API_URL}/fee`, {
      params: { currency: normalizedCurrency, network: normalizedNetwork },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
      },
    }).then((res) => res.data);

    if (!feeRes || feeRes.status !== 'success') {
      throw new BadRequestException(
        feeRes.message || 'Service unavailable to calculate fees',
      );
    }

    const networkFeeTiers = feeRes.data.fee ?? [];

    let networkFeeHuman = '0';
    const amountDec = new Decimal(amount);

    for (const tier of networkFeeTiers) {
      const min = new Decimal(tier.min);
      const max = new Decimal(tier.max);

      if (amountDec.gte(min) && amountDec.lte(max)) {
        if (tier.type === 'flat') {
          networkFeeHuman = tier.value.toString();
        } else if (tier.type === 'percentage') {
          networkFeeHuman = amountDec
            .mul(new Decimal(tier.value).div(100))
            .toFixed(decimals);
        }
        break;
      }
    }

    const networkFeeBase = ConvertCurrency.toBase(
      networkFeeHuman,
      normalizedCurrency,
      normalizedNetwork as CryptoNetwork,
    );

    const platformFeeBase = BigInt(
      new Decimal(requestedAmountBase.toString())
        .mul(PLATFORM_SPREAD)
        .toDecimalPlaces(0, Decimal.ROUND_DOWN)
        .toFixed(0),
    );

    const totalDeductionBase =
      requestedAmountBase + networkFeeBase + platformFeeBase;

    const previewId = randomUUID();

    const preview = {
      previewId,
      userId,
      currency: normalizedCurrency,
      network,
      toAddress,
      destinationTag,
      side: 'send',
      requestedAmount: amount.toString(),
      requestedAmountBase: requestedAmountBase.toString(),
      networkFee: networkFeeHuman,
      networkFeeBase: networkFeeBase.toString(),
      platformFee: ConvertCurrency.fromBase(
        platformFeeBase.toString(),
        normalizedCurrency,
        normalizedNetwork as CryptoNetwork,
      ),
      platformFeeBase: platformFeeBase.toString(),
      totalDeduction: ConvertCurrency.fromBase(
        totalDeductionBase.toString(),
        normalizedCurrency,
        normalizedNetwork as CryptoNetwork,
      ),
      totalDeductionBase: totalDeductionBase.toString(),
      pinVerified: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + QUOTE_TTL_SECONDS * 1000,
    };

    await this.tempStore.set(
      `send:${previewId}`,
      JSON.stringify(preview),
      QUOTE_TTL_SECONDS,
    );
    await this.setWithdrawalCooldown(userId);

    return {
      previewId,
      currency: normalizedCurrency,
      network: normalizedNetwork,
      requestedSendAmount: preview.requestedAmount,
      networkFee: preview.networkFee,
      transactionFee: preview.platformFee,
      totalToBeDeducted: preview.totalDeduction,
      expiresIn: QUOTE_TTL_SECONDS,
      note: 'This is only a preview. No deduction has occurred yet.',
    };
  }

   async confirmSend(userId: string, dto: ConfirmSendDto) {
     await this.transactionService.enforceConfirmationCooldown(userId);
     const { previewId } = dto;
  
    const rawPreview = await this.tempStore.get(`send:${previewId}`);
    if (!rawPreview)
      throw new NotFoundException('Preview not found or expired');
  
    const preview =
      typeof rawPreview === 'string' ? JSON.parse(rawPreview) : rawPreview;
  
    if (preview.userId !== userId)
      throw new UnauthorizedException('Unauthorized to confirm this preview');
  
    if (!preview.pinVerified)
      throw new BadRequestException('PIN not verified');
  
    if (Date.now() > preview.expiresAt) {
      await this.tempStore.del(`send:${previewId}`);
      throw new BadRequestException(
        'Preview has expired. Please request a new one.',
      );
    }

    // Define missing variables
    const requestedAmountBase = BigInt(preview.requestedAmountBase);
    const networkFeeBase = BigInt(preview.networkFeeBase);
    const platformFeeBase = BigInt(preview.platformFeeBase);
    const totalDeductionBase = BigInt(preview.totalDeductionBase);
  
    if (preview.currency?.toUpperCase() === 'USDT') {
      const minUsdtBase = ConvertCurrency.toBase(MIN_TRANSACTION_USDT.toString(), 'usdt', preview.network as CryptoNetwork);
      if (requestedAmountBase < minUsdtBase) {
        throw new BadRequestException(`Minimum transaction amount is ${MIN_TRANSACTION_USDT} USDT`);
      }
    }

    const isXRP = preview.currency.toLowerCase() === 'xrp';
  
    // SINGLE TRANSACTION BLOCK
    const { transaction, withdrawal, companyLiquidityReserved } =
      await this.prisma.$transaction(async (tx) => {
        // Idempotency check by unique reference
        const existingWithdrawal = await tx.withdrawal.findFirst({
          where: { reference: previewId },
          include: { transaction: true },
        });

        if (existingWithdrawal) {
          return {
            transaction: existingWithdrawal.transaction,
            withdrawal: existingWithdrawal,
            companyLiquidityReserved: false,
          };
        }

        await this.transactionService.reserveBalance(
          tx,
          userId,
          preview.currency,
          totalDeductionBase,
        );
  
        const wallet = await tx.wallet.findUnique({
          where: {
            userId_currency: { userId, currency: preview.currency },
          },
        });
  
        if (!wallet) throw new NotFoundException('Wallet not found');
  
        const transaction = await tx.transaction.create({
          data: {
            userId,
            senderWalletId: wallet.id,
            senderWalletAddress: wallet.quidaxWalletId || null,
            transactionType: TransactionType.DEBIT,
            transactionContext: TransactionContext.WITHDRAWAL,
            transactionUniqueId: previewId,
            currency: preview.currency,
            network: preview.network,
            cryptoAmountBase: toDecimal(requestedAmountBase),
            platformFeeBase: toDecimal(platformFeeBase),
            networkFeeBase: toDecimal(networkFeeBase),
            totalAmountSentBase: toDecimal(totalDeductionBase),
            totalAmountSentOriginal: preview.totalDeduction,
            platformFeeOriginal: preview.platformFee,
            networkFeeOriginal: preview.networkFee,
            fiatAmountBase: toDecimal(0n),
            fiatAmountOriginal: '0',
            status: TransactionStatus.PENDING,
            isProcessed: false,
          },
        });
  
        const companyLiquidityReserved =
          await this.companyLiquidityService.reserveLiquidity(
            preview.currency,
            totalDeductionBase,
            tx,
          );
  
        const withdrawal = await tx.withdrawal.create({
          data: {
            userId,
            reference: previewId,
            currency: preview.currency,
            network: preview.network,
            amount: preview.requestedAmount,
            fee: preview.networkFee,
            total: preview.totalDeduction,
            recipientType: 'external',
            recipientAddress: preview.toAddress,
            destinationTag: preview.destinationTag || null,
            status: companyLiquidityReserved
              ? WithdrawalStatus.PROCESSING
              : WithdrawalStatus.PENDING,
            createdAtProvider: new Date(),
            transactionId: transaction.id,
          },
        });
  
        if (!companyLiquidityReserved) {
          await tx.failedCompanyLiquidityTransaction.create({
            data: {
              transactionId: transaction.id,
              transactionType: 'WITHDRAWAL',
              fromCurrency: preview.currency,
              amountOriginal: preview.totalDeduction,
              currency: preview.currency,
              amountBase: totalDeductionBase.toString(),
              providerResponse: {
                reason: 'Insufficient company liquidity at time of request',
                requestedAmount: preview.requestedAmount,
                networkFee: preview.networkFee,
                platformFee: preview.platformFee,
                totalDeduction: preview.totalDeduction,
                recipientAddress: preview.toAddress,
                network: preview.network,
              },
            },
          });
        }
  
        return { transaction, withdrawal, companyLiquidityReserved };
      });
  
    // Notification
    const transactionWithUser = await this.prisma.transaction.findUnique({
      where: { id: transaction.id },
      select: {
        id: true,
        userId: true,
        transactionUniqueId: true,
        transactionContext: true,
        status: true,
        User: { select: { email: true, firstName: true } },
        paymentMetadata: true,
      },
    });
  
    if (transactionWithUser) {
      try {
        this.transactionNotificationService.sendTransactionInitiatedNotification(
          transactionWithUser,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send notification for withdrawal transaction ${transaction.id}: ${error.message}`,
          error.stack,
        );
      }
    }
  
    // Liquidity fallback
    if (!companyLiquidityReserved) {
      return {
        success: true,
        transactionId: transaction.id,
        withdrawalId: withdrawal.id,
        providerWithdrawalId: null,
        requestedAmount: preview.requestedAmount,
        message: 'Withdrawal queued. You will be notified.',
      };
    }
  
    let providerWithdrawalId: string;
  
    try {
      const response = await axios.post(
        `${process.env.QUIDAX_API_URL}/users/${QUIDAX_COMPANY_USERID}/withdraws`,
        {
          user_id: QUIDAX_COMPANY_USERID,
          currency: preview.currency,
          amount: preview.requestedAmount,
          fund_uid: preview.toAddress,
          fund_uid2: isXRP ? preview.destinationTag : undefined,
          network: preview.network,
          reference: previewId,
          transaction_note: 'External crypto withdrawal',
          narration: `Send to ${preview.toAddress.slice(0, 8)}...`,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
          },
        },
      ).then((res) => res.data);
  
      if (response.status !== 'success' || !response.data?.id) {
        await this.compensateFailedWithdrawal(
          transaction.id,
          withdrawal.id,
          userId,
          preview.currency,
          totalDeductionBase,
          response.message || 'Provider rejected the withdrawal request',
        );
  
        throw new BadRequestException(
          `Withdrawal initiation failed: ${response.message || 'Unknown error'}`,
        );
      }
  
      providerWithdrawalId = response.data.id;
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
  
      await this.compensateFailedWithdrawal(
        transaction.id,
        withdrawal.id,
        userId,
        preview.currency,
        totalDeductionBase,
        `Provider API error: ${error.message}`,
      );
  
      throw new BadRequestException(
        'Could not reach the withdrawal provider. Please try again shortly.',
      );
    }
  
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { transactionUniqueId: providerWithdrawalId },
      });
  
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { providerWithdrawalId },
      });
    });
  
    await this.tempStore.del(`send:${previewId}`);
  
    return {
      success: true,
      transactionId: transaction.id,
      withdrawalId: withdrawal.id,
      providerWithdrawalId,
      status: 'processing',
      requestedAmount: preview.requestedAmount,
      message:
        'Withdrawal request submitted — awaiting blockchain confirmation',
    };
  }

  async cancelWithdrawal(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.userId !== userId)
      throw new UnauthorizedException('You cannot cancel this transaction');
    if (transaction.transactionContext !== TransactionContext.WITHDRAWAL) {
      throw new BadRequestException('This transaction is not a withdrawal');
    }
    if (transaction.isProcessed) {
      throw new ConflictException(
        'Withdrawal already finalized and cannot be cancelled',
      );
    }

    // Find by reference (previewId) since transactionUniqueId may already be the
    // provider ID after Phase 3. Using reference is safer here.
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { transactionId: transaction.id, userId },
    });

    if (!withdrawal)
      throw new NotFoundException('Related withdrawal not found');

    if (
      withdrawal.status !== WithdrawalStatus.PENDING &&
      withdrawal.status !== WithdrawalStatus.PROCESSING
    ) {
      throw new BadRequestException(
        `Withdrawal cannot be cancelled. Current status: ${withdrawal.status}`,
      );
    }

    // Pre-provider cancellation: no Quidax call was ever made
    if (!withdrawal.providerWithdrawalId) {
      return this.prisma.$transaction(async (tx) => {
        await this.transactionService.releaseBalance(
          tx,
          userId,
          transaction.currency,
          transaction.totalAmountSentBase,
        );

        // Release company liquidity if it was reserved (PROCESSING status)
        if (withdrawal.status === WithdrawalStatus.PROCESSING) {
          await this.companyLiquidityService.releaseLiquidity(
            transaction.currency,
            transaction.totalAmountSentBase,
            tx,
          );
        }

        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: WithdrawalStatus.FAILED,
            reason: 'Cancelled by user (pre-provider)',
          },
        });

        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.FAILED, isProcessed: false },
        });

        return {
          success: true,
          message: 'Withdrawal cancelled successfully',
          transactionId: transaction.id,
        };
      });
    }

    // PROCESSING: provider was called — we must tell Quidax to cancel first
    const response = await axios.post(
      `${process.env.QUIDAX_API_URL}/users/me/withdraws/${withdrawal.providerWithdrawalId}/cancel`,
      { user_id: 'me', withdrawal_id: withdrawal.providerWithdrawalId },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
        },
      },
    ).then((res) => res.data);

    if (response.status !== 'success') {
      throw new BadRequestException(
        response.message || 'Failed to cancel withdrawal with provider',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.transactionService.releaseBalance(
        tx,
        userId,
        transaction.currency,
        transaction.totalAmountSentBase,
      );

      await this.companyLiquidityService.releaseLiquidity(
        transaction.currency,
        transaction.totalAmountSentBase,
        tx,
      );

      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: WithdrawalStatus.FAILED, reason: 'Cancelled by user' },
      });

      await tx.transaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.FAILED, isProcessed: false },
      });

      return {
        success: true,
        message: 'Withdrawal cancelled successfully',
        transactionId: transaction.id,
      };
    });
  }

  /**
   * Compensation path when the Quidax API call fails after Phase 1 has already
   * reserved balances and created records. Runs in a single atomic transaction.
   */
  private async compensateFailedWithdrawal(
    transactionId: string,
    withdrawalId: string,
    userId: string,
    currency: string,
    totalDeductionBase: bigint | string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.transactionService.releaseBalance(
        tx,
        userId,
        currency,
        totalDeductionBase,
      );
      await this.companyLiquidityService.releaseLiquidity(
        currency,
        totalDeductionBase,
        tx,
      );

      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED, isProcessed: false },
      });

      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: WithdrawalStatus.FAILED, reason },
      });
    });

    this.logger.warn(`Withdrawal ${withdrawalId} compensated: ${reason}`);
  }

  private async setWithdrawalCooldown(userId: string): Promise<void> {
    const key = `${COOLDOWN_KEY_PREFIX}${userId}`;
    await this.tempStore.set(
      key,
      Date.now().toString(),
      QUOTE_COOLDOWN_SECONDS + 10,
    );
  }
}
