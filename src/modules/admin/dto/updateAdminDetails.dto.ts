import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '../../../infrastructure';

export class UpdatePersonalInfoDto {
  @ApiProperty({ description: 'Country of residence', example: 'Nigeria' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ description: 'Residential address', example: '24 Backbone avenue, Omole estate, New Ikeja, Lagos, Nigeria' })
  @IsOptional()
  @IsString()
  residentialAddress?: string;

  @ApiProperty({ description: 'Date of birth', example: '1990-10-01' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ description: 'Gender', enum: Gender, example: 'MALE' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}