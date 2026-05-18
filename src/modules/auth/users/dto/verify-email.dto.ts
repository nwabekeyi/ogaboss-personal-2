// src/modules/user/dto/verify-email.dto.ts
import { IsEmail, IsString, Matches } from 'class-validator';

export class VerifyEmailDTO {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;
}



export class ResendEmailVerificationDTO {
  @IsEmail()
  email: string;
}