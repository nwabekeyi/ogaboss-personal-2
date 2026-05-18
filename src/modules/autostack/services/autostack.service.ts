// import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// import { PrismaService } from '../../../infrastructure/databases/prisma';
// import { compareHash } from '../../../shared/services/hash';
// import { AutoStackConfirmDto, AutoStackPreviewDto } from '../dto/autostack.dto';
// import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
// import { QueueName } from '../../../infrastructure/bullMQ/types';

// @Injectable()
// export class AutoStackService {
//   constructor(private readonly prisma: PrismaService, private readonly queueService: QueueService) {}

//   async preview(userId: string, dto: AutoStackPreviewDto) {
//     const crypto = await this.prisma.cryptoCurrency.findUnique({ where: { id: dto.currencyId }, include: { rate: true } });
//     if (!crypto) throw new NotFoundException('Cryptocurrency not found');
//     const symbol = crypto.symbol.toUpperCase();
//     if (!['USDT', 'USDC'].includes(symbol)) throw new BadRequestException('Only USDT and USDC are allowed for autostack');
//     if (!crypto.rate || crypto.rate.dailyRatePercent.toNumber() <= 0) throw new BadRequestException('Daily interest rate is not configured for this currency');

//     const feeSetting = await this.prisma.autoStackingTransactionFee.findFirst({ where: { currency: symbol, isActive: true } });
//     const feePercent = feeSetting?.feePercent?.toNumber() || 0;
//     const txFee = (dto.amount * feePercent) / 100;
//     const amountToReceive = dto.amount - txFee;

//     return { success: true, data: { frequency: dto.frequency, planName: dto.planName, transactionFee: txFee.toFixed(8), amountToReceive: amountToReceive.toFixed(8) } };
//   }

//   async confirm(userId: string, dto: AutoStackConfirmDto) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { pin: true } });
//     if (!user?.pin || !(await compareHash(dto.pin, user.pin))) throw new BadRequestException('Invalid pin');

//     const wallet = await this.prisma.wallet.findFirst({ where: { userId, currencyId: dto.currencyId } });
//     if (!wallet) throw new NotFoundException('Wallet not found');

//     const amountMinor = BigInt(Math.floor(dto.amount * 1_000_000));
//     const baseMinor = BigInt(wallet.baseBalance.toFixed(0));
//     if (baseMinor < amountMinor) throw new BadRequestException('Insufficient balance');

//     const nextExecutionAt = new Date(dto.startDate);
//     const [h, m] = dto.timeOfDay.split(':').map(Number);
//     nextExecutionAt.setUTCHours(h, m, 0, 0);

//     const autoStack = await this.prisma.$transaction(async (tx) => {
//       const created = await tx.autoStack.create({ data: { userId, currencyId: dto.currencyId, planName: dto.planName, frequency: dto.frequency as any, amount: amountMinor.toString(), startDate: new Date(dto.startDate), timeOfDay: dto.timeOfDay, dayOfWeek: dto.dayOfWeek, dayOfMonth: dto.dayOfMonth, nextExecutionAt, nextInterestAt: nextExecutionAt } });
//       await tx.wallet.update({ where: { id: wallet.id }, data: { baseBalance: (baseMinor - amountMinor).toString(), stackedAmount: (BigInt(wallet.stackedAmount.toFixed(0)) + amountMinor).toString() } });
//       return created;
//     });

//     await this.queueService.add(QueueName.CLEANUP, 'autostack.execute', { autoStackId: autoStack.id }, { jobId: `autostack:${autoStack.id}`, delay: Math.max(nextExecutionAt.getTime() - Date.now(), 0) });
//     return { success: true, message: 'Autostack created', data: autoStack };
//   }

//   async getActive(userId: string) {
//     const plans = await this.prisma.autoStack.findMany({ where: { userId, status: 'ACTIVE' as any }, orderBy: { createdAt: 'desc' } });
//     return { success: true, data: plans };
//   }

//   async end(userId: string, autoStackId: string) {
//     const plan = await this.prisma.autoStack.findFirst({ where: { id: autoStackId, userId, status: 'ACTIVE' as any } });
//     if (!plan) throw new NotFoundException('Autostack not found');
//     const wallet = await this.prisma.wallet.findFirst({ where: { userId, currencyId: plan.currencyId } });
//     if (!wallet) throw new NotFoundException('Wallet not found');
//     const principal = BigInt(plan.amount.toFixed(0));
//     const interest = BigInt(plan.accruedInterest.toFixed(0));
//     await this.prisma.$transaction(async (tx) => {
//       await tx.wallet.update({ where: { id: wallet.id }, data: { baseBalance: (BigInt(wallet.baseBalance.toFixed(0)) + principal + interest).toString(), stackedAmount: (BigInt(wallet.stackedAmount.toFixed(0)) - principal).toString() } });
//       await tx.autoStack.update({ where: { id: autoStackId }, data: { status: 'ENDED' as any, endedAt: new Date() } });
//       const crypto = await tx.cryptoCurrency.findUnique({ where: { id: plan.currencyId } });
//       if (crypto) {
//         await tx.$executeRaw`UPDATE "company_liquidity" SET "totalAmountStacked" = "totalAmountStacked" - ${principal.toString()}::decimal, "totalStackedInterestPaid" = "totalStackedInterestPaid" + ${interest.toString()}::decimal WHERE "currency" = ${crypto.symbol.toUpperCase()}`;
//       }
//     });
//     return { success: true, message: 'Autostack ended' };
//   }
// }
