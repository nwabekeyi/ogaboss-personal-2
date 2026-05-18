import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { DevicePlatform } from './device-token.dto';

export class LoginTwoFactorDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'The email of the user',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'The OTP sent to the user email for login verification',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;

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
