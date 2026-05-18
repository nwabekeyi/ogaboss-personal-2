import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class InitiateSignupDTO {
    @ApiProperty({
        example: 'john@example.com',
        description: 'The email address of the user',
    })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({
        description: 'Cloudflare Turnstile captcha token',
      })
      @IsString()
      @IsNotEmpty()
      captchaToken: string;
}