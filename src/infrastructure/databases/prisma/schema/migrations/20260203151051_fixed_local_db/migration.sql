-- Ensure timestamp columns exist with correct type (NO DATA LOSS)
ALTER TABLE "buffer_tiers"
  ADD COLUMN IF NOT EXISTS "createdat" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedat" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Ensure correct foreign key exists (schema-aligned)
DO $$
BEGIN
    -- Check if the FK already exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='buffer_tiers'
          AND constraint_name='buffer_tiers_cryptoid_fkey'
          AND constraint_type='FOREIGN KEY'
    ) THEN
        ALTER TABLE "buffer_tiers"
        ADD CONSTRAINT "buffer_tiers_cryptoid_fkey"
        FOREIGN KEY ("cryptoId")
        REFERENCES "cryptocurrencies"("id")
        ON DELETE CASCADE
        ON UPDATE NO ACTION;
    END IF;
END $$;
