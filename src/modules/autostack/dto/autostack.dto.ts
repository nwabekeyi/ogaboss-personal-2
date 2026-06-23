import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AutoStackFrequencyDto {
  DAILY = 1,
  WEEKLY = 2,
  MONTHLY = 3,
}

export class AutoStackQuoteDto {
  @ApiProperty({
    description: 'Crypto currency id selected by the user from the currencies table.',
    example: 'cml6nkzxh0001g6fe6soo2taw',
  })
  @IsString()
  @IsNotEmpty()
  assetId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() planName?: string;
  @ApiProperty() @IsNumber() @Min(0.000001) amount: number;
}

export class AutoStackPaymentTypesDto {
  @ApiProperty() @IsString() @IsNotEmpty() quoteId: string;
}

export class AutoStackPreviewDto {
  @ApiProperty() @IsString() @IsNotEmpty() quoteId: string;
  @ApiProperty({
    enum: ['CARD', 'CRYPTO_WALLET'],
    description:
      'Payment source type. Use CRYPTO_WALLET to charge the selected asset wallet; use CARD only when paying with a saved card.',
    example: 'CRYPTO_WALLET',
  })
  @IsString()
  @IsNotEmpty()
  paymentType: string;
  @ApiPropertyOptional({
    description: 'Required only when paymentType is CARD. Not needed for CRYPTO_WALLET payments.',
  })
  @IsOptional()
  @IsString()
  paymentCardId?: string;
  @ApiProperty({
    enum: [1, 2, 3],
    description: 'Autostack frequency: 1 = daily, 2 = weekly, 3 = monthly.',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3])
  frequency: AutoStackFrequencyDto;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ example: '14:30' }) @IsOptional() @IsString() timeOfDay?: string;
  @ApiPropertyOptional({
    description:
      'Day of the week for weekly autostacks: 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday, 7 = Sunday. Not required for daily autostacks.',
    example: 1,
  })
  @ValidateIf((dto) => dto.frequency === AutoStackFrequencyDto.WEEKLY)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @IsNumber() dayOfMonth?: number;
}

export class AutoStackConfirmDto {
  @ApiProperty() @IsString() @IsNotEmpty() quoteId: string;
  @ApiProperty() @IsString() @IsNotEmpty() pin: string;
}

export class EndAutoStackDto {
  @ApiProperty() @IsString() @IsNotEmpty() autoStackId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pin?: string;
}