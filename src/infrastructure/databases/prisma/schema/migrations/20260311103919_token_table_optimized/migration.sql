-- CreateIndex
CREATE INDEX "tokens_token_type_isRevoked_idx" ON "tokens"("token", "type", "isRevoked");
