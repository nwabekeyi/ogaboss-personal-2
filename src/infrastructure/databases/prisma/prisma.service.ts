import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  [x: string]: any;
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
      min: 1,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    super({
      adapter,
      log: ['error', 'warn'],
      errorFormat: 'minimal',
      transactionOptions: {
        timeout: 30000,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    Logger.log('Database connected', 'PrismaService');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: any) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}

// export const dropDatabase = async (): Promise<void> => {
//   try {
//     console.log('Dropping database >>>>>');
//     // eslint-disable-next-line @typescript-eslint/no-var-requires
//     const { PrismaClient } = require('@prisma/client');
//     const prisma = new PrismaClient();

//     // Drop all tables in the database
//     const tableNames = await prisma.$queryRaw<
//       Array<{ tablename: string }>
//     >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

//     for (const { tablename } of tableNames) {
//       console.log('Dropping table >>>>>', tablename);
//       await prisma.$executeRawUnsafe(
//         `DROP TABLE IF EXISTS "${tablename}" CASCADE`,
//       );
//     }

//     console.log('Database dropped successfully');

//     await prisma.$disconnect();
//   } catch (error) {
//     console.error('Failed to drop database', error);
//     throw error;
//   }
// };

// (async () => {
//   console.log('Dropping database');
//   await dropDatabase();
//   console.log('Database dropped successfully 2');
// })();
