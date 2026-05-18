-- Drop foreign key only if it exists
ALTER TABLE "buffer_tiers"
DROP CONSTRAINT IF EXISTS "buffer_tiers_cryptoId_fkey";
