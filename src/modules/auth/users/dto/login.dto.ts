import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Length,
} from 'class-validator';
import { DevicePlatform } from './device-token.dto';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(6)
  pin: string;

  @ApiProperty({
    example: 'dQw4w9WgXcQ',
    description: 'Firebase Cloud Messaging device token (required)',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  deviceToken: string;

  @ApiProperty({
    example: 'ANDROID',
    description: 'Device platform - must be either ANDROID or IOS',
    enum: DevicePlatform,
    examples: ['ANDROID', 'IOS'],
    required: true,
  })
  @IsEnum(DevicePlatform)
  devicePlatform: DevicePlatform;

  @ApiProperty({
    example: 'Samsung Galaxy S21',
    description: 'Device name',
    required: false,
  })
  @IsString()
  @IsOptional()
  deviceName?: string;
}
