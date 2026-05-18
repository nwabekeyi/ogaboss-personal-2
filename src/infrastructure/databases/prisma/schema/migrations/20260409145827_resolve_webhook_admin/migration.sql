-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "resolvedBy" TEXT;

-- CreateIndex
CREATE INDEX "Webhook_resolvedBy_idx" ON "Webhook"("resolvedBy");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
