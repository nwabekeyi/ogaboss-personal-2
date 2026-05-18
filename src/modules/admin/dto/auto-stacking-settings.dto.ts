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

export class UpdateAutoStackingSettingsDto {
  @ApiPropertyOptional({
    description: 'Daily interest rate percentage (0-100)',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  dailyInterestRatePercent?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class CreateAutoStackingTransactionFeeDto {
  @ApiProperty({ description: 'From amount', example: 1000 })
  @IsNumber()
  @Min(0)
  fromAmount: number;

  @ApiProperty({ description: 'To amount', example: 10000 })
  @IsNumber()
  @Min(0)
  toAmount: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string = 'NGN';

  @ApiProperty({ description: 'Fee amount', example: 100 })
  @IsNumber()
  @Min(0)
  feeAmount: number;

  @ApiPropertyOptional({ description: 'Fee currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  feeCurrency?: string = 'NGN';
}

export class UpdateAutoStackingTransactionFeeDto {
  @ApiPropertyOptional({ description: 'From amount', example: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fromAmount?: number;

  @ApiPropertyOptional({ description: 'To amount', example: 10000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  toAmount?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Fee amount', example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  feeAmount?: number;

  @ApiPropertyOptional({ description: 'Fee currency code', example: 'NGN' })
  @IsOptional()
  @IsString()
  feeCurrency?: string;
}

export class BulkAutoStackingTransactionFeesDto {
  @ApiProperty({
    type: [CreateAutoStackingTransactionFeeDto],
    description: 'Array of transaction fee ranges to create',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAutoStackingTransactionFeeDto)
   fees: CreateAutoStackingTransactionFeeDto[];
}
