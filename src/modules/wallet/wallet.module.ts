// src/modules/wallet/wallet.module.ts
import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AuthModule } from '../auth/auth.module';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { SharedModule } from '../../shared/shared.module';
@Module({
  imports: [
    AuthModule,
    QuidaxModule,
    SharedModule
  ],
  controllers: [WalletController],
  providers: [
    WalletService,
  ],
  exports: [WalletService],
})
export class WalletModule {}
