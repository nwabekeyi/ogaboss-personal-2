import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSecuritySettingsDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Enable or disable PIN login',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  loginWithPin?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Enable or disable biometric login (fingerprint/face ID)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  loginWithBiometric?: boolean;
}
