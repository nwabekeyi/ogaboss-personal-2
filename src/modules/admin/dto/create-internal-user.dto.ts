import { IsString, IsEmail, IsOptional, IsEnum, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '../../../infrastructure';

export class CreateInternalUserDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Must contain at least first and last name (e.g., "John Doe")' 
  })
  @Matches(/^\s*\S+(?:\s+\S+)+\s*$/, {
    message: 'fullName must contain at least first and last name separated by space (e.g., "John Doe")',
  })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'john@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  password: string;

  @ApiProperty({ example: '+2348012345678', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ enum: Gender, required: false })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ example: '123 Lagos St', required: false })
  @IsOptional()
  @IsString()
  residentialAddress?: string;

  @ApiProperty({ example: 'Nigeria', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: 'wufhqfb7274wy2e', required: false })
  @IsOptional()
  @IsString()
  internalRoleId?: string;
}