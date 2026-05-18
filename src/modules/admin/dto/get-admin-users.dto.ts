import {
    IsOptional,
    IsEnum,
    IsInt,
    Min,
    Max,
    IsString,
    IsBooleanString,
  } from 'class-validator';
  import { Transform } from 'class-transformer';
  import { ApiProperty } from '@nestjs/swagger';
  import { Status, VerificationStatus } from '../../../infrastructure';

  export class GetAdminUsersDto {
    @ApiProperty({ description: 'Page number', example: 1, default: 1 })
    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiProperty({ description: 'Items per page', example: 20, default: 20 })
    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @ApiProperty({ description: 'Search by name, email, phone, ID, wallet', example: 'John', required: false })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiProperty({ description: 'Status filter', enum: Status, required: false })
    @IsOptional()
    @IsEnum(Status)
    status?: Status;

    @ApiProperty({ description: 'KYC status filter', enum: VerificationStatus, required: false })
    @IsOptional()
    @IsEnum(VerificationStatus)
    kycStatus?: VerificationStatus;

    @ApiProperty({ description: 'Email verified', example: 'true', required: false })
    @IsOptional()
    @IsBooleanString()
    emailVerified?: string;

    @ApiProperty({ description: 'Country filter', example: 'NG', required: false })
    @IsOptional()
    @IsString()
    country?: string;
  }