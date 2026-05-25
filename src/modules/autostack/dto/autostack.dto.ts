import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum AutoStackFrequencyDto {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export class AutoStackQuoteDto {
  @ApiProperty() @IsString() @IsNotEmpty() asset: string;
  @ApiPropertyOptional() @IsOptional() @IsString() planName?: string;
  @ApiProperty() @IsNumber() @Min(0.000001) amount: number;
}

export class AutoStackPaymentTypesDto {
  @ApiProperty() @IsString() @IsNotEmpty() quoteId: string;
}

export class AutoStackPreviewDto {
  @ApiProperty() @IsString() @IsNotEmpty() quoteId: string;
  @ApiProperty() @IsString() @IsNotEmpty() paymentType: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentCardId?: string;
  @ApiProperty({ enum: AutoStackFrequencyDto }) @IsEnum(AutoStackFrequencyDto) frequency: AutoStackFrequencyDto;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ example: '14:30' }) @IsOptional() @IsString() timeOfDay?: string;
  @ApiPropertyOptional({ example: 'MONDAY' }) @IsOptional() @IsString() dayOfWeek?: string;
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @IsNumber() dayOfMonth?: number;
}

export class AutoStackConfirmDto {
  @ApiProperty() @IsString() @IsNotEmpty() quoteId: string;
  @ApiProperty() @IsString() @IsNotEmpty() pin: string;
}

export class EndAutoStackDto {
  @ApiProperty() @IsString() @IsNotEmpty() autoStackId: string;
}
