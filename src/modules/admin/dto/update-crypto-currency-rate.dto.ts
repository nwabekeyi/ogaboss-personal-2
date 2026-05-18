import { IsNumber, Min, Max, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCryptoCurrencyRateDto {
  @ApiProperty({
    description: 'Interest rate percentage (0-100)',
    example: 5.5,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  interestRatePercent?: number;

  @ApiProperty({
    description: 'Locked funds interest rate percentage (0-100)',
    example: 10,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  lockedFundsInterestRatePercent?: number;
}

export class UpdateSingleCryptoCurrencyRateDto {
  @ApiProperty({ description: 'Cryptocurrency ID', example: 'cuid123' })
  @IsString()
  cryptoId: string;

  @ApiProperty({
    description: 'Interest rate percentage (0-100)',
    example: 5.5,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  interestRatePercent: number;

  @ApiProperty({
    description: 'Locked funds interest rate percentage (0-100)',
    example: 10,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  lockedFundsInterestRatePercent: number;
}

export class BulkUpdateCryptoCurrencyRateDto {
  @ApiProperty({
    type: [UpdateSingleCryptoCurrencyRateDto],
    description: 'Array of rate updates for multiple cryptocurrencies',
  })
  updates: UpdateSingleCryptoCurrencyRateDto[];
}
