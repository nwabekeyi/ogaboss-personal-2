import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PaystackService } from '../../infrastructure/providers/paystack';
import { PrismaService } from '../../infrastructure';
import { TempStoreService } from '../../infrastructure';
import { BASE_CURRENCY, encrypt, toDecimal } from '../../shared';
import {
  TransactionStatus,
  TransactionType,
  TransactionContext,
  PaymentType,
} from '../../infrastructure';

@Injectable()
export class CardService {
  constructor(
    private readonly paystackService: PaystackService,
    private readonly prisma: PrismaService,
    private readonly tempStore: TempStoreService,
  ) {}

  // INITIALIZE CARD & STORE REFERENCE IN REDIS (15 MINS)
  async initializeCard(userId: string) {
    const reference = `card-${userId}-${Date.now()}`;
    const amountSent = 10000;

    // Fetch user email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      throw new BadRequestException('User email not found');
    }

    const serverUrl = process.env.SERVER_URL;
    const callbackUrl = `${serverUrl}/api/v1/cards/verify`;

    const response = await this.paystackService.initializePayment({
      email: user.email,
      amount: amountSent,
      reference,
      channels: ['card'],
      callback_url: callbackUrl,
      metadata: { userId, type: 'card-initialization' },
    });

    return {
      authorization_url: response.data.authorization_url,
      reference: response.data.reference,
    };
  }

  // VERIFY CARD (called via Paystack callback)
  async verifyCardTransaction(reference: string) {
    if (!reference) throw new BadRequestException('Reference is required');

    // Extract userId from reference (card-userId-timestamp)
    const match = reference.match(/^card-(.+)-(\d+)$/);
    if (!match) {
      throw new BadRequestException('Invalid reference format');
    }
    const userId = match[1];

    const response = await this.paystackService.verifyTransaction(reference);

    if (!response.status || response.data.status !== 'success') {
      throw new BadRequestException('Card verification failed on Paystack');
    }

    const paystackRef = response.data.reference;
    const authorization = response.data.authorization;
    const last4 = authorization.last4;
    const expMonth = Number(authorization.exp_month);
    const expYear = Number(authorization.exp_year);
    const channel = response.data.channel;
    const card_type = authorization.card_type;
    const encrypted = encrypt(authorization.authorization_code);

    // Amount handling
    const amountBase = BigInt(response.data.amount); // in kobo
    const amountOriginal = (Number(amountBase) / 100).toFixed(2); // in NGN

    let savedCard;

    await this.prisma.$transaction(async (tx) => {
      // Check if card already exists
      const existingCard = await tx.paymentCard.findFirst({
        where: { userId, last4, expMonth, expYear, cardType: card_type },
      });

      if (existingCard) {
        savedCard = existingCard;
        return;
      }

      // Create debit transaction record
      await tx.transaction.create({
        data: {
          transactionUniqueId: `${paystackRef}-debit`,
          currency: BASE_CURRENCY.toUpperCase(),
          fiatAmountBase: toDecimal(amountBase),
          fiatAmountOriginal: amountOriginal,
          totalAmountSentBase: toDecimal(amountBase),
          totalAmountSentOriginal: amountOriginal,
          status: TransactionStatus.COMPLETED,
          transactionType: TransactionType.DEBIT,
          transactionContext: TransactionContext.CARD_VERIFICATION,
          paymentType: PaymentType.CARD,
          description: 'Card verification charge',
          isProcessed: true,
          userId,
        },
      });

      // Save new card
      savedCard = await tx.paymentCard.create({
        data: {
          userId,
          authorizationCode: encrypted.content,
          authorizationIv: encrypted.iv,
          authorizationTag: encrypted.tag,
          cardType: card_type,
          last4,
          expMonth,
          expYear,
          reusable: authorization.reusable,
          bank: authorization.bank,
          channel,
          label: authorization.brand,
        },
      });

      // Initiate refund
      const refund = await this.paystackService.refundTransaction({
        transaction: paystackRef,
        amount: response.data.amount, // kobo
      });

      if (!refund.status) {
        throw new BadRequestException('Refund failed after card verification');
      }

      const refundAmountBase = BigInt(refund.data.amount); // kobo
      const refundAmountOriginal = (Number(refundAmountBase) / 100).toFixed(2); // NGN

      // Record refund transaction
      await tx.transaction.create({
        data: {
          transactionUniqueId: `${paystackRef}-refund`,
          currency: BASE_CURRENCY.toUpperCase(),
          network: 'paystack',
          fiatAmountBase: toDecimal(refundAmountBase),
          fiatAmountOriginal: refundAmountOriginal,
          totalAmountSentBase: toDecimal(refundAmountBase),
          totalAmountSentOriginal: refundAmountOriginal,
          status: TransactionStatus.COMPLETED,
          transactionType: TransactionType.CREDIT,
          transactionContext: TransactionContext.CARD_REFUND,
          paymentType: PaymentType.CARD,
          description: `Refund for card verification: ${paystackRef}`,
          isProcessed: true,
          userId,
        },
      });
    });

    const tempKey = `card-added:${reference}`;
    await this.tempStore.set(tempKey, 'true', 180);

    return {
      success: true,
      message: savedCard?.id
        ? 'Card added successfully'
        : 'Card already exists',
      card: savedCard
        ? {
            id: savedCard.id,
            last4: savedCard.last4,
            cardType: savedCard.cardType,
            expMonth: savedCard.expMonth,
            expYear: savedCard.expYear,
            bank: savedCard.bank,
            label: savedCard.label,
            reusable: savedCard.reusable,
          }
        : null,
    };
  }

  async getUserCards(userId: string) {
    const cards = await this.prisma.paymentCard.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        last4: true,
        expMonth: true,
        expYear: true,
        cardType: true,
        bank: true,
        label: true,
        reusable: true,
      },
    });

    return { cards };
  }

  async isCardAdded(reference: string): Promise<boolean> {
    const tempKey = `card-added:${reference}`;
    const exists = await this.tempStore.get(tempKey);

    if (exists) {
      await this.tempStore.del(tempKey);
      return true;
    }

    return false;
  }

  async deleteCard(userId: string, cardId: string) {
    const card = await this.prisma.paymentCard.findFirst({
      where: { id: cardId, userId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    await this.prisma.paymentCard.delete({
      where: { id: cardId },
    });

    return { message: 'Card deleted successfully' };
  }
}
