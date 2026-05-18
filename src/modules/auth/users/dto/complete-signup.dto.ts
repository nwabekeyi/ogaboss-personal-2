// src/user/dto/complete-signup.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Gender } from '../../../../infrastructure';

export class CompleteSignUpDTO {
  @ApiProperty({
    example: 'Chidi',
    description: 'The first name of the user',
  })
  @IsString({ message: 'First name must be a string' })
  @IsNotEmpty({ message: 'First name is required' })
  @Length(3, 25, { message: 'First name must be between 3 and 25 characters' })
  firstName: string;

  @ApiProperty({
    example: 'Mwabekeyi',
    description: 'The last name of the user',
  })
  @IsString({ message: 'Last name must be a string' })
  @IsNotEmpty({ message: 'Last name is required' })
  @Length(3, 25, { message: 'Last name must be between 3 and 25 characters' })
  lastName: string;

  @ApiProperty({
    example: '+2348023456789',
    description: 'The phone number of the user in E.164 format (e.g., +234XXXXXXXXXX)',
  })
  @IsString({ message: 'Phone number must be a string' })
  @IsNotEmpty({ message: 'Phone number is required' })
  @Length(14, 14, { message: 'Phone number must be exactly 14 characters (e.g., +234XXXXXXXXXX)' })
  @Matches(/^\+\d{13}$/, { message: 'Phone number must start with + and contain 13 digits' })
  phoneNumber: string;

  @ApiProperty({
    example: 'Nigeria',
    description: 'The country of residence of the user',
  })
  @IsString({ message: 'Country must be a string' })
  @IsNotEmpty({ message: 'Country is required' })
  @Length(2, 50, { message: 'Country must be between 2 and 50 characters' })
  country: string;

  @ApiProperty({
    example: '23 Admiralty Way, Lekki, Lagos',
    description: 'The full residential address of the user',
  })
  @IsString({ message: 'Residential address must be a string' })
  @IsNotEmpty({ message: 'Residential address is required' })
  @Length(10, 200, { message: 'Residential address must be between 10 and 200 characters' })
  residentialAddress: string;

  @ApiProperty({
    example: '1990-01-01',
    description: 'The date of birth of the user in YYYY-MM-DD format',
  })
  @IsString({ message: 'Date of birth must be a string' })
  @IsNotEmpty({ message: 'Date of birth is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date of birth must be in YYYY-MM-DD format' })
  dateOfBirth: string;

  @ApiProperty({
    example: 'MALE',
    description: 'The gender of the user',
    enum: ['MALE', 'FEMALE'],
  })
  @IsString({ message: 'Gender must be a string' })
  @IsNotEmpty({ message: 'Gender is required' })
  @IsIn(['MALE', 'FEMALE'], { message: 'Gender must be either MALE or FEMALE' })
  gender: Gender;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'The unique registration ID obtained from the verify-otp step',
  })
  @IsString({ message: 'Registration ID must be a string' })
  @IsNotEmpty({ message: 'Registration ID is required' })
  @IsUUID('4', { message: 'Invalid Registration ID format' })
  registrationId: string;
}