import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum AutoStackFrequencyDto {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export class AutoStackPreviewDto {
  @ApiProperty() @IsString() @IsNotEmpty() currencyId: string;
  @ApiProperty() @IsString() @IsNotEmpty() planName: string;
  @ApiProperty({ enum: AutoStackFrequencyDto }) @IsEnum(AutoStackFrequencyDto) frequency: AutoStackFrequencyDto;
  @ApiProperty() @IsNumber() @Min(0.000001) amount: number;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty({ example: '14:30' }) @IsString() timeOfDay: string;
  @ApiPropertyOptional({ example: 'MONDAY,TUESDAY' }) @IsOptional() @IsString() dayOfWeek?: string;
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @IsNumber() dayOfMonth?: number;
}

export class AutoStackConfirmDto extends AutoStackPreviewDto {
  @ApiProperty() @IsString() @IsNotEmpty() pin: string;
}

export class EndAutoStackDto {
  @ApiProperty() @IsString() @IsNotEmpty() autoStackId: string;
}
