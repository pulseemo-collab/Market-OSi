-- Phase B: multi-tenant performance indexes.
-- Every business query filters by organizationId; without these indexes each one
-- degrades to a sequential scan of a table shared by all tenants.
--
-- Index names follow Prisma's `Table_col1_col2_idx` convention so that
-- `prisma migrate diff` stays clean against schema.prisma.

-- Organization: platform dashboard lists orgs by creation date.
CREATE INDEX IF NOT EXISTS "Organization_createdAt_idx" ON "Organization"("createdAt");

-- Supplier: per-org listing ordered by name.
CREATE INDEX IF NOT EXISTS "Supplier_organizationId_emri_idx" ON "Supplier"("organizationId", "emri");

-- Product: the hottest table. Active-stock listing, name ordering/search,
-- category filter, and supplier joins.
CREATE INDEX IF NOT EXISTS "Product_organizationId_isArchived_idx" ON "Product"("organizationId", "isArchived");
CREATE INDEX IF NOT EXISTS "Product_organizationId_emri_idx" ON "Product"("organizationId", "emri");
CREATE INDEX IF NOT EXISTS "Product_organizationId_kategoria_idx" ON "Product"("organizationId", "kategoria");
CREATE INDEX IF NOT EXISTS "Product_furnitorId_idx" ON "Product"("furnitorId");

-- Supply: per-org history ordered by creation date.
CREATE INDEX IF NOT EXISTS "Supply_organizationId_createdAt_idx" ON "Supply"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Supply_furnitorId_idx" ON "Supply"("furnitorId");

-- SupplyItem: nested include resolution.
CREATE INDEX IF NOT EXISTS "SupplyItem_supplyId_idx" ON "SupplyItem"("supplyId");
CREATE INDEX IF NOT EXISTS "SupplyItem_productId_idx" ON "SupplyItem"("productId");

-- ProductBarcode: barcode search resolves back to the product.
CREATE INDEX IF NOT EXISTS "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");

-- Sale: every dashboard/report/history query is (organizationId, createdAt range).
CREATE INDEX IF NOT EXISTS "Sale_organizationId_createdAt_idx" ON "Sale"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_paymentMethod_createdAt_idx" ON "Sale"("organizationId", "paymentMethod", "createdAt");
CREATE INDEX IF NOT EXISTS "Sale_staffId_idx" ON "Sale"("staffId");

-- SaleItem: items include + top-products groupBy.
CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx" ON "SaleItem"("saleId");
CREATE INDEX IF NOT EXISTS "SaleItem_productId_idx" ON "SaleItem"("productId");

-- UserRole: org member listing and the email uniqueness pre-checks in /api/users.
CREATE INDEX IF NOT EXISTS "UserRole_organizationId_createdAt_idx" ON "UserRole"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserRole_organizationId_email_idx" ON "UserRole"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "UserRole_email_idx" ON "UserRole"("email");

-- AuditLog: grows fastest of all tables. Covers the register page's filter set.
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_userId_createdAt_idx" ON "AuditLog"("organizationId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_entityType_createdAt_idx" ON "AuditLog"("organizationId", "entityType", "createdAt");

-- Notification: bell polling (unread count) runs on every page for every user.
CREATE INDEX IF NOT EXISTS "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_isRead_idx" ON "Notification"("organizationId", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_userId_isRead_idx" ON "Notification"("organizationId", "userId", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_type_isRead_createdAt_idx" ON "Notification"("organizationId", "type", "isRead", "createdAt");

-- BillingAuditLog: per-org billing history.
CREATE INDEX IF NOT EXISTS "BillingAuditLog_organizationId_createdAt_idx" ON "BillingAuditLog"("organizationId", "createdAt");

-- StaffSession: expiry sweeps.
CREATE INDEX IF NOT EXISTS "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");
