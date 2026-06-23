/**
 * Represents a single crypto wallet converted to Naira.
 */
export interface TransformedWallet {
  id: string;
  name: string;
  currency: string;
  balance: string;
  reservedBalance: string;
  loanCollateralBalance: string;
  loanCollateralBalanceInNaira: number;
  totalBalance: string;
  ngnPrice: number;
  ngnBalance: number;
  isCrypto: boolean;
  blockchainEnabled: boolean;
  defaultNetwork: string | null;
}

/**
 * The final structure returned by the Wallet Service.
 */
export interface WalletSummary {
  totalBalanceInNaira: number;
  totalReservedBalanceInNaira: number;
  displayCurrency: string;
  currencySymbol: string;
  weeklyPercentChange: number;
  trend: '1' | '0' | '2';
  wallets: TransformedWallet[];
}