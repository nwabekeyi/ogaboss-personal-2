// src/modules/user/dto/validate-bvn.dto.ts
import { IsNumberString } from 'class-validator';

export class ValidateBvnDto {
  @IsNumberString({}, { message: 'BVN must be a numeric string' })
  bvn: string;
}