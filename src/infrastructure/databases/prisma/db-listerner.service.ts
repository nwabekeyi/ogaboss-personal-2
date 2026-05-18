// src/infrastructure/databases/prisma/db-watcher.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Client } from 'pg';

@Injectable()
export class DbWatcherService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private readonly logger = new Logger(DbWatcherService.name);

  async onModuleInit() {
    this.client = new Client({
      connectionString: process.env.DATABASE_URL,
    });

    await this.client.connect();

    // NEW TRIGGER CHANNEL
    await this.client.query('LISTEN user_status_changed');

    this.client.on('notification', (msg) => {
      if (!msg.payload) return;
      const payload = JSON.parse(msg.payload);

      switch (msg.channel) {
        case 'user_status_changed':
          break;

        default:
      }
    });

    this.client.on('error', (err) => {
      this.logger.error('Postgres LISTEN error:', err);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.end();
    }
  }

  // Used by DashboardStatsService
  getClient() {
    return this.client;
  }
}
