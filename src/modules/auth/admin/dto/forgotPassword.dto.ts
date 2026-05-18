// src/modules/auth/admin/dto/forgot-password.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@example.com', description: 'Admin email to reset password' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}