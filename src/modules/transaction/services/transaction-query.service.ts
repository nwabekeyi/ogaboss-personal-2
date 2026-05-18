import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { GetUserTransactionsDto } from '../dto/get-user-transactions.dto';
import { ConvertCurrency, CryptoNetwork } from '../../../shared';

@Injectable()
export class TransactionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserTransactions(userId: string, dto: GetUserTransactionsDto = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      context,
      currency,
      startDate,
      endDate,
    } = dto;

    if (page < 1) throw new BadRequestException('Page must be >= 1');
    if (limit < 1 || limit > 100)
      throw new BadRequestException('Limit must be between 1 and 100');

    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (status) where.status = status;
    if (type) where.transactionType = type;
    if (context) where.transactionContext = context;
    if (currency) where.currency = { equals: currency, mode: 'insensitive' };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          transactionUniqueId: true,
          currency: true,
          cryptoAmountOriginal: true,
          fiatAmountOriginal: true,
          status: true,
          transactionType: true,
          transactionContext: true,
          paymentType: true,
          network: true,
          description: true,
          createdAt: true,
          receiverWalletAddress: true,
          senderWalletAddress: true,
          platformFeeOriginal: true,
          networkFeeOriginal: true,
          bufferAmountOriginal: true,
          totalAmountSentOriginal: true,
          paymentMetadata: true,
          executedCryptoAmountBase: true,
          executedFiatAmountBase: true,
          executionPrice: true,
          executedAt: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const sanitizedTransactions = transactions.map(
      ({
        paymentMetadata,
        executedCryptoAmountBase,
        executedFiatAmountBase,
        network,
        currency,
        ...rest
      }) => {
        const executedCryptoAmountOriginal = executedCryptoAmountBase
          ? ConvertCurrency.fromBase(
              executedCryptoAmountBase.toString(),
              currency,
              network as CryptoNetwork,
            )
          : null;

        const executedFiatAmountOriginal = executedFiatAmountBase
          ? ConvertCurrency.fromBase(executedFiatAmountBase.toString(), 'ngn')
          : null;

        return {
          ...rest,
          currency,
          network,
          executedCryptoAmountOriginal,
          executedFiatAmountOriginal,
          paymentMetadata: paymentMetadata
            ? this.sanitizePaymentMetadata(paymentMetadata)
            : null,
        };
      },
    );

    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: sanitizedTransactions,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  private sanitizePaymentMetadata(metadata: any): any {
    const { liquidityReservationStatus, ...rest } = metadata;
    return rest;
  }

  /**
   * Get a single transaction by its internal ID
   * @param userId - Authenticated user ID
   * @param transactionId - Internal transaction UUID
   */
  async getTransactionById(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        id: transactionId,
        userId,
      },
      select: {
        id: true,
        transactionUniqueId: true,
        currency: true,
        cryptoAmountOriginal: true,
        fiatAmountOriginal: true,
        status: true,
        transactionType: true,
        transactionContext: true,
        paymentType: true,
        network: true,
        description: true,
        createdAt: true,
        receiverWalletAddress: true,
        senderWalletAddress: true,
        platformFeeOriginal: true,
        networkFeeOriginal: true,
        bufferAmountOriginal: true,
        totalAmountSentOriginal: true,
        paymentMetadata: true,
        executedCryptoAmountBase: true,
        executedFiatAmountBase: true,
        executionPrice: true,
        executedAt: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction not found or not owned by user`);
    }

    const {
      paymentMetadata,
      executedCryptoAmountBase,
      executedFiatAmountBase,
      network,
      currency,
      ...rest
    } = transaction;
    const executedCryptoAmountOriginal = executedCryptoAmountBase
      ? ConvertCurrency.fromBase(
          executedCryptoAmountBase.toString(),
          currency,
          network as CryptoNetwork,
        )
      : null;
    const executedFiatAmountOriginal = executedFiatAmountBase
      ? ConvertCurrency.fromBase(executedFiatAmountBase.toString(), 'ngn')
      : null;
    const sanitized = {
      ...rest,
      currency,
      network,
      executedCryptoAmountOriginal,
      executedFiatAmountOriginal,
      paymentMetadata: paymentMetadata
        ? this.sanitizePaymentMetadata(paymentMetadata)
        : null,
    };

    return {
      success: true,
      data: sanitized,
    };
  }

  /**
   * Get the most recent 5 transactions for the user
   * @param userId - Authenticated user ID
   */
  async getRecentTransactions(userId: string) {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: {
        id: true,
        transactionUniqueId: true,
        currency: true,
        cryptoAmountOriginal: true,
        fiatAmountOriginal: true,
        status: true,
        transactionType: true,
        transactionContext: true,
        paymentType: true,
        network: true,
        description: true,
        createdAt: true,
        receiverWalletAddress: true,
        senderWalletAddress: true,
        platformFeeOriginal: true,
        networkFeeOriginal: true,
        bufferAmountOriginal: true,
        totalAmountSentOriginal: true,
        executedCryptoAmountBase: true,
        executedFiatAmountBase: true,
        executionPrice: true,
        executedAt: true,
      },
    });

    return {
      success: true,
      data: transactions.map(
        ({
          executedCryptoAmountBase,
          executedFiatAmountBase,
          network,
          currency,
          ...rest
        }) => ({
          ...rest,
          currency,
          network,
          executedCryptoAmountOriginal: executedCryptoAmountBase
            ? ConvertCurrency.fromBase(
                executedCryptoAmountBase.toString(),
                currency,
                network as CryptoNetwork,
              )
            : null,
          executedFiatAmountOriginal: executedFiatAmountBase
            ? ConvertCurrency.fromBase(executedFiatAmountBase.toString(), 'ngn')
            : null,
        }),
      ),
      count: transactions.length,
    };
  }
}
