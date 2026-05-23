import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  WebhookStatus,
} from '../../../infrastructure/databases/prisma';
import { GetAdminTransactionsDto } from '../dto/get-admin-transactions.dto';
import {
  TransactionFormatter,
} from '../../../shared';
import { WebhookIdempotencyService } from '../../webhook/service/webhook-idempotency.service';
import { QuidaxWebhookService } from '../../webhook/quidax/quidax-webhook-event.service';
import { PaystackWebhookHandler } from '../../webhook/paystack';
import { Providers } from '../../../shared';
import { PdfGenerator } from '../../../shared/utils/pdf-generator.util';
import { transanctionHistoryTitle } from '../types';

@Injectable()
export class AdminTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
    private readonly quidaxWebhookService: QuidaxWebhookService,
    private readonly paystackWebhookHandler: PaystackWebhookHandler,
  ) {}

  async getAllTransactions(dto: GetAdminTransactionsDto = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      context,
      currency,
      userId,
      startDate,
      endDate,
      search,
    } = dto;

    if (page < 1) throw new BadRequestException('Page must be >= 1');
    if (limit < 1 || limit > 100)
      throw new BadRequestException('Limit must be between 1 and 100');

    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) where.status = status;
    if (type) where.transactionType = type;
    if (context) where.transactionContext = context;
    if (currency) where.currency = { equals: currency, mode: 'insensitive' };
    if (userId) where.userId = userId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { id: { contains: term, mode: 'insensitive' } },
        { transactionUniqueId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          User: {
            select: { firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const formattedData = TransactionFormatter.formatMany(transactions);

    return {
      success: true,
      data: formattedData,
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

  async getTransactionById(id: string) {
    console.log(id);
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        User: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!transaction) throw new NotFoundException('Transaction not found');

    const accountName =
      `${transaction.User?.firstName || ''} ${transaction.User?.lastName || ''}`.trim() ||
      'N/A';

    const baseResponse = {
      transactionId: transaction.id,
      date: transaction.createdAt,
      accountName,
      walletAddress:
        transaction.receiverWalletAddress ||
        transaction.senderWalletAddress ||
        'N/A',
      transactionType: transaction.transactionType,
      amountToken: `${transaction.cryptoAmountOriginal} ${transaction.currency.toUpperCase()}`,
      status: transaction.status,
      network: transaction.network || 'N/A',
      transactionContext: transaction.transactionContext,
    };

    if (transaction.transactionContext === 'WITHDRAWAL') {
      return {
        success: true,
        data: {
          ...baseResponse,
          destinationWallet: transaction.network
            ? `${transaction.currency.toUpperCase()} (${transaction.network.toUpperCase()})`
            : transaction.currency.toUpperCase(),
          destinationAddress: transaction.receiverWalletAddress || 'N/A',
          destinationTag:
            (transaction.paymentMetadata as any)?.destination_tag || null,
        },
      };
    }

    return {
      success: true,
      data: baseResponse,
    };
  }





  async getFailedWebhooks(dto: {
    provider?: string;
    eventType?: string;
    page?: number;
    limit?: number;
  }) {
    return this.webhookIdempotencyService.getFailedWebhooks(dto);
  }

  async resolveWebhook(
    webhookId: string,
    resolutionComment: string,
    adminId: string,
  ) {
    // Use transaction with row-level lock to prevent race conditions
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the webhook row and get current state
      const webhook = await tx.$queryRaw<any[]>`
        SELECT * FROM "webhooks"
        WHERE id = ${webhookId}
        FOR UPDATE
      `.then((rows) => rows[0] || null);

      if (!webhook) {
        throw new NotFoundException(`Webhook ${webhookId} not found`);
      }

      if (webhook.status !== WebhookStatus.failed) {
        throw new BadRequestException(
          `Webhook ${webhookId} is not in failed status`,
        );
      }

      if (webhook.isResolved) {
        throw new BadRequestException(
          `Webhook ${webhookId} is already resolved`,
        );
      }

      // Process the webhook - try the appropriate handler based on provider
      let success = false;
      let errorMessage = '';

      try {
        if (webhook.provider === Providers.QUIDAX) {
          // Transform payload to match what the service expects (has .event and .data)
          const payload = {
            event: webhook.eventType,
            data: webhook.payload,
          };
          await this.quidaxWebhookService.processWebhookEvent(
            payload,
            webhookId,
          );
          success = true;
        } else if (webhook.provider === Providers.PAYSTACK) {
          // Paystack handler expects raw body string
          const rawBody = JSON.stringify(webhook.payload);
          await this.paystackWebhookHandler.handleWebhook(rawBody);
          success = true;
        } else {
          // For other providers, just mark as resolved for now
          success = true;
        }
      } catch (error: any) {
        errorMessage = error.message || 'Unknown error';
        success = false;
      }

      // Update webhook status atomically
      await tx.webhook.update({
        where: { id: webhookId },
        data: {
          isResolved: success,
          resolvedAt: success ? new Date() : null,
          resolvedBy: adminId,
          resolutionComment: success
            ? resolutionComment
            : `Retry failed: ${errorMessage} | Admin note: ${resolutionComment}`,
          status: success ? WebhookStatus.processed : WebhookStatus.failed,
          failedReason: success ? null : errorMessage,
        },
      });

      return { success, errorMessage };
    });

    if (result.success) {
      return {
        success: true,
        data: { id: webhookId, isResolved: true },
        message: 'Webhook resolved and processed successfully',
      };
    } else {
      throw new BadRequestException(
        `Webhook reprocessing failed: ${result.errorMessage}`,
      );
    }
  }

  async generateUserTransactionHistoryPdf(dto: {
    userId: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    type?: string;
    currency?: string;
  }): Promise<Buffer> {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { firstName: true, lastName: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const where: any = { userId: dto.userId };

    if (dto.status) where.status = dto.status;
    if (dto.type) where.transactionType = dto.type;
    if (dto.currency)
      where.currency = { equals: dto.currency, mode: 'insensitive' };

    if (dto.startDate || dto.endDate) {
      where.createdAt = {};
      if (dto.startDate) where.createdAt.gte = new Date(dto.startDate);
      if (dto.endDate) where.createdAt.lte = new Date(dto.endDate);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        User: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    const rows = transactions.map((tx) => ({
      transactionId: tx.id,
      date: tx.createdAt.toISOString(),
      accountName:
        `${tx.User?.firstName || ''} ${tx.User?.lastName || ''}`.trim(),
      transactionType: tx.transactionType,
      status: tx.status,
      amount:
        tx.cryptoAmountOriginal || tx.fiatAmountOriginal?.toString() || 'N/A',
      currency: tx.currency,
      network: tx.network || undefined,
    }));

    return PdfGenerator.generateTransactionHistory(rows, {
      title: transanctionHistoryTitle.user,
      userName: `${user.firstName} ${user.lastName}`.trim(),
      userId: dto.userId,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
  }

  async generateUsersTransactionHistoryPdf(dto: {
    userIds: string[];
    startDate?: string;
    endDate?: string;
    status?: string;
    type?: string;
    currency?: string;
  }): Promise<Buffer> {
    const where: any = {
      userId: { in: dto.userIds },
    };

    if (dto.status) where.status = dto.status;
    if (dto.type) where.transactionType = dto.type;
    if (dto.currency)
      where.currency = { equals: dto.currency, mode: 'insensitive' };

    if (dto.startDate || dto.endDate) {
      where.createdAt = {};
      if (dto.startDate) where.createdAt.gte = new Date(dto.startDate);
      if (dto.endDate) where.createdAt.lte = new Date(dto.endDate);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        User: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    const rows = transactions.map((tx) => ({
      transactionId: tx.id,
      date: tx.createdAt.toISOString(),
      accountName:
        `${tx.User?.firstName || ''} ${tx.User?.lastName || ''}`.trim(),
      transactionType: tx.transactionType,
      status: tx.status,
      amount:
        tx.cryptoAmountOriginal || tx.fiatAmountOriginal?.toString() || 'N/A',
      currency: tx.currency,
      network: tx.network || undefined,
    }));

    return PdfGenerator.generateTransactionHistory(rows, {
      title: transanctionHistoryTitle.multiUser,
      userName: `${dto.userIds.length} Users`,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
  }

  async generateTransactionReceiptPdf(transactionId: string): Promise<Buffer> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        User: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const data = {
      transactionId: transaction.id,
      date: transaction.createdAt.toISOString(),
      accountName:
        `${transaction.User?.firstName || ''} ${transaction.User?.lastName || ''}`.trim(),
      walletAddress:
        transaction.receiverWalletAddress ||
        transaction.senderWalletAddress ||
        'N/A',
      transactionType: transaction.transactionType,
      status: transaction.status,
      amountToken: `${transaction.cryptoAmountOriginal} ${transaction.currency.toUpperCase()}`,
      currency: transaction.currency,
      network: transaction.network,
      executedCryptoAmount: transaction.executedCryptoAmountBase
        ? ConvertCurrency.fromBase(
            transaction.executedCryptoAmountBase.toString(),
            transaction.currency,
          )
        : undefined,
      executedFiatAmount: transaction.executedFiatAmountBase
        ? ConvertCurrency.fromBase(
            transaction.executedFiatAmountBase.toString(),
            'ngn',
          )
        : undefined,
      executionPrice: transaction.executionPrice || undefined,
      executedAt: transaction.executedAt?.toISOString() || undefined,
    };

    return PdfGenerator.generateTransactionReceipt(data);
  }

  async generateMultipleTransactionReceiptsPdf(
    transactionIds: string[],
  ): Promise<Buffer> {
    const transactions = await this.prisma.transaction.findMany({
      where: { id: { in: transactionIds } },
      include: {
        User: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (transactions.length === 0) {
      throw new NotFoundException('No transactions found');
    }

    const receipts = await Promise.all(
      transactions.map((tx) =>
        PdfGenerator.generateTransactionReceipt({
          transactionId: tx.id,
          date: tx.createdAt.toISOString(),
          accountName:
            `${tx.User?.firstName || ''} ${tx.User?.lastName || ''}`.trim(),
          walletAddress:
            tx.receiverWalletAddress || tx.senderWalletAddress || 'N/A',
          transactionType: tx.transactionType,
          status: tx.status,
          amountToken: `${tx.cryptoAmountOriginal} ${tx.currency.toUpperCase()}`,
          currency: tx.currency,
          network: tx.network,
          executedCryptoAmount: tx.executedCryptoAmountBase
            ? ConvertCurrency.fromBase(
                tx.executedCryptoAmountBase.toString(),
                tx.currency,
              )
            : undefined,
          executedFiatAmount: tx.executedFiatAmountBase
            ? ConvertCurrency.fromBase(
                tx.executedFiatAmountBase.toString(),
                'ngn',
              )
            : undefined,
          executionPrice: tx.executionPrice || undefined,
          executedAt: tx.executedAt?.toISOString() || undefined,
        }),
      ),
    );

    return Buffer.concat(receipts);
  }
}
