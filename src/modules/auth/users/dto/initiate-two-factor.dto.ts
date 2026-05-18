import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class InitiateTwoFactorDto {
  @ApiProperty({
    example: '123456',
    description: 'User current PIN to verify identity before enabling 2FA',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  currentPin: string;
}
