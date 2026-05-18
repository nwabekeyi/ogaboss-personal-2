import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateInternalUserDto } from './create-internal-user.dto';
import { IsOptional, IsEnum } from 'class-validator';
import { AccountStatus } from '../../../infrastructure';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateInternalUserDto extends PartialType(
  OmitType(CreateInternalUserDto, ['password'] as const),
) {
  @ApiProperty({
    enum: AccountStatus,
    description: 'Set account status (ACTIVE or DEACTIVATED)',
    example: AccountStatus.ACTIVE,
    required: false,
  })
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;
}