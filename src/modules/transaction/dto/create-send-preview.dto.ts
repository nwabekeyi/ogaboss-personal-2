// src/modules/transaction/dto/create-send-preview.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, IsOptional } from 'class-validator';

export class CreateSendPreviewDto {
  @ApiProperty({
    example: 'btc',
    description: 'The currency to send, e.g., BTC, ETH, XRP',
  })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({
    example: '0.01',
    description: 'Amount to send (as a string, e.g., "0.01")',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'Amount must be a string representing a valid positive number',
  })
  amount: string;

  @ApiProperty({
    example: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    description: 'Recipient wallet address',
  })
  @IsString()
  @IsNotEmpty()
  toAddress: string;

  @ApiProperty({
    example: 'BTC',
    description: 'The network for the currency, e.g., BTC, ETH, XRP',
  })
  @IsString()
  @IsNotEmpty()
  network: string;

  @ApiProperty({
    description: 'Required only for XRP token; leave empty for other currencies',
    required: false,
    example: '123456789',
  })
  @IsString()
  @IsOptional()
  destinationTag?: string;
}
