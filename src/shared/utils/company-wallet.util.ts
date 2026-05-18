export function getCompanyWalletKey(
  currency: string,
  network?: string,
): string {
  const lowerCurrency = currency.toLowerCase();
  const lowerNetwork = network?.toLowerCase() || 'mainnet';
  return `${lowerCurrency}-${lowerNetwork}`;
}

export function findCompanyWallet(
  wallets: Record<string, any>,
  currency: string,
  network?: string,
): any {
  const lowerCurrency = currency.toLowerCase();
  const networkKey = network?.toLowerCase() || 'mainnet';
  const walletKey = `${lowerCurrency}-${networkKey}`;

  let wallet = wallets[walletKey];
  if (!wallet?.depositAddress && networkKey !== 'mainnet') {
    wallet = wallets[`${lowerCurrency}-mainnet`];
  }
  if (!wallet?.depositAddress) {
    wallet = wallets[`${lowerCurrency}-${lowerCurrency}`];
  }
  if (!wallet?.depositAddress) {
    const availableKeys = Object.keys(wallets).filter((k) =>
      k.startsWith(`${lowerCurrency}-`),
    );
    if (availableKeys.length > 0) {
      wallet = wallets[availableKeys[0]];
    }
  }
  return wallet;
}
