import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';

@Injectable()
export class SchedulerExecutionStateService {
  constructor(private readonly prisma: PrismaService) {}

  async isDue(jobName: string, now: Date): Promise<boolean> {
    const state = await this.prisma.schedulerJobState.findUnique({
      where: { jobName },
    });
    if (!state?.nextExecutionAt) return true;
    return state.nextExecutionAt.getTime() <= now.getTime();
  }

  async markExecuted(jobName: string, lastExecutedAt: Date, nextExecutionAt: Date) {
    await this.prisma.schedulerJobState.upsert({
      where: { jobName },
      create: { jobName, lastExecutedAt, nextExecutionAt },
      update: { lastExecutedAt, nextExecutionAt },
    });
  }
}
