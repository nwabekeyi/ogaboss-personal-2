// src/modules/account/account.controller.ts
import {
  Get,
  Post,
  Delete,
  Put,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  Param,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';

import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { HttpExceptionInterceptor } from '../../core';
import { apiTags } from '../../shared';
import { AccountService } from './account.service';
import { VersionedController } from '../../core/decorators';
import {
  VerifyBankAccountDto,
  CreateBankWithTokenDto,
  updateBankAccountDTO,
} from './dto';
import { AuthGuard } from '../../core/guards/auth.guard';
import { AuthenticatedRequest } from '../../common';
import { AuditLog, AuditAction, AuditResource } from '../../core/audit';

@ApiTags('Bank accounts')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.account)
@UseInterceptors(HttpExceptionInterceptor)
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  // ---------------- VERIFY BANK ACCOUNT ----------------
  @Post('/verify-bank')
  @AuditLog({
    action: AuditAction.BANK_VERIFY_ACCOUNT,
    resource: AuditResource.USER_BANK_ACCOUNT,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify bank account number (Step 1 of 2)',
    description: `
## Overview
Verifies a bank account number using Paystack's account verification API.
This is the first step in adding a bank account.

## Required Fields
- **bankCode**: The bank's unique code (get from /list-banks endpoint)
- **accountNumber**: The user's bank account number

## Response Details
- **tempToken**: A temporary JWT token needed for step 2
- **accountName**: The registered name on the bank account
- **bankName**: The name of the bank

## Important Notes
- This endpoint just verifies - doesn't save anything yet
- The tempToken is valid for a limited time (typically 10 minutes)
- Use the token in the next step (POST /) to actually add the account
- If account number is invalid, you'll get a 400 error
    `,
  })
  @ApiConsumes('application/json')
  @ApiBody({ type: VerifyBankAccountDto })
  @ApiResponse({
    status: 200,
    description: 'Verification successful - temp token returned',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid account number or bank code',
  })
  async verifyBankAccount(@Body() body: VerifyBankAccountDto) {
    return this.accountService.verifyBankAccount(body);
  }

  // ---------------- CREATE BANK ACCOUNT ----------------
  @Post()
  @AuditLog({
    action: AuditAction.BANK_ADD_ACCOUNT,
    resource: AuditResource.USER_BANK_ACCOUNT,
    maskFields: ['token'],
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add bank account using verification token (Step 2 of 2)',
    description: `
## Overview
Completes the bank account addition process using the token from step 1.
This saves the verified bank account to the user's profile.

## Required Fields
- **token**: The temp token from /verify-bank endpoint

## Response Details
- **id**: Internal bank account record ID
- **bankAccountName**: Name on the bank account
- **bankAccountNumber**: Masked account number (last 4 digits visible)
- **bankName**: Name of the bank
- **bankCode**: Bank's unique code

## Important Notes
- Token expires after ~10 minutes - get a new one if expired
- Each user can have multiple bank accounts
- Account number is stored masked (only last 4 digits shown)
- This is needed for fiat withdrawals (selling crypto to NGN)
    `,
  })
  @ApiConsumes('application/json')
  @ApiBody({ type: CreateBankWithTokenDto })
  @ApiResponse({
    status: 201,
    description: 'Bank account added successfully',
    schema: {
      example: {
        message: 'Bank account added successfully',
        bankAccount: {
          id: 'ckx9s8f3r0001',
          bankAccountName: 'John Doe',
          bankAccountNumber: '****6789',
          bankName: 'GTBank',
          bankCode: '058',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({
    status: 409,
    description: 'Bank account already exists for this user',
  })
  async createBankAccount(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateBankWithTokenDto,
  ) {
    return this.accountService.createBankAccount(req.user.id, body);
  }

  // ---------------- LIST BANKS ----------------
  @Get('/list-banks')
  @ApiOperation({
    summary: 'Get list of supported Nigerian banks',
    description: `
## Overview
Returns a list of all Nigerian banks supported for bank account verification
and withdrawals.

## Query Parameters
- **search** (optional): Filter banks by name

## Use Cases
- Show bank list in a dropdown for user to select
- Allow users to search for their bank
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Banks retrieved successfully',
    schema: {
      example: {
        message: 'Banks retrieved successfully',
        data: [
          { name: 'Access Bank', code: '044' },
          { name: 'GTBank', code: '058' },
          { name: 'First Bank of Nigeria', code: '011' },
        ],
      },
    },
  })
  async getAllbanks(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
  ) {
    return this.accountService.allBanks(search);
  }

  // ---------------- GET ALL BANK ACCOUNTS ----------------
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all bank accounts for the authenticated user',
    description: `
## Overview
Retrieves all bank accounts that have been added by the authenticated user.

## Response Details
Each bank account contains:
- **id**: Unique identifier for the bank account record
- **bankAccountName**: Name on the bank account
- **bankAccountNumber**: Masked (only last 4 digits visible)
- **bankName**: Name of the bank
- **bankCode**: Bank's unique code
- **createdAt**: When the bank account was added

## Use Cases
- Show user's saved bank accounts for withdrawal
- Allow user to select which account to withdraw to
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Bank accounts retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBankAccounts(@Req() req: AuthenticatedRequest) {
    return this.accountService.getBankAccounts(req.user.id);
  }

  // ---------------- GET BANK ACCOUNT BY ID ----------------
  @Get('/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a specific bank account by ID',
    description: `
## Overview
Retrieves details of a single bank account by its ID.

## Use Cases
- Get full details of a specific saved bank account
- Validate a bank account exists before deletion
    `,
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The bank account ID to retrieve',
    example: 'ckx9s8f3r0001',
  })
  @ApiResponse({
    status: 200,
    description: 'Bank account details retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Bank account not found',
  })
  async getBankAccountById(
    @Req() req: AuthenticatedRequest,
    @Param('id') bankAccountId: string,
  ) {
    return this.accountService.getBankAccountById(req.user.id, bankAccountId);
  }

  // ---------------- DELETE BANK ACCOUNT ----------------
  @Delete('/:id')
  @AuditLog({
    action: AuditAction.BANK_DELETE_ACCOUNT,
    resource: AuditResource.USER_BANK_ACCOUNT,
    resourceIdPath: 'params.id',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a bank account',
    description: `
## Overview
Removes a saved bank account from the user's profile.

## Use Cases
- User wants to remove an old bank account
- User mistakenly added the wrong bank account

## Important Notes
- Once deleted, the bank account cannot be recovered
- User can add the same bank account again if needed
    `,
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The bank account ID to delete',
    example: 'ckx9s8f3r0001',
  })
  @ApiResponse({
    status: 200,
    description: 'Bank account deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Bank account not found' })
  async deleteBankAccount(
    @Req() req: AuthenticatedRequest,
    @Param('id') bankAccountId: string,
  ) {
    return this.accountService.deleteBankAccount(req.user.id, bankAccountId);
  }
}
