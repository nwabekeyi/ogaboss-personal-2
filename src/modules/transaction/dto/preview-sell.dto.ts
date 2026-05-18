import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PreviewSellDto {
  @ApiProperty({
    description: 'Crypto quoteId',
    example: 'sell_quote_123',
  })
  @IsString()
  @IsNotEmpty()
  quoteId: string;

  @ApiProperty({
    description: 'User bank account ID to receive fiat',
    example: 'bank_123abc',
  })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;
}