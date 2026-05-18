// src/modules/user/dto/initiate-pin-change.dto.ts
import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

export class InitiatePinChangeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Current PIN must be exactly 6 digits' })
  currentPin: string;
}

export class ConfirmPinChangeDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'New PIN must be exactly 6 digits' })
  newPin: string;
}
