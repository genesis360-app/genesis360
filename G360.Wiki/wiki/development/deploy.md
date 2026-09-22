---
title: Deploy — Vercel + Supabase
category: development
tags: [deploy, vercel, supabase, produccion, dominios]
sources: []
updated: 2026-09-22
---

# Deploy

---

## Stack de deploy

| Componente | Servicio |
|-----------|---------|
| Frontend (React SPA) | Vercel |
| Base de datos | Supabase (PostgreSQL managed) |
| Edge Functions | Supabase Edge Functions (Deno) |
| Dominio | genesis360.pro |

---

## Dominios

| Dominio | Destino |
|---------|---------|
| `www.genesis360.pro` | Landing page (marketing) |
| `app.genesis360.pro` | Aplicación autenticada |

Configurado en `vercel.json`:
- `app.genesis360.pro/` → redirect a `/login`
- Todas las rutas → `/index.html` (SPA rewrite)

---

## Proyectos Supabase

| Ambiente | Project ID | URL |
|----------|-----------|-----|
| PROD | `jjffnbrdjchquexdfgwq` | `https://jjffnbrdjchquexdfgwq.supabase.co` |
| DEV | `gcmhzdedrkmmzfzfveig` | `https://gcmhzdedrkmmzfzfveig.supabase.co` |

> [!WARNING] **PROD:** No aplicar migraciones sin haber testeado en DEV primero. No modificar datos directamente.

---

## Variables de entorno en Vercel

Configuradas en el dashboard de Vercel (no en el repo):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` — 🔑 **2026-09-20**: en el proyecto `genesis360` (app) ya apunta a la **publishable
  key nueva** (`sb_publishable_…`), verificado en el bundle servido. 🔴 **El proyecto `genesis360-admin` todavía
  sirve la key vieja** — pendiente redeploy. ⚠️ Cambiar esta variable **solo entra al bundle al reconstruir ESE
  branch** — "Preview" es el ENTORNO, `dev`/`main` son las RAMAS, no confundirlas. Ver
  [[wiki/architecture/infraestructura]] ("API keys de Supabase").
- `VITE_MP_PUBLIC_KEY`
- `VITE_APP_URL`

> 🐛 **Tras cambiar `VITE_SUPABASE_ANON_KEY` y redeployar, un browser ya logueado puede seguir fallando por el
> service worker de la PWA** (no se da de baja con hard-refresh). Confirmar en DevTools → Application → Service
> Workers → Unregister + Clear site data, o probar en incógnito, antes de asumir que el cambio "no sirvió".

---

## Variables de entorno en Supabase (Edge Functions)

Configuradas en Supabase Dashboard → Settings → Edge Functions:
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET` — 🔴 sin cargar todavía en Supabase DEV/PROD; sin ella `mp-webhook` no valida nada (log-only)
- `MP_WEBHOOK_SIG_ENFORCE` — 🆕 2026-09-22 (mig 431), interruptor: en `true` (y con `MP_WEBHOOK_SECRET` cargado) `mp-webhook` pasa de LOG-ONLY a bloquear con 401 (ver [[wiki/architecture/guards-server-side]], "Segunda tanda")
- `MP_PRICE_ID`
- `MODO_WEBHOOK_SECRET` — 🆕 2026-09-20, requerida por `modo-webhook` para validar el pago (antes no validaba nada). 🔴 Si no está cargada, la EF responde 503 a propósito
- `CRON_SECRET` — 🆕 2026-09-20, ✅ **cargada en DEV y PROD (Supabase) y en GitHub Actions**, verificada en PROD (los 8 sweeps probados dan 401 con la anon key, el workflow real `tn-stock-sync` corrido desde `main` dio success) — requerida por los 15 sweeps/workers (header `x-cron-secret`, que mandan los 13 workflows de GitHub Actions)
- `TN_CLIENT_SECRET` — ya existía; ahora también la usa `tn-webhook` para validar el HMAC-SHA256 del body
- `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` — 🆕 2026-09-20, ✅ **cargadas en GitHub** (secrets del repo, no de Supabase), usadas por el workflow de backup de Storage
- Claves de Resend, AFIP, MeLi, TN, Anthropic

---

## Backup de Storage (GitHub Actions, 2026-09-20, ✅ corrida real verificada 2026-09-22)

Los backups automáticos de Supabase **no incluyen Storage** (textual de su doc: *"Database backups do not
include objects you store via the Storage API"*) — solo la base. Ni certificados AFIP, ni comprobantes, ni
fotos, ni legajos se recuperan con un `restore` de Supabase. Tampoco se puede restaurar **un cliente solo**: el
restore es del proyecto entero y lo deja caído mientras dura. Mitigación:
`.github/workflows/backup-storage.yml` baja todos los buckets a diario con el CLI de Supabase y los deja como
artifact de GitHub, **90 días de retención** (contra los 7 del plan Pro). Usa el `SUPABASE_ACCESS_TOKEN` (token
de cuenta, no una key de datos) para no exponer una credencial de acceso a datos del negocio en GitHub Actions.
Secrets `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PROJECT_REF` ✅ **cargados**. Corrida real verificada: **13 buckets,
8 archivos**. Gotchas de la CLI verificados contra PROD: la ruta de storage lleva **tres barras** (`ss:///bucket`)
y `--experimental` es obligatorio.

🩸 **Gotcha de la primera corrida real (2026-09-22)**: el listado de buckets se parseaba como JSON, pero el CLI
de Supabase **no devuelve lo mismo en todos lados** — en una terminal local escupe `{"paths":[...]}` y en el
runner de GitHub escupe **texto plano**, un bucket por línea; parsear siempre como JSON con `jq` daba 0 aunque
el listado mostrara los 13 buckets. Encima, la primera corrida murió **muda**: con `bash -e` + `pipefail`,
`grep -v '^$'` devuelve 1 ante una entrada vacía y mataba el script antes de llegar al mensaje que iba a explicar
el problema. Se resolvió: el workflow **imprime la salida cruda** antes de parsear, contempla los dos formatos, y
**pinea la versión del CLI de Supabase** (con `@latest`, un cambio de formato futuro lo rompería otra vez en
silencio). Detalle completo en [[wiki/architecture/infraestructura]] ("Backups y continuidad").

---

## Proceso de deploy

### Frontend (automático)
```
Push a main → Vercel detecta → build automático → deploy
```

### Migraciones de DB (manual)
```bash
# 1. Crear migration
supabase migration new nombre_descriptivo

# 2. Escribir SQL en supabase/migrations/NNN_nombre.sql

# 3. Aplicar en DEV
supabase db push --project-ref gcmhzdedrkmmzfzfveig

# 4. Testear en DEV

# 5. Aplicar en PROD (solo después de testeo exitoso)
supabase db push --project-ref jjffnbrdjchquexdfgwq

# 6. Actualizar schema_full.sql
supabase db dump --project-ref jjffnbrdjchquexdfgwq > supabase/migrations/schema_full.sql
```

### Edge Functions (manual)
```bash
supabase functions deploy nombre-funcion --project-ref jjffnbrdjchquexdfgwq
# webhooks (Meta, TN, MELI, MODO, MP) — preservar verify_jwt=false:
supabase functions deploy tn-webhook --project-ref jjffnbrdjchquexdfgwq --no-verify-jwt
```

🐛 **El deploy de una Edge Function por CLI CONSERVA el `verify_jwt` que ya tenía la función desplegada** —
(2026-09-15, deploy de `marketplace-webhook`). No importa lo que diga el código nuevo ni si se pasa o no
`--no-verify-jwt`: `supabase functions deploy` no toca el flag si la función ya existía, hereda el que estaba
configurado en el dashboard/proyecto. `marketplace-webhook` tenía `verify_jwt: false` desde que aceptaba llamadas
sin auth (bug cerrado el 2026-09-14); tras redesplegar el código nuevo (que exige un usuario autenticado del mismo
negocio) el flag **siguió en `false`** — la EF quedaba con el guard nuevo pero sin exigir el JWT de entrada.
Se corrige con la **Management API**, no con la CLI:
```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<project-ref>/functions/<function-slug>" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_jwt": true}'
```
Verificar siempre con un GET/POST sin `Authorization`: `UNAUTHORIZED_NO_AUTH_HEADER` cuando `verify_jwt: true`
está realmente activo (no alcanza con mirar el flag en el dashboard sin probar la llamada real).

🛑 **Los workflows PROGRAMADOS de GitHub corren SIEMPRE la versión del archivo que está en `main`** (2026-09-22,
auditoría de seguridad `v1.229.0`) — no la de la rama donde vive el código, aunque el `workflow_dispatch` manual
sí pueda apuntarse a otra rama. Desplegar Edge Functions con un guard nuevo (por ejemplo, exigir el header
`x-cron-secret`) **antes** de mergear a `main` deja a los sweeps **programados** de GitHub Actions llamando sin
el secreto → 401 → **dejan de correr en silencio**, reintentos de NC de AFIP incluidos. Se frenó a tiempo antes
de ese deploy.

**Orden obligatorio cuando un cambio toca Edge Functions + workflows de GitHub juntos:**
```
1. Migraciones aditivas (nunca rompen lo que ya corre)
2. Merge a main (el workflow programado YA lee el header/secret nuevo)
3. Deploy de las Edge Functions con el guard nuevo
4. Verificar con un workflow REAL: gh workflow run <wf> --ref main
   (elegir uno que hoy sea no-op, p.ej. tn-stock-sync con 0 tiendas conectadas)
```

🛑 **Mergear `dev`→`main` NO despliega las Edge Functions.** En cada deploy a PROD, auditar que el código desplegado sea el del repo:

```bash
bash scripts/auditar-edge-functions.sh
```

Y la **paridad de policies por schema** (no solo `public`): el 2026-09-14 `public` y `cron` estaban idénticos, pero en `storage` a PROD le faltaban las políticas de 3 buckets (mig 419).

```sql
SELECT schemaname, count(*), md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' ORDER BY tablename, policyname)) FROM pg_policies GROUP BY schemaname ORDER BY schemaname;
```

Motivo: el 2026-09-14 la EF `emitir-factura` de PROD resultó ser la del 15/07, sin el lock anti doble emisión que el wiki daba por deployado desde el 20/08. Ver [[wiki/architecture/edge-functions]].

---

## Comandos útiles

```bash
npm run dev          # Dev server local
npm run build        # Build de producción
npm run preview      # Preview del build local
npm run lint         # TypeScript + ESLint
```

---

## Links relacionados

- [[wiki/development/workflow-git]]
- [[wiki/development/supabase-dev-vs-prod]]
- [[wiki/architecture/backend-supabase]]
- [[wiki/architecture/infraestructura]] — API keys legacy vs nuevas, backups y continuidad
- [[wiki/architecture/guards-server-side]] — auditoría de seguridad completa (Tanda G)
