import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayModule } from '../../infrastructure/providers/xpresspay/xpresspay.module';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { TransactionModule } from '../transaction/transaction.module';
import { JwtModule, JwtService } from '@nestjs/jwt';

@Module({
  imports: [XpresspayModule, QuidaxModule, TransactionModule, JwtModule],
  controllers: [BillsController],
  providers: [BillsService, PrismaService, JwtService],
})
export class BillsModule {}