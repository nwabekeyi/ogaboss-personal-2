export const quidaxSellReference = 'sell-withrawal';

export enum Providers {
    QUIDAX = 'Quidax',
    PAYSTACK = 'Paystack',
}

export enum Company_withdrawal_type {
    Deposit = 'DEPOSIT',
}

export interface referenceData {
    type: Company_withdrawal_type,
    providerId: string
  }
