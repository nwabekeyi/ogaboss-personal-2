import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FlagUserDto {
  @ApiProperty({ description: 'Reason for flagging the user (optional but recommended)', example: 'Suspicious activity' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}