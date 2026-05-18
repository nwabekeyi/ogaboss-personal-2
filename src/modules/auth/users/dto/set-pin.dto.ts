import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Validate,
} from 'class-validator';
import { MatchPinsConstraint } from '../../../../common/validators/match-passwords.validator';
import { DevicePlatform } from './device-token.dto';

export class UserSetPinDTO {
  @ApiProperty({
    example: '123456',
    description: 'The 6-digit PIN of the user',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'PIN must be exactly 6 digits' })
  pin: string;

  @ApiProperty({
    example: '123456',
    description: 'The confirmation of the 6-digit PIN of the user',
  })
  @IsString()
  @IsNotEmpty()
  @Validate(MatchPinsConstraint, ['pin'], {
    message: 'Confirm pin must match pin',
  })
  @Length(6, 6, { message: 'Confirm PIN must be exactly 6 digits' })
  confirmPin: string;

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
