import {
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUrgentLiquiditySettingsDto {
  @ApiPropertyOptional({
    description: 'Maximum allowed loan request amount',
    example: 100000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxLoanRequest?: number;

  @ApiPropertyOptional({
    description: 'Loan fee percentage (0-100)',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  loanFeePercent?: number;

  @ApiPropertyOptional({
    description: 'Settlement percentage (0-100)',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  settlementPercent?: number;

  @ApiPropertyOptional({
    description: 'Collateral percentage (0-100)',
    example: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  collateralPercent?: number;

  @ApiPropertyOptional({
    description: 'Liquidation deadline in days',
    example: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  liquidationDeadlineDays?: number;

  @ApiPropertyOptional({
    description: 'Liquidation fee percentage (0-100)',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  liquidationFeePercent?: number;
}

export class CreateRepaymentRangeDto {
  @ApiProperty({
    description: 'From amount (minimum loan amount)',
    example: 5000,
  })
  @IsNumber()
  @Min(1)
  fromAmount: number;

  @ApiProperty({
    description: 'To amount (maximum loan amount)',
    example: 50000,
  })
  @IsNumber()
  @Min(1)
  toAmount: number;

  @ApiProperty({ description: 'Repayment duration in days', example: 30 })
  @IsInt()
  @Min(1)
  repaymentDurationDays: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string = 'NGN';
}

export class UpdateRepaymentRangeDto {
  @ApiPropertyOptional({
    description: 'From amount (minimum loan amount)',
    example: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fromAmount?: number;

  @ApiPropertyOptional({
    description: 'To amount (maximum loan amount)',
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  toAmount?: number;

  @ApiPropertyOptional({
    description: 'Repayment duration in days',
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  repaymentDurationDays?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class BulkRepaymentRangesDto {
  @ApiProperty({
    type: [CreateRepaymentRangeDto],
    description: 'Array of repayment ranges to create',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRepaymentRangeDto)
  ranges: CreateRepaymentRangeDto[];
}
