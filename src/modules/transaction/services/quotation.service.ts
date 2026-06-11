import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import { v4 as uuidv4 } from 'uuid';
import { BuyQuoteDto, SellQuoteDto, SwapQuoteDto } from '../dto';
import {
  PLATFORM_SPREAD,
  QUOTE_TTL_SECONDS,
  COOLDOWN_KEY_PREFIX,
  QUOTE_COOLDOWN_SECONDS,
  MIN_TRANSACTION_USDT,
  QUIDAX_COMPANY_USERID,
} from '../constants';
import {
  BASE_CURRENCY,
  ConvertCurrency,
  CryptoNetwork,
  getCurrencyDecimals,
} from '../../../shared';
import Decimal from 'decimal.js';
import { TransactionService } from './transaction.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax/swap.service';
import {
  CryptoCurrencyCacheService,
  FiatCurrencyCacheService,
} from '../../../infrastructure/databases/redis';
import { IBuyQuote, IQuote, ISellQuote, ISwapQuote } from './types';
import { compareHash } from '../../../shared/services/hash';
import { TierLimitService } from '../../../shared/services/tier-limit.service';

@Injectable()
export class QuotationService {
  private readonly logger = new Logger(QuotationService.name);
  private readonly BASE_FIAT_CURRENCY = BASE_CURRENCY.toUpperCase();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickerService: QuidaxTickerService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly tempStore: TempStoreService,
    private readonly transactionService: TransactionService,
    private readonly fiatCache: FiatCurrencyCacheService,
    private readonly cryptoCache: CryptoCurrencyCacheService,
    private readonly tierLimitService: TierLimitService,
  ) {}

  private getFiatDecimals(code: string): number {
    return getCurrencyDecimals(code.toLowerCase());
  }

  private async resolveQuoteNetwork(
    userId: string,
    symbol: string,
    requestedNetwork?: string,
  ): Promise<CryptoNetwork | undefined> {
    const trimmedNetwork = requestedNetwork?.trim();
    if (trimmedNetwork) return trimmedNetwork as CryptoNetwork;

    const wallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        currency: { equals: symbol, mode: 'insensitive' },
      },
      select: { defaultNetwork: true },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet for ${symbol} not found`);
    }

    if (!wallet.defaultNetwork) {
      throw new BadRequestException(
        `Network is required for ${symbol} because this wallet has no default network`,
      );
    }

    return wallet.defaultNetwork as CryptoNetwork;
  }

  private async validateMinimumAmount(
    fiatValue: Decimal,
    cryptoSymbol: string,
    cryptoAmount?: Decimal,
  ): Promise<void> {
    const usdtNgnPrice = await this.tickerService.getPrice('usdtngn');
    if (!usdtNgnPrice || parseFloat(usdtNgnPrice) <= 0) {
      throw new NotFoundException('No valid USDT/NGN price available');
    }

    if (
      cryptoSymbol.toUpperCase() === 'USDT' &&
      cryptoAmount &&
      cryptoAmount.gte(MIN_TRANSACTION_USDT)
    ) {
      return;
    }

    const minFiatValue = new Decimal(usdtNgnPrice).mul(MIN_TRANSACTION_USDT);
    if (fiatValue.lt(minFiatValue)) {
      throw new BadRequestException(
        `Minimum transaction amount is ${MIN_TRANSACTION_USDT} USDT (₦${minFiatValue.toFixed(2)})`,
      );
    }
  }

  private async validateSwapMinimumAmount(
    amount: Decimal,
    fromSymbol: string,
  ): Promise<void> {
     // If swapping FROM USDT, the amount is already in USDT
     if (fromSymbol.toUpperCase() === 'USDT') {
       if (amount.lt(MIN_TRANSACTION_USDT)) {
         throw new BadRequestException(
           `Minimum swap amount is ${MIN_TRANSACTION_USDT} USDT equivalent`,
         );
       }
       return;
     }

    const usdtPair = `${fromSymbol.toLowerCase()}usdt`;
    const usdtPrice = await this.tickerService.getPrice(usdtPair);

    if (usdtPrice && parseFloat(usdtPrice) > 0) {
      const usdtValue = amount.mul(usdtPrice);
      if (usdtValue.lt(MIN_TRANSACTION_USDT)) {
        throw new BadRequestException(
          `Minimum swap amount is ${MIN_TRANSACTION_USDT} USDT equivalent`,
        );
      }
      return;
    }

    const ngnPair = `${fromSymbol.toLowerCase()}ngn`;
    const ngnPrice = await this.tickerService.getPrice(ngnPair);
    const usdtNgnPrice = await this.tickerService.getPrice('usdtngn');

    if (
      !ngnPrice ||
      parseFloat(ngnPrice) <= 0 ||
      !usdtNgnPrice ||
      parseFloat(usdtNgnPrice) <= 0
    ) {
      throw new NotFoundException(
        'Unable to determine price for minimum amount validation',
      );
    }

    const ngnValue = amount.mul(ngnPrice);
    const usdtValue = ngnValue.div(usdtNgnPrice);

    if (usdtValue.lt(MIN_TRANSACTION_USDT)) {
      throw new BadRequestException(
        `Minimum swap amount is ${MIN_TRANSACTION_USDT} USDT equivalent`,
      );
    }
  }

  private normalizeCryptoFromCache(crypto: any) {
    return {
      ...crypto,
      defaultBufferPercent: crypto.defaultBufferPercent
        ? new Decimal(crypto.defaultBufferPercent)
        : new Decimal(0),

      maxBufferPercent: crypto.maxBufferPercent
        ? new Decimal(crypto.maxBufferPercent)
        : new Decimal(0),

       buffer_tiers: (crypto.buffer_tiers ?? []).map((t: any) => ({
         ...t,
         bufferPercent: t.bufferPercent
           ? new Decimal(t.bufferPercent)
           : new Decimal(0),

         minAmount: t.minAmount ? BigInt(new Decimal(t.minAmount).toFixed(0)) : null,
         maxAmount: t.maxAmount ? BigInt(new Decimal(t.maxAmount).toFixed(0)) : null,
       })),
    };
  }

  private async getBaseFiat(): Promise<{
    id: string;
    code: string;
    decimals: number;
  }> {
    const fiat = await this.fiatCache.getByCode(this.BASE_FIAT_CURRENCY);

    if (!fiat) {
      throw new NotFoundException(
        `Base fiat currency ${this.BASE_FIAT_CURRENCY} not configured`,
      );
    }

    return {
      id: fiat.id,
      code: fiat.code,
      decimals: this.getFiatDecimals(fiat.code),
    };
  }

  private async getCryptoBySymbol(symbol: string) {
    const crypto = await this.cryptoCache.getBySymbol(symbol);

    if (!crypto) {
      throw new NotFoundException(`Cryptocurrency ${symbol} not found`);
    }

    return this.normalizeCryptoFromCache(crypto);
  }

  private async getEffectiveBufferPercent(
    cryptoSymbol: string,
    orderType: 'buy' | 'sell',
    amountMinor: bigint,
    network?: CryptoNetwork,
  ): Promise<Decimal> {
    const crypto = await this.getCryptoBySymbol(cryptoSymbol);

    let bufferPercent = new Decimal(0);

    const matchingTier = crypto.buffer_tiers.find((tier: any) => {
      const typeMatch =
        !tier.orderType || tier.orderType.toLowerCase() === orderType;
      if (!typeMatch) return false;
      if (tier.minAmount === null || tier.maxAmount === null) return false;
      if (amountMinor < tier.minAmount) return false;
      if (amountMinor > tier.maxAmount) return false;
      return true;
    });

    if (matchingTier) {
      bufferPercent = new Decimal(matchingTier.bufferPercent);
    } else if (crypto.defaultBufferPercent?.gt(0)) {
      bufferPercent = crypto.defaultBufferPercent;
    }

    if (
      bufferPercent.eq(0) &&
      !crypto.buffer_tiers.length &&
      !crypto.defaultBufferPercent?.gt(0)
    ) {
      throw new BadRequestException(
        `No buffer configuration for ${cryptoSymbol}. Cannot place ${orderType} order.`,
      );
    }

    if (
      crypto.maxBufferPercent?.gt(0) &&
      bufferPercent.gt(crypto.maxBufferPercent)
    ) {
      bufferPercent = crypto.maxBufferPercent;
    }

    return bufferPercent.div(100);
  }

  private toMinorString(
    value: Decimal,
    currency: string,
    network?: CryptoNetwork,
  ): string {
    const decimals = getCurrencyDecimals(currency.toLowerCase(), network);
    return ConvertCurrency.toBase(
      value.toFixed(decimals),
      currency,
      network,
    ).toString();
  }

  private async setSwapQuoteCooldown(userId: string): Promise<void> {
    const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}`;
    const now = Date.now().toString();

    await this.tempStore.set(cooldownKey, now, QUOTE_COOLDOWN_SECONDS + 10);
  }

   // ===================================================================
   // BUY QUOTE
   // ===================================================================
   async getBuyQuote(userId: string, dto: BuyQuoteDto & { network?: string }) {
     const { crypto, amount, network } = dto;

    const symbol = crypto.toUpperCase();
    const quoteNetwork = await this.resolveQuoteNetwork(userId, symbol, network);
    const fiat = await this.getBaseFiat();
    const cryptoDecimals = getCurrencyDecimals(symbol, quoteNetwork);

    const volumeCryptoMinor = ConvertCurrency.toBase(
      new Decimal(amount).toFixed(cryptoDecimals),
      symbol,
      quoteNetwork,
    );

    const marketPair = `${symbol.toLowerCase()}${fiat.code.toLowerCase()}`;
    const marketPriceStr = await this.tickerService.getPrice(marketPair);
    if (!marketPriceStr || parseFloat(marketPriceStr) <= 0) {
      throw new NotFoundException(`No valid price for ${marketPair}`);
    }

     const marketPriceDec = new Decimal(marketPriceStr);
     const bufferFactor = await this.getEffectiveBufferPercent(
       symbol,
       'buy',
       volumeCryptoMinor,
       quoteNetwork,
     );

     // bufferedPrice: the rate ceiling the company will execute at
     const bufferedPriceDec = marketPriceDec.mul(
       new Decimal(1).add(bufferFactor),
     );
     const bufferSpreadDec = bufferedPriceDec.sub(marketPriceDec);

     // baseFiat: value of crypto at buffered price (before platform fee)
     const baseFiatDec = new Decimal(amount).mul(bufferedPriceDec);
     const platformFeeDec = baseFiatDec.mul(PLATFORM_SPREAD);
     // totalFiat: full cost to user = baseFiat + platformFee
     const totalFiatDec = baseFiatDec.add(platformFeeDec);

     // Validate the base transaction amount (excludes platform fee)
     await this.validateMinimumAmount(baseFiatDec, symbol);

    const marketPriceMinor = this.toMinorString(marketPriceDec, fiat.code);
    const bufferedPriceMinor = this.toMinorString(bufferedPriceDec, fiat.code);
    const bufferSpreadMinor = this.toMinorString(bufferSpreadDec, fiat.code);
    const platformFeeMinor = this.toMinorString(platformFeeDec, fiat.code);
    const totalFiatMinor = this.toMinorString(totalFiatDec, fiat.code);

    const quoteId = uuidv4();

    const internalQuote: IBuyQuote = {
      quoteId,
      userId,
      side: 'buy',
      crypto: symbol,
      network: quoteNetwork || 'N/A',
      fiatCurrency: fiat.code,
      fiatDecimals: fiat.decimals,
      cryptoDecimals,
      volumeCryptoMinor: volumeCryptoMinor.toString(),
      marketPriceMinor,
      bufferedPriceMinor,
      bufferSpreadMinor,
      platformFeeMinor,
      totalFiatMinor,
      bufferPercent: bufferFactor.mul(100).toFixed(2),
      expiresAt: Date.now() + QUOTE_TTL_SECONDS * 1000,
      pinVerified: false,
    };

    await this.tempStore.set(
      `buy:${quoteId}`,
      JSON.stringify(internalQuote),
      QUOTE_TTL_SECONDS,
    );

    return {
      status: 'success',
      data: {
        id: quoteId,
        side: 'buy',
        crypto: symbol,
        network: quoteNetwork || 'N/A',
        fiatCurrency: fiat.code,
        cryptoVolume: ConvertCurrency.formatCryptoForQuote(
          volumeCryptoMinor.toString(),
          symbol,
          quoteNetwork,
        ),
        marketRate: ConvertCurrency.fromBase(marketPriceMinor, fiat.code),
        bufferedRate: ConvertCurrency.fromBase(bufferedPriceMinor, fiat.code),
        bufferSpread: ConvertCurrency.fromBase(bufferSpreadMinor, fiat.code),
        transactionFee: ConvertCurrency.fromBase(platformFeeMinor, fiat.code),
        totalToPay: ConvertCurrency.fromBase(totalFiatMinor, fiat.code),
        bufferPercent: bufferFactor.mul(100).toFixed(2),
        expiresIn: `${QUOTE_TTL_SECONDS}s`,
      },
    };
  }

   // ===================================================================
   // SELL QUOTE
   // ===================================================================
   async getSellQuote(userId: string, dto: SellQuoteDto & { network?: string }) {
     const { crypto, amount, network } = dto;

    const symbol = crypto.toUpperCase();
    const fiat = await this.getBaseFiat();
    const cryptoDecimals = getCurrencyDecimals(
      symbol,
      network as CryptoNetwork,
    );

    await this.transactionService.validateNetworkExists(
      userId,
      symbol,
      network,
    );

    const exactCryptoMinor = ConvertCurrency.toBase(
      new Decimal(amount).toFixed(cryptoDecimals),
      symbol,
      network as CryptoNetwork,
    );

    const marketPair = `${symbol.toLowerCase()}${fiat.code.toLowerCase()}`;
    const marketPriceStr = await this.tickerService.getPrice(marketPair);
    if (!marketPriceStr || parseFloat(marketPriceStr) <= 0) {
      throw new NotFoundException(`No valid price for ${marketPair}`);
    }
     const marketPriceDec = new Decimal(marketPriceStr);

     const bufferFactor = await this.getEffectiveBufferPercent(
       symbol,
       'sell',
       exactCryptoMinor,
       network as CryptoNetwork,
     );

     const bufferedPriceDec = marketPriceDec.mul(
       new Decimal(1).sub(bufferFactor),
     );
     const bufferSpreadDec = marketPriceDec.sub(bufferedPriceDec);
     const grossFiatDec = new Decimal(amount).mul(bufferedPriceDec);
     const platformFeeCryptoDec = new Decimal(amount).mul(PLATFORM_SPREAD);
     const netFiatDec = grossFiatDec;

     // Validate the gross transaction amount (before platform fee deduction)
     await this.validateMinimumAmount(grossFiatDec, symbol, new Decimal(amount));

    const marketPriceMinor = this.toMinorString(marketPriceDec, fiat.code);
    const bufferedPriceMinor = this.toMinorString(bufferedPriceDec, fiat.code);
    const bufferSpreadMinor = this.toMinorString(bufferSpreadDec, fiat.code);
    const grossFiatMinor = this.toMinorString(grossFiatDec, fiat.code);
    const platformFeeMinor = ConvertCurrency.toBase(
      platformFeeCryptoDec.toFixed(cryptoDecimals),
      symbol,
      network as CryptoNetwork,
    ).toString();
    const netFiatMinor = this.toMinorString(netFiatDec, fiat.code);

    const quoteId = uuidv4();

    const internalQuote: ISellQuote = {
      quoteId,
      userId,
      side: 'sell',
      crypto: symbol,
      network: network || 'N/A',
      fiatCurrency: fiat.code,
      fiatDecimals: fiat.decimals,
      cryptoDecimals,
      exactCryptoMinor: exactCryptoMinor.toString(),
      marketPriceMinor,
      bufferedPriceMinor,
      bufferSpreadMinor,
      grossFiatMinor,
      platformFeeMinor,
      netFiatMinor,
      bufferPercent: bufferFactor.mul(100).toFixed(2),
      expiresAt: Date.now() + QUOTE_TTL_SECONDS * 1000,
      pinVerified: false,
    };

    await this.tempStore.set(
      `sell:${quoteId}`,
      JSON.stringify(internalQuote),
      QUOTE_TTL_SECONDS,
    );

    return {
      status: 'success',
      data: {
        id: quoteId,
        side: 'sell',
        crypto: symbol,
        network: network || 'N/A',
        fiatCurrency: fiat.code,
        cryptoAmount: ConvertCurrency.formatCryptoForQuote(
          exactCryptoMinor.toString(),
          symbol,
          network as CryptoNetwork,
        ),
        marketRate: ConvertCurrency.fromBase(marketPriceMinor, fiat.code),
        bufferedRate: ConvertCurrency.fromBase(bufferedPriceMinor, fiat.code),
        bufferSpread: ConvertCurrency.fromBase(bufferSpreadMinor, fiat.code),
        grossFiat: ConvertCurrency.fromBase(grossFiatMinor, fiat.code),
        transactionFee: ConvertCurrency.fromBase(
          platformFeeMinor,
          symbol,
          network as CryptoNetwork,
        ),
        estimatedFiat: ConvertCurrency.fromBase(netFiatMinor, fiat.code),
        bufferPercent: bufferFactor.mul(100).toFixed(2),
        expiresIn: `${QUOTE_TTL_SECONDS}s`,
      },
    };
  }

  // ===================================================================
  // SWAP QUOTE (CASE-INSENSITIVE + DUAL BUFFER PROTECTION)
  // ===================================================================
  async getSwapQuote(userId: string, dto: SwapQuoteDto) {
    const { from, to, amount } = dto;

    // Normalize to Uppercase for consistent lookup and logic
    const fromSymbol = from.toUpperCase();
    const toSymbol = to.toUpperCase();

    const [fromWallet, toWallet] = await Promise.all([
      this.prisma.wallet.findFirst({
        where: {
          userId,
          currency: { equals: fromSymbol, mode: 'insensitive' },
        },
        select: { defaultNetwork: true },
      }),
      this.prisma.wallet.findFirst({
        where: {
          userId,
          currency: { equals: toSymbol, mode: 'insensitive' },
        },
        select: { defaultNetwork: true },
      }),
    ]);

    if (!fromWallet)
      throw new NotFoundException(`Wallet for ${fromSymbol} not found`);
    if (!toWallet)
      throw new NotFoundException(`Wallet for ${toSymbol} not found`);

    const fromNet = (fromWallet.defaultNetwork as CryptoNetwork) || undefined;
    const toNet = (toWallet.defaultNetwork as CryptoNetwork) || undefined;

    const fromDecimals = getCurrencyDecimals(fromSymbol, fromNet);
    const toDecimals = getCurrencyDecimals(toSymbol, toNet);

    const amountDec = new Decimal(amount);
    const exactFromMinor = ConvertCurrency.toBase(
      amountDec.toFixed(fromDecimals),
      fromSymbol,
      fromNet,
    );

    const swapQuotation = await this.quidaxSwapService.createInstantSwapRequest(
      QUIDAX_COMPANY_USERID,
      {
        from_currency: fromSymbol.toLowerCase(),
        to_currency: toSymbol.toLowerCase(),
        from_amount: amountDec.toFixed(fromDecimals),
      },
    );

    if (swapQuotation.status !== 'success') {
      const errorMsg = swapQuotation.message || 'Failed to get swap quote';
      throw new BadRequestException(
        `Swap not available for ${fromSymbol.toUpperCase()} → ${toSymbol.toUpperCase()}. ${errorMsg}`,
      );
    }

    const quotationData = swapQuotation?.data;
    if (!quotationData?.id) {
      throw new BadRequestException(
        `Swapping is unavailable at the moment`,
      );
    }

    const pairPriceStr = quotationData.quoted_price;
    if (!pairPriceStr || parseFloat(pairPriceStr) <= 0) {
      throw new BadRequestException(
        `Swap not available at the moment`,
      );
    }

    // Quidax quoted_price is already the target-currency amount per one
    // source-currency unit (e.g. BTC per USDT for USDT → BTC). Do not
    // invert it; doing so turns a BTC-per-USDT rate into a USDT-per-BTC
    // price and makes quote values many orders of magnitude too large.
    const marketRateDec = new Decimal(pairPriceStr);
    const platformFeeDec = amountDec.mul(PLATFORM_SPREAD);

    await this.validateSwapMinimumAmount(amountDec, fromSymbol);

    const sellBufferFactor = await this.getEffectiveBufferPercent(
      fromSymbol,
      'sell',
      exactFromMinor,
      fromNet,
    );

    // Platform fee is charged separately, so the full requested source amount
    // is what Quidax swaps and what we use to estimate destination volume.
    const estimatedOutAtMarketDec = amountDec.mul(marketRateDec);
    const estimatedOutAtMarketMinor = ConvertCurrency.toBase(
      estimatedOutAtMarketDec.toFixed(toDecimals),
      toSymbol,
      toNet,
    );

    const buyBufferFactor = await this.getEffectiveBufferPercent(
      toSymbol,
      'buy',
      estimatedOutAtMarketMinor,
      toNet,
    );

    const combinedBufferMultiplier = new Decimal(1)
      .sub(sellBufferFactor)
      .mul(new Decimal(1).sub(buyBufferFactor));

    const protectedRateDec = marketRateDec.mul(combinedBufferMultiplier);
    const bufferSpreadDec = marketRateDec.sub(protectedRateDec);
    const totalBufferPercent = new Decimal(1)
      .sub(protectedRateDec.div(marketRateDec))
      .mul(100);

    const estimatedOutDec = amountDec.mul(protectedRateDec);
    const bufferAmountDec = estimatedOutAtMarketDec.sub(estimatedOutDec);

    const platformFeeMinor = ConvertCurrency.toBase(
      platformFeeDec.toFixed(fromDecimals),
      fromSymbol,
      fromNet,
    ).toString();

    const estimatedOutMinor = ConvertCurrency.toBase(
      estimatedOutDec.toFixed(toDecimals),
      toSymbol,
      toNet,
    ).toString();

    const marketRateMinor = ConvertCurrency.toBase(
      marketRateDec.toFixed(toDecimals),
      toSymbol,
      toNet,
    ).toString();

    // protectedRateMinor is the slippage floor used in confirmSwap comparison
    const protectedRateMinor = ConvertCurrency.toBase(
      protectedRateDec.toFixed(toDecimals),
      toSymbol,
      toNet,
    ).toString();

    const bufferSpreadMinor = ConvertCurrency.toBase(
      bufferSpreadDec.toFixed(toDecimals),
      toSymbol,
      toNet,
    ).toString();

    const quoteId = uuidv4();
    const quoteKey = `swap:${quoteId}`;

    const internalQuote: ISwapQuote = {
      quoteId,
      userId,
      side: 'swap',
      from: fromSymbol,
      to: toSymbol,
      fromNetwork: fromNet || 'default',
      toNetwork: toNet || 'default',
      fromDecimals,
      toDecimals,
      exactFromMinor: exactFromMinor.toString(),
      platformFeeMinor,
      estimatedOutMinor,
      marketRateMinor,
      protectedRateMinor,
      bufferSpreadMinor,
      bufferPercent: sellBufferFactor.mul(100).toFixed(2),
      totalBufferPercent: totalBufferPercent.toFixed(2),
      pinVerified: false,
      expiresAt: Date.now() + QUOTE_TTL_SECONDS * 1000,
      quotationId: quotationData.id,
    };

    await this.tempStore.set(
      quoteKey,
      JSON.stringify(internalQuote),
      QUOTE_TTL_SECONDS,
    );

    return {
      status: 'success',
      data: {
        id: quoteId,
        from: fromSymbol,
        to: toSymbol,
        fromNetwork: fromNet || 'default',
        toNetwork: toNet || 'default',
        amountIn: amount.toString(),
        estimatedOut: ConvertCurrency.fromBase(
          estimatedOutMinor.toString(),
          toSymbol,
          toNet,
        ),
        conversionFee: ConvertCurrency.fromBase(
          platformFeeMinor,
          fromSymbol,
          fromNet,
        ),
        marketRate: pairPriceStr,
        protectedRate: protectedRateDec.toFixed(toDecimals),
        bufferAmount: bufferAmountDec.toFixed(toDecimals),
        bufferPercent: sellBufferFactor.mul(100).toFixed(2),
        totalBufferPercent: totalBufferPercent.toFixed(2),
        expiresIn: `${QUOTE_TTL_SECONDS}s`,
      },
    };
  }

  async verifyPinForQuote(
    userId: string,
    quoteId: string,
    pin: string,
  ): Promise<{ success: boolean; message: string }> {
    const quote = await this.getQuote(quoteId);

    if (!quote) {
      throw new NotFoundException('Quote not found or has expired');
    }

    // Critical check: the pinVerified field MUST already exist
    if (!('pinVerified' in quote)) {
      throw new BadRequestException(
        'Invalid quote state. Please request a quote preview first before verifying PIN.',
      );
    }

    if (quote.userId !== userId) {
      throw new UnauthorizedException(
        'You are not authorized to verify this quote',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });

    if (!user?.pin) {
      throw new BadRequestException('Set PIN first');
    }

    const isPinValid = await compareHash(pin, user.pin);
    if (!isPinValid) {
      throw new UnauthorizedException('Invalid PIN');
    }

    // Now the field exists → we can safely set it to true (whether it was false or already true)
    const wasAlreadyVerified = quote.pinVerified === true;

    quote.pinVerified = true;
    quote.pinVerifiedAt = Date.now();

    // Determine storage key
    let key: string;
    if (quote.side === 'buy') {
      key = `buy:${quoteId}`;
    } else if (quote.side === 'sell') {
      key = `sell:${quoteId}`;
    } else if (quote.side === 'swap') {
      key = `swap:${quoteId}`;
    } else {
      key = `send:${quoteId}`;
    }

    // Save back
    await this.tempStore.set(key, JSON.stringify(quote), QUOTE_TTL_SECONDS);

    return {
      success: true,
      message: wasAlreadyVerified
        ? 'PIN is already verified for this quote'
        : 'PIN verified successfully',
    };
  }

  async getQuote<T extends IQuote>(quoteId: string): Promise<T | null> {
    const keys = [
      `buy:${quoteId}`,
      `sell:${quoteId}`,
      `swap:${quoteId}`,
      `send:${quoteId}`,
    ];
    const results = await Promise.all(
      keys.map((key) => this.tempStore.get(key)),
    );
    for (let i = 0; i < keys.length; i++) {
      if (results[i]) {
        const quote = JSON.parse(JSON.stringify(results[i])) as T;
        if (Date.now() > quote.expiresAt) {
          await this.tempStore.del(keys[i]);
          return null;
        }
        return quote;
      }
    }
    return null;
  }

  async updateQuote<T extends IQuote>(
    quoteId: string,
    quote: T,
  ): Promise<void> {
    const key = `${quote.side}:${quoteId}`;
    const ttlMs = quote.expiresAt - Date.now();
    if (ttlMs > 0) {
      await this.tempStore.set(
        key,
        JSON.stringify(quote),
        Math.ceil(ttlMs / 1000),
      );
    }
  }

  async deleteQuote(quoteId: string) {
    await Promise.all([
      this.tempStore.del(`buy:${quoteId}`),
      this.tempStore.del(`sell:${quoteId}`),
      this.tempStore.del(`swap:${quoteId}`),
    ]);
    this.logger.log(`quote with ${quoteId} deleted`);
  }

  async getTransactionLimits(userId: string, crypto: string) {
    const symbol = crypto.toUpperCase();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });

    const tierLimits = this.tierLimitService.getLimitForTier(
      user?.tier || 'TIER_1',
    );

    const usdtNgnPrice = await this.tickerService.getPrice('usdtngn');
    if (!usdtNgnPrice || parseFloat(usdtNgnPrice) <= 0) {
      throw new NotFoundException('No valid USDT/NGN price available');
    }

    const minNgnValue = new Decimal(usdtNgnPrice).mul(MIN_TRANSACTION_USDT);

    const marketPair = `${symbol.toLowerCase()}ngn`;
    const cryptoNgnPrice = await this.tickerService.getPrice(marketPair);
    if (!cryptoNgnPrice || parseFloat(cryptoNgnPrice) <= 0) {
      throw new NotFoundException(`No valid price for ${marketPair}`);
    }

    const cryptoPriceDec = new Decimal(cryptoNgnPrice);
    const minCryptoAmount = minNgnValue.div(cryptoPriceDec);

    let maxCryptoAmount: string | null = null;
    if (!tierLimits.isUnlimited) {
      const maxNgnValue = new Decimal(tierLimits.dailyTransferLimit);
      maxCryptoAmount = maxNgnValue.div(cryptoPriceDec).toString();
    }

    const cryptoDecimals = 8; // Fixed: no network needed for display limits

    return {
      status: 'success',
      data: {
        crypto: symbol,
        minimum: {
          amount: minCryptoAmount.toFixed(cryptoDecimals),
          usdtEquivalent: MIN_TRANSACTION_USDT,
          ngnValue: minNgnValue.toFixed(2),
        },
        maximum: maxCryptoAmount
          ? {
              amount: new Decimal(maxCryptoAmount).toFixed(cryptoDecimals),
              ngnValue: tierLimits.dailyTransferLimit.toString(),
              tier: user?.tier || 'TIER_1',
            }
          : {
              amount: 'unlimited',
              ngnValue: 'unlimited',
              tier: user?.tier || 'TIER_1',
            },
      },
    };
  }
}
