import { IsArray, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PatchCryptoDto } from './patch-crypto.dto';

class BulkPatchItem {
  @IsString()
  cryptoId: string;

  @ValidateNested()
  @Type(() => PatchCryptoDto)
  patch: PatchCryptoDto;
}

export class BulkPatchCryptoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkPatchItem)
  updates: BulkPatchItem[];
}
