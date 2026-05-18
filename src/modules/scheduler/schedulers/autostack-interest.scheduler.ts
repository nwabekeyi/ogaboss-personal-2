// import { Injectable, Logger } from '@nestjs/common';
// import { Cron, CronExpression } from '@nestjs/schedule';
// import { PrismaService } from '../../../infrastructure/databases/prisma';
// import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
// import { QueueName } from '../../../infrastructure/bullMQ/types';
// import { TempStoreService } from '../../../infrastructure';

// @Injectable()
// export class AutoStackInterestScheduler {
//   private readonly logger = new Logger(AutoStackInterestScheduler.name);
//   private readonly BATCH_SIZE = 200;
//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly queueService: QueueService,
//     private readonly tempStore: TempStoreService,
//   ) {}

//   @Cron('5 0 * * *') // Staggered: 00:05
//   async accrueDailyInterest() {
//     try {
//       await this.queueService.add(QueueName.CLEANUP, 'scheduler.autostack-interest.dispatch', {}, { jobId: `scheduler.autostack-interest.dispatch:${new Date().toISOString().slice(0,16)}` });
//       return;
//     } catch {
//       return this.execute();
//     }
//   }

//   async execute() {
//     return this.dispatchDueInterestShards();
//   }

//   async dispatchDueInterestShards() {
//     const runKey = `lock:scheduler:autostack-interest:dispatch:${new Date().toISOString().slice(0, 10)}`;
//     const lockAcquired = await this.tempStore.setNx(runKey, '1', 60 * 20);
//     if (!lockAcquired) return;

//     const now = new Date();
//     let cursor: string | undefined;
//     let shardIndex = 0;

//     while (true) {
//       const page = await this.prisma.autoStack.findMany({
//         where: { status: 'ACTIVE' as any, nextInterestAt: { lte: now } },
//         select: { id: true },
//         orderBy: { id: 'asc' },
//         take: this.BATCH_SIZE,
//         ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
//       });

//       if (page.length === 0) break;
//       const ids = page.map((p) => p.id);
//       cursor = ids[ids.length - 1];

//       await this.queueService.add(
//         QueueName.CLEANUP,
//         'scheduler.autostack-interest.shard',
//         { ids, asOf: now.toISOString() },
//         { jobId: `scheduler.autostack-interest.shard:${now.toISOString().slice(0, 10)}:${shardIndex++}` },
//       );
//     }
//   }

//   async executeShard(ids: string[], asOfIso: string) {
//     const asOf = new Date(asOfIso);
//     const active = await this.prisma.autoStack.findMany({
//       where: { id: { in: ids }, status: 'ACTIVE' as any, nextInterestAt: { lte: asOf } },
//       include: { cryptoCurrency: { include: { rate: true } } },
//     });
//     for (const stack of active) {
//       const rate = stack.cryptoCurrency.rate?.dailyRatePercent?.toNumber() || 0;
//       if (rate <= 0) continue;
//       const principal = BigInt(stack.amount.toFixed(0));
//       const interest = (principal * BigInt(Math.floor(rate))) / 36500n;
//       await this.prisma.$transaction(async (tx) => {
//         const wallet = await tx.wallet.findFirst({ where: { userId: stack.userId, currencyId: stack.currencyId } });
//         if (!wallet) return;
//         await tx.wallet.update({ where: { id: wallet.id }, data: { totalStackedInterest: (BigInt(wallet.totalStackedInterest.toFixed(0)) + interest).toString() } });
//         await tx.autoStack.update({
//           where: { id: stack.id },
//           data: {
//             accruedInterest: (BigInt(stack.accruedInterest.toFixed(0)) + interest).toString(),
//             nextInterestAt: new Date(asOf.getTime() + 24 * 60 * 60 * 1000),
//           },
//         });
//       });
//     }
//     this.logger.log(`Accrued autostack interest shard for ${active.length} plans`);
//   }
// }
