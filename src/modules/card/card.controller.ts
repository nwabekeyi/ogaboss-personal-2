// src/modules/card/card.controller.ts
import {
  Get,
  Post,
  Delete,
  Body,
  Req,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

import { CardService } from './card.service';
import { AuthGuard, AuthenticatedRequest } from '../../common';
import { ConfirmCardDto } from './dto';
import { VersionedController } from '../../core/decorators';
import { apiTags } from '../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../core/audit';

@ApiTags('Bank Cards')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.card)
export class CardController {
  constructor(private readonly cardService: CardService) {}

  // =====================================================
  // GET USER CARDS
  // =====================================================
  @Get()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all saved bank cards',
    description: `
## Overview
Retrieves all debit/credit cards that have been saved by the authenticated user.

## Response Details
Each card contains:
- **id**: Unique card identifier
- **cardType**: Type of card (VISA, MASTERCARD, VERVE)
- **last4**: Last 4 digits of the card
- **bank**: Issuing bank name
- **isDefault**: Whether this is the default payment card
- **createdAt**: When the card was saved

## Use Cases
- Display saved cards for checkout
- Allow user to select which card to use for payment
- Manage multiple saved cards
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'List of saved cards retrieved successfully',
    schema: {
      example: {
        message: 'Cards retrieved successfully',
        cards: [
          {
            id: 'card_123abc',
            cardType: 'VISA',
            last4: '4242',
            bank: 'Guaranty Trust Bank',
            isDefault: true,
            createdAt: '2024-01-15T10:30:00.000Z',
          },
        ],
      },
    },
  })
  async getUserCards(@Req() req: AuthenticatedRequest) {
    return this.cardService.getUserCards(req.user.id);
  }

  // =====================================================
  // INITIALIZE CARD
  // =====================================================
  @Post('initialize')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.CARD_INITIALIZE,
    resource: AuditResource.USER_CARD,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initialize card addition',
    description: `
## Overview
Starts the process of adding a new debit/credit card. Returns a payment reference
that will be used to complete the card addition.

## Response Details
- **authorizationUrl**: URL to redirect user for card entry
- **accessCode**: Access code for the payment session
- **reference**: Unique reference for tracking

## Flow
1. Call this endpoint to get payment reference
2. Redirect user to authorizationUrl
3. User enters card details on Paystack page
4. After completion, user is redirected back
5. Use /verify endpoint to confirm card was added

## Important Notes
- This uses Paystack's card save functionality
- No actual charge is made - just card verification
- The reference is needed to verify completion
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Card initialization successful',
    schema: {
      example: {
        message: 'Card initialized',
        authorizationUrl: 'https://checkout.paystack.com/xxx',
        accessCode: 'abc123xyz',
        reference: 'pay_card_123abc',
      },
    },
  })
  async initializeCard(@Req() req: AuthenticatedRequest) {
    return this.cardService.initializeCard(req.user.id);
  }

  // =====================================================
  // VERIFY CARD (CALLBACK)
  // =====================================================
  @Get('verify')
  @AuditLog({
    action: AuditAction.CARD_VERIFY_CALLBACK,
    resource: AuditResource.USER_CARD,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify card addition after Paystack redirect',
    description: `
## Overview
Internal endpoint to verify that a card was successfully added after the 
Paystack redirect. Called automatically after user completes card entry.

## Query Parameters
- **reference**: The payment reference from initialize endpoint

## Important Notes
- This is called by Paystack after card entry
- Frontend should poll /confirm-card-added while waiting
    `,
  })
  async verifyCardCallback(
    @Req() req: AuthenticatedRequest,
    @Query('reference') reference: string,
  ) {
    if (!reference) {
      throw new BadRequestException('Reference query parameter is required');
    }

    const userId = req.user?.id;
    return this.cardService.verifyCardTransaction(reference);
  }

  // =====================================================
  // CONFIRM CARD ADDED (POLLING)
  // =====================================================
  @Post('confirm-card-added')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.CARD_CONFIRM_ADDED,
    resource: AuditResource.USER_CARD,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm if card has been added (polling endpoint)',
    description: `
## Overview
Used to check if a card has been successfully added after the Paystack flow.
Should be polled by the frontend while waiting for card addition to complete.

## Required Fields
- **reference**: The reference from the initialize endpoint

## Use Cases
- Poll after redirecting to Paystack
- Check if user completed card entry successfully
- Handle timeout if user never completed

## Important Notes
- Rate limited to 1 request per second
- Returns success: true when card is added
- Returns success: false when still pending
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Card addition status',
    schema: {
      example: { success: true },
    },
  })
  async confirmCard(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmCardDto,
  ) {
    const userId = req.user?.id;
    const isAdded = await this.cardService.isCardAdded(dto.reference);
    return { success: isAdded };
  }

  // =====================================================
  // DELETE CARD
  // =====================================================
  @Delete(':id')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.CARD_DELETE,
    resource: AuditResource.USER_CARD,
    resourceIdPath: 'params.id',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a saved card',
    description: `
## Overview
Removes a saved debit/credit card from the user's account.

## Use Cases
- User wants to remove an old card
- User wants to remove a compromised card

## Important Notes
- Card is permanently deleted
- User can add the same card again if needed
- If deleting default card, another card becomes default
    `,
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'The card ID to delete',
    example: 'card_123abc',
  })
  @ApiResponse({
    status: 200,
    description: 'Card deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Card not found' })
  async deleteCard(
    @Req() req: AuthenticatedRequest,
    @Param('id') cardId: string,
  ) {
    return this.cardService.deleteCard(req.user.id, cardId);
  }
}
