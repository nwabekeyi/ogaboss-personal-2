import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DevicePlatform } from '../../../../infrastructure/databases/prisma/generated/prisma/enums';

export { DevicePlatform };

export class DeviceTokenDto {
  @ApiProperty({
    example: 'dQw4w9WgXcQ',
    description: 'Firebase Cloud Messaging device token (required)',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'ANDROID',
    description: 'Device platform - must be either ANDROID or IOS',
    enum: DevicePlatform,
    examples: ['ANDROID', 'IOS'],
    required: true,
  })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiProperty({
    example: 'Samsung Galaxy S21',
    description: 'Device name',
    required: false,
  })
  @IsString()
  @IsOptional()
  deviceName?: string;

  @ApiProperty({
    example: 'abc123def456',
    description: 'Unique device identifier',
    required: false,
  })
  @IsString()
  @IsOptional()
  deviceId?: string;
}
