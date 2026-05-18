// src/modules/kyc/kyc.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { DojahService } from '../../infrastructure/providers/dojah/dojah.service';
import { uploadBase64Image } from '../../infrastructure';
import {
  ValidateNinDto,
  ValidateBvnDto,
  VerifySelfieNinDto,
  VerifySelfieBvnDto,
  LivenessCheckDto,
  VerifyAddressDto,
  ValidateBankAccountDto,
  UploadDocumentDto,
} from './dto';
import { retryWithBreaker } from '../../shared';
import {
  VerificationStatus,
  DocumentTypeInternal,
  AccountTier,
} from '../../infrastructure';

// the commented parts of this codes is not required for the UI design
// It was comment incase if it will be added in future

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dojah: DojahService,
  ) {}

   // ────── NIN ──────
   async validateNin(userId: string, dto: ValidateNinDto) {
     const ninNormalized = dto.nin.trim();

     // ── CHECK IF NIN ALREADY EXISTS IN DATABASE ──
     const existingNin = await this.prisma.kycVerification.findUnique({
       where: { nin: ninNormalized },
     });

     if (existingNin) {
       throw new BadRequestException(
         `This NIN has already been verified for another account.`,
       );
     }

     const resp = await this.dojah.validateNin({ nin: ninNormalized });
     if (!resp.success || !resp.data?.entity)
       throw new BadRequestException(resp.message || 'NIN validation failed');

     const e = resp.data.entity;

     // ── GET USER TO COMPARE NAMES ──
     const user = await this.prisma.user.findUnique({
       where: { id: userId },
       select: { firstName: true, lastName: true },
     });

     if (!user) {
       throw new NotFoundException('User not found');
     }

     // ── VALIDATE NAME MATCH ──
     const ninFirst = (e.first_name || '').trim().toLowerCase();
     const ninLast = (e.last_name || '').trim().toLowerCase();
     const userFirst = (user.firstName || '').trim().toLowerCase();
     const userLast = (user.lastName || '').trim().toLowerCase();

     const firstMatch = ninFirst === userFirst;
     const lastMatch = ninLast === userLast;

     if (!firstMatch || !lastMatch) {
       throw new BadRequestException(
         `NIN verification failed: The name on your NIN record does not match your registered name.`,
       );
     }

     await this.prisma.kycVerification.upsert({
       where: { user_id: userId },
       update: {
         nin: ninNormalized,
         hasVerifiedNin: true,
         ninFirstName: e.first_name,
         ninLastName: e.last_name,
         ninPhoneNumber: e.phone_number,
         ninDateOfBirth: e.date_of_birth ? new Date(e.date_of_birth) : null,
         ninImageUrl: e.photo,
         documentTypeInternal: DocumentTypeInternal.NIN,
         documentNumber: ninNormalized,
         documentIssuedCountryCode: 'NG',
       },
       create: {
         user_id: userId,
         nin: ninNormalized,
         hasVerifiedNin: true,
         ninFirstName: e.first_name,
         ninLastName: e.last_name,
         ninPhoneNumber: e.phone_number,
         ninDateOfBirth: e.date_of_birth ? new Date(e.date_of_birth) : null,
         ninImageUrl: e.photo,
         documentTypeInternal: DocumentTypeInternal.NIN,
         documentNumber: ninNormalized,
         documentIssuedCountryCode: 'NG',
       },
     });

     return { success: true, message: 'NIN verified' };
   }

  // // ────── BVN ──────
  // async validateBvn(userId: string, dto: ValidateBvnDto) {
  //   const resp = await this.dojah.validateBvn({ bvn: dto.bvn });
  //   if (!resp.success || !resp.data?.entity)
  //     throw new BadRequestException(resp.message || 'BVN validation failed');

  //   const e = resp.data.entity;

  //   await this.prisma.kycVerification.upsert({
  //     where: { user_id: userId },
  //     update: {
  //       bvn: BigInt(dto.bvn),
  //       hasVerifiedBvn: true,
  //       bvnFirstName: e.first_name,
  //       bvnLastName: e.last_name,
  //       bvnPhoneNumber: e.phone_number,
  //       bvnDateOfBirth: e.dob ? new Date(e.dob) : null,
  //       bvnImageUrl: e.image,
  //       documentTypeInternal: DocumentTypeInternal.NATIONAL_IDENTITY_CARD,
  //       documentNumber: dto.bvn,
  //       documentIssuedCountryCode: 'NG',
  //       hasVerifiedDocument: true,
  //     },
  //     create: {
  //       user_id: userId,
  //       bvn: BigInt(dto.bvn),
  //       hasVerifiedBvn: true,
  //       bvnFirstName: e.first_name,
  //       bvnLastName: e.last_name,
  //       bvnPhoneNumber: e.phone_number,
  //       bvnDateOfBirth: e.dob ? new Date(e.dob) : null,
  //       bvnImageUrl: e.image,
  //       documentTypeInternal: DocumentTypeInternal.NATIONAL_IDENTITY_CARD,
  //       documentNumber: dto.bvn,
  //       documentIssuedCountryCode: 'NG',
  //       hasVerifiedDocument: true,
  //     },
  //   });

  //   return { success: true, message: 'BVN verified' };
  // }

  private normalizeDocumentType(input: string): string {
    return input.trim().toUpperCase().replace(/\s+/g, '_'); // "International Passport" → INTERNATIONAL_PASSPORT
  }

  private isValidDocumentType(type: string): type is DocumentTypeInternal {
    return Object.values(DocumentTypeInternal).includes(
      type as DocumentTypeInternal,
    );
  }

  // ────── DOCUMENT VERIFICATION ──────
  async uploadDocument(userId: string, dto: UploadDocumentDto) {
    const { frontImageBase64, backImageBase64, documentType } = dto;

    const normalizedUserDocType = this.normalizeDocumentType(documentType);

    if (!this.isValidDocumentType(normalizedUserDocType)) {
      throw new BadRequestException(
        `Unsupported document type: ${documentType}`,
      );
    }

    const userDocumentEnum = normalizedUserDocType as DocumentTypeInternal;

    // 1. Ensure NIN is verified
    const kyc = await this.prisma.kycVerification.findUnique({
      where: { user_id: userId },
      select: { hasVerifiedNin: true },
    });

    if (!kyc?.hasVerifiedNin) {
      throw new BadRequestException('Kindly verify your NIN');
    }

    // 2. VERIFY DOCUMENT WITH DOJAH FIRST (NO SIDE EFFECTS)
    const verifyPayload: {
      imageFront: string;
      imageBack?: string;
      inputType: 'base64';
    } = {
      imageFront: frontImageBase64,
      inputType: 'base64',
    };
    if (backImageBase64) {
      verifyPayload.imageBack = backImageBase64;
    }

    const { success, result: dojahResp } = await retryWithBreaker(
      () => this.dojah.verifyDocument(verifyPayload),
      5,
      50000,
    );

    console.log(dojahResp.data);

    // DOJAH UNAVAILABLE (timeouts, breaker open, network issues)
    if (!success) {
      throw new BadRequestException({
        message:
          'Verification service is currently unavailable. Please try again later.',
      });
    }

    const entity = dojahResp?.data?.data?.entity;
    const verificationSuccess =
      success && dojahResp?.success && entity?.status?.overall_status === 1;

    if (!verificationSuccess) {
      throw new BadRequestException(
        'Document verification failed. Please upload a valid document.',
      );
    }

    // 3. EXTRACT DATA (DEFENSIVE — DOJAH MAY CHANGE)
    const documentName = entity?.document_type?.document_name ?? documentType;

    const countryCode = entity?.document_type?.document_country_code ?? 'NG';

    const documentNumber =
      entity?.text_data?.find((td) =>
        td.field_key?.toLowerCase().includes('document'),
      )?.value ?? null;

    // 4. UPLOAD IMAGES ONLY AFTER VERIFICATION SUCCESS
    const folder = `kyc/${userId}/documents/${documentType}`;
    const front = await uploadBase64Image(frontImageBase64, `${folder}/front`);

    let back = null;
    if (backImageBase64) {
      back = await uploadBase64Image(backImageBase64, `${folder}/back`);
    }

    // 5. SAVE KYC RECORD
    await this.prisma.kycVerification.upsert({
      where: { user_id: userId },
      update: {
        documentTypeInternal: userDocumentEnum,
        documentType: documentName,
        documentNumber,
        documentIssuedCountryCode: countryCode,
        documentFrontPageUrl: front.url,
        documentBackPageUrl: back?.url ?? null,
      },
      create: {
        user_id: userId,
        documentTypeInternal: userDocumentEnum,
        documentType: documentName,
        documentNumber,
        documentIssuedCountryCode: countryCode,
        documentFrontPageUrl: front.url,
        documentBackPageUrl: back?.url ?? null,
      },
    });

    // 6. UPDATE USER STATUS AND TIER
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycVerificationStatus: VerificationStatus.APPROVED,
        tier: AccountTier.TIER_2,
      },
    });

    return {
      success: true,
      message: 'Document verified',
      data: {
        frontUrl: front.url,
        backUrl: back?.url ?? null,
      },
    };
  }

  // // ────── SELFIE & LIVENESS ──────
  // async verifySelfieNin(userId: string, dto: VerifySelfieNinDto) {
  //   const resp = await this.dojah.verifySelfieNin({ nin: dto.nin, image: dto.image });
  //   if (!resp.success) throw new BadRequestException(resp.message);

  //   const selfieUrl = await this.uploadSelfie(userId, dto.image, 'nin-selfie');
  //   await this.prisma.kycVerification.update({
  //     where: { user_id: userId },
  //     data: { verificationSelfie: selfieUrl },
  //   });

  //   return { success: true, message: 'Selfie verified' };
  // }

  // async verifySelfieBvn(userId: string, dto: VerifySelfieBvnDto) {
  //   const resp = await this.dojah.verifySelfieBvn({ bvn: dto.bvn, image: dto.image });
  //   if (!resp.success) throw new BadRequestException(resp.message);

  //   const selfieUrl = await this.uploadSelfie(userId, dto.image, 'bvn-selfie');
  //   await this.prisma.kycVerification.update({
  //     where: { user_id: userId },
  //     data: { verificationSelfie: selfieUrl },
  //   });

  //   return { success: true, message: 'Selfie verified' };
  // }

  // async livenessCheck(userId: string, dto: LivenessCheckDto) {
  //   const resp = await this.dojah.checkUserLiveness({ image: dto.image });
  //   if (!resp.success) throw new BadRequestException(resp.message);

  //   await this.prisma.kycVerification.upsert({
  //     where: { user_id: userId },
  //     update: { hasVerifiedLivenessCheck: true },
  //     create: { user_id: userId, hasVerifiedLivenessCheck: true },
  //   });

  //   return { success: true, message: 'Liveness confirmed' };
  // }

  // ────── ADDRESS ──────
  async verifyAddress(userId: string, dto: VerifyAddressDto) {
    const payload = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName,
      dob: dto.dob,
      gender: dto.gender,
      phoneNumber: dto.phoneNumber,
      street: dto.street,
      landmark: dto.landmark,
      lga: dto.lga,
      state: dto.state,
    };

    const resp = await this.dojah.verifyIndividualAddress(payload);
    if (!resp.success) throw new BadRequestException(resp.message);

    await this.prisma.kycVerification.upsert({
      where: { user_id: userId },
      update: {
        hasVerifiedAddress: true,
        addressVerificationStatus: 'VERIFIED',
        addressVerificationRef: resp.data?.reference,
        countryOfResidence: dto.state,
        state: dto.state,
        lga: dto.lga,
        streetName: dto.street,
        landmark: dto.landmark,
      },
      create: {
        user_id: userId,
        hasVerifiedAddress: true,
        addressVerificationStatus: 'VERIFIED',
        addressVerificationRef: resp.data?.reference,
        countryOfResidence: dto.state,
        state: dto.state,
        lga: dto.lga,
        streetName: dto.street,
        landmark: dto.landmark,
      },
    });

    return { success: true, message: 'Address verified' };
  }

  // ────── SUPPORTED DOCUMENT TYPES ──────
  getSupportedDocumentTypes() {
    const documents = Object.values(DocumentTypeInternal).map((type) => ({
      value: type,
      label: this.formatDocumentLabel(type),
    }));

    return documents;
  }

  private formatDocumentLabel(type: string): string {
    return type
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // // ────── BANK ACCOUNT ──────
  // async validateBankAccount(userId: string, dto: ValidateBankAccountDto) {
  //   const resp = await this.dojah.validateBankAccount(dto);
  //   if (!resp.success) throw new BadRequestException(resp.message);
  //   return { success: true, message: 'Bank validated' };
  // }

  // private async uploadSelfie(userId: string, base64: string, type: 'nin-selfie' | 'bvn-selfie') {
  //   const folder = `kyc/${userId}/${type}`;
  //   const result = await uploadBase64Image(base64, folder);
  //   return result.url;
  // }
}
