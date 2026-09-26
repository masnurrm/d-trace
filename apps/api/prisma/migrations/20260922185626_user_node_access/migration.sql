-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isChecker" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_node_access" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'VIEWER',
    "canCreateDocument" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_node_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_node_access_nodeId_idx" ON "user_node_access"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "user_node_access_userId_nodeId_key" ON "user_node_access"("userId", "nodeId");

-- AddForeignKey
ALTER TABLE "user_node_access" ADD CONSTRAINT "user_node_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_node_access" ADD CONSTRAINT "user_node_access_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
