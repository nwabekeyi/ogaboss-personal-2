import { Module } from '@nestjs/common';
import { CardService } from './card.service';
import { CardController } from './card.controller';
import { PaystackService } from '../../infrastructure/providers/paystack';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule],
  controllers: [CardController],
  providers: [CardService, PaystackService],
  exports: [CardService],
})
export class CardModule {}
