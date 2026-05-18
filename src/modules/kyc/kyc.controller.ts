// src/modules/kyc/kyc.controller.ts
import { Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { KycService } from './kyc.service';
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
import { AuthGuard } from '../../common';
import { apiTags } from '../../shared';
import { VersionedController } from '../../core/decorators';
import { AuditLog, AuditAction, AuditResource } from '../../core/audit';

@ApiTags('KYC')
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.kyc)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // =====================================================
  // VALIDATE NIN
  // =====================================================
  @Post('nin')
  @AuditLog({
    action: AuditAction.KYC_VALIDATE_NIN,
    resource: AuditResource.KYC_NIN,
    resourceIdPath: 'body.nin',
  })
  @ApiOperation({
    summary: 'Validate National Identification Number (NIN)',
    description: `
## Overview
Validates a user's National Identification Number (NIN) against the Nigerian 
identity database.

## Required Fields
- **nin**: 11-digit NIN number (e.g., 70123456789)

## Response Details
- **valid**: Whether the NIN is valid
- **data**: Personal information from the NIN database (name, DOB, etc.)

## Use Cases
- Required for full account verification
- Enables higher transaction limits
- Required for fiat transactions

## Important Notes
- NIN validation is one-time - cannot be changed once verified
- User must be a Nigerian citizen with a valid NIN
- This verifies identity, not document ownership
      `,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        nin: {
          type: 'string',
          example: '70123456789',
          description: '11-digit Nigerian NIN',
        },
      },
      required: ['nin'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'NIN validation result',
    schema: {
      example: {
        valid: true,
        data: {
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1990-01-15',
          gender: 'Male',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid NIN format' })
  @ApiResponse({ status: 404, description: 'NIN not found in database' })
  validateNin(@Req() req: any, @Body() dto: ValidateNinDto) {
    return this.kycService.validateNin(req.user.id, dto);
  }

  // =====================================================
  // VERIFY ADDRESS
  // =====================================================
  @Post('address')
  @AuditLog({
    action: AuditAction.KYC_VERIFY_ADDRESS,
    resource: AuditResource.KYC_ADDRESS,
  })
  @ApiOperation({
    summary: 'Verify residential address',
    description: `
## Overview
Verifies a user's residential address using address verification services.

## Required Fields
- **street**: Street address
- **city**: City name
- **state**: State name
- **country**: Country (defaults to Nigeria)

## Use Cases
- Part of KYC compliance requirements
- Required for higher withdrawal limits

## Important Notes
- Address verification may require additional documentation
- Some addresses may not be verifiable through automated services
      `,
  })
  @ApiResponse({
    status: 200,
    description: 'Address verification result',
  })
  verifyAddress(@Req() req: any, @Body() dto: VerifyAddressDto) {
    return this.kycService.verifyAddress(req.user.id, dto);
  }

  // =====================================================
  // UPLOAD ID DOCUMENT
  // =====================================================
  @Post('document')
  @AuditLog({
    action: AuditAction.KYC_UPLOAD_DOCUMENT,
    resource: AuditResource.KYC_DOCUMENT,
    maskFields: ['frontImageBase64', 'backImageBase64'],
  })
  @ApiOperation({
    summary: 'Upload ID document',
    description: `
## Overview
Uploads an identity document (passport, driver's license, etc.) for verification.

## Required Fields
- **documentType**: Type of document being uploaded
  - INTERNATIONAL_PASSPORT
  - DRIVERS_LICENSE
  - NATIONAL_ID_CARD
  - VOTERS_CARD
- **frontImageBase64**: Base64-encoded image of the document front

## Optional Fields
- **backImageBase64**: Base64-encoded image of document back (if applicable)

## Supported Document Types
| Type | Description |
|------|-------------|
| INTERNATIONAL_PASSPORT | International passport |
| DRIVERS_LICENSE | Nigerian driver's license |
| NATIONAL_ID_CARD | National ID card (NIN card) |
| VOTERS_CARD | PVC (Permanent Voter Card) |

## Image Requirements
- Format: JPEG, PNG
- Max size: 5MB per image
- Must be clear and readable
- All text must be visible

## Important Notes
- Document must not be expired
- Image must show all corners of the document
- Avoid glare or shadows on the image
- Both sides required for some document types
      `,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          example: 'INTERNATIONAL_PASSPORT',
          enum: [
            'INTERNATIONAL_PASSPORT',
            'DRIVERS_LICENSE',
            'NATIONAL_ID_CARD',
            'VOTERS_CARD',
          ],
        },
        frontImageBase64: {
          type: 'string',
          format: 'byte',
          example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
          description: 'Base64-encoded front image of the document',
        },
        backImageBase64: {
          type: 'string',
          format: 'byte',
          description:
            'Base64-encoded back image (optional, required for some documents)',
        },
      },
      required: ['documentType', 'frontImageBase64'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded successfully',
    schema: {
      example: {
        success: true,
        message: 'Document verified',
        data: {
          frontUrl: 'https://storage.example.com/kyc/.../front.jpg',
          backUrl: 'https://storage.example.com/kyc/.../back.jpg',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Document verification failed',
    schema: {
      example: {
        statusCode: 400,
        message: 'Bad Request',
        errors: [
          'Document verification failed. Please upload a valid document.',
        ],
        timestamp: '2026-04-22T15:20:16.433Z',
        path: '/api/v1/kyc/document',
      },
    },
  })
  uploadDocument(@Req() req: any, @Body() dto: UploadDocumentDto) {
    return this.kycService.uploadDocument(req.user.id, dto);
  }

  // =====================================================
  // GET SUPPORTED DOCUMENT TYPES
  // =====================================================
  @Get('document/types')
  @ApiOperation({
    summary: 'Get supported ID document types',
    description: `
## Overview
Returns a list of all supported identity document types for upload.

## Use Cases
- Show available document options to users
- Help users choose which document to upload
      `,
  })
  @ApiResponse({
    status: 200,
    description: 'List of supported document types',
    schema: {
      example: {
        documents: [
          { type: 'INTERNATIONAL_PASSPORT', name: 'International Passport' },
          { type: 'DRIVERS_LICENSE', name: "Driver's License" },
          { type: 'NATIONAL_ID_CARD', name: 'National ID Card' },
          { type: 'VOTERS_CARD', name: "Voter's Card" },
        ],
      },
    },
  })
  getSupportedDocumentTypes() {
    return this.kycService.getSupportedDocumentTypes();
  }
}
