// src/modules/user/dto/upload-document.dto.ts
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { DocumentTypeInternal } from '../../../infrastructure';

export class UploadDocumentDto {
  @IsEnum(DocumentTypeInternal)
  documentType: DocumentTypeInternal;

  @IsString()
  frontImageBase64: string;

  @IsString()
  @IsOptional()
  backImageBase64?: string;
}
