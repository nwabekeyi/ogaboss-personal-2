import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { DevicePlatform } from '../../../infrastructure/databases/prisma';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'Firebase Cloud Messaging device token (required)',
    example: 'fcm_token_here',
    required: true,
  })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'Device platform - must be either ANDROID or IOS',
    enum: DevicePlatform,
    examples: ['ANDROID', 'IOS'],
    required: true,
  })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiProperty({
    description: 'Device name (optional)',
    example: 'iPhone 14 Pro',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceName?: string;

  @ApiProperty({
    description: 'Device ID (optional)',
    example: 'unique-device-id',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
