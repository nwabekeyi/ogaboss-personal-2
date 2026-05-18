export interface TransactionReceiptData {
    transactionId: string;
    date: string;
    accountName: string;
    walletAddress: string;
    transactionType: string;
    status: string;
    amountToken: string;
    currency: string;
    network: string | null;
    executedCryptoAmount?: string;
    executedFiatAmount?: string;
    executionPrice?: string;
    executedAt?: string;
  }
  
  export interface TransactionHistoryRow {
    transactionId: string;
    date: string;
    accountName: string;
    transactionType: string;
    status: string;
    amount: string;
    currency: string;
    network?: string;
  }