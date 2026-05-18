import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSuperAdminDTO {
  @ApiProperty({ example: 'superadmin@example.com', description: 'Email of the super admin' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SuperAdmin123!', description: 'Password for the super admin' })
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Super', description: 'First name' })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Admin', description: 'Last name' })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'SomeVerySecretKey123!' })
  @IsString()
  superAdminKey: string;
}
