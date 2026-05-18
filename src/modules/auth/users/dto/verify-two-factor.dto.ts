import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyTwoFactorDto {
  @ApiProperty({
    example: '123456',
    description: 'The OTP sent to the user’s email to enable 2FA',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;
}
