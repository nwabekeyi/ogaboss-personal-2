import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDTO {
  @ApiProperty({ example: 'my-refresh-token', description: 'Refresh token' })
  @IsString()
  refreshToken: string;
}
