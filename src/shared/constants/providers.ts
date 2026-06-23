export const quidaxSellReference = 'sell-withrawal';

export enum Providers {
    QUIDAX = 'Quidax',
    PAYSTACK = 'Paystack',
    XPRESSPAY = 'Xpresspay',
}

export enum Company_withdrawal_type {
    Deposit = 'DEPOSIT',
}

export interface referenceData {
    type: Company_withdrawal_type,
    providerId: string
  }