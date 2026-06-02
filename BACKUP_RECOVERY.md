# Backup & Recovery — Market OS

## Overview

Market OS provides an owner-only backup and restore system that exports all
organisation-scoped data to a portable JSON file and restores from it safely.

---

## Backup

### What is exported

| Table            | Notes                                    |
|------------------|------------------------------------------|
| Organization     | Name, timestamps                         |
| Suppliers        | All supplier records                     |
| Products         | Full product catalogue with stock levels |
| ProductBarcodes  | Barcode mappings                         |
| Supplies         | Supply receipts                          |
| SupplyItems      | Line items per supply receipt            |
| Sales            | All transaction records                  |
| SaleItems        | Line items per sale                      |
| UserRoles        | Role assignments (for reference only)    |
| AuditLogs        | Most recent 1 000 audit entries          |

### Backup file format

```
market-osi-backup-{organizationName}-{YYYY-MM-DD}.json
```

### Metadata included

```json
{
  "metadata": {
    "appVersion": "1.1.0",
    "organizationId": 1,
    "organizationName": "My Market",
    "exportedAt": "2026-06-02T14:00:00.000Z",
    "exportedBy": "owner@email.com",
    "counts": {
      "suppliers": 12,
      "products": 340,
      "productBarcodes": 400,
      "supplies": 56,
      "supplyItems": 280,
      "sales": 5000,
      "saleItems": 18000,
      "userRoles": 4,
      "auditLogs": 1000
    }
  },
  ...
}
```

### How to export

1. Log in as **Pronar** (owner).
2. Navigate to **Backup & Rikuperim** in the sidebar.
3. Click **Shkarko Backup** — the file downloads automatically.
4. Store the file in a secure location (encrypted drive or cloud storage).

### API

```
GET /api/backup
Authorization: Cookie (owner role required)
Response: application/json — Content-Disposition: attachment
Rate limit: 10 requests/minute
```

---

## Restore

### What is restored

All tables **except** UserRoles are fully deleted and recreated from the backup.
Internal numeric IDs are remapped automatically to avoid conflicts; foreign-key
references inside the backup are preserved correctly.

**UserRoles are not restored.** They are tied to Supabase Auth UUIDs that may
not exist in the target project. Role assignments must be managed separately
via the Përdoruesit page.

**AuditLogs are not restored.** Historical audit trails are read-only records
and restoring them would cause duplication.

### Cross-organisation restore

If the backup was created by a *different* organisation (different `organizationId`),
the server returns a `409` warning before proceeding. The owner must explicitly
tick the **"Konfirmoj importin nga organizatë tjetër"** checkbox to continue.

### Restore process

1. Navigate to **Backup & Rikuperim**.
2. Click **Zgjidh Skedarin** and select a `.json` backup file.
3. Review the metadata preview (organisation name, export date, record counts).
4. If the backup is from a different organisation, confirm the cross-org checkbox.
5. Tick the **confirmation checkbox** acknowledging that existing data will be replaced.
6. Click **Rikupero të Dhënat** (red button).
7. Wait for the success confirmation — do not close the browser.

### Validation

Before any data is touched the server validates:

- JSON is parseable and not empty
- `metadata.appVersion`, `organizationId`, `organizationName`, `exportedAt`, `exportedBy` are present
- All required arrays (`suppliers`, `products`, `productBarcodes`, `supplies`, `supplyItems`, `sales`, `saleItems`, `userRoles`, `auditLogs`) exist

An invalid file is rejected with a `400` error before the database is touched.

### Transaction safety

The restore runs inside a single Prisma transaction with a 120-second timeout.
If any step fails the entire operation is rolled back — no partial data is left
in the database.

### API

```
POST /api/restore
Authorization: Cookie (owner role required)
Content-Type: application/json
Body: { "backup": <parsed JSON>, "confirmCrossOrg": true | false }
Rate limit: 5 requests/minute
```

---

## Audit Logging

Every backup and restore operation is recorded in the Audit Log
(`/regjistri`) with the following actions:

| Action                   | When                                     |
|--------------------------|------------------------------------------|
| `backup_exported`        | Successful backup download               |
| `backup_restored`        | Successful restore                       |
| `backup_restore_failed`  | Restore failed (transaction rolled back) |

All entries include metadata: record counts, export date, exporting user, and
whether a cross-org restore was performed.

---

## Error Monitoring

Exceptions in `/api/backup` and `/api/restore` are captured by Sentry with:

- `operation` tag: `backup_export` or `backup_restore`
- `organizationId` tag
- Extra context: backup org name/id

---

## Security

- Both endpoints require **owner** role (`backup:create`, `backup:restore`).
- `organizationId` is derived server-side from the authenticated user's
  `UserRole` — never from the client request.
- Cross-org restores require an explicit double confirmation (server + client).
- Rate limit: 10 exports/min, 5 restores/min per org.
- All operations are audited.

---

## Recommendations

- Schedule weekly backups before peak trading hours.
- Store backup files encrypted and off-site (e.g. encrypted cloud storage).
- Test restores periodically in a staging environment.
- Keep at least the last 4 weekly backups.
- Never share backup files — they contain full product pricing and sales data.
