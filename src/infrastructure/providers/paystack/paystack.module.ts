import { Module } from '@nestjs/common';
import { PaystackService } from './paystack.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
