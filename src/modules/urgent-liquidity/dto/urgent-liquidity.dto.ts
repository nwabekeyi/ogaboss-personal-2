import {
  IsString,
  IsNumber,
  Min,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UrgentLiquidityQuoteDto {
  @ApiProperty({
    description: 'Loan amount requested in NGN',
    example: 50000,
  })
  @IsNumber()
  @Min(1)
  loanAmount: number;

  @ApiProperty({
    description: 'Cryptocurrency asset ID to use as collateral',
    example: 'cml6nkzxh0001g6fe6soo2taw',
  })
  @IsString()
  @IsNotEmpty()
  collateralAssetId: string;
}

export class UrgentLiquidityPreviewDto {
  @ApiProperty({
    description: 'Quote ID returned from quote endpoint',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsNotEmpty()
  quoteId: string;

  @ApiProperty({
    description: 'Deposit bank account ID where loan should be disbursed',
    example: 'bank-account-id',
  })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;
}

export class UrgentLiquidityConfirmDto {
  @ApiProperty({
    description: 'Quote ID returned from quote endpoint',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsNotEmpty()
  quoteId: string;

  @ApiProperty({
    description: 'Transaction PIN to confirm loan request',
    example: '1234',
  })
  @IsString()
  @IsNotEmpty()
  pin: string;
}
