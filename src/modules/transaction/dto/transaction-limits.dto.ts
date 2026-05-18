import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransactionLimitsDto {
  @ApiProperty({
    description: 'Crypto symbol (e.g., BTC, ETH, USDT)',
    example: 'BTC',
  })
  @IsString()
  @IsNotEmpty()
  crypto: string;
}
