// src/infrastructure/scheduler/schedulers/quidax-ticker.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax';

@Injectable()
export class QuidaxTickerScheduler {
  private readonly logger = new Logger(QuidaxTickerScheduler.name);

  constructor(private readonly tickerService: QuidaxTickerService) {}

  async onModuleInit() {
    setTimeout(() => this.handleQuidaxTickers(), 5000);
  }

  @Cron('*/2 * * * *') // Every 2 minutes
  async handleQuidaxTickers() {
    try {
      await this.tickerService.fetchAndCacheTickers();
    } catch (error) {
      this.logger.error('Failed to fetch tickers', error);
    }
  }
}