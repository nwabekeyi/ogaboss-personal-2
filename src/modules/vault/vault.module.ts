import { Module } from '@nestjs/common';
import { VaultController } from './controllers/vault.controller';
import { VaultService } from './services/vault.service';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { JwtService } from '@nestjs/jwt';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [QuidaxModule, TransactionModule],
  controllers: [VaultController],
  providers: [
    VaultService,
    JwtService
  ],
  exports: [VaultService],
})
export class VaultModule {}
