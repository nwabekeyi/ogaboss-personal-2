import { Module } from '@nestjs/common';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { PaystackModule } from '../../infrastructure/providers/paystack';
import { TransactionModule } from '../transaction/transaction.module';
import { AutoStackController } from './controllers/autostack.controller';
import { AutoStackService } from './services/autostack.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [QuidaxModule, PaystackModule, TransactionModule],
  controllers: [AutoStackController],
  providers: [AutoStackService, JwtService],
  exports: [AutoStackService],
})
export class AutoStackModule {}