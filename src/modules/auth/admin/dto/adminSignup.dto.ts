import { ApiProperty } from '@nestjs/swagger';
import { AdminRole } from '../../../../infrastructure';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class SignupAdminDTO {
  @ApiProperty({
    example: 'John',
    description: 'The first name of the admin',
  })
  @IsString()
  @Length(3, 25)
  firstName: string;

  @ApiProperty({
    example: 'Doe',
    description: 'The last name of the admin',
  })
  @IsString()
  @Length(3, 25)
  lastName: string;

  @ApiProperty({
    example: 'admin@example.com',
    description: 'The email of the admin',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'Password123',
    description:
      'Password must contain at least one uppercase letter, one number, and be at least 8 characters long.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?=.*[A-Z])(?=.*\d).{8,}$/, {
    message:
      'Password must be at least 8 characters, contain at least one uppercase letter and one number',
  })
  password: string;

  @ApiProperty({
    example: '+2348023456789',
    description: 'The phone number of the admin',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  phoneNumber?: string;

  @ApiProperty({
    example: 'HQ',
    description: 'User group (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  userGroup?: string;

  @ApiProperty({
    example: '123 Allen Avenue, Ikeja',
    description: 'Residential address of the admin',
    required: false,
  })
  @IsOptional()
  @IsString()
  residentialAddress?: string;

  @ApiProperty({
    example: 'Nigeria',
    description: 'Country of the admin',
    required: false,
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({
    example: 'ADMIN',
    description: 'The role of the admin',
  })
  @IsString()
  @IsIn(['ADMIN', 'SUPER_ADMIN'])
  role: AdminRole;
}
