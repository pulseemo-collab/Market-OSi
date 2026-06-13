-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
                           ADD COLUMN "cancelledAt"       TIMESTAMP(3);
