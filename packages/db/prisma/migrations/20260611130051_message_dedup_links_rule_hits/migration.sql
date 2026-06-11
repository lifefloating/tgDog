-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "dupCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "messageLink" TEXT,
ADD COLUMN     "polishedText" TEXT,
ADD COLUMN     "senderAvatarKey" TEXT,
ADD COLUMN     "textHash" TEXT;

-- CreateTable
CREATE TABLE "message_rule_hits" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_rule_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_rule_hits_ruleId_createdAt_idx" ON "message_rule_hits"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_rule_hits_messageId_ruleId_key" ON "message_rule_hits"("messageId", "ruleId");

-- CreateIndex
CREATE INDEX "messages_senderId_textHash_idx" ON "messages"("senderId", "textHash");

-- AddForeignKey
ALTER TABLE "message_rule_hits" ADD CONSTRAINT "message_rule_hits_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_rule_hits" ADD CONSTRAINT "message_rule_hits_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
