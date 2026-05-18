import { Decimal } from '../prisma/generated/prisma/internal/prismaNamespace';


export interface CachedAutoStackingSettings {
    id: string;
    dailyInterestRatePercent: number;
    currency: string;
  }
  
  export interface CachedAutoStackingTransactionFee {
    id: string;
    fromAmount: string;
    toAmount: string;
    currency: string;
    feeAmount: string;
    feeCurrency: string;
  }
  
  export interface CachedAutoStackingData {
    settings: CachedAutoStackingSettings;
    transactionFees: CachedAutoStackingTransactionFee[];
  }

  export interface CachedBufferTier {
    id: string;
    cryptoId: string | null;
    orderType: string | null;
    minAmount: string | null;
    maxAmount: string | null;
    bufferPercent: Decimal | null;
  }
  
  export interface CachedCryptoCurrency {
    id: string;
    name: string;
    symbol: string;
    logoUrl?: string | null;
    description?: string | null;
    defaultBufferPercent: Decimal;
    maxBufferPercent: Decimal;
    buffer_tiers: CachedBufferTier[];
  }

  export interface CachedCryptoCurrencyRate {
    cryptoId: string;
    symbol: string;
    name: string;
    interestRatePercent: number;
    lockedFundsInterestRatePercent: number;
  }

  export interface CachedUrgentLiquiditySettings {
    id: string;
    maxLoanRequest: string;
    loanFeePercent: number;
    settlementPercent: number;
    collateralPercent: number;
    liquidationDeadlineDays: number;
    liquidationFeePercent: number;
  }
  
  export interface CachedRepaymentRange {
    id: string;
    fromAmount: string;
    toAmount: string;
    repaymentDurationDays: number;
    currency: string;
  }
  
  export interface CachedUrgentLiquidityData {
    settings: CachedUrgentLiquiditySettings;
    repaymentRanges: CachedRepaymentRange[];
  }