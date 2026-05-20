import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ValidateBillDto {
  @ApiProperty({ example: 'electricity' })
  @IsString()
  @IsNotEmpty()
  category: string;

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

export class PayBillDto extends ValidateBillDto {
  @ApiProperty({ example: 'USDT' })
  @IsString()
  @IsNotEmpty()
  walletCurrency: string;

  @ApiProperty({ example: 'optional-plan-or-product-code', required: false })
  @IsOptional()
  @IsString()
  productCode?: string;
}
