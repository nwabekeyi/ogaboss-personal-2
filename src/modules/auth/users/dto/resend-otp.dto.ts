// src/modules/user/dto/resend-otp.dto.ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendOtpDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address used during signup',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '0x4AAAAAA...turnstile-token...',
    description: 'Cloudflare Turnstile / reCAPTCHA token',
  })
  @IsString()
  @IsNotEmpty({ message: 'CAPTCHA token is required' })
  captchaToken: string;
}