-- CreateTable
CREATE TABLE "InstalledSection" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalledSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstalledSection_shop_sectionId_key" ON "InstalledSection"("shop", "sectionId");
