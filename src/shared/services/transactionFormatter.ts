import { Transaction, User } from '../../infrastructure';
import { ConvertCurrency } from '../utils/currency-precision.util';

export interface FormattedTransaction {
  transactionId: string;
  date: Date;
  accountName: string;
  walletAddress: string;
  transactionType: string;
  status: string;
  amountToken: string;
  currency: string;
  network: string | null;
  executedCryptoAmountOriginal: string | null;
  executedFiatAmountOriginal: string | null;
  executionPrice: string | null;
  executedAt: Date | null;
  transactionContext: string;
}

export class TransactionFormatter {
  static format(
    transaction: Transaction & {
      User?: Pick<User, 'firstName' | 'lastName'> | null;
    },
  ): FormattedTransaction {
    const accountName =
      `${transaction.User?.firstName || ''} ${transaction.User?.lastName || ''}`.trim() ||
      'N/A';

    const walletAddress =
      transaction.receiverWalletAddress ||
      transaction.senderWalletAddress ||
      'N/A';

    const isCrypto =
      transaction.transactionType.toLowerCase() === 'crypto' ||
      !!transaction.cryptoAmountOriginal;

    const executedCryptoAmountOriginal = transaction.executedCryptoAmountBase
      ? ConvertCurrency.fromBase(
          transaction.executedCryptoAmountBase.toString(),
          transaction.currency,
        )
      : null;

    const executedFiatAmountOriginal = transaction.executedFiatAmountBase
      ? ConvertCurrency.fromBase(
          transaction.executedFiatAmountBase.toString(),
          'ngn',
        )
      : null;

    return {
      transactionId: transaction.id,
      date: transaction.createdAt,
      accountName,
      walletAddress,
      transactionType: transaction.transactionType,
      status: transaction.status,
      amountToken: isCrypto
        ? `${transaction.cryptoAmountOriginal} ${transaction.currency.toUpperCase()}`
        : 'N/A',
      currency: transaction.currency,
      network: transaction.network,
      executedCryptoAmountOriginal,
      executedFiatAmountOriginal,
      executionPrice: transaction.executionPrice ?? null,
      executedAt: transaction.executedAt ?? null,
      transactionContext: transaction.transactionContext,
    };
  }

  static formatMany(
    transactions: (Transaction & {
      User?: Pick<User, 'firstName' | 'lastName'> | null;
    })[],
  ): FormattedTransaction[] {
    return transactions.map(this.format);
  }
}