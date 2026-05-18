import {
  IsString,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class VaultQuoteDto {
  @ApiProperty({ description: 'Cryptocurrency ID', example: 'cuid123' })
  @IsString()
  @IsNotEmpty()
  currencyId: string;

  @ApiProperty({ description: 'Amount to lock', example: '100.00' })
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiProperty({ description: 'Duration in days', example: 30 })
  @IsNumber()
  @Min(1)
  durationDays: number;
}

export class VaultPreviewDto {
  @ApiProperty({ description: 'Quote ID', example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  quoteId: string;
}

export class VaultConfirmDto {
  @ApiProperty({ description: 'Quote ID', example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  quoteId: string;
}

export class LockVaultDto {
  @ApiProperty({ description: 'Cryptocurrency symbol', example: 'USDT' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => value?.toUpperCase())
  currency: string;

  @ApiProperty({ description: 'Duration in days', example: 30 })
  @IsNumber()
  @Min(1)
  durationDays: number;

  @ApiProperty({ description: 'Amount to lock', example: '100.00' })
  @IsNumber()
  @Min(0.00000001)
  amount: number;
}

export class UnlockVaultDto {
  @ApiProperty({ description: 'Vault ID', example: 'cuid123' })
  @IsString()
  @IsNotEmpty()
  vaultId: string;

  @ApiProperty({ description: 'Transaction PIN for early unlock', example: '1234' })
  @IsString()
  @IsNotEmpty()
  pin: string;
}

export class VaultResponseDto {
  @ApiProperty({ description: 'Vault ID' })
  id: string;

  @ApiProperty({ description: 'Currency ID' })
  currencyId: string;

  @ApiProperty({ description: 'Currency symbol' })
  currency: string;

  @ApiProperty({ description: 'Amount locked' })
  amountLocked: string;

  @ApiProperty({ description: 'Maturity date' })
  maturityDate: Date;

  @ApiProperty({ description: 'Total gain percentage' })
  totalGain: string;

  @ApiProperty({ description: 'Interest rate per annum' })
  interestRatePerAnum: string;

  @ApiProperty({ description: 'Vault status' })
  status: string;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}

export class VaultsListResponseDto {
  @ApiProperty({ type: [VaultResponseDto] })
  vaults: VaultResponseDto[];

  @ApiProperty({ description: 'Total locked amount' })
  totalLocked: string;

  @ApiProperty({ description: 'Total gain earned' })
  totalGain: string;
}
