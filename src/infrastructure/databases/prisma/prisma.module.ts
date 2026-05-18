// src/infrastructure/databases/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DbWatcherService } from './db-listerner.service';

@Global()
@Module({
  providers: [PrismaService, DbWatcherService],
  exports: [PrismaService, DbWatcherService],
})
export class PrismaModule {}
