import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyingOtpDTO {
  @ApiProperty({
    example: 'john@example.com',
    description: 'The email of the user verifying their OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'The OTP sent to the user’s email',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;
}
