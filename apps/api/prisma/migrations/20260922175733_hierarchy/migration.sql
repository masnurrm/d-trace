-- CreateTable
CREATE TABLE "node_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "canBeRoot" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "typeId" UUID NOT NULL,
    "parentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_NodeTypePlacement" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_NodeTypePlacement_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "node_types_code_key" ON "node_types"("code");

-- CreateIndex
CREATE INDEX "node_types_isActive_idx" ON "node_types"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_code_key" ON "nodes"("code");

-- CreateIndex
CREATE INDEX "nodes_parentId_position_idx" ON "nodes"("parentId", "position");

-- CreateIndex
CREATE INDEX "nodes_typeId_idx" ON "nodes"("typeId");

-- CreateIndex
CREATE INDEX "nodes_isActive_idx" ON "nodes"("isActive");

-- CreateIndex
CREATE INDEX "_NodeTypePlacement_B_index" ON "_NodeTypePlacement"("B");

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "node_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NodeTypePlacement" ADD CONSTRAINT "_NodeTypePlacement_A_fkey" FOREIGN KEY ("A") REFERENCES "node_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NodeTypePlacement" ADD CONSTRAINT "_NodeTypePlacement_B_fkey" FOREIGN KEY ("B") REFERENCES "node_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
