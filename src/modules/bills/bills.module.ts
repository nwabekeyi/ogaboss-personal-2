import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayModule } from '../../infrastructure/providers/xpresspay/xpresspay.module';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [XpresspayModule, QuidaxModule, TransactionModule],
  controllers: [BillsController],
  providers: [BillsService, PrismaService],
})
export class BillsModule {}
