# Platform Dashboard (Paneli i Platformës SaaS)

## Përmbledhje

Faqja **Platforma** (`/platforma`) është një pamje ekskluzive për pronarin e platformës SaaS (Market OS). Ajo shfaq statistika të agreguara nga **të gjitha** organizatat aktive në sistem, duke i mundësuar operatorit të platformës të monitorojë shëndetin e platformës si tërësi.

## Qasja

| Roli             | Qasje     |
|------------------|-----------|
| `platform_owner` | ✅ Po     |
| `owner`          | ❌ Jo     |
| `manager`        | ❌ Jo     |
| `cashier`        | ❌ Jo     |
| `employee`       | ❌ Jo     |

Vetëm roli `platform_owner` ka akses. Çdo përdorues tjetër merr faqen **AccessDenied**. Shiko `PLATFORM_OWNER.md` për udhëzime se si të vendosësh këtë rol.

## Shtimi i Skedarëve

```
src/
├── app/
│   ├── api/
│   │   └── platform/
│   │       └── route.ts          ← API route GET /api/platform
│   └── platforma/
│       └── page.tsx              ← Faqja e Platformës SaaS
├── components/layout/
│   └── Sidebar.tsx               ← Shton "Platforma" (vetëm owner)
└── lib/
    └── roles.ts                  ← Shton permission 'platform:read' dhe route '/platforma'
```

## API Route — `GET /api/platform`

### Siguria

- Kërkon autentikim Supabase të vlefshëm
- Kërkon `permission: 'platform:read'` → vetëm roli `owner`
- Rate limiting: bucket `platform`

### Të dhënat e kthyera

```json
{
  "totalOrganizations": 3,
  "totalUsers": 12,
  "totalProducts": 248,
  "totalSales": 1540,
  "totalRevenue": 385200.50,
  "totalNotifications": 47,
  "totalAuditLogs": 892,
  "organizations": [
    {
      "id": 1,
      "name": "Marketi Tirana",
      "usersCount": 4,
      "productsCount": 120,
      "salesCount": 800,
      "lastActivity": "2026-06-01T14:30:00.000Z",
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

### Agregimi i të dhënave

| Fusha               | Burimi                          |
|---------------------|---------------------------------|
| `totalOrganizations`| `prisma.organization.count()`   |
| `totalUsers`        | `prisma.userRole.count()`       |
| `totalProducts`     | `prisma.product.count()`        |
| `totalSales`        | `prisma.sale.aggregate._count`  |
| `totalRevenue`      | `prisma.sale.aggregate._sum.totali` |
| `totalNotifications`| `prisma.notification.count()`   |
| `totalAuditLogs`    | `prisma.auditLog.count()`       |
| `organizations[]`   | `prisma.organization.findMany()` me `_count` |

## Faqja `/platforma`

### Elementet e UI

1. **Titull + buton Rifresko** — me spinner gjatë ngarkimit
2. **Timestamp i rifreskimit të fundit**
3. **7 karta KPI** (grid responsive: 2 kolona mobile → 7 kolona XL)
   - Organizata Gjithsej
   - Përdorues Gjithsej
   - Produkte Gjithsej
   - Shitje Gjithsej
   - Të Ardhura Totale (me L)
   - Njoftime Gjithsej
   - Regjistrime Auditimi
4. **Tabelë e organizatave** me kolona:
   - `#` (ID)
   - Organizata (emri + ikonë)
   - Përdorues (badge violet)
   - Produkte (badge portokalli)
   - Shitje (badge jeshile)
   - Aktiviteti i Fundit (data e shitjes së fundit)
   - Krijuar më

### Siguria (Client-side)

```tsx
if (!role || role !== 'platform_owner') return <AccessDenied />
```

Roli lexohet nga `RoleContext` i cili popullohet gjatë ngarkimit të layout-it.

## Izolimi Multi-Tenant

- Përdoruesit normalë (manager, cashier, employee) **nuk mund** të shohin të dhëna nga organizata të tjera
- API-ja `/api/platform` kthen të dhëna **cross-org** vetëm kur autentikimi kalon `platform:read`
- Sidebar-i shfaq opsionin "Platforma" vetëm kur `role === 'platform_owner'`
- ROUTE_ACCESS i roleve siguron navigim të saktë

## Ndryshimet e Roleve/Permissions

**`src/lib/roles.ts`**:
```ts
// Lejet e platformës (platform_owner)
'platform:read':        ['platform_owner'],
'organizations:read':   ['platform_owner'],
'organizations:manage': ['platform_owner'],
'billing:read':         ['platform_owner'],
'global:audit':         ['platform_owner'],
'global:monitoring':    ['platform_owner'],

// Route e platformës
'/platforma': ['platform_owner'],
```

## Shënim Sigurie

Platforma SaaS supozon se **të gjitha** organizatat ndajnë të njëjtën bazë të dhënash. Vetëm roli `platform_owner` mund të qaset tek `/api/platform` — pronari i organizatës (`owner`) nuk ka më akses në këtë endpoint. Shiko `PLATFORM_OWNER.md` për detaje mbi ndarjen e roleve.
