import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayModule } from '../../infrastructure/providers/xpresspay/xpresspay.module';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';

@Module({
  imports: [XpresspayModule],
  controllers: [BillsController],
  providers: [BillsService, PrismaService],
})
export class BillsModule {}
