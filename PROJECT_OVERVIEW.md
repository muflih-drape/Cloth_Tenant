# StockFlow / XL Apparals — Codebase Overview

> **Repository:** `Cloth_Tenant` (GitHub: `muflih-drape/Cloth_Tenant`, branch `main`)
> **Internal name:** "StockFlow" / "XL Apparals" — the repo was renamed on GitHub but internal identifiers were never updated.
> **Analysis date:** 2026-09-27 · **HEAD:** `efa6644` · **Tracked files:** 453 (frontend 272 / backend 181)
> **Authors:** 1 (`Muflih-uk <muhammedmuflih875@gmail.com>`) · 4 commits over 26.5 hours

---

## 1. Project Summary

### 1.1 Purpose

A **single-tenant B2B order-management system for a cloth/textile mill**. It models the physical reality of selling fabric *off a roll, measured in metres*:

- A mill sells **fabrics** (cloth qualities) in **colours/finishes** (`FabricVariant`). Stock is per-colour, in fractional metres to 3 decimal places.
- **Sales agents** take orders from **customers** for specific metres of specific fabric colours, identified by scanning a **QR label** printed on each colour variant.
- A **warehouse admin** then has to *split physical rolls* across many competing orders. This is the hard part and the reason the app exists: one roll of 2400 m must be divided between two customers who each want 1400 m.

### 1.2 The single load-bearing invariant

`backend/apps/orders/stock.py:1-17` states it, and the entire codebase is organised around it:

> `FabricVariant.stock_meters` is **on-hand warehouse stock**, and it moves in exactly one place: when packing hands cloth to a customer.

Consequences that pervade the design:

| Rule | Where enforced |
|---|---|
| **Placing an order records demand only** — never decrements stock | `orders/views.py:223-229` |
| **Cloth leaves the roll only on `confirm`** of a packing round | `orders/allocation.py:294-368` |
| **Demand may exceed supply.** Oversubscription is *reported*, never rejected | `orders/stock.py:143-201` (`backorder_report`) |
| `ordered_quantity` = demand, `allocated_quantity` = cloth physically moved; the gap is the packing queue's work | `orders/models.py:202-204` |

### 1.3 Tech Stack

**Backend** — Django REST monolith, `backend/`

| Layer | Technology | Version |
|---|---|---|
| Language | Python | `>=3.12` (`.python-version: 3.12`) |
| Framework | Django | `5.2.14` |
| REST | djangorestframework | `3.16.1` |
| Auth | SimpleJWT (JWT bearer) + custom `PasswordResetToken` | `5.5.1` |
| Schema | drf-spectacular (Swagger/ReDoc) | `0.29.0` |
| Password reset | django-rest-passwordreset + custom email view | `1.5.0` |
| CORS | django-cors-headers | `4.9.0` |
| Async tasks | Celery + Redis | `5.6.3` / `7.4.0` |
| Database | PostgreSQL (psycopg2-binary) | `2.9.12` / PG 16 |
| Push (web) | pywebpush (VAPID) | `2.3.0` |
| Push (mobile) | firebase-admin (FCM) | `6.6.0` |
| Images | Pillow | `12.2.0` |
| Static | WhiteNoise (compressed manifest) | `6.8.2` |
| WSGI | Gunicorn | `23.0.0` |
| Config | python-decouple (`.env`) | `3.8` |
| Lockfile | `uv.lock` (1468 lines) | — |

**Frontend** — Next.js App Router SPA, `frontend/`

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript (`strict: true`) | `^5.9.3` |
| Framework | **Next.js 16** (App Router, Turbopack) | `16.2.2` (exact pin) |
| UI | React / ReactDOM | `19.2.3` (exact pin) |
| Styling | Tailwind CSS v4 (CSS-first `@theme`) | `^4.2.2` |
| Components | shadcn/ui (`new-york`, Radix) + lucide-react | — |
| HTTP | axios | `^1.15.2` |
| Charts | recharts | `^3.8.1` |
| PDF | `@react-pdf/renderer` + `pdf-lib` | — |
| QR | `@yudiel/react-qr-scanner` (scan) + `react-qr-code` (render) | — |
| Image crop | `react-easy-crop` | `^5.5.7` |
| HEIC | `heic2any` (dynamic import) | `^0.0.4` |
| Excel | `xlsx` (SheetJS via CDN tarball) | `0.20.3` |
| Toasts | sonner | `^2.0.7` |
| Dates | date-fns + react-day-picker | `^4.1.0` / `^9.14.0` |
| Tests | Vitest + jsdom + Testing Library | `^4.1.4` |
| Runtime | Node, pnpm | `>=24 <25`, `pnpm@11.9.0` |

### 1.4 Architecture Pattern

**Two-tier client/server monolith, split by physical deploy** — *not* MVC, *not* microservices.

```
┌────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (frontend/)                          │
│  Route groups → (auth) (agent) (agent-order) (admin)       │
│                   (admin-no-layout)                         │
│  State: 2 React Contexts + cookies (NO Redux/Zustand)       │
│  Middleware: proxy.ts (JWT expiry sweep + /admin guard)    │
└────────────────────────┬───────────────────────────────────┘
                         │  HTTPS, JWT Bearer, CORS
┌────────────────────────▼───────────────────────────────────┐
│  Django REST Framework (backend/)                           │
│  config/ (settings, urls, celery, wsgi, asgi)               │
│  apps/  accounts agents customers items orders              │
│         dashboard admins business notification               │
│  transports/  (sibling of apps/ — see §11.1)                │
└──────┬──────────────────────┬───────────────────────┬───────┘
       │                      │                       │
  PostgreSQL 16          Redis 7 + Celery        media/ (FileSystemStorage)
  (13 tables)             worker + beat          whatsapp/pillow-resized
```

Characteristics:
- **Backend is an app-registry monolith** (10 Django apps) with domain services (`allocation.py`, `stock.py`, `pricing.py`) sitting beside views.
- **Frontend is a fully client-rendered SPA** — auth lives in browser cookies only, there is no SSR session (`AGENTS.md:15`: *"Do not assume SSR/session state."*).
- **Async work is Celery**, but notifications are explicitly *best-effort* (`notification/utils.py:1-7`: a broker outage must never turn a successful business op into a 500).
- **Single-tenant.** `Brand` is a singleton company profile for invoicing, not a tenancy boundary. Explicitly documented at `apps/accounts/models.py:8-12` and `apps/business/models.py:5-9`.

---

## 2. Folder & File Structure

### 2.1 Top Level

```
Cloth_Tenant/
├── backend/          Django REST API + Celery + Postgres  (181 tracked files)
├── frontend/         Next.js 16 App Router SPA            (272 tracked files)
└── PROJECT_OVERVIEW.md   ← this document
```
> There is **no root-level `.gitignore`, `README`, or config file.** Ignore rules live separately in `backend/.gitignore` (45 lines) and `frontend/.gitignore` (43 lines).

### 2.2 Backend Tree

```
backend/
├── manage.py                     Django CLI entry; DJANGO_SETTINGS_MODULE=config.settings
├── pyproject.toml                project metadata: name="stock_flow_backend", requires-python>=3.12
├── requirements.txt              3733 B, uv-exported pinned transitive closure
├── uv.lock                       uv dependency lock (1468 lines)
├── .python-version               3.12
├── Dockerfile                    python:3.12-slim; collectstatic at build; migrate+gunicorn at start
├── docker-compose.yml            db (pg16) + redis7 + celery worker + celery-beat + web
├── .env / .env.example           runtime config (secrets — .env is gitignored)
├── .dockerignore / .gitignore
├── README.md                     ⚠ 0 BYTES
│
├── config/                       ← project config package
│   ├── settings.py         (320) Django settings: 10 apps, 9 middleware, CORS, JWT,
│   │                             Celery beat, domain tuning knobs (§8)
│   ├── urls.py             (50)  Root URL conf; /health, schema/docs, 10 app includes,
│   │                             immutable-cache media route
│   ├── celery.py           (11)  Celery("config"), namespace="CELERY", autodiscover
│   ├── __init__.py         (3)   Exports celery_app
│   ├── wsgi.py / asgi.py         Thin adapters
│
├── apps/                         ← all domain apps
│   ├── __init__.py
│   ├── accounts/                 Identity, login, password reset, PIN gate
│   │   ├── models.py       (51)  User(AbstractUser)+PasswordResetToken
│   │   ├── views.py       (212)  Login/Profile/Forgot/Reset/VerifyPin
│   │   ├── permissions.py  (53)  IsAgent, IsAdmin, IsSuperuser, IsAgentOrAdmin,
│   │   │                         IsAdminOrSelfAgent, check_admin_pin()
│   │   ├── serializers.py (≈80) Login/User/VerifyPin serializers
│   │   ├── admin.py, apps.py, tests.py (2117 B)
│   │   ├── urls.py         (17)  5 routes
│   │   └── management/commands/seed_test_data.py  (12452 B) realistic mill fixture
│   │
│   ├── agents/                   Sales agents + fabric assignment
│   │   ├── models.py       (52)  Agent, AgentItem (unique per agent+variant)
│   │   ├── views.py      (≈300) AgentViewSet, AgentDetail, AgentItemsView,
│   │   │                         AgentItemDetail/Transfer/CopyView
│   │   ├── serializers.py (6527 B) AgentSerializer, AgentFabricListSerializer
│   │   ├── urls.py, tests.py (8750 B)
│   │
│   ├── customers/                Buyers
│   │   ├── models.py       (38)  Customer (+priority_override, soft delete)
│   │   ├── views.py      (≈220) CustomerViewSet + bulk_import_customers (XLSX feed)
│   │   ├── serializers.py (≈60) CustomerSerializer + total_orders
│   │   ├── urls.py, tests.py (7214 B)
│   │
│   ├── items/                    ★ Fabric catalogue + stock
│   │   ├── models.py       (71)  Fabric, FabricVariant (qr_code UUID, stock_meters 14,3)
│   │   ├── services.py    (230) touch_catalog, sync_out_of_stock,
│   │   │                         delete_fabric_keep_history, purge_archived_fabrics,
│   │   │                         restock_variant, ArchivedFabricRecord, PurgeResult
│   │   ├── signals.py     (≈45) post_save/post_delete → sync out_of_stock, drop images
│   │   ├── tasks.py        (33)  2 Celery tasks (media cleanup, fabric purge)
│   │   ├── serializers.py (9210 B) Fabric/FabricVariant, Create+Update (multipart,
│   │   │                         Pillow re-encode to ≤1024px), CustomerRequirement
│   │   ├── views.py      (≈460) FabricViewSet (sync, by-qr, stock-list, archived,
│   │   │                         outstanding-demand, customer-requirements),
│   │   │                         FabricVariantViewSet
│   │   ├── admin.py, tests.py (22150 B — 10× bigger than the code it tests)
│   │   ├── urls.py                2 DefaultRouters (fabrics + variants)
│   │   ├── migrations/0001_initial.py, 0002_alter_fabricvariant_stock_meters.py
│   │   └── management/commands/
│   │       ├── cleanup_orphaned_media.py (4474 B) ⚠ BROKEN — see §11.1
│   │       └── purge_archived_fabrics.py  (3030 B)
│   │
│   ├── orders/                   ★★ Order + packing engine (the intellectual core)
│   │   ├── models.py      (295)  Order, OrderLog, OrderItem, PackingRound,
│   │   │                         Allocation, UserViewedOrder
│   │   ├── allocation.py  (460)  ★ the allocation engine (§4.3)
│   │   ├── stock.py       (217)  stock movement + backorder reporting (§4.4)
│   │   ├── pricing.py     (168)  Decimal money maths + override authority (§4.5)
│   │   ├── packing_views.py(479) packing round lifecycle endpoints
│   │   ├── views.py      (1232)  10 view classes + 8 module helpers
│   │   ├── serializers.py (≈380) Order/OrderItem/Invoice/AddItem/Merge/Allocation
│   │   ├── urls.py        (≈50)  6 packing paths (must precede router) + 2 routers
│   │   ├── tests.py     (55045 B — largest file in the repo)
│   │   └── test_allocation_scenario.py (295 lines) scenario harness
│   │
│   ├── dashboard/                Analytics (no models)
│   │   ├── views.py      (≈250) AdminDashboardView, AdminAnalyticsView
│   │   ├── urls.py, apps.py, migrations/(__init__.py only)
│   │
│   ├── admins/                   Thin CRUD over User(role=ADMIN)
│   │   ├── views.py       (≈20) AdminViewSet
│   │   ├── serializers.py (≈60) AdminSerializer
│   │   └── urls.py
│   │
│   ├── business/                 ★ Company profile (singleton) = invoicing identity
│   │   ├── models.py       (45)  Brand with singleton save(), refusing delete()
│   │   ├── views.py       (≈70)  BrandViewSet; list always returns exactly one
│   │   ├── serializers.py (≈50)
│   │   └── management/commands/seed_brands.py (1932 B) XL TOWER + BN CLOTHING
│   │
│   └── notification/             Push
│       ├── models.py       (44)  PushSubscription (web), DeviceToken (FCM)
│       ├── views.py        (87)  3 APIViews: save-subscription / register-token /
│       │                         unregister-token
│       ├── tasks.py       (131) send_push_to_user (pywebpush), send_fcm_to_user
│       ├── utils.py        (53) ★ notify_user_safely, queue_safely, admin_user_ids
│       └── tests.py      (7483 B)
│
├── transports/                   ⚠ NOT under apps/ — see §11.1
│   ├── models.py       (10)  Transport(name, is_active) — 3 fields
│   ├── views.py, serializers.py, admin.py, urls.py, tests.py, apps.py
│   └── migrations/0001_initial.py
│
├── media/                        ⚠ TRACKED IN GIT (49 files, ~7.7 MB of user JPEGs)
│   ├── brand/xl-tower.png
│   ├── fabrics/<fabric_id>/<uuid>.jpg     (41 files — current upload path)
│   └── items/<id>/<uuid>.jpg               (7 files — orphaned legacy path)
│
├── seed_data/                    Test fixtures (logos + 3 shirt photos)
└── venv/                         ⚠ Present on disk, gitignored (0 tracked files)
```

### 2.3 Frontend Tree

```
frontend/
├── package.json (71)  scripts, deps, packageManager=pnpm@11.9.0, engines node>=24<25
├── pnpm-lock.yaml    (326 KB)  tracked
├── package-lock.json (465 KB)  ⚠ UNTRACKED stray npm artifact
├── next.config.ts (552 B)  allowedDevOrigins + conditional images.remotePatterns
├── next-env.d.ts, tsconfig.json (700 B), tailwind.config.ts, postcss.config.mjs
├── eslint.config.mjs (483 B)  next core-web-vitals + typescript
├── vitest.config.ts (438 B)  jsdom, globals, tests/setup.ts, @ alias
├── components.json (469 B)   shadcn: new-york, rsc, neutral, lucide
├── AGENTS.md (1752 B)        ★ best doc in the repo — conventions & version pins
├── README.md (955 B)         ⚠ verbatim create-next-app boilerplate
├── .env.local                 ⚠ 1 var (VERCEL_OIDC_TOKEN) — gitignored
├── .gitignore (535 B)
├── proxy.ts (1663 B)         ★ Next 16 middleware (renamed from middleware.ts)
│
├── app/                          ★ 60 route/layout files
│   ├── layout.tsx (68)          ROOT server layout: AuthProvider + SW register + Toaster
│   ├── globals.css (213)        ★ Tailwind v4 CSS-first theme (§2.4)
│   ├── manifest.ts (42)         PWA: "XL Apparals", web+stockflow protocol handler
│   ├── not-found.tsx (23), favicon.ico, apple-icon.png
│   │
│   ├── (auth)/                   Login / password recovery — no navbar
│   │   ├── layout.tsx (7), page.tsx (198) = "/"
│   │   ├── forgot-password/page.tsx (141), reset-password/page.tsx (192)
│   │
│   ├── (admin)/admin/            Warehouse admin — navbar except on fullscreen routes
│   │   ├── layout.tsx (37)       client; AdminNavBar + fullscreen path detection
│   │   ├── page.tsx (334)        /admin — order list, filters, unread badges
│   │   ├── analytics/page.tsx (79)          /admin/analytics — charts + KPIs
│   │   ├── items/
│   │   │   ├── page.tsx (17)                 /admin/items (server, ?tab=)
│   │   │   ├── new/page.tsx (154)           /admin/items/new — 2-step wizard
│   │   │   │   + addColor/colorCard/colorList/commonDetails(+Badge)/cropModal
│   │   │   ├── edit/[id]/page.tsx (433)     /admin/items/edit/:id
│   │   │   │   + editVariantRow.tsx
│   │   │   └── ordered/[id]/page.tsx (207)  /admin/items/ordered/:id — demand by customer
│   │   ├── packing/
│   │   │   ├── page.tsx (157)               /admin/packing — variant picker
│   │   │   └── [variant]/page.tsx (16)      /admin/packing/:variant — ★ PackingBoard
│   │   ├── order/
│   │   │   ├── layout.tsx (7), new/layout.tsx (9)   OrderFlowProvider mode="admin"
│   │   │   ├── new/page.tsx (13)            /admin/order/new
│   │   │   ├── new/[id]/page.tsx (3)        thin re-export of (agent-order) page
│   │   │   ├── new/[id]/[qr]/page.tsx (3)   thin re-export
│   │   │   ├── new/[id]/scanner/page.tsx (3) thin re-export
│   │   │   ├── status/[id]/page.tsx (319)  /admin/order/status/:id — dispatch, logs, delete
│   │   │   └── status/[id]/edit/page.tsx (56)
│   │   ├── users/
│   │   │   ├── page.tsx (63)                /admin/users — Customers|Agents|Admins tabs
│   │   │   ├── admins/new/page.tsx (381)  + admins/[id]/page.tsx (645)  ← largest page
│   │   │   ├── agents/new/page.tsx (213)  + agents/[id]/page.tsx (574)
│   │   │   └── customers/new/page.tsx (289) + customers/[id]/page.tsx (507)
│   │   ├── settings/
│   │   │   ├── page.tsx (74)                superuser-gated tabs
│   │   │   ├── brands/new/page.tsx (323)  + brands/[id]/page.tsx (439)
│   │   │   └── transports/new/page.tsx (119) + transports/[id]/edit/page.tsx (150)
│   │   └── profile/page.tsx (6)             → ProfilePage
│   │
│   ├── (admin-no-layout)/admin/  Fullscreen tools — navbar stripped
│   │   ├── layout.tsx (3)
│   │   ├── bulk-import/page.tsx (855)  ★ XLSX parse → edit → validate → POST
│   │   ├── summary/page.tsx (315)       inventory valuation & stock filters
│   │   └── items/qr/[id]/page.tsx (127)  single QR label + auto-print
│   │       items/qr-print/page.tsx (11)  QRPageContent (server)
│   │
│   ├── (agent)/agent/              Sales agent — bottom NavBar + push init
│   │   ├── layout.tsx (18)
│   │   ├── page.tsx (51)                 /agent
│   │   ├── history/page.tsx (21), profile/page.tsx (17)
│   │   ├── items/page.tsx (84)           /agent/items
│   │   ├── items/scanner/page.tsx (377)  ★ QR scan → add to draft order
│   │   ├── customers/page.tsx (181)  + new/page.tsx (245)  + [id]/page.tsx (487)
│   │   └── order/status/[id]/page.tsx (247)
│   │
│   └── (agent-order)/agent/order/   Shared order wizard (agent + admin modes)
│       ├── layout.tsx (13)              OrderFlowProvider mode="agent"
│       ├── new/page.tsx (47)            customer select
│       ├── new/[id]/page.tsx (810)      ★ order entry — 2nd largest page
│       ├── new/[id]/[qr]/page.tsx (296) + components/
│       │       MetresSelector/ProductHeader/ProductImage/ProductInfo/
│       │       SubmitButton/VariantSelector
│       ├── new/[id]/scanner/page.tsx (59)
│       ├── edit/[id]/page.tsx (440)  + edit/[id]/[qr]/page.tsx (191)
│       │   + edit/[id]/scanner/page.tsx (56)
│       └── orderform/page.tsx (397)     printable order form / invoice PDF
│
├── components/
│   ├── ServiceWorkerRegister.tsx (258 B)
│   ├── items/         ItemCard, ItemList (16.5 KB), OrderedItemList, QRScanModal,
│   │                  StockBadge, StockMetresRow, VariantCard, VariantRow, index.ts
│   ├── order/         OrderCard, OrderItemRow (9.3 KB), OrderTotals,
│   │                  ★ PriceOverrideDialog, index.ts
│   ├── pages/
│   │   ├── InvoicePdf.tsx (19661 B)         @react-pdf invoice
│   │   ├── ImagePreview.tsx, ScannerPage.tsx (5457 B), ListCustomer.tsx
│   │   ├── admin/
│   │   │   ├── packing/PackingBoard.tsx (27722 B)  ★ the roll-splitting board
│   │   │   ├── analytics/  10 chart components (KpiTiles, 3 bar charts, donut,
│   │   │   │                sparkline, leaderboard, range presets, time metrics, value cards)
│   │   │   ├── users/      AdminsList, AgentsList, CustomersList, AdminCustomerSelect
│   │   │   ├── settings/   BrandsList, TransportsList
│   │   │   ├── items/      ListItems
│   │   │   ├── order_components/ OrderList, types.ts
│   │   │   └── order-item/ OrderDetailHeader, OrderItem, orderItemEdit
│   │   ├── agent/         ItemAssignment (16524 B), AssignedItemsPDF (8289 B),
│   │   │                  order/{OrderCard,OrderDetailHeader,OrderDetailItems,OrderListHeader}
│   │   ├── agent/orderList/ OrderList
│   │   ├── auth/          AuthAlert, AuthBackLink, AuthBranding, AuthCard,
│   │   │                  AuthSubmitButton, PasswordInput
│   │   ├── items/qr/      QRPageContent (11338 B), QRLabelPdf
│   │   ├── order/         OrderFooter, OrderItemsSection, OrderLogs, OrderSummary
│   │   ├── order-form/    OrderFormView (12748 B)
│   │   └── profile/       ProfilePage (12252 B)
│   └── ui/
│       ├── [14 shadcn primitives]  accordion alert avatar button calendar card
│       │                             dialog field input label popover select
│       │                             separator spinner textarea   ← untouched upstream
│       ├── AdminNavBar.tsx (4552 B), NavBar.tsx (4701 B)
│       ├── [14 custom components]   AdminNavBar-adjacent app-level UI:
│       │   EmptyState, FailBox, SuccessAlert, FilterBar, FilterToggle, Loading,
│       │   Pagination, SearchBar, date-picker, deleteWithTransferDialog (18 KB),
│       │   transferItemsDialog, pinDeleteDialog, DialogNoCloseButton
│       └── custom/                   12 hand-rolled, none from shadcn:
│           AdminNavBar-adjacent: adminInputBar, adminProfileButton, agentProfileButton,
│           DeleteConfirmButton, EditModeBanner, FormField, Modals, ShareImageButton,
│           StatusBadge, stockflowAvatar, stockFlowButton, stockFlowSelect
│
├── context/
│   ├── AuthContext.tsx (5363 B)     ★ user, accessToken, refreshToken, role, business,
│   │                                  isSuperuser, isAuthenticated, login, logout
│   └── OrderFlowContext.tsx (1007 B) mode: "agent"|"agent"→"admin", basePath, agentId
│
├── lib/
│   ├── api/            axios.ts, index.ts, auth.ts, admin.ts, agents.ts, brand.ts,
│   │                   customer.ts, dashboard.ts, item.ts, order.ts (11199 B), transport.ts
│   ├── api/order.ts    ★ 28 orderApi methods + 6 packingApi methods
│   ├── api/axios.ts    ★ baseURL, FormData Content-Type strip, Bearer injection
│   ├── orderFlow.ts      routing + payload policy (agent vs admin order creation)
│   ├── draftOrder.ts     localStorage draft-order identity (race fix)
│   ├── priceOverride.ts  ★ price validation mirrored from server
│   ├── form-utils.ts     ★ multipart FormData encoding (protocol-critical)
│   ├── image-utils.ts    HEIC detection/normalisation, shrink, crop
│   ├── image-resize.ts   computeShrinkSize (1600 px, q0.85)
│   ├── crop-utils.ts     canvas crop/fit, PNG-vs-JPEG alpha heuristic
│   ├── submitItem.ts     fabric create payload + stock validation + ApiError
│   ├── updateItem.ts     ★ fabric update payload (2 load-bearing rules, §11.3)
│   ├── push.ts / pushInit.tsx   VAPID subscribe + SW registration
│   ├── toast.ts          ★ error-message extraction from axios/DRF/proxy failures
│   ├── sortVariants.ts, colorLabel.ts, viewedOrders.ts, useEditGuard.ts, utils.ts
│   └── utils/            deriveUsername, inventorySummary, orderItemSort, packingSplit
│
├── util/               archiveLabel, getColorFromId, groupOrders, stockValidators,
│                       useBackButton          ← NOTE: singular "util", separate from "utils"
├── types/              11 files — auth, admin, agent, brand, customer, dashboard,
│                       global, item, order, transport
├── hooks/useSessionStorage.ts
├── constants/sizes.ts  KIDS_SIZES, GENTS_SIZES  (⚠ vestigial — no garment sizing left)
└── tests/              14 test files + tests/setup.ts + tests/fixtures/dart-qr-{L,M}.png
    ├── setup.ts (124 B)
    ├── items/fabricUpdatePayload.test.ts
    └── lib/  apiMultipart, archiveLabel, colorLabel, fabricUpdateUpload, form-utils,
              image-resize, inventorySummary, orderFlow, orderItemSort, packingSplit,
              priceOverride, qr-label-parity, sortVariants, utils
```

### 2.4 `app/globals.css` — Tailwind v4 CSS-First Theme

Tailwind v4 has no JS config for theme values; they live in CSS.

- **Brand tokens** (`:6-13`): `--color-primary: #ff6200` (orange), `--color-pending: #ff0000`, `--color-packed: #ff6200`, `--color-dispatched: #096700`, `--color-border: #d9d9d9`, `--color-heading: #000`, `--color-text: #919191`, `--radius: 0.625rem`.
- **shadcn semantic tokens** (`:14-45`): standard oklch `background/foreground/card/popover/secondary/muted/accent/destructive/border/input/ring/chart-1..5/sidear-*`.
- **`@theme inline`** (`:103-142`): maps the semantic vars onto Tailwind's `--color-*` namespace + radius scale.
- **Dark mode** (`:147-179`): a `.dark` block exists but is **never toggled** — no theme switcher in the app.
- **Custom typography** (`:51-98`): `h1` 32px/600, `h2` 24px/700, `h3` 16px/400, `h6` 10px, and `p { @apply text-[8px] }` — an 8px body text size, plus a `font-size: 16px !important` override on all form controls to defeat iOS zoom.
- **Custom utility** (`:190-212`): `.animate-shake` keyframe — used for validation-error feedback.
- `tailwind.config.ts` carries only the `tailwindcss-animate` plugin and a `poppins` font alias pointing at `var(--font-poppins)`, **which the root layout never defines** (it defines `--font-jakartha` via `Plus_Jakarta_Sans`).

---

## 3. Entry Points

### 3.1 Backend

| File | Role |
|---|---|
| `backend/manage.py:7-18` | Sets `DJANGO_SETTINGS_MODULE=config.settings`, calls `execute_from_command_line` |
| `backend/config/wsgi.py` | `application = get_wsgi_application()` — the Gunicorn target |
| `backend/config/asgi.py` | ASGI adapter (present but not used in compose) |
| `backend/config/__init__.py:1-2` | Imports `celery_app` so `shared_task` binds on Django startup |
| `backend/config/urls.py:13-38` | Root URL conf |
| `backend/Dockerfile:29` | `CMD`: `migrate --noinput && gunicorn --bind=0.0.0.0:8000 --workers=2 --timeout=120 config.wsgi:application` |
| `backend/apps/accounts/migrations/0001_initial.py` … | Schema entry |

**Boot sequence (Docker):** gunicorn → `config.wsgi` → Django `setup()` → `config/__init__.py` → Celery app init → `apps.ready()` → `settings.INSTALLED_APPS` → middleware chain (`SecurityMiddleware` → `CorsMiddleware` → `WhiteNoiseMiddleware` → …) → `config.urls`.

**Middleware order matters** (`settings.py:65-75`): CORS runs *before* WhiteNoise, so API responses get CORS headers even when WhiteNoise short-circuits static files.

### 3.2 Frontend

| File | Role |
|---|---|
| `frontend/app/layout.tsx` (68) | **Root server layout.** `Plus_Jakarta_Sans` → `--font-jakartha`; wraps `<AuthProvider>` around everything; renders `<ServiceWorkerRegister />`, `{children}`, and a Sonner `<Toaster position="top-right" duration=3000 />` **outside** the provider |
| `frontend/app/manifest.ts` (42) | PWA manifest — "XL Apparals", `display: standalone`, `protocol_handlers: web+stockflow` |
| `frontend/components/ServiceWorkerRegister.tsx` (258 B) | `useEffect` → `navigator.serviceWorker.register("/sw.js")` |
| `frontend/public/sw.js` (22 lines) | `install`→skipWaiting, `activate`→claim, `push`→`showNotification({title, body, icon})`, `notificationclick`→`openWindow("/")`. **No `fetch` handler — no offline caching.** |
| `frontend/proxy.ts` (1663 B) | **Next 16 middleware** (renamed from `middleware.ts`) |

**`proxy.ts` boot logic:**
1. `isTokenExpired(token)` — base64url-decodes the JWT payload client-side; expired if `exp*1000 <= now + 5000`; **unparseable ⇒ treated as expired**.
2. If `token` present and expired → redirect `/`, delete cookies `token`, `role`, `auth_user`, `auth_refresh` (⚠ **not** `business` / `is_superuser`).
3. If path starts `/admin` and `role !== "ADMIN"` → redirect `/agent`.
4. Otherwise `NextResponse.next()`.
5. `config.matcher` (`:47-55`) excludes `api`, `_next/static`, `_next/image`, `favicon.ico`, `sw.js`, `manifest.webmanifest`, `forgot-password`, `reset-password`, `robots.txt`, `sitemap.xml`, and image extensions.

**No `page.tsx` at `/admin` is server-guarded** — protection is entirely cookie-based client state, so an attacker can freely edit cookies. See §11.4.

---

## 4. Key Modules / Components

### 4.1 Backend Domain Services (the important ones)

#### `apps/orders/allocation.py` (460 lines) ★ the core

Two-pass worst-fit metre allocator, pure (no writes, no locks) in `build_plan`.

```
Spec (module docstring, :1-26):
  2400 m on hand, round_size 1000 m
  A wants 1400 m, B wants 1400 m
  Pass 1 equal fill  → A 1000, B 1000, 400 m left
  Pass 2 priority top-up → 400 m to the higher-priority customer
  Result: A 1400, B 1000
```

| Function | Lines | Input → Output |
|---|---|---|
| `customer_priority(customer_ids)` | 53-110 | ids → `{cid: {rank, metres_sold, source, override}}` |
| `outstanding_lines(variant, order_ids=None)` | 118-132 | variant → `OrderItem` QuerySet, FIFO by `order__created_at` |
| `build_plan(variant, round_size, order_ids=None, available_meters=None)` | 135-261 | → plan dict. **Pure.** |
| `_adjust_stock(variant, delta)` | 269-281 | `F()`-expression update + `refresh_from_db` + `sync_out_of_stock` |
| `_lock_round(packing_round)` | 284-291 | `select_for_update().get()` |
| `confirm_round(round, user, note)` | 294-368 | re-plans vs live stock, writes `Allocation`s, debits stock |
| `cancel_round(round, user)` | 371-416 | returns metres, `demote=True` if now short again |
| `sync_order_after_allocation(...)` | 419-460 | PENDING↔PACKED state machine + `OrderLog` entry |

**The priority ranking** (`sort_key`, `:93-98`) — a 5-tuple, stable total order:
```python
pinned   → (0, override,          0,          epoch,     cid)   # any pin outranks all
unpinned → (1, 0,               -sold[cid],  first_order, cid)  # biggest buyer first
```
`metres_sold` sums `allocated_quantity` on **DISPATCHED** lines only — deliberately *not* `ordered_quantity`, which "would over-count partial dispatches and hand priority to a customer who was shipped short" (`:62-65`).

**Equal-fill cap** (`:175`): `equal_cap = min(round_size, stock / participant_count)` — the division is what stops "first line eats the roll".

**Two subtleties worth knowing:**
- `_adjust_stock` (`:269-281`) uses `QuerySet.update`, which **skips `post_save`**, so `items/signals.py` never fires for packing. `sync_out_of_stock` is therefore called manually or the fabric would sit at zero with a stale `out_of_stock_since` and never archive.
- `confirm_round` **auto-cancels** an empty plan (`:316-322`): a DRAFT round with nothing left to give is closed, not confirmed.
- `_apply_plan` (in `packing_views.py:360-428`) applies a hand-edited plan but writes `sequence` from `enumerate` and **always `is_priority_award=False`** — so a manually adjusted round loses the engine's provenance.

#### `apps/orders/stock.py` (217 lines)

| Function | Lines | Purpose |
|---|---|---|
| `consume_for_allocation` / `return_to_stock` | 41-52 | Directional wrappers; **caller must already hold the row lock** |
| `_apply_stock_delta` | 55-82 | One `F()` update per variant + `sync_out_of_stock` per parent fabric |
| `allocated_totals_by_variant` | 85-99 | ⚠ **no callers** |
| `stock_movement_for_lines` | 102-121 | `consume`/`return` for a set of lines; `ValueError` on unknown direction |
| `outstanding_demand` | 129-140 | ⚠ **no callers** |
| `backorder_report(order)` | 143-201 | ★ The oversubscription warning |
| `shortfall_for_line` | 204-210 | ⚠ **no callers** |
| `order_is_fully_allocated` | 213-217 | ⚠ **no callers** |

`backorder_report` compares **per-variant totals across all open orders**, not per-line. Docstring `:148-154`: a per-line check would never fire — 2400 m of stock vs. two separate 1400 m orders means neither line exceeds stock, yet the roll is oversubscribed by 400 m.

#### `apps/orders/pricing.py` (168 lines)

`METRE = Decimal("0.001")` (`:22`) — anything summed for storage must land on the 3-dp grid or the serializer rejects it.

| Function | Lines | Purpose |
|---|---|---|
| `line_value` | 25-26 | `ordered × rate` |
| `order_computed_total` | 29-41 | **Loops in Python, not SQL** — `rate_per_meter` is snapshotted per line and rates differ within one order (`:32-33`) |
| `recompute_order_total` | 44-68 | ★ **Self-healing**: if `final_total == new computed_total`, clears the override + reason + actor + timestamp (`:52-56`) so a no-op change doesn't leave the order falsely flagged "adjusted" |
| `set_final_total` | 71-142 | Optional reason (≤200 chars); logs `PRICE_OVERRIDE` **or** `PRICE_OVERRIDE_CLEARED` |
| `order_totals` | 145-168 | Canonical totals dict for every endpoint |

#### `apps/orders/views.py` (1232 lines)

| View | Lines | Methods | Permission | Purpose |
|---|---|---|---|---|
| `PlaceOrderView` | 175-267 | POST | IsAgentOrAdmin | DRAFT→PENDING, recompute total, backorder report, notify admins |
| `StartEditView` | 270-313 | POST | **IsAgent only** | Snapshot lines → EDITING; **admins excluded** |
| `SaveEditView` | 316-380 | POST | IsAgent | EDITING→PENDING, **no stock movement** |
| `SetOrderPriceView` | 383-463 | POST | IsAgentOrAdmin | DRAFT-only reprice; **agent capped at line arithmetic, admin unrestricted** |
| `OrderViewSet` | 466-792 | CRUD + 5 `@action` | IsAuthenticated | See below |
| `AddOrderItemView` | 795-863 | POST | IsAgentOrAdmin | QR → line; **agent must be assigned the fabric** |
| `DeleteOrderItemView` | 1072-1082 | DELETE | IsAuthenticated | → `_remove_order_line` |
| `InvoiceView` | 1085-1103 | GET | IsAuthenticated | Invoice payload (carries GSTIN ⇒ owner-only) |
| `OrderLogsView` | 1106-1130 | GET | IsAuthenticated | Audit trail |
| `OrderItemViewSet` | 1133-1232 | CRUD | IsAuthenticated | `create()` **always 405** |
| `MergeOrderItemsView` | 951-1069 | POST | IsAgentOrAdmin | Transactional collapse of duplicate lines |

`OrderViewSet` actions: `dispatch_order` (618-715), `cancel_edit` (717-736), `my_viewed_ids` (738-744), `mark_viewed` (746-754), `order_ids` (756-767), `get_archived` (769-792).

**Module helpers:**
| Helper | Lines | Purpose |
|---|---|---|
| `OrderPagination` | 51-54 | page_size 50, max 200 |
| `_build_snapshot` | 57-72 | Deep copy of every line for edit-undo |
| `_has_allocations` | 75-82 | **The freeze gate** — once packing touched a line, no add/remove/merge/recolour |
| `_restore_snapshot` | 85-108 | Atomic rollback → PENDING |
| `_is_creator` | 111-120 | Has a **legacy fallback**: `created_by` NULL → `order.agent.user_id` |
| `_may_touch` | 123-127 | ADMIN → all; else own agent |
| `_reap_stale_drafts` | 130-149 | Admin: 24 h; **agent: 15 minutes** |
| `_notify_admins` | 152-172 | `transaction.on_commit(..., robust=True)` fan-out |
| `_remove_order_line` | 866-929 | Single guarded removal path |

**`get_queryset()` has write side effects on GET** (`:474-481`): listing orders reaps stale drafts *and* rolls back abandoned `EDITING` orders older than 15 min.

**Admin visibility rule** (`:515-528`): an admin sees `Q(status="DRAFT", created_by=user) | ~Q(status="DRAFT")` — their own drafts plus all non-drafts.

#### `apps/items/services.py` (230 lines)

| Function | Lines | Purpose |
|---|---|---|
| `touch_catalog(fabric)` | 27-36 | Bump `catalog_updated_at`. **Only for catalog changes, never stock** |
| `total_stock` / `sync_out_of_stock` | 39-62 | Flip-flop on `out_of_stock_since`; saves **only on an actual flip** |
| `delete_fabric_keep_history` | 65-80 | Soft delete + delete only images no `OrderItem` references |
| `purge_threshold` | 83-93 | `now - (ARCHIVE_AFTER_DAYS + retention)` |
| `_purge_eligibility` | 117-139 | Reasons: `already_deleted`, `restocked`, `open_order` |
| `purge_archived_fabrics` | 141-215 | Order-independent & idempotent; re-checks under `select_for_update` |
| `restock_variant` | 218-230 | Add metres + keep flag in step |

`OPEN_ORDER_STATUSES` here is `("DRAFT","PENDING","EDITED","PACKED")` — deliberately **wider** than the packing constant, because these orders still hold cloth references, so the fabric must never be purged (`:21-23`).

#### `apps/notification/utils.py` (53 lines)

`notify_user_safely()` (`:27-41`) queues web push + FCM with `retry=False` so an unreachable broker fails fast instead of holding the request open. `admin_user_ids()` (`:44-53`) returns active `role="ADMIN"` ∪ superusers.

### 4.2 Backend Permission Model

`apps/accounts/permissions.py`:

| Class | Rule |
|---|---|
| `IsAgent` | `role == "AGENT"` |
| `IsAdmin` | `role == "ADMIN"` |
| `IsSuperuser` | `is_superuser` |
| `IsAgentOrAdmin` | either |
| `IsAdminOrSelfAgent` | object-level: ADMIN → all, else `obj.user == request.user` |
| `check_admin_pin(request)` | Anti-mistake gate. Superusers **and agents exempt**. Admin must supply a 6-digit PIN matching `User.check_pin` |

Notably `transports/views.py:11-13` defines a **separate, local** `IsAdminUser` that checks `is_staff` — inconsistent with the rest of the codebase's `role`-based check. See §11.2.

### 4.3 Frontend Core Modules

| Module | Size | Responsibility |
|---|---|---|
| `lib/api/axios.ts` | 1517 B | Base URL, FormData header strip, Bearer injection |
| `context/AuthContext.tsx` | 5363 B | All auth state + route guard + 401 interceptor |
| `context/OrderFlowContext.tsx` | 1007 B | agent-vs-admin order wizard mode |
| `lib/api/order.ts` | 11199 B | 28 `orderApi` + 6 `packingApi` methods |
| `lib/orderFlow.ts` | 2059 B | `getOrderBasePath`, `buildOrderCreatePayload`, `extractErrorMessage` |
| `lib/priceOverride.ts` | 3161 B | Mirrors the server's repricing rules client-side |
| `lib/utils/packingSplit.ts` | 3830 B | Client mirror of the allocation engine's equal-fill + top-up |
| `lib/utils/inventorySummary.ts` | 3198 B | Stock valuation + `low`/`out` filters |
| `lib/form-utils.ts` | 3502 B | ★ Multipart encoding protocol |
| `lib/updateItem.ts` | 2461 B | ★ Fabric update payload rules |
| `lib/toast.ts` | 3759 B | ★ Error extraction across axios/DRF/proxy/HTML |
| `components/pages/admin/packing/PackingBoard.tsx` | 27722 B | ★ The three-step roll-splitting UI |

**`PackingBoard.tsx` flow** (rewritten in `efa6644`): `"select"` → `"review"` → commit. Holds `selected` (ticked order-item ids) and `metres` (typed per line) state; prefill via `splitEqually()`; validation via `splitProblems()`; a *"read the split back"* confirmation gate before any cloth moves; the backend re-checks stock and demand regardless.

**`lib/updateItem.ts` two load-bearing rules:**
1. **Every colour is always sent** — an absent colour is treated as deleted by the API.
2. **`stock_meters` is only sent for new variants.** Sending the loaded warehouse count back would overwrite live stock changed by concurrent packing.

---

## 5. Data Layer

### 5.1 Database

**PostgreSQL 16**, accessed via Django ORM (`psycopg2-binary`). No raw SQL, no secondary DB, no cache table. 13 tables across 9 apps.

### 5.2 Models

#### `apps.accounts`

**`User(AbstractUser)`** — `AUTH_USER_MODEL = "accounts.User"` (`settings.py:204`)

| Field | Type | Notes |
|---|---|---|
| `email` | EmailField | **unique** |
| `role` | CharField(10) | `ADMIN` \| `AGENT`, blank |
| `display_name` | CharField(255) | blank |
| `pin` | CharField(128) | hashed via `set_pin`/`check_pin` |
| — | `AbstractUser` | username, password, is_staff, is_superuser, is_active… |

`save()` (`:27-30`) forces `role="ADMIN"` when `is_superuser`.

**`PasswordResetToken`**

| Field | Type |
|---|---|
| `user` | FK → User, CASCADE, `related_name="custom_password_reset_tokens"` |
| `token` | CharField(64), **unique**, `uuid4().hex` |
| `created_at` | auto_now_add |
| `expires_at` | DateTimeField (30 min) |
| `used` | Boolean |

#### `apps.items` — the catalogue

**`Fabric`** — `ordering: ["-id"]`

| Field | Type | Notes |
|---|---|---|
| `name` | CharField(100) | |
| `description` | TextField | blank |
| `price_per_meter` | Decimal(10,2) | |
| `is_deleted` | Boolean | soft delete |
| `out_of_stock_since` | DateTime | null; drives archiving |
| `catalog_updated_at` | DateTime | `default=now`, **`db_index=True`** — mobile delta-sync cursor |

**`FabricVariant`** — `ordering: ["-id"]`, image path `fabrics/<fabric_id>/<filename>`

| Field | Type | Notes |
|---|---|---|
| `fabric` | FK → Fabric, CASCADE, `related_name="variants"` | |
| `display_order` | CharField(100) | null/blank — the colour label |
| `qr_code` | **UUIDField, unique, `editable=False`, `default=uuid4`** | The QR agents scan |
| `image` | ImageField | null/blank |
| `stock_meters` | **Decimal(14,3)**, default 0, `MinValueValidator(0)` | Fractional metres |
| `stock_updated_at` | DateTime | `db_index=True` — stock delta-sync cursor |

#### `apps.orders` — 6 models

**`Order`** — `ordering: ["-created_at"]`. Status: `DRAFT → PENDING → EDITING → PENDING → PACKED → DISPATCHED`

| Field | Type | Notes |
|---|---|---|
| `customer` | FK, **PROTECT** | |
| `agent` | FK, PROTECT, null | |
| `created_by` | FK → User, SET_NULL, null | |
| `status` | CharField(20) | default `DRAFT` |
| `computed_total` | Decimal(14,2) | **derived, never hand-edited** |
| `final_total` | Decimal(14,2) | nullable — what is actually billed |
| `price_override_reason` | CharField(200) | |
| `price_overridden_by` / `_at` | FK / DateTime | audit |
| `expected_delivery_date` | DateField | null |
| `preferred_transport` / `transport_company` | FK → Transport | two distinct relations |
| `lr_number` | CharField(50) | lorry receipt |
| `shortfall_reason` | CharField(200) | set when shipping short |
| `edit_snapshot` | **JSONField(default=list)** | ★ line-by-line copy for edit rollback |
| `editing_started_at` | DateTime | null |
| `notes` | CharField(200) | null |
| `created_at` / `dispatched_at` | DateTime | |

Properties: `is_price_overridden` (`:95-100`), `effective_total` (`:102-107`).

**`OrderLog`** — the audit trail. `order` is **nullable with `SET_NULL`** (`:137-139`) and `order_ref` (`PositiveIntegerField`, `db_index=True`) keeps the original id — *"which matters most for a deletion, since that is exactly the entry you need afterwards"* (`:114-120`).

Actions: `ITEM_DELETED, ORDER_DELETED, ORDER_EDITED, DISPATCHED, EDIT_STARTED, EDIT_SAVED, EDIT_CANCELLED, PRICE_OVERRIDE, PRICE_OVERRIDE_CLEARED, ALLOCATION_MADE, ALLOCATION_REVERSED, ROUND_CANCELLED`.
Classmethod `record(order, action, details, performed_by)` (`:153-165`) fills `order_ref` so no call site can forget.
Index: `(order_ref, -created_at)`.

**`OrderItem`** — one fabric line

| Field | Type | Notes |
|---|---|---|
| `order` | FK, CASCADE, `related_name="items"` | |
| `fabric` / `variant` | FK, **SET_NULL**, null | |
| `fabric_name` | CharField(100) | ★ snapshot |
| `rate_per_meter` | Decimal(10,2) | ★ snapshot |
| `variant_image` | URLField | ★ snapshot (absolute URL) |
| `variant_display_order` | CharField(100) | ★ snapshot |
| `ordered_quantity` | Decimal(14,3) | demand |
| `allocated_quantity` | Decimal(14,3) | cloth actually moved |

Property `outstanding_quantity` (`:202-204`).

**`PackingRound`** — `DRAFT | CONFIRMED | CANCELLED`

| Field | Type | Notes |
|---|---|---|
| `variant` | FK, **PROTECT** | one colour per round |
| `round_size` | Decimal(14,3) | per-line grant |
| `status` | CharField(12) | default `DRAFT` |
| `note` | CharField(200) | |
| `plan_override` | **JSONField(default=list)** | `[{"order_item": pk, "metres": "<decimal>"}]`; empty ⇒ re-plan from live stock |
| `created_by` / `created_at` / `confirmed_at` | | |

**`Allocation`**

| Field | Type | Notes |
|---|---|---|
| `round` | FK, **SET_NULL**, null | cancelling never erases the record |
| `order_item` | FK, CASCADE, `related_name="allocations"` | |
| `metres` | Decimal(14,3) | |
| `sequence` | PositiveSmallInteger | `1` = equal fill, `2` = priority top-up |
| `is_priority_award` | Boolean | |

**`UserViewedOrder`** — `unique_together ("user","order")`; unread-badge tracking.

#### `apps.agents`, `apps.customers`, `apps.business`, `apps.notification`, `transports`

| Model | Key fields |
|---|---|
| `Agent` | `user` OneToOne, `contact`, `is_active`, `deactivated_at`; `soft_delete()` / `hard_delete()` |
| `AgentItem` | `agent` + `variant` FKs, **`unique_together`** |
| `Customer` | `name` **unique**, `address`, `contact`, `gst`, `agent` (PROTECT), `preferred_transport`, **`priority_override` Integer null** ("lower wins; blank = rank by sales"), `is_active`, `deactivated_at` |
| `Brand` | `name, phone, email, address_line1/2, logo, gst`; `save()` enforces singleton; **`delete()` raises `ValueError`** |
| `PushSubscription` | `user` FK, `endpoint` **unique**, `p256dh`, `auth`, `user_agent` |
| `DeviceToken` | `user` FK, `token` CharField(**4096**) unique, `platform` android\|ios |
| `Transport` | `name`, `is_active`, `created_at` |

### 5.3 Migration State

All apps squashed to a single `0001_initial.py` in commit `1b270f8` (50 migrations deleted). Only one second migration exists: `items/0002_alter_fabricvariant_stock_meters.py`.

`apps/dashboard/migrations/` and `apps/transports/migrations/` contain **only `__init__.py`** — the dashboard has no models, and the `transports` migration lives at `backend/transports/migrations/` (not `apps/transports/`), which is *not* in `INSTALLED_APPS` as written — it resolves via the `transports` top-level package.

### 5.4 Precision Convention (important)

- **Metres: `Decimal(14, 3)`.** Money: `Decimal(10,2)`/`(14,2)`. `METRE = Decimal("0.001")`; `CENT = Decimal("0.01")`.
- **The frontend mirrors this exactly**: every `Decimal` field is typed `string` in `types/` and converted via `toMeters()` / `Number()`; `roundMetres(v)` = `Math.round((v + EPSILON) * 1000) / 1000` — the `EPSILON` exists specifically to kill `0.1+0.2 = 0.30000000000000004` false positives.
- `MIN_ORDER_METERS = Decimal("0.001")` — "one gram, i.e. 0.001 m at 3 decimal places. Anything below this is a rounding artefact" (`orders/serializers.py:16-18`).

---

## 6. APIs & Routes

### 6.1 Root

| Method | Path | Purpose |
|---|---|---|
| GET | `/health/` | `{"status":"ok"}` (inline lambda, `config/urls.py:14`) |
| GET | `/api/schema/` | OpenAPI 3 schema (drf-spectacular) |
| GET | `/api/docs/` | Swagger UI |
| GET | `/api/redoc/` | ReDoc |
| — | `/api/password/**` | django-rest-passwordreset |
| — | `/admin/**` | Django admin site |
| GET | `/media/<path>` | Immutable cache: `max_age=31536000, immutable=True` — safe because filenames are UUIDs (`config/urls.py:41-49`) |

### 6.2 Auth — `/api/auth/`

| Method | Path | Req → Res |
|---|---|---|
| POST | `login/` | `{username\|email, password}` → `{access, refresh, role, user_id, username, email, is_superuser}`. Errors are flat `{"error": "..."}` for frontend convenience (`views.py:39-47`) |
| GET | `profile/` | → `UserSerializer` |
| POST | `forgot-password/` | `{email}` → 200 `{message}` / 404 / 400. Invalidates prior unused tokens, creates a 30-min `uuid4().hex`, emails a link to `https://xlapparals.in/reset-password?token=…` |
| POST | `reset-password/` | `{token, password}` (≥8 chars) → 200. 400 on invalid/expired |
| POST | `verify-pin/` | `{pin}` → 200 `{ok:true}` / 403 |

⚠ `ForgotPasswordView` **enumerates accounts** (404 "No account found with that email address" vs. a success message) — a user-enumeration vector. See §11.5.

### 6.3 Agents — `/api/agents/`

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET/POST | `/` | IsAdminOrSelfAgent | list (agents: own only) / create |
| GET/PATCH/DELETE | `/{id}/` | IsAdminOrSelfAgent + **PIN on delete** | retrieve / patch / delete |
| GET | `/{id}/delete_info/` | | `{customers_count, orders_count, transferable_agents[]}` |
| GET | `/profile/{user_id}/` | | agent detail by user id |
| GET | `/{id}/items/` | IsAdminOrSelfAgent | assigned fabrics, grouped by parent |
| POST | `/{id}/items/` | **IsAdmin** | `{variant_ids:[]}` — set-difference add/remove |
| DELETE | `/{id}/items/` | IsAdmin | remove all |
| DELETE | `/{id}/items/variants/{variant_id}/` | IsAdmin | remove one |
| POST | `/{id}/items/transfer/` | IsAdmin | `{target_agent_id}` — move (delete source) |
| POST | `/{id}/items/copy/` | IsAdmin | `{target_agent_id}` — duplicate (keep source) |

`destroy` supports `action: "transfer"` (reassign customers, then hard delete) or default `soft_delete`.

### 6.4 Customers — `/api/customers/`

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET/POST | `/` | IsAuthenticated | list (agent: own only) / create |
| GET/PATCH/DELETE | `/{id}/` | IsAuthenticated + **PIN on delete** | soft delete |
| GET | `/{id}/delete_info/` | | `{orders_count}` (excl. DRAFT) |
| POST | `/bulk-import/` | ⚠ **none** (see §11.5) | `{customers:[…]}` → `{created, failed, errors[]}`; 207 if any errors |

⚠ `bulk_import_customers` is a plain Django function view with only `@csrf_exempt @require_POST` — **no authentication, no permission class**.

### 6.5 Items — `/api/items/` and `/api/items/variants/`

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET | `/` | IsAuthenticated | active fabrics, paginated, `?search&ordering` |
| POST | `/` | **IsAdmin** | `CreateFabricSerializer` (multipart) |
| GET | `/{id}/` | IsAuthenticated | |
| PUT/PATCH | `/{id}/` | **IsAdmin** | `UpdateFabricSerializer` |
| DELETE | `/{id}/` | **IsAdmin + PIN** | soft delete, keeps order history |
| GET | `/archived/` | IsAuthenticated | out-of-stock ≥ `ARCHIVE_AFTER_DAYS`; includes `purge_on`, `days_until_purge` |
| GET | `/stock-list/` | IsAuthenticated | unpaginated per-colour stock for the order wizard |
| GET | `/sync/` | **IsAdmin** | ★ incremental mobile sync (§6.13) |
| GET | `/by-qr/?qr_code=&agent_id=` | IsAuthenticated | ★ QR lookup; rejects `len>255` or containing `/` (path-traversal guard); optional agent-assignment scoping |
| GET | `/outstanding-demand/?variant=` | IsAuthenticated | `Σordered − Σallocated` per variant + `is_backordered` |
| GET | `/customer-requirements/?fabric_id=` | IsAuthenticated | per-customer open demand for a fabric |
| GET/POST/PUT/PATCH/DELETE | `/variants/` and `/variants/{id}/` | IsAuthenticated / **IsAdmin** | variant CRUD; writes call `touch_catalog` + `sync_out_of_stock` |
| GET | `/variants/all/` | IsAuthenticated | flat variant list across fabrics |

### 6.6 Orders — `/api/orders/`

> **Routing note** (`urls.py:23-25`): the 6 `packing-rounds/*` paths are declared **before** the router, because the router's detail regex `^(?P<pk>[^/.]+)/$` would otherwise swallow `packing-rounds/` as `pk="packing-rounds"` and 405 on POST.

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET/POST | `/` | IsAuthenticated | list (filters: `customer, from_date, to_date, agent`(admin), status[], search, page, page_size) / create |
| GET/PATCH | `/{id}/` | IsAuthenticated | retrieve / patch. PATCH cannot set `status=DISPATCHED` (400) or leave DRAFT (400) |
| DELETE | `/{id}/` | `_may_touch` | 204. **Returns allocated cloth to stock** unless DRAFT/DISPATCHED |
| POST | `/{id}/place-order/` | IsAgentOrAdmin | DRAFT→PENDING; returns `shortfall_lines[]` + `notice` |
| POST | `/{id}/add-item/` | IsAgentOrAdmin | `{qr_code, ordered_quantity}` |
| DELETE | `/{id}/delete-item/{item_id}/` | IsAuthenticated | 200 `{message}` (not 204) |
| POST | `/{id}/merge-items/` | IsAgentOrAdmin | `{keep_item_id, drop_item_ids[]}` — must share one variant |
| GET | `/{id}/invoice/` | `_may_touch` | invoice payload incl. `brand`, `totals`, `gst_rate` |
| GET | `/{id}/logs/` | `_may_touch` | audit trail |
| POST | `/{id}/start-edit/` | **IsAgent** | snapshot → EDITING |
| POST | `/{id}/save-edit/` | **IsAgent** | EDITING→PENDING |
| POST | `/{id}/set-price/` | IsAgentOrAdmin | `{final_total, reason?}` |
| POST | `/{id}/dispatch/` | IsAuthenticated | `{allow_partial?, shortfall_reason?, transport_company?, lr_number?}` |
| POST | `/{id}/cancel-edit/` | IsAuthenticated | rollback to snapshot |
| GET | `/order-ids/` | IsAuthenticated | `[{id, status}]` (admin: excludes DRAFT) |
| GET | `/my-viewed-ids/` | IsAuthenticated | `number[]` |
| POST | `/{id}/mark-viewed/` | IsAuthenticated | get_or_create / delete by status |
| GET | `/archived/` | IsAuthenticated | dispatched >30 d ago; **only honours `from_date`/`to_date`/`page`/`page_size`** |
| GET/PATCH/DELETE | `/order-items/{id}/` | IsAuthenticated | `create()` always 405 |

**`set-price` rules** (docstring `:384-395`): DRAFT only, for everyone · agent may only **discount**, capped at *live line arithmetic* (recomputed, not read from the stored column, `:432-435`) · admin may set any amount · reason optional · every change audited.

**`dispatch` rules**: status must be PENDING or PACKED · if any line is short and `allow_partial` is falsy → 400 with `unallocated_lines[]` + `hint` · if short, `shortfall_reason` is mandatory · **no stock movement** (cloth already left the roll; the unallocated remainder never left).

### 6.7 Packing — `/api/orders/packing-rounds/` (all **IsAdmin**)

| Method | Path | Body / Params | Purpose |
|---|---|---|---|
| GET | `queue/?variant=<pk>` | | Outstanding demand for a variant, ranked by customer priority |
| POST | `preview/` | `{variant, round_size, order_ids?, available_meters?}` | ★ **Dry run** — `build_plan` with an optional hypothetical stock figure |
| POST | `/` | `{variant, round_size, note?, allocations?}` | Freeze a plan as a DRAFT round. No `allocations` ⇒ the engine's own plan is frozen into `plan_override` |
| GET | `list/?variant=<pk>` | | Last **50** rounds (hard limit, unpaginated) |
| POST | `/{pk}/confirm/` | `{note?}` | Move stock + record `Allocation`s. Re-checks status under lock (`:316-320` and `:326-335`) |
| POST | `/{pk}/cancel/` | `{}` | Return the metres; demotes orders that are no longer full |

**Two-layer status check on confirm:** the second `select_for_update` read is what prevents two admins clicking simultaneously from both seeing `DRAFT` and applying the plan twice.

### 6.8 Dashboard — `/api/dashboard/`

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET | `/` | IsAdmin | `{order_summary:{draft,pending,editing,packed,dispatched}, agents:[{agent,customers,pending_orders}]}` |
| GET | `/analytics/?from=&to=` | IsAdmin | `{kpis, trend, top_customers, top_agents, top_fabrics, time_metrics}` |

Analytics excludes DRAFT from all totals/trends/top-lists (WIP must not distort the numbers) but keeps `kpis.draft` for the status donut. Revenue uses `Coalesce("final_total", "computed_total")` so an admin's override counts. `time_metrics` (avg/median dispatch hours, % within 24 h) is computed in **Python with an N+1 query per dispatched order** (`views.py:~180-190`).

### 6.9 Admins, Business, Transports, Notification

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET/POST/PUT/PATCH | `/api/admins/` | **IsAdmin** | "Every admin can see and manage every other admin" |
| GET/PATCH | `/api/business/` `/api/business/{id}/` | IsAuthenticated / **IsSuperuser** | `list` always returns exactly one `Brand`; `create` updates the singleton; `destroy` → **405** |
| GET | `/api/transports/` `/api/transports/active/` | **AllowAny** | list / active only |
| POST/PATCH/DELETE | `/api/transports/` `/…/{id}/` | `is_staff` | ⚠ see §11.2 |
| POST | `/api/notification/save-subscription/` | IsAuthenticated | web-push `{endpoint, keys:{p256dh, auth}}` |
| POST | `/api/notification/register-token/` | IsAuthenticated | FCM `{token, platform}` |
| POST | `/api/notification/unregister-token/` | IsAuthenticated | FCM `{token}` |

### 6.10 Mobile Delta-Sync Protocol — `GET /api/items/sync/`

The most heavily documented action (`items/views.py:186-197`). A two-mode sync for a phone that goes offline.

| Param | Default | Clamp |
|---|---|---|
| `since` | — | opaque ISO cursor |
| `page` | 1 | 1 … 10,000,000 |
| `page_size` | 100 | 1 … 500 |

**Falls back to `mode:"full"`** when: no `since` · `since` older than `FABRIC_SYNC_MAX_AGE_DAYS` (14) · `len(catalog_changed) + stock_rows > FABRIC_SYNC_MAX_DELTA_FABRICS` (500).

| Response key | `full` | `delta` |
|---|---|---|
| `fabrics` | page of snapshots | page of changed |
| `stock` | `[]` | `[{variant_id, stock_meters}]` |
| `removed_fabric_ids` | `[]` (full snapshots never report removals) | `sorted(changed − active)` |
| `check` | `{fabrics: n, total_stock_meters: "…"}` — an integrity fingerprint | same |
| `cursor`, `server_time` | ✅ both modes — `server_time` lets clients correct for device-clock skew | |
| `archive_after_days`, `next_page` | ✅ | `next_page: null` |

### 6.11 External APIs Consumed

| Service | Direction | Where |
|---|---|---|
| **SMTP** (configurable) | outbound | `settings.py:109-115`, `accounts/views.py:114-141` (password-reset email) |
| **Web Push endpoints** (FCM/Edge/Mozilla…) | outbound | `notification/tasks.py:20-33` via pywebpush |
| **Firebase Cloud Messaging** | outbound | `notification/tasks.py:111-119` via firebase-admin |
| ❌ No third-party analytics, payment, or mapping SDK | | |

### 6.12 Error Format

Deliberately inconsistent, and the frontend copes with all of it:
- Flat `{"error": "..."}` — most hand-written views
- Flat `{"detail": "..."}` — DRF default
- `{"field": ["msg", …]}` — serializers
- `{"error": …, "status": …, "hint": …}` — `dispatch` shortfall
- 500 HTML debug page — caught by `toast.ts` (`data.includes("<html")`)

`lib/orderFlow.ts::extractErrorMessage` and `lib/toast.ts::parseApiError` both normalise these.

---

## 7. State Management

**No Redux, Zustand, Jotai, or Recoil. No server-state library (no SWR/React Query).** State is:

### 7.1 React Context (2 providers)

**`context/AuthContext.tsx`** (199 lines, `"use client"`) — mounted in `app/layout.tsx:60`.

```ts
{ user, accessToken, refreshToken, role, business, isSuperuser,
  isAuthenticated,          // derived: !!accessToken
  login(data), logout() }
```

| Cookie | Read as |
|---|---|
| `auth_user` | `JSON.parse`d → `AuthUser` |
| `token` | access token |
| `auth_refresh` | refresh token (**never used** — see below) |
| `role` | `"ADMIN"` \| `"AGENT"` |
| `business` | `"gents"` \| `"kids"` |
| `is_superuser` | `=== "true"` |

- `initializeAuth()` runs **synchronously in the component body on every render** (not memoized).
- `login()` writes all 6 cookies via `Cookies.set` with **no options** ⇒ **session cookies** (no `maxAge`, no `secure`, no `sameSite`).
- `logout()` nulls state, removes cookies, `router.push("/")`. **`authApi.logout()` is a no-op** — purely client-side, the JWT is never revoked server-side.
- **401 handler** (`:126-140`): a response interceptor on the shared axios instance calls `logout()` on any 401.
- ⚠ **There is no silent refresh.** `auth_refresh` is stored and exposed but **no frontend code ever calls a refresh endpoint** — none is wired up in the backend either. Combined with a 30-day access-token lifetime (`settings.py:214`), the cookie simply expires and the user is logged out.
- **Route guard** (`:142-173`, gated on an internal `isReady` flag): no token + not public → `/`; token + at `/` → `/admin` or `/agent` by role; `/admin*` + non-ADMIN → `/agent`.
- 29 files consume `useAuth()`.

**`context/OrderFlowContext.tsx`** (45 lines) — deliberately tiny.

```ts
type OrderFlowContextValue = {
  mode: "agent" | "admin";
  isAdmin: boolean;
  basePath: string;                      // /agent/order/new | /admin/order/new
  agentId: number | undefined;           // admin never picks an agent
  afterPlacePath: (orderId) => string;   // /agent/order/orderform | /admin/order/status/:id
}
```
Mounted twice: `(agent-order)/layout.tsx` → `mode="agent"`, and `(admin)/admin/order/new/layout.tsx` → `mode="admin"`. This is how the **same order-wizard pages serve both roles** — `/admin/order/new/[id]/page.tsx` is a 3-line re-export of the `(agent-order)` page.

### 7.2 Local Component State

All list/filter/form state is `useState` + `useEffect` inside each page. Data is fetched on mount and re-fetched after mutations — no cache layer, no dedupe, no request cancellation.

### 7.3 Session & Browser Storage

| Helper | Storage | Purpose |
|---|---|---|
| `hooks/useSessionStorage.ts` | `sessionStorage` | generic `useState` + JSON persist (⚠ no `storage`-event listener, no `JSON.parse` try/catch) |
| `lib/draftOrder.ts` | **`localStorage["orderKey"]`** | ★ draft-order identity. Written **before** navigation — the wizard reads the id on mount, and navigating first made it read the *previous* order's id |
| `lib/viewedOrders.ts` | module-level `Set` cache | unread-badge ids, with `clearViewedCache()` |
| `AGENTS.md` note | — | "Do not assume SSR/session state" |

### 7.4 Middleware-Level State

`proxy.ts` mutates cookies on the response (expired-token sweep). This is the only state that survives a hard reload before React hydrates.

---

## 8. Configuration & Environment

### 8.1 Backend `backend/.env` (gitignored; `.env.example` is the template)

| Variable | Required | Purpose |
|---|---|---|
| `SECRET_KEY` | ✅ | Django signing key |
| `DEBUG` | ✅ | bool; `True` also adds `localhost/127.0.0.1/testserver` to `ALLOWED_HOSTS` |
| `ALLOWED_HOSTS` | ✅ | comma-separated |
| `CORS_ALLOWED_ORIGINS` | — | default `http://localhost:3000,https://stockflow-sigma.vercel.app`; `https://` entries auto-feed `CSRF_TRUSTED_ORIGINS` (`settings.py:265`) |
| `CORS_ALLOW_ALL_ORIGINS` | — | bool, default `False` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` | ✅ | PostgreSQL |
| `POSTGRES_DB` / `_USER` / `_PASSWORD` | — | mirror for the compose `db` service |
| `EMAIL_HOST` / `_PORT` / `_USE_TLS` / `_HOST_USER` / `_HOST_PASSWORD` | — | password-reset SMTP |
| `DEFAULT_FROM_EMAIL` | — | |
| `PUBLIC_VAPID_KEY` / `PRIVATE_VAPID_KEY` | — | web push; private used server-side at `notification/tasks.py:29` |
| `CELERY_BROKER_URL` | — | ⚠ empty string would win over the default and silently fall back to `amqp://localhost` — hence the `or "redis://…"` guard at `settings.py:139-142` |
| `FIREBASE_CREDENTIALS` | — | absolute path to the service-account JSON. Empty ⇒ FCM silently disabled, web push unaffected |

**Tunable business settings** (all with defaults, `settings.py:278-307`):

| Setting | Default | Meaning |
|---|---|---|
| `GST_RATE` | `5` | % on every invoice |
| `ADMIN_DRAFT_EXPIRY_HOURS` | `24` | admin draft reaper |
| `ARCHIVE_AFTER_DAYS` | `30` | hidden from catalogue after this long out of stock |
| `ARCHIVED_FABRIC_RETENTION_DAYS` | `30` | then purged (total 60) |
| `ARCHIVED_FABRIC_PURGE_ENABLED` | `True` | master switch |
| `ARCHIVED_FABRIC_PURGE_BATCH` | `500` | per-run cap |
| `FABRIC_SYNC_MAX_AGE_DAYS` | `14` | delta-sync window |
| `FABRIC_SYNC_MAX_DELTA_FABRICS` | `500` | delta→full threshold |

**Hard-coded, not env-driven** (worth flagging): reset link origin `https://xlapparals.in/` (`accounts/views.py:112`), VAPID `sub` claim `mailto:muhammedmuflih9605@gmail.com` (`notification/tasks.py:30`), JWT `ACCESS_TOKEN_LIFETIME = 30 days`.

⚠ **`TIME_ZONE` is assigned twice** — `"UTC"` at `settings.py:187` then `"Asia/KolkATA"` at `:309`. The second wins; the first is dead.

### 8.2 Frontend `frontend/.env.local` (gitignored — `.gitignore:34` = `.env*`)

| Variable | Referenced at | Fallback |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `lib/api/axios.ts:8` | `?? "http://localhost:8000"` |
| `NEXT_PUBLIC_MEDIA_DOMAIN` | `next.config.ts:12,16` | falsy ⇒ `images.remotePatterns` is `[]` (all remote `next/image` rejected) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `lib/push.ts:36` | falsy ⇒ `getOrCreateSubscription()` **throws** |
| `VERCEL_OIDC_TOKEN` | — | present in `.env.local`; a Vercel platform secret, not referenced in app source |

⚠ **`NEXT_PUBLIC_MEDIA_DOMAIN` is absent from `.env.local`** — so `images.remotePatterns` is empty in a fresh clone and remote fabric images will not optimise through `next/image`.
⚠ `next.config.ts:14` hard-pins `protocol: "https"`, so an `http://localhost:8000` media URL is never optimised either.

### 8.3 Other Config Files

| File | Purpose |
|---|---|
| `backend/Dockerfile` | `python:3.12-slim`; `libpq-dev`/`libjpeg-dev`; `collectstatic` at build with dummy env; `CMD` = migrate + gunicorn (2 workers, 120 s timeout) |
| `backend/docker-compose.yml` | `db` (pg16-alpine, healthcheck `pg_isready`), `redis` (7-alpine, appendonly, healthcheck `redis-cli ping`), `celery` worker, `celery-beat`, `web`. Both `db` and `redis` have `restart: unless-stopped` + healthchecks; `web` binds `127.0.0.1:8000` and mounts `./media` |
| `backend/pyproject.toml` | `name = "stock_flow_backend"`, `requires-python = ">=3.12"` |
| `backend/.python-version` | `3.12` |
| `backend/.dockerignore` | excludes `media/`, `staticfiles/`, `venv/`, `.env*` (keeps `.env.example`), `*.md` |
| `frontend/next.config.ts` | `allowedDevOrigins` (4 LAN/tunnel hosts); conditional `remotePatterns` |
| `frontend/tsconfig.json` | `strict: true`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, paths `@/* → ./*` |
| `frontend/eslint.config.mjs` | flat config, `next/core-web-vitals` + `next/typescript` |
| `frontend/tailwind.config.ts` | only the `tailwindcss-animate` plugin + a `poppins` alias |
| `frontend/postcss.config.mjs` | `{ "@tailwindcss/postcss": {} }` |
| `frontend/vitest.config.ts` | jsdom, `globals: true`, `tests/setup.ts`, `@` alias |
| `frontend/components.json` | shadcn `new-york`, `rsc: true`, `neutral`, `lucide` |
| `frontend/AGENTS.md` | ★ conventions + "Don't change the strict version pins" |

---

## 9. Dependencies

### 9.1 Backend (`pyproject.toml` → `requirements.txt`, 3733 B, uv-pinned)

| Package | Version | Purpose |
|---|---|---|
| `django` | `~5.2.14` | framework |
| `djangorestframework` | `~3.16.1` | REST layer |
| `djangorestframework-simplejwt` | `~5.5.1` | JWT issue/verify |
| `drf-spectacular` | `~0.29.0` | OpenAPI schema + Swagger/ReDoc |
| `django-rest-passwordreset` | `~1.5.0` | password-reset endpoints |
| `django-cors-headers` | `~4.9.0` | CORS for the SPA |
| `django-extensions` | `~4.1` | dev shell |
| `psycopg2-binary` | `~2.9.11` | PostgreSQL driver |
| `redis` | `>=7.4.0` | Celery broker |
| `celery` | `>=5.6.3` | async tasks + beat |
| `kombu` | `>=5.6.2` | AMQP layer |
| `pywebpush` | `>=2.3.0` | VAPID web push |
| `py-vapid`, `http-ece`, `cryptography` | `1.9.4`/`1.2.1`/`48.0.0` | pywebpush transitives (RFC 8291) |
| `firebase-admin` | `>=6.6.0` | FCM mobile push |
| `pillow` | `~12.2.0` | server-side image resize/re-encode |
| `whitenoise` | `~6.8.2` | compressed-manifest static serving |
| `gunicorn` | `~23.0.0` | production WSGI |
| `python-decouple` | `~3.8` | `.env` → settings |
| `pyjwt` | `~2.10.1` | SimpleJWT backend |
| `requests`, `urllib3`, `certifi`, `idna`, `charset-normalizer` | | pywebpush transitives |
| `aiohttp`, `aiohappyeyeballs`, `aiosignal`, `frozenlist`, `multidict`, `yarl`, `propcache` | | pywebpush transitive |
| `jsonschema`, `jsonschema-specifications`, `referencing`, `rpds-py`, `attrs`, `inflection` | | drf-spectacular transitives |
| `sqlparse` | `0.5.5` | Django |
| `amqp`, `billiard`, `vine`, `kombu`, `click*`, `prompt-toolkit`, `python-dateutil`, `six`, `tzdata`, `tzlocal`, `wcwidth` | | Celery transitives |
| `PyYAML` | `6.0.3` | drf-spectacular |

### 9.2 Frontend (`package.json`)

**Runtime (16 → 24):**

| Package | Version | Purpose |
|---|---|---|
| `next` | **`16.2.2`** | framework (exact pin) |
| `react` / `react-dom` | **`19.2.3`** | UI (exact pin) |
| `axios` | `^1.15.2` | HTTP client |
| `js-cookie` | `^3.0.5` | auth cookie read/write |
| `lucide-react` | `^0.562.0` | icons |
| `class-variance-authority` + `clsx` + `tailwind-merge` | | shadcn `cn()` |
| `tailwindcss-animate` | `^1.0.7` | animation utilities |
| `radix-ui` | `^1.4.3` | primitives (single import surface) |
| `@radix-ui/react-label`, `-popover`, `-separator` | `^2.1.8`/`^1.1.15`/`^1.1.8` | used directly |
| `sonner` | `^2.0.7` | toasts |
| `recharts` | `^3.8.1` | analytics charts |
| `@react-pdf/renderer` | `^4.3.2` | invoice PDF (React tree → PDF) |
| `pdf-lib` | `^1.17.1` | PDF manipulation/download |
| `@yudiel/react-qr-scanner` | `^2.5.1` | camera QR scanning |
| `react-qr-code` | `^2.0.18` | QR label rendering |
| `qrcode` + `@types/qrcode` | `^1.5.4` | QR raster generation |
| `react-easy-crop` | `^5.5.7` | client-side image cropping |
| `heic2any` | `^0.0.4` | HEIC → JPEG (**dynamic import** — only pulled when a HEIC is actually uploaded) |
| `sharp` | `^0.34.5` | server-side image optimisation |
| `xlsx` | `0.20.3` (CDN tarball) | bulk customer import |
| `date-fns` + `react-day-picker` | `^4.1.0`/`^9.14.0` | delivery-date picker |
| `react-select` | `^5.10.2` | searchable selects |

**Dev (18):** `typescript ^5.9.3`, `tailwindcss ^4.2.2`, `@tailwindcss/postcss ^4.2.2`, `tw-animate-css ^1.4.0`, `vitest ^4.1.4`, `@vitejs/plugin-react ^6.0.1`, `jsdom ^29.0.2`, `@testing-library/{dom,react,user-event}`, `eslint ^9.39.4` + `eslint-config-next 16.1.1`, `@types/{node,react,react-dom,js-cookie,qrcode}`, `openapi-typescript ^7.13.0` (⚠ declared but **no script uses it** — no generated client exists).

**Runtime:** Node `>=24 <25`, package manager `pnpm@11.9.0`.

---

## 10. Recent Changes / Custom Edits

### 10.1 Git History

| Commit | When | Files | +/- | Content |
|---|---|---|---|---|
| `3028307` "first commit" | Sep 26 10:06 +0530 | **433** | **+51,871** | Squashed import of the author's pre-existing `stock_flow` app. Contains the scaffolding **and** most of the original logic |
| `1b270f8` "feat: implement new idea" | Sep 27 00:02 | 187 | +9,326 / −11,049 | ★ **The real new work** — packing/allocation engine, `Item`→`Fabric` rename, migration squash |
| `55a916e` "fix: fix the upload image" | Sep 27 08:42 | 50 | +189 / −1 | axios FormData bug (3 real code files; 47 are committed JPEGs) |
| `efa6644` "update: update in packing page" | Sep 27 12:42 (HEAD) | 31 | +2,496 / −552 | select→review→commit packing flow, price override, merge endpoint, draft-order race fix |

### 10.2 Origin

```
origin  https://github.com/muflih-drape/Cloth_Tenant
```
Single branch `main`, no tags, no stash, no other branches.

**The repo was renamed; the code was not.** Zero occurrences of "cloth tenant" in the tree, while the old identity persists:
- `backend/pyproject.toml:2` → `name = "stock_flow_backend"`
- `frontend/package.json:2` → `"name": "stock-flow"`
- `frontend/AGENTS.md:3` → *"This is `frontend/` of the **`stock_flow` git repo"*
- `components/ui/custom/stockFlowButton.tsx`, `stockFlowSelect.tsx`, `stockflowAvatar.tsx`

There is **no upstream/boilerplate ancestor in the git record** — no second author, no merge, no vendored commit. The "original/base project" *is* this author's own earlier work.

### 10.3 What `1b270f8` Actually Did

One cohesive re-architecture in four threads:

**(a) The packing / stock-allocation engine** — the "new idea"
- **New models:** `PackingRound`, `Allocation`
- **New modules:** `allocation.py` (460), `packing_views.py` (479), `stock.py` (217), `pricing.py` (161)
- **Frontend:** `PackingBoard.tsx` (634 lines then), `admin/packing/page.tsx`, `admin/packing/[variant]/page.tsx`, `lib/utils/inventorySummary.ts`, `MetresSelector.tsx`, `StockMetresRow.tsx`
- **Tests:** `test_allocation_scenario.py` (295), `inventorySummary.test.ts`

**(b) Domain rename `Item` → `Fabric`** — `Item`→`Fabric`, `ItemVariant`→`FabricVariant`, plus new `stock_meters`/`stock_updated_at`. ~40 settings constants renamed (`ARCHIVED_ITEM_*`→`ARCHIVED_FABRIC_*`, `ITEM_SYNC_MAX_DELTA_ITEMS`→`FABRIC_SYNC_MAX_DELTA_FABRICS`); Celery task → `purge_archived_fabrics_task`; command `purge_archived_items.py`→`purge_archived_fabrics.py` (the only rename-detected move in history). **The URL prefix stayed `/api/items/`.**

**(c) Migration history squashed** — ~50 migrations collapsed into rewritten `0001_initial.py` files. This is why deletions outnumber insertions, and is why the `cleanup_orphaned_media` breakage (§11.1) went unnoticed.

**(d) Business logic relocated/rewritten** — `orders/utils.py` deleted (absorbed into the new modules); `orders/views.py` restructured into function-based APIViews; `items/services.py` gained `sync_out_of_stock`, `delete_fabric_keep_history`, `purge_archived_fabrics`; `agents/views.py` gained `AgentItemTransferView`/`AgentItemCopyView`; `dashboard/views.py` rewritten.

### 10.4 The `55a916e` Upload Fix

**Root cause** (documented in `lib/api/axios.ts:20`): the axios instance sets a default `Content-Type: application/json`. axios merges instance defaults into every request, so passing `{}` per-call cannot clear it. With a JSON content-type on a `FormData` body, axios runs `JSON.stringify(formDataToJSON(data))`, every `File` collapses to `{}`, and DRF's `ImageField` replies *"The submitted data was not a file."*

**Fix** — request interceptor:
```ts
if (config.data instanceof FormData) {
  if (typeof config.headers.delete === "function") config.headers.delete("Content-Type");
  else delete config.headers["Content-Type"];
}
```
Regression-locked by `tests/lib/apiMultipart.test.ts` (72) and `tests/lib/fabricUpdateUpload.test.ts` (101).

**Second half of the commit:** removed `media/` from `backend/.gitignore` and committed **47 runtime-uploaded JPEGs (7.7 MB)** of customer data. That is why a "3-code-file fix" shows as 50 files.

### 10.5 The `efa6644` Packing Update

- **`PackingBoard.tsx`** (676 lines changed, 36 hunks) — rewritten from auto-apply to explicit `"select"` → `"review"` → commit, with a *"Step 3: read the split back before any cloth moves"* confirmation gate.
- **`lib/utils/packingSplit.ts`** (new, 120) — `splitEqually()` (even share capped at each line's outstanding, leftover to highest `priority_rank`, 3-dp quantised) + `splitProblems()` mirroring server-side rejections as sentences. **Suggestion only — never touches stock.**
- **`lib/priceOverride.ts`** (new, 94) + **`PriceOverrideDialog.tsx`** (new, 171) — strict `/^-?\d+(\.\d{1,2})?$/` guard before `Number()`; `formatRupees` (`₹`, `en-IN`). Mirrors the server rule: agents may only lower.
- **Backend** — `MergeOrderItemsSerializer` + `MergeOrderItemsView` (transactional, decimal-safe), route `<int:order_id>/merge-items/`, extracted `_remove_order_line`, and `pricing.py` made `reason` **optional**.
- **`lib/draftOrder.ts`** (new, 58) — the `localStorage["orderKey"]`-before-navigate race fix.
- **`types/item.ts`** — gained `roundMetres` (EPSILON-correct 3-dp quantisation) to kill float-drift false positives.
- **+967 lines of tests** (backend `PackingRoundAPITests` incl. `test_a_round_cannot_exceed_what_one_order_still_needs`, `test_agents_cannot_reach_the_packing_api`, `test_confirming_twice_is_rejected`; frontend `packingSplit`/`priceOverride`/`orderFlow`).

### 10.6 Custom vs. Boilerplate

**Boilerplate — do not treat as custom work:**
- **shadcn/ui, 14 files, untouched in all 4 commits:** `accordion, alert, avatar, button, calendar, card, dialog, field, input, label, popover, select, separator, spinner, textarea`. Confirmed upstream by `import { Dialog as DialogPrimitive } from "radix-ui"`.
- **create-next-app defaults:** `frontend/README.md` (verbatim boilerplate), `postcss.config.mjs`, `tailwind.config.ts`, `next.config.ts`, `eslint.config.mjs`, `app/favicon.ico`, `app/apple-icon.png`, `lib/utils.ts` (6-line `cn()`).
- **Django/DRF-generated:** every `apps.py`, `admin.py` stub, `__init__.py`, all `migrations/*`, `manage.py`, `config/{asgi,wsgi,celery,urls}.py`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore`, `requirements.txt`, `uv.lock`, `pnpm-lock.yaml`.

**Hand-written — the actual signal:** `allocation.py` (the intellectual centre), `stock.py`, `pricing.py`, `packing_views.py`, `PackingRound`/`Allocation`, `_build_snapshot`/`_restore_snapshot`/`_may_touch`/`_reap_stale_drafts`, `items/services.py`, `items/signals.py`, `AgentItemTransferView`/`AgentItemCopyView`, `dashboard/views.py`, `notification/`, and on the frontend `PackingBoard.tsx`, `packingSplit.ts`, `priceOverride.ts`, `PriceOverrideDialog.tsx`, `draftOrder.ts`, `inventorySummary.ts`, `roundMetres`, `form-utils.ts`, `updateItem.ts`, `toast.ts`, `bulk-import/page.tsx` (855), `InvoicePdf.tsx`, `QRPageContent.tsx`, `ItemAssignment.tsx`, and all 12 files in `components/ui/custom/` (hand-rolled, none from shadcn).

**Strongest originality signal: the test suite** — ~9,000 lines encoding *business invariants*, not framework coverage: `test_placing_does_not_move_stock`, `test_oversubscribed_order_is_placed_with_a_warning`, `test_dispatch_blocked_while_unallocated`, `test_deleting_a_packed_order_returns_its_cloth`, `test_generic_patch_cannot_reach_the_total`, `test_posting_the_order_total_clears_an_override`.

**Net:** the custom work is essentially commits `1b270f8` + `55a916e` + `efa6644` — ~12,000 insertions in a 36-hour window by one developer.

---

## 11. Known Issues / TODOs

### 11.0 TODO/FIXME inventory

**There are no `TODO`, `FIXME`, `HACK`, or `XXX` comments anywhere in the source** (backend or frontend). The only matches are inside lockfile integrity hashes. The codebase instead documents intent through unusually thorough **docstrings and inline comments** explaining *why* — often recording the bug a change fixed (see §10.5, and e.g. `orders/views.py:815-817`, `packing_views.py` docstrings).

That makes the issues below more important: they are **unlabelled**.

### 11.1 🔴 `cleanup_orphaned_media` is dead — daily Celery job raises `ImportError`

`backend/apps/items/management/commands/cleanup_orphaned_media.py` was **missed by the `Item` → `Fabric` rename** in commit `1b270f8`. It still references the pre-rename world:

| Line | Stale reference | Should be |
|---|---|---|
| 8 | `from apps.items.models import ItemVariant` | `FabricVariant` |
| 12 | help text "…not referenced by any ItemVariant" | `FabricVariant` |
| 38, 68, 112 | `items_dir = media/items` | `media/fabrics` — the new upload path |
| 47 | `.filter(item__is_deleted=False)` | `.filter(fabric__is_deleted=False)` |
| 53 | `.filter(orderitem__isnull=False)` | `FabricVariant` has **no** `orderitem` relation at all |

**Impact:** `apps/items/tasks.py:13-16` `cleanup_orphaned_media_task()` calls `call_command("cleanup_orphaned_media", days_old=1)`, scheduled by `CELERY_BEAT_SCHEDULE` (`settings.py:152-155`) to run **daily at 00:00**. It will raise `ImportError` on the class-name import. Orphaned fabric images are therefore **never cleaned up** — and 41 stale files already sit in `media/fabrics/`.

The sibling command `purge_archived_fabrics.py` *was* updated and is fine.

### 11.2 🟠 Inconsistent admin checks on Transports

`transports/views.py:11-13` defines a **local** `IsAdminUser` that checks `is_staff`:
```python
class IsAdminUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_staff
```
Every other app uses `apps.accounts.permissions.IsAdmin`, which checks `role == "ADMIN"`. `User.save()` (`accounts/models.py:27-30`) forces `role="ADMIN"` for superusers but **never sets `is_staff`**, so:
- A non-superuser admin with `role="ADMIN"` and `is_staff=False` **cannot** create/edit/delete transports — the Settings → Transports UI is broken for them.
- Conversely `is_staff` is a Django-auth flag this app otherwise never sets, so the two notions have diverged.

**Structurally:** `transports/` sits at `backend/transports/`, outside the `apps/` package that every other app uses — a leftover from the wholesale import.

### 11.3 🟠 `transportApi` return types are wrong

`frontend/lib/api/transport.ts` types `create()` and `update()` as returning `TransportAllResponse` (an **array**), when the backend returns a single `Transport` object. `delete()` returns nothing at all. The `/admin/settings/transports` screens are the only consumers.

### 11.4 🟠 All authorization is client-side cookie state

`proxy.ts` reads the `role` cookie and the JWT payload, both of which the user controls. A user can edit `role=ADMIN` in devtools and the middleware will let them past `/admin`, then read whatever the browser cookie allows. The **backend** permissions (`IsAdmin`, `IsAgentOrAdmin`, `check_admin_pin`) are the real boundary and are sound — but the frontend route guards are cosmetic, and `AGENTS.md:14` ("Keep in sync with route guards") describes an enforcement that does not exist.

Related specifics:
- Auth cookies are **session cookies** — no `maxAge`, no `secure`, no `sameSite` (`AuthContext.tsx` `login()`).
- `logout()` never revokes the JWT server-side (`authApi.logout()` is an empty function).
- `proxy.ts` clears `token`/`role`/`auth_user`/`auth_refresh` on expiry but **not** `business`/`is_superuser`, unlike `AuthContext.logout()` which clears all six.
- **No silent refresh.** `auth_refresh` is stored and exposed but nothing ever calls a refresh endpoint, and none is wired up in the backend — so the 30-day access token is the whole session.

### 11.5 🟠 Security gaps

| Issue | Location |
|---|---|
| `bulk_import_customers` has **no auth** — `@csrf_exempt @require_POST` only | `customers/views.py:~74-78` |
| Transport **reads are `AllowAny`** | `transports/views.py:~20-22` |
| User enumeration: `forgot-password` returns 404 for unknown emails vs. a success message otherwise | `accounts/views.py:98-102` |
| `get_by_qr` rejects `len>255` or any `/` — an explicit path-traversal guard, but the guard is a string check rather than a UUID parse at the query level | `items/views.py:273-276` |
| `check_admin_pin` is exempt for **agents**, who are not routed to destructive admin endpoints anyway — but the exemption is broad if that routing ever changes | `accounts/permissions.py:42-45` |

### 11.6 🟡 Dead code (verified by grep — no callers)

**Backend:**
- `stock.py`: `consume_for_allocation`, `outstanding_demand`, `shortfall_for_line`, `order_is_fully_allocated`, `allocated_totals_by_variant`, `LIVE_STATUSES` — packing uses `allocation._adjust_stock` instead
- `orders/views.py:8,21,32` — imports `F`, `IsAdmin`, `check_admin_pin`, `return_to_stock`, none of which are used in the file
- `items/views.py:128-133` — the `fabrics_sync` permission branch is redundant (`sync` is a GET, so it would reach `IsAuthenticated` anyway)
- `constants/sizes.ts` — `KIDS_SIZES` / `GENTS_SIZES`: vestigial from a garment-sizing model that no longer exists
- `openapi-typescript` in devDependencies — no script uses it; no generated API client exists

**Frontend:**
- `hooks/useSessionStorage.ts` — generic but only lightly used
- `.dark` theme block in `globals.css:147-179` — no theme toggle exists
- `--font-poppins` referenced by `tailwind.config.ts` — never defined (root layout defines `--font-jakartha`)
- **`_restore_snapshot` discards `allocated_quantity`** even though `_build_snapshot` captures it (`views.py:57-72` vs `94-103`). Currently safe because the function is only called for allocation-free orders, but it is a latent trap.

### 11.7 🟡 Performance / N+1 issues

| Issue | Location |
|---|---|
| Dispatch-time metrics: one `OrderLog` query **per dispatched order** | `dashboard/views.py:~180-190` |
| `outstanding_demand`: one aggregate **per variant**; endpoint unpaginated | `items/views.py:342-374` |
| `list_rounds`: `sum(r.allocations.metres)` **per round**; hard-limited to 50 | `packing_views.py:452-479` |
| `get_all_variants`, `get_stock_list`, `get_archived` — all unpaginated full scans | `items/views.py` |
| `analytics` docstring contains **mojibake** — `Σ` rendered as `I␀` (`dashboard/views.py:~55-58`), and `.gitignore` has `secret �?"` | encoding damage |
| `log-invoice` N+1: `get_goto_url` per row | — |

### 11.8 🟡 Minor inconsistencies

- `orderApi.getArchived` sends `agent`/`search`/`customer`/`status` that the backend **ignores** — only `from_date`/`to_date`/`page`/`page_size` are honoured.
- `dashboardApi.getAnalytics` always appends `?`, producing `/api/dashboard/analytics/?` even with no params.
- `OPEN_STATUSES = ("PENDING","PACKED")` is **duplicated in 4 places** with slightly different names/values: `orders/views.py:48`, `orders/allocation.py:45`, `orders/stock.py:30`, `items/views.py:32` — and a 5th variant in `items/services.py:24` (`OPEN_ORDER_STATUSES`, which deliberately includes DRAFT/EDITING). A single shared constant would prevent drift.
- `SaveEditView` sets `notes` **only if truthy**, so an empty string cannot clear a note (`views.py:368-369`).
- `_apply_plan` writes `sequence` from `enumerate` and always `is_priority_award=False`, so a hand-edited round loses the engine's sequence/priority provenance (unlike `confirm_round`).
- `useSessionStorage` has no `try/catch` around `JSON.parse` — a corrupted value throws.
- `proxy.ts` has **no guard for `/agent` routes** and no check for a *missing* token on protected routes (deferred to `AuthContext`).
- `Brand.getDeleteInfo` / `delete` are implemented in `lib/api/brand.ts` but the backend `BrandViewSet` returns **405** on destroy and has no `delete_info` action — those two frontend calls can never succeed.
- `OrderLog.ACTION_CHOICES` includes `ITEM_MERGED` in practice (emitted at `views.py:~1040`) but the choices tuple (`:122-135`) does not list it.

### 11.9 🟡 Repo hygiene

- **`backend/media/` is now version-controlled runtime data** — 49 files / ~7.7 MB of customer-uploaded JPEGs. The `media/` ignore rule was deliberately removed in `55a916e` so image previews work from a fresh clone.
- **Stray untracked `frontend/package-lock.json`** (465 KB) sitting next to the tracked `pnpm-lock.yaml` — an accidental `npm install` artifact. The project is pnpm-only.
- **`backend/README.md` is 0 bytes**, yet `pyproject.toml` declares `readme = "README.md"`.
- **`frontend/README.md` is verbatim create-next-app boilerplate** — never modified in any commit.
- No `LICENSE`, no `CONTRIBUTING`, no `CODEOWNERS`, no root `README`.
- No root `.gitignore` — rules are duplicated in two subfolder files.
- `.env` files contain **real-looking values** for DB and SMTP (`backend/.env` is gitignored, but the developer ran a live deployment from this tree).

---

## 12. How to Run

### 12.1 Prerequisites

- **Python ≥3.12** (`.python-version` = `3.12`)
- **Node ≥24 <25**, **pnpm 11.9.0**
- **PostgreSQL 16** and **Redis 7** — or Docker

### 12.2 Backend

```bash
cd backend

# Option A — Python venv
python -m venv venv
.\venv\Scripts\activate            # Windows
source venv/bin/activate           # macOS/Linux
pip install -r requirements.txt    # or: uv sync

# Option B — Docker Compose (db + redis + celery + beat + web)
docker compose up --build

# Configure
cp .env.example .env               # then fill in SECRET_KEY, DB_*, EMAIL_*, VAPID keys

# Database
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_brands           # XL TOWER + BN CLOTHING company profile
python manage.py seed_test_data        # realistic mill: staff, fabrics, demand

# Run
python manage.py runserver 8000        # http://localhost:8000
# Celery (separate shells)
celery -A config worker -l info
celery -A config beat   -l info        # required for the 00:00 / 01:00 purge jobs
```

Serves on `:8000`; browsable docs at `/api/docs/`, schema at `/api/schema/`, health at `/health/`.

**Maintenance commands:**
```bash
python manage.py purge_archived_fabrics --dry-run --limit 100   # preview the purge
python manage.py cleanup_orphaned_media --dry-run --days-old 7  # ⚠ currently broken, see §11.1
python manage.py test                                          # full suite
python manage.py shell_plus                                     # django-extensions
```

### 12.3 Frontend

```bash
cd frontend
pnpm install
pnpm dev            # http://localhost:3000
```

`frontend/.env.local` (create it; `.env*` is gitignored):
```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_MEDIA_DOMAIN=<your-api-host>        # without this, remote next/image fails
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public-vapid-key> # without this, push throws
```

**Scripts** (`package.json:5-15`):

| Script | Command | Purpose |
|---|---|---|
| `pnpm dev` | `next dev` | dev server on `localhost:3000` |
| `pnpm local` | `next dev --hostname 0.0.0.0` | bind all interfaces (LAN/phone testing) |
| `pnpm mobile` | `next dev --experimental-https` | HTTPS for phone camera (QR scanning needs a secure context) |
| `pnpm build` | `next build` | production build |
| `pnpm start` | `next start` | serve the production build |
| `pnpm lint` | `eslint` | ESLint flat config |
| `pnpm test` | `vitest` | watch mode |
| `pnpm test:run` | `vitest run` | single run |
| `pnpm test:ui` | `vitest --ui` | browser UI |

> ⚠ **There is no `typecheck` script.** Per `AGENTS.md:9`, verify types with `pnpm exec tsc --noEmit`.

### 12.4 Full-Stack Notes

- **CORS:** the default allow-list is `http://localhost:3000,https://stockflow-sigma.vercel.app`. `https://` entries are auto-promoted to `CSRF_TRUSTED_ORIGINS`.
- **Media:** served by Django at `/media/<path>` with a 1-year immutable cache. In Docker, `./media` is bind-mounted into both `web` and `celery` — **both need it**, since the Celery tasks delete image files.
- **Test data:** `seed_test_data` seeds 10 realistic fabrics (`FABRIC_SEED`, e.g. "Cotton Cambric 140 GSM" @ ₹9.00/m) with colours, staff, customers, and multi-order demand. The docstring notes stock is *generous on purpose* so backorder/priority behaviour shows up in the packing tests rather than the demo data.
- **Typical loop:** `pnpm dev` + `python manage.py runserver` + `celery -A config worker` + `celery -A config beat`.
