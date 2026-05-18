// src/infrastructure/providers/dojah/types.ts
import { Gender } from '../../databases/prisma/generated/prisma/client';

// ────────────────────────────────────────────────────────────────
// DOJAHSIDE INPUT TYPES (What we send to Dojah)
// ────────────────────────────────────────────────────────────────
export type ValidateNinDojah = {
  nin: string; // 11-digit string
};

export type ValidateBvnDojah = {
  bvn: string; // 11-digit string
};

export type VerifySelfieNinDojah = {
  nin: string;
  image: string; // base64
};

export type VerifySelfieBvnDojah = {
  bvn: string;
  image: string; // base64
};

export type LivenessCheckDojah = {
  image: string; // base64
};

export type VerifyIndividualAddressDojah = {
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string; // YYYY-MM-DD
  gender: string;
  phoneNumber: string;
  street: string;
  landmark: string;
  lga: string;
  state: string;
};

export type ValidateBankAccountDojah = {
  account_number: string;
  bank_code: string;
};

// ────────────────────────────────────────────────────────────────
// DOJAHSIDE RESPONSE TYPES (What Dojah returns)
// ────────────────────────────────────────────────────────────────
export type ValidateNinResponseDojah = {
  success: boolean;
  message?: string;
  data?: {
    entity: {
      first_name: string;
      last_name: string;
      middle_name?: string;
      photo: string;
      date_of_birth: string;
      phone_number: string;
      email?: string;
      gender?: string;
      employment_status?: string;
      marital_status?: string;
    };
  };
};

export type ValidateBvnResponseDojah = {
  success: boolean;
  message?: string;
  data?: {
    entity: {
      first_name: string;
      last_name: string;
      phone_number: string;
      dob: string;
      image: string;
    };
  };
};

export type ValidateAccountResponseDojah = {
  success: boolean;
  message?: string;
  data?: {
    entity: {
      account_name: string;
      account_number: string;
      bank_code: string;
      status?: number
    };
  };
};

// ────────────────────────────────────────────────────────────────
// INTERNAL DTOs (Used in UserService & Controllers)
// ────────────────────────────────────────────────────────────────
export type ValidateNinDto = {
  userId: string;
  nin: string;
};

export type ValidateBvnDto = {
  userId: string;
  bvn: string;
};

export type VerifySelfieNinDto = {
  userId: string;
  nin: string;
  image: string;
};

export type VerifySelfieBvnDto = {
  userId: string;
  bvn: string;
  image: string;
};

export type LivenessCheckDto = {
  userId: string;
  image: string;
};

export type VerifyAddressDto = {
  userId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string;
  gender: string;
  phoneNumber: string;
  street: string;
  landmark: string;
  lga: string;
  state: string;
};

export type ValidateBankAccountDto = {
  userId: string;
  account_number: string;
  bank_code: string;
};

// ────────────────────────────────────────────────────────────────
// LIVENESS RESPONSE (Optional – for future use)
// ────────────────────────────────────────────────────────────────
type EmotionType =
  | 'CALM'
  | 'FEAR'
  | 'SURPRISED'
  | 'SAD'
  | 'ANGRY'
  | 'DISGUSTED'
  | 'HAPPY'
  | 'CONFUSED';

interface Emotion {
  type: EmotionType;
  confidence: number;
}

interface AgeRange {
  low: number;
  high: number;
}
export type VerifyAddressResponseDojah = {
  reference: string;
  status: string;
};


interface FeatureConfidence {
  value: boolean;
  confidence: number;
}

interface FaceDetails {
  age_range: AgeRange;
  smile: FeatureConfidence;
  gender: { value: string; confidence: number };
  eyeglasses: FeatureConfidence;
  sunglasses: FeatureConfidence;
  beard: FeatureConfidence;
  mustache: FeatureConfidence;
  eyes_open: FeatureConfidence;
  mouth_open: FeatureConfidence;
  emotions: Emotion[];
}

type FaceQuality = { brightness: number; sharpness: number };
type BoundingBox = { width: number; height: number; left: number; top: number };

type Face = {
  face_detected: boolean;
  message: string;
  multiface_detected: boolean;
  details: FaceDetails;
  quality: FaceQuality;
  confidence: number;
  bounding_box: BoundingBox;
};

type Liveness = {
  liveness_check: boolean;
  liveness_probability: number;
};

export type LivenessEntity = {
  liveness: Liveness;
  face: Face;
};


export type DojahDocumentAnalysisResponse = {
  success: boolean;
  message?: string;
  data?: {
    entity: {
      status: {
        overall_status: number; // 1 = VALID, 0 = INVALID
        reason: string; // "VALID" | "NOT_VALID"
        document_images: 'Yes' | 'No';
        text: 'Yes' | 'No';
        document_type: 'Yes' | 'No';
        expiry: 'Yes' | 'No';
      };
      document_type?: {
        document_name: string;
        document_country_name: string;
        document_country_code: string;
      };
      document_images?: {
        portrait?: string;
      };
      text_data?: Array<{
        field_name: string;
        field_key: string;
        status: number;
        value: string;
      }>;
    };
  };
};