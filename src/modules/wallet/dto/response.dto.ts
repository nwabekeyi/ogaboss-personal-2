import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransformedWalletDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Unique identifier of the wallet',
  })
  id: string;

  @ApiProperty({
    example: 'Bitcoin',
    description: 'Display name of the wallet',
  })
  name: string;

  @ApiProperty({
    example: 'BTC',
    description: 'Currency code of the wallet (e.g., BTC, USDT, NGN)',
  })
  currency: string;

  @ApiProperty({
    example: '0.025',
    description: 'Current available balance in the wallet (formatted string)',
  })
  balance: string;

  @ApiProperty({
    example: '0',
    description: 'Reserved balance in display units (formatted string)',
  })
  reservedBalance: string;

  @ApiProperty({
    example: '0.025',
    description:
      'Total wallet balance in display units, including locked/stacked funds (formatted string)',
  })
  totalBalance: string;

  @ApiProperty({
    example: 145000,
    description: 'Current price of 1 unit in NGN',
  })
  ngnPrice: number;

  @ApiProperty({
    example: 3625,
    description: 'Total wallet balance converted to NGN (balance * ngnPrice)',
  })
  ngnBalance: number;

  @ApiProperty({
    example: true,
    description:
      'Whether this is a cryptocurrency wallet (true) or fiat (false)',
  })
  isCrypto: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether blockchain deposits are enabled for this wallet',
  })
  blockchainEnabled: boolean;

  @ApiPropertyOptional({
    example: 'bitcoin',
    description:
      'Default blockchain network for this wallet (for crypto wallets)',
  })
  defaultNetwork: string | null;
}

export class WalletSummaryResponseDto {
  @ApiProperty({
    example: 156250,
    description: 'Total available balance across all wallets in NGN',
  })
  totalBalanceInNaira: number;

  @ApiProperty({
    example: 0,
    description: 'Total reserved balance across all wallets in NGN',
  })
  totalReservedBalanceInNaira: number;

  @ApiProperty({
    example: 'NGN',
    description: 'Primary display currency for the user',
  })
  displayCurrency: string;

  @ApiProperty({
    example: '₦',
    description: 'Currency symbol for NGN',
  })
  currencySymbol: string;

  @ApiProperty({
    example: 5.25,
    description: 'Percentage change in total balance since yesterday',
  })
  percentChangeSinceYesterday: number;

  @ApiProperty({
    example: 'up',
    description:
      'Trend direction: up (positive change), down (negative change), no_change (zero change)',
    enum: ['up', 'down', 'no_change'],
  })
  trend: 'up' | 'down' | 'no_change';

  @ApiProperty({
    type: [TransformedWalletDto],
    description:
      'Array of all user wallets with their balances and conversions',
  })
  wallets: TransformedWalletDto[];
}

export class PaymentAddressDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Unique identifier of the payment address record',
  })
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID of the wallet this address belongs to',
  })
  walletId: string;

  @ApiProperty({
    example: 'btc',
    description: 'Currency code for this payment address',
  })
  currency: string;

  @ApiProperty({
    example: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    description: 'The blockchain wallet address where funds can be sent',
  })
  address: string;

  @ApiProperty({
    example: 'bitcoin',
    description: 'Blockchain network (e.g., bitcoin, ethereum, tron)',
  })
  network: string;

  @ApiPropertyOptional({
    example: '12345678',
    description:
      'Destination tag/memo required for certain blockchains (XRP, XLM, etc.)',
  })
  destinationTag: string | null;
}
