import { BadRequestException } from '@nestjs/common';

export type CryptoCurrency =
  | 'btc'
  | 'eth'
  | 'usdt'
  | 'usdc'
  | 'bnb'
  | 'doge'
  | 'xrp'
  | 'sol'
  | 'link'
  | 'trx';

export interface NetworkInfo {
  id: string;
  name: string;
  decimals: number;
}

export type CryptoNetwork =
  | 'btc'
  | 'bep20'
  | 'erc20'
  | 'trc20'
  | 'polygon'
  | 'solana'
  | 'celo'
  | 'optimism'
  | 'ton'
  | 'arbitrum'
  | 'base'
  | 'doge'
  | 'ripple';

export const CURRENCY_PRECISION: Record<CryptoCurrency, NetworkInfo[]> = {
  bnb: [{ id: 'bep20', name: 'Binance Smart Chain', decimals: 18 }],
  btc: [
    { id: 'btc', name: 'Bitcoin', decimals: 8 },
    { id: 'bep20', name: 'Binance Smart Chain', decimals: 18 },
  ],
  usdt: [
    { id: 'bep20', name: 'Binance Smart Chain', decimals: 18 },
    { id: 'erc20', name: 'Ethereum Network', decimals: 6 },
    { id: 'trc20', name: 'Tron Network', decimals: 6 },
    { id: 'polygon', name: 'Polygon Network', decimals: 6 },
    { id: 'solana', name: 'Solana Network', decimals: 6 },
    { id: 'celo', name: 'Celo Network', decimals: 6 },
    { id: 'optimism', name: 'Optimism Network', decimals: 6 },
    { id: 'ton', name: 'Ton Network', decimals: 6 },
    { id: 'arbitrum', name: 'Arbitrum Network', decimals: 6 },
  ],
  usdc: [
    { id: 'bep20', name: 'Binance Smart Chain', decimals: 18 },
    { id: 'erc20', name: 'Ethereum Network', decimals: 6 },
    { id: 'trc20', name: 'Tron Network', decimals: 6 },
    { id: 'polygon', name: 'Polygon Network', decimals: 6 },
    { id: 'solana', name: 'Solana Network', decimals: 6 },
    { id: 'base', name: 'Base Network', decimals: 6 },
    { id: 'arbitrum', name: 'Arbitrum Network', decimals: 6 },
  ],
  eth: [
    { id: 'erc20', name: 'Ethereum Network', decimals: 18 },
    { id: 'bep20', name: 'Binance Smart Chain', decimals: 18 },
    { id: 'base', name: 'Base Network', decimals: 18 },
  ],
  trx: [{ id: 'trc20', name: 'Tron Network', decimals: 6 }],
  sol: [
    { id: 'solana', name: 'Solana Network', decimals: 9 },
    { id: 'bep20', name: 'Binance Smart Chain', decimals: 18 },
  ],
  doge: [{ id: 'doge', name: 'Doge Blockchain', decimals: 8 }],
  xrp: [{ id: 'ripple', name: 'Ripple Payment Network', decimals: 6 }],
  link: [{ id: 'bep20', name: 'Binance Smart Chain', decimals: 18 }],
};

const VALID_NETWORKS = new Set<string>([
  'btc',
  'bep20',
  'erc20',
  'trc20',
  'polygon',
  'solana',
  'celo',
  'optimism',
  'ton',
  'arbitrum',
  'base',
  'doge',
  'ripple',
]);

// Map Quidax provider network names to CryptoNetwork IDs
const NETWORK_ALIASES: Record<string, CryptoNetwork> = {
  bitcoin: 'btc',
  ethereum: 'erc20',
  tron: 'trc20',
  'binance smart chain': 'bep20',
  'polygon network': 'polygon',
  'solana network': 'solana',
  'celo network': 'celo',
  'optimism network': 'optimism',
  'ton network': 'ton',
  'arbitrum network': 'arbitrum',
  'base network': 'base',
};

export function toCryptoNetwork(raw: string): CryptoNetwork {
  const lower = raw.toLowerCase().trim();
  if (VALID_NETWORKS.has(lower)) return lower as CryptoNetwork;
  const alias = NETWORK_ALIASES[lower];
  if (alias) return alias;
  throw new BadRequestException(
    `Invalid network "${raw}". Valid networks: ${[...VALID_NETWORKS].join(', ')}`,
  );
}
