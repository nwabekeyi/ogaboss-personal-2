import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const tickerService = {
    getCachedTickers: jest.fn().mockResolvedValue({
      usdtngn: { ticker: { last: '1386' } },
    }),
  };

  const dailyPercentage = {
    findFirst: jest.fn().mockResolvedValue(null),
  };

  function makeService(wallets: any[]) {
    const prisma = {
      wallet: {
        findMany: jest.fn().mockResolvedValue(wallets),
      },
      userDailyPercentage: dailyPercentage,
    };

    return new WalletService(prisma as any, tickerService as any);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tickerService.getCachedTickers.mockResolvedValue({
      usdtngn: { ticker: { last: '1386' } },
    });
    dailyPercentage.findFirst.mockResolvedValue(null);
  });

  it('formats wallet balances using the wallet defaultNetwork as the canonical scale', async () => {
    const service = makeService([
      {
        id: 'wallet-usdt',
        name: 'USDT Tether',
        currency: 'USDT',
        baseBalance: '5000000000000000000',
        reservedBalance: '1000000000000000000',
        lockedAmount: '3000000000000000000',
        stackedAmount: '0',
        isCrypto: true,
        blockchainEnabled: true,
        defaultNetwork: 'bep20',
      },
    ]);

    const result = await service.userWallets('user-id');

    expect(result.wallets[0]).toMatchObject({
      currency: 'USDT',
      balance: '4',
      reservedBalance: '1',
      totalBalance: '8',
      ngnBalance: 5544,
    });
    expect(result.totalBalanceInNaira).toBe(5544);
    expect(result.totalReservedBalanceInNaira).toBe(1386);
  });
});
