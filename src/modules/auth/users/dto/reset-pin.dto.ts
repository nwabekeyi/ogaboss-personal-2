import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class ResetPinDTO {
  @ApiProperty({
    example: 'john@example.com',
    description: 'The email of the user resetting their PIN',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '0d8efc2a-1f2a-4ec7-a6d7-a3cd90bc9d21',
    description:
      'Short-lived token returned after verifying a PIN reset OTP (expires in 2 minutes)',
  })
  @IsString()
  @IsNotEmpty()
  pinResetToken: string;

  @ApiProperty({
    example: '123456',
    description: 'The new 6-digit PIN of the user',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  newPin: string;
}
