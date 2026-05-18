// src/modules/user/dto/update-user.dto.ts
import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { Gender} from '../../../infrastructure';

export class UpdateUserProfileDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() residentialAddress?: string;
}