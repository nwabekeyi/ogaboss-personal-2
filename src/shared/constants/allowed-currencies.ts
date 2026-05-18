export const ALLOWED_CURRENCIES = new Set<string>([
  'btc',
  'usdt',
  'usdc',
  'eth',
  'bnb',
  'doge',
  'xrp',
  'sol',
  'link',
  'trx',
  'ngn',
  'usd'
]);

export const SUPPORTED_CRYPTO_CURRENCIES = [...ALLOWED_CURRENCIES].filter(
  (c) => c !== 'ngn' && c !== 'usd'
);

// shared/constants/currency.constants.ts

export const CRYPTO_DECIMALS: Record<string, number> = {
  btc: 8,   // satoshi
  eth: 18,  // wei
  usdt: 6,  // depends on chain, default ERC20
  usdc: 6,
  bnb: 18,
  doge: 8,
  xrp: 6,
  sol: 9,
  link: 18,
  trx: 6,
};

export const FIAT_DECIMALS: Record<string, number> = {
  // African currencies (complete list)
  ngn: 2,    // Nigerian Naira (your original)
  usd: 2,    // US Dollar (your original + global)
  xof: 0,    // West African CFA Franc (Benin, Burkina Faso, Côte d'Ivoire, Guinea-Bissau, Mali, Niger, Senegal, Togo)
  xaf: 0,    // Central African CFA Franc (Cameroon, Central African Republic, Chad, Congo-Brazzaville, Equatorial Guinea, Gabon)
  aoa: 2,    // Angolan Kwanza
  dzd: 2,    // Algerian Dinar
  bwp: 2,    // Botswana Pula
  bif: 0,    // Burundian Franc
  cve: 2,    // Cape Verdean Escudo
  cdf: 2,    // Congolese Franc (DRC)
  dji: 0,    // Djiboutian Franc (DJF code)
  egp: 2,    // Egyptian Pound
  ern: 2,    // Eritrean Nakfa
  etb: 2,    // Ethiopian Birr
  gmd: 2,    // Gambian Dalasi
  ghs: 2,    // Ghanaian Cedi
  gnf: 0,    // Guinean Franc
  kes: 2,    // Kenyan Shilling
  lsl: 2,    // Lesotho Loti
  lrd: 2,    // Liberian Dollar
  lyd: 3,    // Libyan Dinar
  mga: 2,    // Malagasy Ariary (special 5:1 ratio, ISO lists 2)
  mwk: 2,    // Malawian Kwacha
  mru: 2,    // Mauritanian Ouguiya (special 5:1 ratio, ISO lists 2)
  mur: 2,    // Mauritian Rupee
  mad: 2,    // Moroccan Dirham
  mzn: 2,    // Mozambican Metical
  nad: 2,    // Namibian Dollar
  rwf: 0,    // Rwandan Franc
  stn: 2,    // São Tomé and Príncipe Dobra
  scr: 2,    // Seychellois Rupee
  sle: 2,    // Sierra Leonean Leone
  sos: 0,    // Somali Shilling
  zar: 2,    // South African Rand
  ssp: 2,    // South Sudanese Pound
  sdg: 2,    // Sudanese Pound
  szl: 2,    // Eswatini Lilangeni
  tzs: 0,    // Tanzanian Shilling
  tnd: 3,    // Tunisian Dinar
  ugx: 0,    // Ugandan Shilling
  zmw: 2,    // Zambian Kwacha
  zwg: 2,    // Zimbabwe Gold (ZiG, code ZWG since 2024)

  // Major global currencies (for easy future addition)
  eur: 2,
  gbp: 2,
  jpy: 0,
  krw: 0,
  vnd: 0,
  kwd: 3,
  bhd: 3,
  omr: 3,
  iqd: 3,
  jod: 3,
};


export const BASE_CURRENCY: string = 'ngn';
