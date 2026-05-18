// src/modules/user/dto/verify-address.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyAddressDto {
  @IsString()
  @IsNotEmpty()
  street: string;

  @IsString()
  @IsNotEmpty()
  lga: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  landmark: string;
}