-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "industry" VARCHAR(100),
    "website" VARCHAR(2048),
    "country" VARCHAR(100),
    "city" VARCHAR(100),
    "address" VARCHAR(255),
    "description" VARCHAR(2000),
    "notes" VARCHAR(5000),
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_userId_status_name_id_idx" ON "Company"("userId", "status", "name", "id");

-- CreateIndex
CREATE INDEX "Company_userId_status_createdAt_id_idx" ON "Company"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Company_userId_status_updatedAt_id_idx" ON "Company"("userId", "status", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Company_userId_normalizedName_key" ON "Company"("userId", "normalizedName");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Company" ADD CONSTRAINT "Company_archive_state_check" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL));
