---
title: Infraestructura — topología y jobs programados
category: architecture
tags: [infraestructura, topologia, vercel, supabase, edge-functions, pg_cron, diagramas]
sources: [supabase/functions, supabase/migrations, .github/workflows, src/lib/supabase.ts]
updated: 2026-09-18
---

# Infraestructura — topología y jobs programados

> **Por qué existe esta página.** Hasta el 2026-09-18 `wiki/architecture/` era **texto puro, sin un solo
> diagrama**: los 10 `.drawio` de `G360.Wiki/diagrams/` son todos de **procesos de negocio**, no de
> infraestructura. Esta página cierra ese hueco.
>
> **Todo lo de acá está contado desde el repo, no de memoria**: las Edge Functions se contaron sobre
> `supabase/functions/`, los jobs de `pg_cron` se buscaron con `cron.schedule(` en `supabase/migrations/`,
> los buckets sobre los `storage.from('…')` reales del código y los workflows sobre `.github/workflows/`.
> Donde un número difiera de otra página del wiki, **manda éste** (ver "Drift detectado" al final).

## 🗺️ Diagrama 11 — Topología

Editable en draw.io: [`G360.Wiki/diagrams/11-infraestructura-topologia.drawio`](../../diagrams/11-infraestructura-topologia.drawio).

```mermaid
flowchart TD
    U(["Usuario del comercio<br/>dueño · cajero · depósito…"]) -->|HTTPS| V["<b>Vercel</b> — CDN + hosting estático<br/>app.genesis360.pro (SPA) · www.genesis360.pro (landing)<br/>React 18 + Vite + TypeScript + Tailwind · PWA"]
    EQ(["Equipo Genesis360<br/>soporte · administración"]) -->|HTTPS| AD["<b>admin.genesis360.pro</b><br/>Panel interno — REPO APARTE (genesis360-admin)"]

    subgraph SB["Supabase — 2 proyectos AISLADOS · PROD jjffnbrdjchquexdfgwq · DEV gcmhzdedrkmmzfzfveig"]
        AU["<b>Auth</b> (GoTrue)<br/>Google OAuth + email/password<br/>JWT · refresco con cortacircuitos"]
        PG["<b>PostgreSQL</b><br/>migraciones 001-429<br/>RLS multi-tenant + por sucursal (23 tablas)<br/>triggers de stock, numeración y caja"]
        ST["<b>Storage</b> — 12 buckets<br/>productos · empleados · avatares · logos<br/>certificados-afip · comprobantes-gastos<br/>remitos · etiquetas-envios · soporte-adjuntos…"]
        EF["<b>Edge Functions</b> (Deno) — 51<br/>webhooks · sweeps · workers de sync<br/>emisión AFIP · IA · email · portales"]
        CR["<b>pg_cron</b> — 6 jobs"]
    end

    V -->|"supabase-js (anon key + JWT)"| AU
    V -->|"PostgREST — todo filtrado por RLS"| PG
    V -->|archivos| ST
    V -->|invoke| EF
    AD -->|"admin-api (service role, server-side)"| EF
    CR --> PG
    EF -->|"lee/escribe con service role"| PG

    GA["<b>GitHub Actions</b> — 13 workflows<br/>CI (unit tests en cada push a dev)<br/>+ sweeps programados (respaldo externo de pg_cron)"] -.->|cron externo| EF

    EF --> FI["<b>ARCA / AFIP</b><br/>vía AfipSDK — CAE, NC/ND"]
    EF --> PA["<b>Cobros</b><br/>Mercado Pago (suscripción + link) · MODO (QR)"]
    EF --> MK["<b>Marketplaces</b><br/>Mercado Libre · TiendaNube"]
    EF --> CO["<b>Mensajería</b><br/>Resend (envío) · Cloudflare Email Routing (recepción)<br/>WhatsApp Cloud API (Meta)"]
    EF --> OT["<b>Otros</b><br/>Anthropic Claude (asistente + scan)<br/>Google Maps (direcciones/distancias)"]
```

> 🛑 **El navegador nunca habla con los externos.** Toda credencial de tercero vive en secrets de Edge
> Function o de Vercel. El frontend solo lleva la **anon key**, y lo que ésa puede ver lo decide **RLS** —
> por eso una `service_role` filtrada es crítica: saltea RLS y ve todos los negocios (ver
> [[wiki/architecture/multi-tenant-rls]]).

## ⏱️ Qué corre solo, y desde dónde

Hay **dos relojes distintos**, y conviene no confundirlos:

| | Dónde vive | Cuántos | Qué dispara |
|---|---|---|---|
| **`pg_cron`** | Dentro de Postgres | **6 jobs** | SQL directo (funciones `fn_*`), sin salir de la base |
| **GitHub Actions** | Fuera de Supabase | **13 workflows** | `curl` a Edge Functions (sweeps) + CI de tests |

**Los 6 jobs de `pg_cron`** (verificados con `cron.schedule(` en las migraciones):

| Job | Migración | Cadencia |
|---|---|---|
| Aplicar precios programados | 422 | cada minuto |
| Avisar precios que entran mañana | 422 | 12:00 diario |
| Notificar cuentas corrientes vencidas | 091 | diaria |
| Limpieza de `integration_job_queue` | 104 | diaria |
| Limpieza de tokens de envío vencidos | 143 | diaria |
| Sync de fulfillment TiendaNube | 338 | cada 5 min |

**Los 13 workflows** (`.github/workflows/`): `tests` (CI) · `sweeps` · `birthday-notifications` ·
`monitoring-check` · `mp-reconciliacion` · `tn-stock-sync` · `meli-stock-sync` · `tn-fulfillment-sync` ·
`repricing-sweep` · `repositores-cierre-dia-sweep` · `tenant-hard-delete-sweep` · `nc-afip-retry-sweep` ·
`wa-briefing-sweep`.

> ⚠️ Un workflow programado **solo se dispara desde el branch por defecto** del repo. Una feature que vive
> en `dev` no ejecuta su cron hasta mergear — en DEV se invoca a mano por `curl`.

## 🛑 Drift detectado al construir esta página (2026-09-18)

Se encontró contando contra el repo. Estas páginas **quedaron desactualizadas** y se corrigen por separado:

| Dónde | Dice | Realidad |
|---|---|---|
| [[wiki/architecture/backend-supabase]] | 83 migraciones · 26 Edge Functions · rol `OWNER` | **429** · **51** · `OWNER` **no existe** (es `DUEÑO`; ver [[wiki/architecture/multi-tenant-rls]]) |
| [[wiki/architecture/edge-functions]] | 30 funciones Deno | **51** |
| `sources/raw/genesis360_overview.html` (doc de producto, v2.0) | 823 tests / 55 archivos · 249 migraciones · **"pg_cron no habilitado"** | **1848 tests / 112 archivos** · **429** · **pg_cron SÍ habilitado, con 6 jobs** |

El error de `pg_cron` es el más importante de los tres porque ese documento **va a externos**.

## Links relacionados

- [[wiki/architecture/backend-supabase]] · [[wiki/architecture/edge-functions]] · [[wiki/architecture/frontend-stack]]
- [[wiki/architecture/multi-tenant-rls]] — cómo RLS aísla tenant y sucursal
- [[wiki/architecture/resiliencia]] — techo de capacidad medido, consumo por usuario y palancas
- [[wiki/development/deploy]] — cómo se despliegan app, Edge Functions y migraciones
- `G360.Wiki/diagrams/README.md` — convención de los diagramas (`.drawio` + Mermaid)
