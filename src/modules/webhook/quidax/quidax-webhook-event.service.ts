import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject, ValidationError } from 'class-validator';
import { AddressGeneratedHandler } from './handlers/address-generated.handler';
import { DepositSuccessfulHandler } from './handlers/deposit-successful.handler';
import { SwapTransactionHandler } from './handlers/swap-transaction.handler';
import { WalletAddressGeneratedDataDto } from './dtos/wallet-address-generated.dto';
import { DepositSuccessfulDataDto } from './dtos/deposit-successful.dto';
import { SwapWebhookDto } from './dtos/swap-webhook.dto';
import { WithdrawalWebhookDataDto } from './dtos/withdrawal-webhook.dto';
import { WithdrawalWebhookHandler } from './handlers';
import { OrderDoneDataDTO } from './dtos/order-done-webhook.dto';
import { OrderDoneHandler } from './handlers/order-done.handler';
import { WebhookIdempotencyService } from '../service/webhook-idempotency.service';
import { isTransientPrismaError } from '../../../shared';
import { CompensatedError } from '../compensated-error';

@Injectable()
export class QuidaxWebhookService {
  private readonly logger = new Logger(QuidaxWebhookService.name);

  constructor(
    private readonly addressHandler: AddressGeneratedHandler,
    private readonly depositHandler: DepositSuccessfulHandler,
    private readonly swapHandler: SwapTransactionHandler,
    private readonly withdrawalHandler: WithdrawalWebhookHandler,
    private readonly orderDoneHandler: OrderDoneHandler,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {}

  async processWebhookEvent(payload: any, webhookId?: string): Promise<void> {
    const event = payload?.event;
    const dataId = payload?.data?.id;

    console.log(
      `[QuidaxWebhookService] Received event: ${event}, data.id: ${dataId}`,
    );
    console.log(
      `[QuidaxWebhookService] Full payload: ${JSON.stringify(payload)}`,
    );

    const { data } = payload;

    if (!data?.id) {
      this.logger.warn('Webhook payload missing data.id, skipping');
      return;
    }

    this.logger.debug(`Switching on event: ${event}`);
    try {
      switch (event) {
        case 'wallet.address.generated': {
          this.logger.log('Processing wallet.address.generated case');
          this.logger.debug(
            `Data for address generated: ${JSON.stringify(data)}`,
          );
          const dto = plainToInstance(WalletAddressGeneratedDataDto, data);
          this.logger.debug(`DTO created, validating...`);

          try {
            await validateOrReject(dto);
            this.logger.debug('DTO validated successfully, calling handler...');
          } catch (validationError) {
            this.logger.error(
              `WalletAddressGenerated DTO validation failed: ${JSON.stringify(validationError)}`,
            );
            throw validationError;
          }

          await this.addressHandler.process(dto);
          this.logger.log('Completed wallet.address.generated processing');
          break;
        }

        case 'deposit.successful': {
          this.logger.log('Processing deposit.successful case');
          const dto = plainToInstance(DepositSuccessfulDataDto, data);
          this.logger.debug('Validating deposit DTO');

          try {
            await validateOrReject(dto);
          } catch (validationError) {
            this.logger.error(
              `Deposit DTO validation failed: ${JSON.stringify(validationError)}`,
            );
            throw validationError;
          }

          this.logger.debug('Calling deposit handler');
          await this.depositHandler.process(dto);
          this.logger.log('Completed deposit.successful processing');
          break;
        }

        case 'order.done': {
          this.logger.log('Processing order.done case');
          const dto = plainToInstance(OrderDoneDataDTO, data);
          this.logger.debug('DTO created, validating...');

          try {
            await validateOrReject(dto);
          } catch (validationError) {
            this.logger.error(
              `OrderDone DTO validation failed: ${JSON.stringify(validationError)}`,
            );
            throw validationError;
          }

          this.logger.debug('Calling order done handler');
          await this.orderDoneHandler.process(dto);
          this.logger.log('Completed order.done processing');
          break;
        }

        case 'withdraw.successful':
        case 'withdraw.rejected': {
          this.logger.log(`Processing ${event} case`);
          const dto = plainToInstance(WithdrawalWebhookDataDto, data);

          try {
            await validateOrReject(dto);
          } catch (validationError) {
            this.logger.error(
              `Withdrawal DTO validation failed: ${JSON.stringify(validationError)}`,
            );
            throw validationError;
          }

          await this.withdrawalHandler.process(event, dto);
          this.logger.log(`Completed ${event} processing`);
          break;
        }

        default: {
          if (event.startsWith('swap_transaction.')) {
            this.logger.log(`Processing swap event: ${event}`);
            const dto = plainToInstance(SwapWebhookDto, payload);

            await validateOrReject(dto);
            await this.swapHandler.process(data, event);
            this.logger.log(`Completed swap processing`);
            break;
          }

          this.logger.warn(`Unhandled Quidax event: ${event}`);
        }
      }

      // Mark webhook as processed on success
      if (webhookId) {
        try {
          await this.webhookIdempotencyService.markProcessed(webhookId);
        } catch (markErr: any) {
          this.logger.error(
            `Failed to mark webhook ${webhookId} as processed: ${markErr?.message}`,
          );
        }
      }
    } catch (err: any) {
      if (Array.isArray(err) && err[0] instanceof ValidationError) {
        this.logger.error(
          `Webhook validation failed (${event} / ${data.id}): ${JSON.stringify(err)}`,
        );
        return; // Don't retry validation errors
      }

      if (err instanceof CompensatedError) {
        this.logger.warn(
          `Webhook compensated (${event} / ${data.id}): ${err.message}`,
        );
        if (webhookId) {
          await this.webhookIdempotencyService
            .markFailed(webhookId, err.message)
            .catch(() => undefined);
        }
        throw err;
      }

      if (isTransientPrismaError(err)) {
        this.logger.error(
          `Transient DB error processing webhook (${event} / ${data.id}): ${err.message}`,
        );
        throw err; // Let BullMQ retry
      }

      this.logger.error(
        `Webhook processing failed (${event} / ${data.id}): ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
