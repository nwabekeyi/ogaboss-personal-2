import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum BillCategoryDto {
  AIRTIME = 'airtime',
  TV_SUBSCRIPTION = 'tv_subscription',
  DATA = 'data',
  ELECTRICITY = 'electricity',
  BETTING = 'betting',
}

export class ValidateBillDto {
  @ApiProperty({ example: 'cat_electricity' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: 'eko-electric' })
  @IsString()
  @IsNotEmpty()
  billerCode: string;

  @ApiProperty({ example: '04123456789' })
  @IsString()
  @IsNotEmpty()
  customerReference: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  @Min(1)
  amount: number;
}

export class BillQuoteDto extends ValidateBillDto {
  @ApiProperty({ example: 'USDT' })
  @IsString()
  @IsNotEmpty()
  walletCurrency: string;

  @ApiProperty({ example: 'optional-plan-or-product-code', required: false })
  @IsOptional()
  @IsString()
  productCode?: string;
}

export class BillPaymentConfirmDto {
  @ApiProperty({ example: 'cm123quoteid' })
  @IsString()
  @IsNotEmpty()
  quoteId: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  pin: string;
}
