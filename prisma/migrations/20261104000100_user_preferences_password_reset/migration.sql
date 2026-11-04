-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordResetLastRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "passwordResetRequestedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" UUID NOT NULL,
    "locale" VARCHAR(20) NOT NULL DEFAULT 'fr',
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Africa/Abidjan',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_consumedAt_idx" ON "PasswordResetToken"("userId", "consumedAt");

-- CreateIndex
CREATE INDEX "User_passwordResetRequestedAt_idx" ON "User"("passwordResetRequestedAt");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Préférences de lancement pour les comptes déjà présents, sans modifier leurs données.
INSERT INTO "UserPreference" ("userId", "createdAt", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
ON CONFLICT ("userId") DO NOTHING;
