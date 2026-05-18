// src/infrastructure/providers/dojah/dojah.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '../../httpService/httpService.service';
import {
  LivenessCheckDojah,
  ValidateBvnDojah,
  ValidateBvnResponseDojah,
  ValidateAccountResponseDojah,
  ValidateNinDojah,
  ValidateNinResponseDojah,
  VerifyIndividualAddressDojah,
  VerifySelfieBvnDojah,
  VerifySelfieNinDojah,
  ValidateBankAccountDojah,
  VerifyAddressResponseDojah,
  DojahDocumentAnalysisResponse
} from './types';
import { config } from '../../../config';

@Injectable()
export class DojahService {
  private readonly logger = new Logger(DojahService.name);
  private readonly basePath: string;
  private readonly authorizationKey: string;
  private readonly appIdKey: string;

  constructor(private readonly httpService: HttpService) {
    const isDevelopment = config.env === 'development';

    this.basePath = isDevelopment
      ? config.credentials.dojah.apiTest
      : config.credentials.dojah.apiLive;

    this.authorizationKey = isDevelopment
      ? config.credentials.dojah.secretKeyTest
      : config.credentials.dojah.secretKeyLive;

    this.appIdKey = isDevelopment
      ? config.credentials.dojah.appIdTest
      : config.credentials.dojah.appIdLive;
  }

  private get headers() {
    return {
      Authorization: this.authorizationKey,
      AppId: this.appIdKey,
    };
  }

  private extractDojahError(error: any): { status: number | string; message: string; details?: any } {
    // If it's an HttpServiceException, the original AxiosError is in error.data
    const originalError = error?.data || error;
    const status = error?.status ?? originalError?.response?.status ?? 'N/A';
    const dojahError = originalError?.response?.data;
    let errorMessage = 'Unknown error';

    if (dojahError) {
      errorMessage = dojahError.error || dojahError.message || JSON.stringify(dojahError);
    } else {
      errorMessage = error?.message || originalError?.message || 'Unknown error';
    }

    return { status, message: errorMessage, details: dojahError };
  }

  // ────── NIN VALIDATION ──────
  async validateNin({ nin }: ValidateNinDojah): Promise<ValidateNinResponseDojah> {
     const url = `${this.basePath}/api/v1/kyc/nin`;
     const ninString = String(nin).trim();

     try {
       const data = await this.httpService.get<{ entity: ValidateNinResponseDojah['data']['entity'] }>(
         url,
         this.headers,
         { params: { nin: ninString } },
       );

       if (data?.entity) {
         return { success: true, data, message: 'NIN validation completed' };
       }

       return { success: false, data: null, message: 'NIN validation returned no data' };
     } catch (error: any) {
       const { status, message: errorMessage, details: dojahError } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] NIN validation failed | URL: ${url} | NIN: ${ninString.substring(0, 3)}*** | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           nin: ninString.substring(0, 3) + '***',
           statusCode: status,
           responseData: dojahError ? JSON.stringify(dojahError).substring(0, 300) : null,
         },
       );

       // Provide helpful error messages for common issues
       if (status === 404 || errorMessage.toLowerCase().includes('wrong nin')) {
         throw new BadRequestException(`NIN validation failed: ${errorMessage}. In sandbox mode, use test NIN: 70123456789. Received: ${ninString}`);
       }

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah NIN validation failed: ${errorMessage} (Status: ${status})`);
     }
   }


   // ────── BVN VALIDATION ──────
   async validateBvn({ bvn }: ValidateBvnDojah): Promise<ValidateBvnResponseDojah> {
     const url = `${this.basePath}/api/v1/kyc/bvn`;
     const bvnString = String(bvn).trim();


     try {
       const data = await this.httpService.get<{ entity: ValidateBvnResponseDojah['data']['entity'] }>(
         url,
         this.headers,
         { params: { bvn: bvnString } },
       );

       if (data?.entity) {
         return { success: true, data, message: 'BVN validation completed' };
       }

       this.logger.warn(`[Dojah] BVN validation returned no entity data for BVN ending in ${bvnString.slice(-4)}`);
       return { success: false, data: null, message: 'BVN validation returned no data' };
     } catch (error: any) {
       const status = error?.status ?? error?.response?.status ?? 'N/A';
       const dojahError = error?.response?.data;
       let errorMessage = 'Unknown error';

       if (dojahError) {
         errorMessage = dojahError.error || dojahError.message || JSON.stringify(dojahError);
       } else {
         errorMessage = error?.message || 'Unknown error';
       }

       this.logger.error(
         `[Dojah] BVN validation failed | URL: ${url} | BVN: ${bvnString.substring(0, 3)}*** | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           bvn: bvnString.substring(0, 3) + '***',
           statusCode: status,
           responseData: dojahError ? JSON.stringify(dojahError).substring(0, 300) : null,
         },
       );

       if (status === 404 || errorMessage.toLowerCase().includes('wrong bvn')) {
         throw new BadRequestException(`BVN validation failed: ${errorMessage}. In sandbox mode, use test BVN: 22222222222. Received: ${bvnString}`);
       }

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah BVN validation failed: ${errorMessage} (Status: ${status})`);
     }
   }

   // ────── SELFIE + NIN ──────
   async verifySelfieNin({ nin, image }: VerifySelfieNinDojah): Promise<{ success: boolean; data: any; message: string }> {
     const url = `${this.basePath}/api/v1/kyc/nin/verify`;
     const ninString = String(nin).trim();

     try {
       const data = await this.httpService.post(
         url,
         { nin: ninString, selfie_image: image },
         this.headers,
       );

       return { success: true, data, message: 'NIN selfie verified' };
     } catch (error: any) {
       const { status, message: errorMessage } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] NIN selfie verification failed | URL: ${url} | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           nin: ninString.substring(0, 3) + '***',
           statusCode: status,
           responseData: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
         },
       );

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah NIN selfie verification failed: ${errorMessage} (Status: ${status})`);
     }
   }

   // ────── SELFIE + BVN ──────
   async verifySelfieBvn({ bvn, image }: VerifySelfieBvnDojah): Promise<{ success: boolean; data: any; message: string }> {
     const url = `${this.basePath}/api/v1/kyc/bvn/verify`;
     const bvnString = String(bvn).trim();

     try {
       const data = await this.httpService.post(
         url,
         { bvn: bvnString, selfie_image: image },
         this.headers,
       );

       return { success: true, data, message: 'BVN selfie verified' };
     } catch (error: any) {
       const { status, message: errorMessage } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] BVN selfie verification failed | URL: ${url} | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           bvn: bvnString.substring(0, 3) + '***',
           statusCode: status,
           responseData: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
         },
       );

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah BVN selfie verification failed: ${errorMessage} (Status: ${status})`);
     }
   }

   // ────── LIVENESS CHECK ──────
   async checkUserLiveness({ image }: LivenessCheckDojah): Promise<{ success: boolean; data: any; message: string }> {
     const url = `${this.basePath}/api/v1/kyc/liveness`;

     try {
       const data = await this.httpService.post(
         url,
         { image },
         this.headers,
       );

       return { success: true, data, message: 'Liveness check completed' };
     } catch (error: any) {
       const { status, message: errorMessage } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] Liveness check failed | URL: ${url} | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           statusCode: status,
           responseData: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
         },
       );

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah liveness check failed: ${errorMessage} (Status: ${status})`);
     }
   }

   // ────── ADDRESS VERIFICATION ──────
   async verifyIndividualAddress(addressData: VerifyIndividualAddressDojah): Promise<{ success: boolean; data: VerifyAddressResponseDojah; message: string }> {
     const url = `${this.basePath}/api/v1/kyc/address`;
     const payload = {
       first_name: addressData.firstName,
       last_name: addressData.lastName,
       middle_name: addressData.middleName,
       dob: addressData.dob,
       gender: addressData.gender,
       mobile: addressData.phoneNumber,
       street: addressData.street,
       landmark: addressData.landmark,
       lga: addressData.lga,
       state: addressData.state,
     };

     try {
       const data = await this.httpService.post<VerifyAddressResponseDojah>(
         url,
         payload,
         this.headers,
       );

       return { success: true, data, message: 'Address verified' };
     } catch (error: any) {
       const { status, message: errorMessage } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] Address verification failed | URL: ${url} | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           statusCode: status,
           responseData: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
         },
       );

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah address verification failed: ${errorMessage} (Status: ${status})`);
     }
   }

   // ────── BANK ACCOUNT VALIDATION ──────
   async validateBankAccount({ account_number, bank_code }: ValidateBankAccountDojah): Promise<{ success: boolean; data: ValidateAccountResponseDojah['data']; message: string }> {
     const url = `${this.basePath}/api/v1/general/account`;
     const accountNumberStr = String(account_number);
     const bankCodeStr = String(bank_code);


     try {
       const data = await this.httpService.get<{ entity: ValidateAccountResponseDojah['data']['entity'] }>(
         url,
         this.headers,
         { params: { account_number: accountNumberStr, bank_code: bankCodeStr } },
       );

       if (data?.entity) {
         return { success: true, data, message: 'Bank account validated' };
       }

       return { success: false, data: null, message: 'Bank account validation returned no data' };
     } catch (error: any) {
       const { status, message: errorMessage } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] Bank account validation failed | URL: ${url} | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           statusCode: status,
           responseData: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
         },
       );

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah bank account validation failed: ${errorMessage} (Status: ${status})`);
     }
   }

   // ────── DOCUMENT VERIFICATION ──────
   async verifyDocument({
     imageFront,
     imageBack,
     inputType = 'url',
   }: {
     imageFront: string;
     imageBack?: string;
     inputType?: 'url' | 'base64';
   }): Promise<{ success: boolean; data: DojahDocumentAnalysisResponse; message: string }> {
     const url = `${this.basePath}/api/v1/document/analysis`;
     const payload: any = {
       input_type: inputType,
       imagefrontside: imageFront,
     };

     if (imageBack) {
       payload.imagebackside = imageBack;
     }

     try {
       const data = await this.httpService.post<DojahDocumentAnalysisResponse>(
         url,
         payload,
         this.headers,
       );

       return { success: true, data, message: 'Document verification completed' };
     } catch (error: any) {
       const { status, message: errorMessage } = this.extractDojahError(error);

       this.logger.error(
         `[Dojah] Document verification failed | URL: ${url} | Status: ${status} | Error: ${errorMessage}`,
         {
           url,
           statusCode: status,
           responseData: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
         },
       );

       if (status === 401 || status === 403) {
         throw new Error(`Dojah API authentication failed. Check your API credentials (AppId/SecretKey)`);
       }

       throw new Error(`Dojah document verification failed: ${errorMessage} (Status: ${status})`);
     }
   }
  
}
