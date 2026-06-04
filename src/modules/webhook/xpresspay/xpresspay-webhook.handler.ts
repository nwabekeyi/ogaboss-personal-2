import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';
import {
  ConvertCurrency,
  LiquidityReservationStatus,
  toBigInt,
  toDecimal,
} from '../../../shared';
import {
  CompanyLiquidityService,
  TransactionService,
} from '../../transaction/services';
import { BASE_CURRENCY } from '../../../shared';

@Injectable()
export class XpresspayWebhookHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
  ) {}

  async process(payload: any): Promise<void> {
    const providerReference =
      payload?.TransactionReference || payload?.TransactionId || payload?.Id;
    if (!providerReference) return;

    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { id: providerReference },
          { transactionUniqueId: providerReference },
        ],
      },
      include: { billPayment: true },
    });
    if (!tx || !tx.billPayment) return;

    const ok = payload.IsSuccessful === true && payload.Status === '00';
    const totalSentBase = toBigInt(
      tx.totalAmountSentBase ?? tx.cryptoAmountBase ?? 0n,
    );
    const billAmountBase = toBigInt(tx.fiatAmountBase ?? 0n);

    await this.prisma.$transaction(async (db) => {
      await db.$queryRaw`
        SELECT "id" FROM "transactions"
        WHERE "id" = ${tx.id}
        FOR UPDATE
      `;
      const latest = await db.transaction.findUnique({
        where: { id: tx.id },
        select: {
          paymentMetadata: true,
          senderWalletId: true,
          status: true,
          userId: true,
          currency: true,
        },
      });
      if (!latest) return;

      const metadata = (latest.paymentMetadata || {}) as Record<string, any>;
      if (metadata.xpresspayWebhookStatus === 'COMPLETED') return;

      if (ok) {
        if (!latest.senderWalletId || totalSentBase <= 0n) return;
        await this.transactionService.releaseBalance(
          db,
          latest.userId,
          latest.currency,
          totalSentBase,
        );
        const [{ baseBalance: newBaseStr }] = await db.$queryRaw<
          { baseBalance: string }[]
        >`
          UPDATE "wallets"
          SET "baseBalance" = GREATEST("baseBalance" - ${toDecimal(totalSentBase)}, 0)
          WHERE "id" = ${latest.senderWalletId}
          RETURNING "baseBalance"
        `;
        const newOriginalBalance = ConvertCurrency.fromBase(
          BigInt(String(newBaseStr)),
          latest.currency,
          6,
        );
        await db.$executeRaw`
          UPDATE "wallets"
          SET "originalBalance" = ${newOriginalBalance}
          WHERE "id" = ${latest.senderWalletId}
        `;
        const consumedLiquidity =
          await this.companyLiquidityService.consumeReservedLiquidity(
            BASE_CURRENCY,
            billAmountBase,
            db,
          );
        if (!consumedLiquidity) {
          throw new Error('Unable to consume reserved bill payment liquidity');
        }
        await this.companyLiquidityService.updateInternalBalance(
          latest.currency,
          toDecimal(totalSentBase),
          'subtract',
          db,
        );
      }

      if (!ok && metadata.xpresspayWebhookStatus !== 'FAILED') {
        if (latest.senderWalletId && totalSentBase > 0n) {
          await this.transactionService.releaseBalance(
            db,
            latest.userId,
            latest.currency,
            totalSentBase,
          );
        }

        if (
          metadata.liquidityReservationStatus ===
          LiquidityReservationStatus.RESERVED
        ) {
          await this.companyLiquidityService.releaseLiquidity(
            BASE_CURRENCY,
            billAmountBase,
            db,
          );
        }
      }

      const settlementMetadata = ok
        ? {
            liquidityReservationStatus: LiquidityReservationStatus.CONSUMED,
            liquidityConsumedAt: new Date().toISOString(),
            liquidityConsumedReason: 'bill_payment_completed',
          }
        : {
            liquidityReservationStatus:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? LiquidityReservationStatus.RELEASED
                : metadata.liquidityReservationStatus,
            liquidityReleasedAt:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? new Date().toISOString()
                : metadata.liquidityReleasedAt,
            liquidityReleaseReason:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? 'bill_payment_failed'
                : metadata.liquidityReleaseReason,
          };

      await db.transaction.update({
        where: { id: tx.id },
        data: {
          status: ok ? ('COMPLETED' as any) : ('FAILED' as any),
          isProcessed: true,
          paymentMetadata: {
            ...metadata,
            ...settlementMetadata,
            xpresspayWebhook: payload,
            xpresspayWebhookStatus: ok ? 'COMPLETED' : 'FAILED',
            billingStatus: ok ? 'COMPLETED' : 'FAILED',
          } as any,
        },
      });

      await db.billPayment.update({
        where: { id: tx.billPayment!.id },
        data: {
          status: ok ? 'COMPLETED' : 'FAILED',
          providerResponse: payload,
        },
      });

      await db.order.updateMany({
        where: { transactionId: tx.id },
        data: {
          status: ok ? ('COMPLETED' as any) : ('FAILED' as any),
          paymentStatus: ok ? ('PAID' as any) : ('FAILED' as any),
          gatewayResponse: JSON.stringify(payload),
        },
      });
    });
  }
}
