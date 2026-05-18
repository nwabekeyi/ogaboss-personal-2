import { single } from "rxjs";

export interface GetAllFiatsOptions {
    search?: string;
    page?: number;
    pageSize?: number;
  }

  export const transanctionHistoryTitle = {
    multiUser: 'MULTI-USER TRANSACTION HISTORY',
    user: 'USER TRANSACTION HISTORY'
  } as const;

  export interface AutoStackingSettingsResponse {
    id: string;
    dailyInterestRatePercent: number;
    currency: string;
  }
  
  export interface AutoStackingTransactionFeeResponse {
    id: string;
    fromAmount: string;
    toAmount: string;
    currency: string;
    feeAmount: string;
    feeCurrency: string;
  }
  
  export interface AutoStackingSettingsDataResponse {
    settings: AutoStackingSettingsResponse;
    transactionFees: AutoStackingTransactionFeeResponse[];
  }
  
  export interface AutoStackingSettingsUpdateResponse {
    id: string;
    dailyInterestRatePercent: number;
    currency: string;
  }
  
 export  type BaseResponse<T> = {
    success: boolean;
    message: string;
    data: T;
  };

  export interface CryptoCurrencyRateResponse {
    cryptoId: string;
    symbol: string;
    name: string;
    interestRatePercent: number;
    lockedFundsInterestRatePercent: number;
  }

  export interface UrgentLiquiditySettingsResponse {
    id: string;
    maxLoanRequest: string;
    loanFeePercent: number;
    settlementPercent: number;
    collateralPercent: number;
    liquidationDeadlineDays: number;
    liquidationFeePercent: number;
  }

  export interface RepaymentRangeResponse {
    id: string;
    fromAmount: string;
    toAmount: string;
    repaymentDurationDays: number;
    currency: string;
  }

  export interface UrgentLiquidityDataResponse {
    settings: UrgentLiquiditySettingsResponse;
    repaymentRanges: RepaymentRangeResponse[];
  }