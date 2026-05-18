DO $main$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'transactions'
      AND table_schema = current_schema()
  ) THEN

    -- Create or replace function
    CREATE OR REPLACE FUNCTION notify_transaction_insert()
    RETURNS trigger AS $func$
    BEGIN
      PERFORM pg_notify('transaction_inserted', row_to_json(NEW)::text);
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    -- Drop trigger if exists
    IF EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'transaction_insert_trigger'
    ) THEN
      DROP TRIGGER transaction_insert_trigger ON transactions;
    END IF;

    -- Create trigger
    CREATE TRIGGER transaction_insert_trigger
    AFTER INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION notify_transaction_insert();
  END IF;
END
$main$;
