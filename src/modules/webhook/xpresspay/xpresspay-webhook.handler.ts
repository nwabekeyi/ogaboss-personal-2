import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';

@Injectable()
export class XpresspayWebhookHandler {
  constructor(private readonly prisma: PrismaService) {}

  async process(payload: any): Promise<void> {
    const transactionId = payload?.TransactionId;
    if (!transactionId) return;

    const tx = await this.prisma.transaction.findFirst({
      where: { OR: [{ id: transactionId }, { transactionUniqueId: transactionId }] },
      include: { billPayment: true },
    });
    if (!tx || !tx.billPayment) return;

    const ok = payload.IsSuccessful === true && payload.Status === '00';
    const amountMinor = BigInt(tx.cryptoAmountBase?.toFixed(0) || '0');

    await this.prisma.$transaction(async (db) => {
      const latest = await db.transaction.findUnique({ where: { id: tx.id }, select: { paymentMetadata: true, senderWalletId: true } });
      if (!latest) return;

      if (ok) {
        const wallet = await db.wallet.findUnique({ where: { id: latest.senderWalletId! } });
        if (!wallet) return;
        const balance = BigInt(wallet.baseBalance.toFixed(0));
        await db.wallet.update({ where: { id: wallet.id }, data: { baseBalance: (balance - amountMinor).toString() } });
      }

      await db.transaction.update({
        where: { id: tx.id },
        data: {
          status: ok ? 'COMPLETED' as any : 'FAILED' as any,
          paymentMetadata: {
            ...((latest.paymentMetadata || {}) as Record<string, any>),
            xpresspayWebhook: payload,
            xpresspayWebhookStatus: ok ? 'COMPLETED' : 'FAILED',
            billingStatus: ok ? 'COMPLETED' : 'FAILED',
          } as any,
        },
      });

      await db.billPayment.update({ where: { id: tx.billPayment!.id }, data: { status: ok ? 'COMPLETED' : 'FAILED', providerResponse: payload } });
    });
  }
}
