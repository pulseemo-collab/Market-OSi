# Protected API Routes — Market OS

All routes require authentication (401 if not logged in). Unauthorised roles receive 403.

## Role Hierarchy

| Role     | Albanian   | Description                              |
|----------|------------|------------------------------------------|
| owner    | Pronar     | Full access — all operations             |
| manager  | Menaxher   | Products, Suppliers, Supplies, Dashboard |
| cashier  | Kasijer    | POS, Sales creation, Sale history        |
| employee | Punonjës   | Read-only where permitted                |

## Permission Map

| Permission          | owner | manager | cashier | employee |
|---------------------|-------|---------|---------|----------|
| products:read       | ✓     | ✓       | ✓       | ✓        |
| products:write      | ✓     | ✓       |         |          |
| products:delete     | ✓     |         |         |          |
| products:prices     | ✓     | ✓       |         |          |
| suppliers:read      | ✓     | ✓       |         |          |
| suppliers:write     | ✓     | ✓       |         |          |
| suppliers:delete    | ✓     |         |         |          |
| supplies:read       | ✓     | ✓       |         |          |
| supplies:write      | ✓     | ✓       |         |          |
| supplies:delete     | ✓     |         |         |          |
| sales:read          | ✓     | ✓       | ✓       |          |
| sales:create        | ✓     |         | ✓       |          |
| sales:manage        | ✓     |         |         |          |
| dashboard:read      | ✓     | ✓       |         |          |
| export:read         | ✓     | ✓       |         |          |
| reorder:read        | ✓     | ✓       |         |          |
| users:manage        | ✓     |         |         |          |

## API Route Protection

| Route                        | Method | Permission         |
|------------------------------|--------|--------------------|
| /api/products                | GET    | products:read      |
| /api/products                | POST   | products:write     |
| /api/products/[id]           | GET    | products:read      |
| /api/products/[id]           | PUT    | products:write     |
| /api/products/[id]           | DELETE | products:delete    |
| /api/suppliers               | GET    | suppliers:read     |
| /api/suppliers               | POST   | suppliers:write    |
| /api/suppliers/[id]          | PUT    | suppliers:write    |
| /api/suppliers/[id]          | DELETE | suppliers:delete   |
| /api/supplies                | GET    | supplies:read      |
| /api/supplies                | POST   | supplies:write     |
| /api/supplies/[id]           | GET    | supplies:read      |
| /api/supplies/[id]           | DELETE | supplies:delete    |
| /api/sales                   | GET    | sales:read         |
| /api/sales                   | POST   | sales:create       |
| /api/sales/[id]              | PUT    | sales:manage       |
| /api/sales/[id]              | DELETE | sales:manage       |
| /api/reorder-suggestions     | GET    | reorder:read       |
| /api/export                  | GET    | export:read        |
| /api/dashboard               | GET    | dashboard:read     |
| /api/users                   | GET    | users:manage       |
| /api/users/[id]              | PUT    | users:manage       |

## Error Responses

- `401 { error: "Nuk je i autorizuar" }` — not authenticated
- `403 { error: "Nuk ke akses" }` — authenticated but wrong role
- `403 { error: "Nuk mund të ndryshosh rolin tënd" }` — self-demotion attempt

## Legacy Role Mapping (DB backward compatibility)

Old roles stored in the database are transparently mapped at runtime:
- `admin` → `owner`
- `staff` → `manager`

No database migration is needed.
