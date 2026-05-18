import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNotificationSettingsDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Receive notifications for account activity (login, password changes, etc.)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  accountActivityAlert?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Receive notifications for transactions (deposits, withdrawals, trades, etc.)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  transactionAlert?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Receive notifications about app updates',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  appUpdates?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Receive notifications about scheduled maintenance',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  maintenanceAlert?: boolean;
}
