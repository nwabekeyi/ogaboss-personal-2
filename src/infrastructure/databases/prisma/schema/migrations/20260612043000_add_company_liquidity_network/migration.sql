ALTER TABLE "company_liquidity" ADD COLUMN IF NOT EXISTS "network" TEXT;

UPDATE "company_liquidity"
SET "network" = CASE LOWER("currency")
  WHEN 'btc' THEN 'btc'
  WHEN 'eth' THEN 'erc20'
  WHEN 'bnb' THEN 'bep20'
  WHEN 'usdt' THEN 'trc20'
  WHEN 'usdc' THEN 'trc20'
  WHEN 'trx' THEN 'trc20'
  WHEN 'xrp' THEN 'ripple'
  WHEN 'doge' THEN 'doge'
  WHEN 'sol' THEN 'solana'
  WHEN 'link' THEN 'bep20'
  ELSE NULL
END
WHERE "network" IS NULL;
