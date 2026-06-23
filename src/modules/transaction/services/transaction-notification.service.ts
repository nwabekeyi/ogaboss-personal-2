import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { EmailJobType, QueueName } from '../../../infrastructure/bullMQ/types';
import { TransactionWithUser } from '../types';
import { ConvertCurrency } from '../../../shared';

@Injectable()
export class TransactionNotificationService {
  private readonly logger = new Logger(TransactionNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  async sendTransactionInitiatedNotification(
    transaction: TransactionWithUser,
  ): Promise<void> {
    try {
      const user = transaction.User;
      if (!user?.email) {
        this.logger.warn(`No email found for transaction ${transaction.id}`);
        return;
      }

      const to = user.email.trim();
      if (!to) return;

      const title = 'Transaction Initiated';
      const message = `Your ${transaction.transactionContext?.toLowerCase() || 'transaction'} has been initiated and is currently ${transaction.status?.toLowerCase()}.`;

      await this.queueService.add(QueueName.EMAIL, 'send-transactional-email', {
        type: EmailJobType.TRANSACTION_NOTIFICATION,
        payload: {
          to,
          userId: transaction.userId,
          firstName: user.firstName || 'User',
          subject: title,
          message,
          transactionId: transaction.transactionUniqueId,
          transactionContext: transaction.transactionContext,
          transactionStatus: transaction.status,
        },
      });

      if (transaction.userId) {
        await this.queueService.sendPushNotification({
          userId: transaction.userId,
          title,
          body: message,
          data: {
            type: 'transaction',
            transactionId: transaction.id,
            transactionUniqueId: transaction.transactionUniqueId || '',
            status: transaction.status || '',
            context: transaction.transactionContext || '',
          },
        });
      }

      await this.updateNotificationStatus(transaction.id, 'initiatedSentAt');

      this.logger.debug(
        `Sent initiated notification for transaction ${transaction.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Error sending initiated notification for transaction ${transaction.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  async sendTransactionStatusNotification(
    transaction: TransactionWithUser,
  ): Promise<void> {
    try {
      const user = transaction.User;
      if (!user?.email) {
        this.logger.warn(`No email found for transaction ${transaction.id}`);
        return;
      }

      const to = user.email.trim();
      if (!to) return;

      const finalStatuses = ['COMPLETED', 'SUCCESS', 'FAILED'];
      if (!finalStatuses.includes(transaction.status)) {
        return;
      }

      const title = `Transaction ${transaction.status?.toLowerCase()}`;

      // Build detailed message for buy/sell/swap with execution info
      const context =
        transaction.transactionContext?.toLowerCase() || 'transaction';
      let message: string;

      if (
        ['buy', 'sell', 'swap'].includes(context) &&
        transaction.executionPrice
      ) {
        const cryptoAmt = transaction.executedCryptoAmountBase
          ? ConvertCurrency.fromBase(
              String(transaction.executedCryptoAmountBase),
              transaction.currency ?? '',
            )
          : (transaction.cryptoAmountOriginal ?? '?');
        const fiatAmt = transaction.executedFiatAmountBase
          ? ConvertCurrency.fromBase(
              String(transaction.executedFiatAmountBase),
              'ngn',
            )
          : (transaction.fiatAmountOriginal ?? '?');

        message =
          `Your ${context} is now ${transaction.status?.toLowerCase()}. ` +
          `Executed: ${cryptoAmt} ${transaction.currency ?? ''} at ₦${transaction.executionPrice}. ` +
          `Total: ₦${fiatAmt}.`;
      } else {
        message = `Your ${context} is now ${transaction.status?.toLowerCase()}.`;
      }

      await this.queueService.add(QueueName.EMAIL, 'send-transactional-email', {
        type: EmailJobType.TRANSACTION_NOTIFICATION,
        payload: {
          to,
          userId: transaction.userId,
          firstName: user.firstName || 'User',
          subject: title,
          message,
          transactionId: transaction.transactionUniqueId,
          transactionContext: transaction.transactionContext,
          transactionStatus: transaction.status,
        },
      });

      if (transaction.userId) {
        await this.queueService.sendPushNotification({
          userId: transaction.userId,
          title,
          body: message,
          data: {
            type: 'transaction',
            transactionId: transaction.id,
            transactionUniqueId: transaction.transactionUniqueId || '',
            status: transaction.status || '',
            context: transaction.transactionContext || '',
          },
        });
      }

      await this.updateNotificationStatus(
        transaction.id,
        'finalStatusSentFor',
        transaction.status,
      );

      this.logger.debug(
        `Sent status notification for transaction ${transaction.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Error sending status notification for transaction ${transaction.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  private async updateNotificationStatus(
    transactionId: string,
    field: 'initiatedSentAt' | 'finalStatusSentFor',
    statusValue?: string,
  ): Promise<void> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { paymentMetadata: true },
    });

    if (!transaction) return;

    const metadata = (transaction.paymentMetadata as Record<string, any>) || {};
    const notifications = metadata.notifications || {};

    if (field === 'initiatedSentAt') {
      notifications.initiatedSentAt = new Date().toISOString();
    } else if (field === 'finalStatusSentFor' && statusValue) {
      notifications.finalStatusSentFor = statusValue;
      notifications.finalStatusSentAt = new Date().toISOString();
    }

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { paymentMetadata: { ...metadata, notifications } },
    });
  }
}