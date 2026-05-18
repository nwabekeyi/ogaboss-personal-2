import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'Finance' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Handles financial operations', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: ['ckxyz1abc0001', 'ckxyz1abc0002'], required: false, type: [String] })
@IsOptional()
@IsArray()
@IsString({ each: true })
permissions?: string[];
}


