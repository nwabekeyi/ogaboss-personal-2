import { IsString } from 'class-validator';

export class EmailVerificationDto {
  @IsString()
  token: string;
}
