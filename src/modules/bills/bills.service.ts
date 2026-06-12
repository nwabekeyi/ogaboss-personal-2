import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayService } from '../../infrastructure/providers/xpresspay/xpresspay.service';
import {
  BillPaymentConfirmDto,
  BillQuoteDto,
  ValidateBillDto,
} from './dto/bills.dto';
import { ConvertCurrency } from '../../shared/utils/currency-precision.util';
import { compareHash } from '../../shared/services/hash';
import { TransactionContext } from '../../infrastructure/databases/prisma';
import {
  BILL_CATEGORIES,
  BILL_QUOTE_KEY_PREFIX,
  BILL_QUOTE_TTL_SECONDS,
} from './constants';
import { TempStoreService } from '../../infrastructure/databases/redis';
import { PLATFORM_SPREAD } from '../transaction/constants';
import { QuidaxTickerService } from '../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxOrderService } from '../../infrastructure/providers/quidax/order.service';
import {
  TransactionService,
  CompanyLiquidityService,
} from '../transaction/services';
import { BASE_CURRENCY, LiquidityReservationStatus } from '../../shared';
import { QUIDAX_COMPANY_USERID } from '../transaction/constants';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpresspay: XpresspayService,
    private readonly tempStore: TempStoreService,
    private readonly ticker: QuidaxTickerService,
    private readonly quidaxOrderService: QuidaxOrderService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
  ) {}

  async categories() {
    return { success: true, data: BILL_CATEGORIES };
  }

  async billers(categoryId: string) {
    const category = BILL_CATEGORIES.find((c) => c.id === categoryId);
    if (!category) throw new BadRequestException('Invalid bill category id');
    return {
      success: true,
      data: await this.xpresspay.getBillers(category.key),
    };
  }

  async validate(dto: ValidateBillDto) {
    const category = BILL_CATEGORIES.find((c) => c.id === dto.categoryId);
    if (!category) throw new BadRequestException('Invalid bill category id');
    const payload = { ...dto, category: category.key };
    return {
      success: true,
      data: await this.xpresspay.validateBill(payload as any),
    };
  }

  async quote(userId: string, dto: BillQuoteDto) {
    const category = BILL_CATEGORIES.find((c) => c.id === dto.categoryId);
    if (!category) throw new BadRequestException('Invalid bill category id');
    if (dto.walletCurrency.toUpperCase() !== 'USDT')
      throw new BadRequestException('Only USDT wallet is supported for bills');
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: 'USDT', mode: 'insensitive' } },
    });
    if (!wallet) throw new NotFoundException('USDT wallet not found');

    const usdtNgn = await this.ticker.getPrice('usdtngn');
    if (!usdtNgn || new Decimal(usdtNgn).lte(0))
      throw new BadRequestException('Unable to fetch USDT/NGN rate');

    const billAmountNgn = new Decimal(dto.amount);
    const cryptoAmount = billAmountNgn
      .div(usdtNgn)
      .toDecimalPlaces(6, Decimal.ROUND_CEIL);
    const feeAmount = cryptoAmount
      .mul(PLATFORM_SPREAD)
      .toDecimalPlaces(6, Decimal.ROUND_CEIL);
    const totalToPay = cryptoAmount
      .plus(feeAmount)
      .toDecimalPlaces(6, Decimal.ROUND_CEIL);
    const walletNetwork = wallet.defaultNetwork as any;
    const cryptoMinor = ConvertCurrency.toBase(cryptoAmount.toFixed(6), 'USDT');
    const feeMinor = ConvertCurrency.toBase(feeAmount.toFixed(6), 'USDT');
    const totalMinor = cryptoMinor + feeMinor;
    const available =
      BigInt(wallet.baseBalance.toFixed(0)) -
      BigInt(wallet.reservedBalance.toFixed(0));
    if (available < totalMinor)
      throw new BadRequestException('Insufficient balance');

    const providerValidation = await this.xpresspay.validateBill({
      ...dto,
      category: category.key,
    } as any);

    const quoteId = uuidv4();
    const quote = {
      quoteId,
      userId,
      walletId: wallet.id,
      walletNetwork: wallet.defaultNetwork,
      categoryId: category.id,
      category: category.key,
      billerCode: dto.billerCode,
      customerReference: dto.customerReference,
      productCode: dto.productCode,
      billAmountNgn: billAmountNgn.toFixed(2),
      usdtNgnRate: new Decimal(usdtNgn).toString(),
      cryptoAmount: cryptoAmount.toFixed(6),
      feeAmount: feeAmount.toFixed(6),
      totalToPay: totalToPay.toFixed(6),
      cryptoMinor: cryptoMinor.toString(),
      feeMinor: feeMinor.toString(),
      totalMinor: totalMinor.toString(),
      providerValidation,
      expiresAt: Date.now() + BILL_QUOTE_TTL_SECONDS * 1000,
    };
    await this.tempStore.set(
      `${BILL_QUOTE_KEY_PREFIX}${quoteId}`,
      JSON.stringify(quote),
      BILL_QUOTE_TTL_SECONDS,
    );

    return {
      success: true,
      message: 'Bill quote created',
      data: {
        quoteId,
        categoryId: category.id,
        amountToReceive: quote.billAmountNgn,
        rate: `1 USDT ≈ ${new Decimal(usdtNgn).toFixed(2)} NGN`,
        transactionFee: quote.feeAmount,
        amountToPay: quote.totalToPay,
        walletCurrency: 'USDT',
        expiresIn: BILL_QUOTE_TTL_SECONDS,
      },
    };
  }

  async confirm(userId: string, dto: BillPaymentConfirmDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin)))
      throw new BadRequestException('Invalid pin');

    const raw = await this.tempStore.get(
      `${BILL_QUOTE_KEY_PREFIX}${dto.quoteId}`,
    );
    if (!raw) throw new NotFoundException('Bill quote not found or expired');
    const quote: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (quote.userId !== userId)
      throw new BadRequestException('Invalid quote owner');
    if (Date.now() > Number(quote.expiresAt))
      throw new BadRequestException('Bill quote expired');

    const totalMinor = BigInt(quote.totalMinor);
    const cryptoMinor = BigInt(quote.cryptoMinor);
    const feeMinor = BigInt(quote.feeMinor);
    const netFiatBase = ConvertCurrency.toBase(
      String(quote.billAmountNgn),
      'NGN',
    );

    const { transaction, billPayment } = await this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { id: quote.walletId },
        });
        if (!wallet) throw new NotFoundException('Wallet not found');

        await this.transactionService.reserveBalance(
          tx,
          userId,
          'USDT',
          totalMinor,
          wallet.defaultNetwork,
        );
        const reserved = await this.companyLiquidityService.reserveLiquidity(
          BASE_CURRENCY,
          netFiatBase,
          tx,
        );
        if (!reserved)
          throw new BadRequestException('Insufficient company NGN liquidity');

        const transaction = await tx.transaction.create({
          data: {
            userId,
            transactionUniqueId: `BILL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            currency: 'USDT',
            cryptoAmountBase: cryptoMinor.toString(),
            cryptoAmountOriginal: String(quote.cryptoAmount),
            totalAmountSentBase: totalMinor.toString(),
            totalAmountSentOriginal: String(quote.totalToPay),
            fiatAmountBase: netFiatBase.toString(),
            fiatAmountOriginal: String(quote.billAmountNgn),
            platformFeeBase: feeMinor.toString(),
            platformFeeOriginal: String(quote.feeAmount),
            status: 'PENDING' as any,
            transactionType: 'DEBIT' as any,
            transactionContext: TransactionContext.BILL_PAYMENT,
            paymentType: 'CRYPTO_WALLET' as any,
            senderWalletId: wallet.id,
            description: `Bill payment: ${quote.category}`,
            paymentMetadata: {
              billingFlow: true,
              billingStatus: 'PENDING_ORDER',
              quoteId: dto.quoteId,
              category: quote.category,
              billerCode: quote.billerCode,
              customerReference: quote.customerReference,
              productCode: quote.productCode,
              billAmountNgn: quote.billAmountNgn,
              billCryptoAmountBase: cryptoMinor.toString(),
              billCryptoAmountOriginal: String(quote.cryptoAmount),
              platformFeeAmountBase: feeMinor.toString(),
              platformFeeAmountOriginal: String(quote.feeAmount),
              totalSellAmountBase: totalMinor.toString(),
              totalSellAmountOriginal: String(quote.totalToPay),
              liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
              liquidityReservationCurrency: BASE_CURRENCY,
              liquidityReservationAmount: netFiatBase.toString(),
            } as any,
          },
        });

        const billPayment = await tx.billPayment.create({
          data: {
            userId,
            walletId: wallet.id,
            transactionId: transaction.id,
            category: quote.category,
            billerCode: quote.billerCode,
            customerReference: quote.customerReference,
            productCode: quote.productCode,
            walletCurrency: 'USDT',
            amountBase: netFiatBase.toString(),
            amountOriginal: String(quote.billAmountNgn),
            status: 'PENDING',
            provider: 'xpresspay',
            providerValidation: quote.providerValidation,
          },
        });

        await tx.order.create({
          data: {
            transactionId: transaction.id,
            userId,
            cryptoAmountBase: totalMinor.toString(),
            cryptoAmountOriginal: String(quote.totalToPay),
            fiatAmountBase: netFiatBase.toString(),
            fiatAmountOriginal: String(quote.billAmountNgn),
            fiatCurrency: 'NGN',
            status: 'PENDING' as any,
            type: 'SELL' as any,
            referenceNo: transaction.transactionUniqueId,
            paymentStatus: 'PENDING' as any,
            paymentAmountBase: netFiatBase.toString(),
            paymentAmountOriginal: String(quote.billAmountNgn),
          },
        });

        return { transaction, billPayment };
      },
    );

    let providerReference: string | undefined;
    let quidaxOrderId: string | undefined;
    let quidaxOrderAccepted = false;

    try {
      const orderResponse = await this.quidaxOrderService.buyOrSellOrderRequest(
        QUIDAX_COMPANY_USERID,
        {
          market: 'usdtngn',
          side: 'sell',
          ord_type: 'market',
          volume: String(quote.totalToPay),
        } as any,
      );
      if (orderResponse.status !== 'success')
        throw new BadRequestException('Something went wrong, try again later.');
      providerReference = orderResponse.data.reference || orderResponse.data.id;
      quidaxOrderId = orderResponse.data.id;
      quidaxOrderAccepted = true;
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.transaction.findUnique({
          where: { id: transaction.id },
          select: { paymentMetadata: true },
        });
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            paymentMetadata: {
              ...((current?.paymentMetadata || {}) as Record<string, any>),
              billingStatus: 'PROCESSING',
              quidaxOrderReference: providerReference,
              quidaxOrderId,
            } as any,
          },
        });
        await tx.order.update({
          where: { transactionId: transaction.id },
          data: {
            referenceNo: providerReference,
            gatewayResponse: JSON.stringify(orderResponse.data),
          },
        });
        await tx.billPayment.update({
          where: { id: billPayment.id },
          data: { status: 'PROCESSING' },
        });
      });
      await this.tempStore.del(`${BILL_QUOTE_KEY_PREFIX}${dto.quoteId}`);
      return {
        success: true,
        message:
          'Bill sell order submitted. Awaiting Quidax webhook to complete billing.',
        data: { reference: transaction.transactionUniqueId },
      };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.transaction.findUnique({
          where: { id: transaction.id },
          select: { paymentMetadata: true },
        });
        const currentMeta = (current?.paymentMetadata || {}) as Record<
          string,
          any
        >;

        if (quidaxOrderAccepted) {
          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: 'PENDING' as any,
              isProcessed: false,
              paymentMetadata: {
                ...currentMeta,
                billingStatus: 'ORDER_REFERENCE_PERSIST_FAILED',
                billingRequiresReconciliation: true,
                billingReconciliationReason:
                  'quidax_order_accepted_but_local_reference_persist_failed',
                billingReconciliationAt: new Date().toISOString(),
                ...(providerReference
                  ? { quidaxOrderReference: providerReference }
                  : {}),
                ...(quidaxOrderId ? { quidaxOrderId } : {}),
              } as any,
            },
          });
          await tx.order.updateMany({
            where: { transactionId: transaction.id },
            data: {
              ...(providerReference ? { referenceNo: providerReference } : {}),
              status: 'PROCESSING' as any,
              paymentStatus: 'PENDING' as any,
              gatewayResponse: JSON.stringify({
                error:
                  (error as any)?.message || 'local_reference_persist_failed',
                quidaxOrderReference: providerReference,
                quidaxOrderId,
                reconciliationRequired: true,
              }),
            },
          });
          await tx.billPayment.update({
            where: { id: billPayment.id },
            data: { status: 'PROCESSING' },
          });
          return;
        }

        await this.transactionService
          .releaseBalance(tx, userId, 'USDT', totalMinor)
          .catch(() => undefined);
        await this.companyLiquidityService
          .releaseLiquidity(BASE_CURRENCY, netFiatBase, tx)
          .catch(() => undefined);
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: 'FAILED' as any,
            paymentMetadata: {
              ...currentMeta,
              liquidityReservationStatus: LiquidityReservationStatus.RELEASED,
              liquidityReleasedAt: new Date().toISOString(),
              liquidityReleaseReason: 'quidax_order_submit_failed',
              billingStatus: 'FAILED_ORDER_SUBMIT',
            } as any,
          },
        });
        await tx.billPayment.update({
          where: { id: billPayment.id },
          data: { status: 'FAILED' },
        });
      });
      if (quidaxOrderAccepted) {
        await this.tempStore.del(`${BILL_QUOTE_KEY_PREFIX}${dto.quoteId}`);
        return {
          success: true,
          message:
            'Bill sell order submitted. Awaiting reconciliation and webhook processing.',
          data: {
            reference: transaction.transactionUniqueId,
            reconciliationRequired: true,
          },
        };
      }

      throw new BadRequestException(
        (error as any)?.response?.data || 'Bill payment failed',
      );
    }
  }
}
