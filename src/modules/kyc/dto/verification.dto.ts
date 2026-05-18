// src/modules/user/dto/kyc.dto.ts
import { IsString, IsOptional, IsBase64 } from 'class-validator';

export class ValidateNinDto {
  @IsString() nin: string;
}

export class ValidateBvnDto {
  @IsString() bvn: string;
}

export class VerifySelfieBvnDto {
  @IsString() bvn: string;
  @IsBase64() image: string;          // base64 selfie
}

export class VerifySelfieNinDto {
  @IsString() nin: string;
  @IsBase64() image: string;
}

export class LivenessCheckDto {
  @IsBase64() image: string;
}

export class ValidateBankAccountDto {
  @IsString() account_number: string;
  @IsString() bank_code: string;
}

export class VerifyAddressDto {
  @IsString() firstName: string;
  @IsString() lastName: string;
  @IsOptional() @IsString() middleName?: string;
  @IsString() dob: string;            // YYYY-MM-DD
  @IsString() gender: string;
  @IsString() phoneNumber: string;
  @IsString() street: string;
  @IsOptional() @IsString() landmark?: string;
  @IsString() lga: string;
  @IsString() state: string;
}