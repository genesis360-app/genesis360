# Stokio — Workflow de Desarrollo

## Ambientes

| Ambiente | Supabase | Vercel | Branch |
|----------|----------|--------|--------|
| **PROD** | `jjffnbrdjchquexdfgwq` (actual) | stokio-tau.vercel.app | `main` |
| **DEV** | `gcmhzdedrkmmzfzfveig` | preview automático | `dev` |

---

## Reglas fundamentales

- **`main` = producción**. Nunca trabajar directo en `main`.
- **Todo desarrollo va en `dev`**. Cuando está listo → PR hacia `main`.
- **Claude Code nunca hace push a `main`**. Solo a `dev` o branches de feature.
- Cada feature importante → commit en `dev` → PR → merge a `main` → deploy automático.

---

## Flujo diario

```
1. Trabajar en rama dev
2. Hacer commits con Co-Authored-By: GNO <gaston.otranto@gmail.com>
3. Testear en DEV (Vercel preview — link en el dashboard de Vercel)
4. Cuando el batch de features está listo para producción:
   a. Aplicar migrations pendientes en PROD (ver historial en este archivo)
   b. Crear PR: dev → main  (ver comando abajo)
   c. Mergear PR → Vercel deploya automáticamente a producción
   d. Crear GitHub release vX.Y.Z (ver sección Releases)
```

### Crear y mergear PR a producción

```bash
# Crear PR
GH_TOKEN="ghp_..." "/c/Program Files/GitHub CLI/gh.exe" pr create \
  --base main --head dev \
  --title "vX.Y.Z — Descripción" \
  --body "## Qué entra..."

# Mergear (reemplazar N por el número del PR)
GH_TOKEN="ghp_..." "/c/Program Files/GitHub CLI/gh.exe" pr merge N --merge
```

El `GH_TOKEN` se obtiene del Windows Credential Manager (no está en `.env.local`):
```bash
git credential fill <<< "protocol=https\nhost=github.com" | grep password | cut -d= -f2
```

---

## Migraciones de base de datos

**Regla:** Toda modificación al schema se hace mediante un archivo SQL en `supabase/migrations/`.

### Crear nueva migración
```
supabase/migrations/
  001_initial_schema.sql
  002_cotizacion_y_precio_historico.sql
  003_clientes_y_rentabilidad.sql
  004_caja_cierre_real.sql
  005_nombre_descriptivo.sql  ← nueva migración
```
Usar numeración secuencial de 3 dígitos. Las migrations deben ser **idempotentes** (`IF NOT EXISTS`, `IF EXISTS`).

### Flujo obligatorio

```
1. Crear archivo  →  supabase/migrations/NNN_descripcion.sql
2. Aplicar en DEV →  (ver comando abajo)
3. Actualizar schema_full.sql
4. Commit + push a dev
5. Probar en DEV
6. Al mergear a main → aplicar en PROD + merge
```

**Claude Code no aplica migraciones en PROD** salvo que el usuario lo pida explícitamente al momento del deploy.

### Comandos para aplicar

**DEV** (`gcmhzdedrkmmzfzfveig`):
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/gcmhzdedrkmmzfzfveig/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"<SQL aquí>\"}"
```

**PROD** (`jjffnbrdjchquexdfgwq`) — solo al deployar a main:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/jjffnbrdjchquexdfgwq/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"<SQL aquí>\"}"
```

`SUPABASE_ACCESS_TOKEN` está en `.env.local`.

### Historial de migrations

| # | Archivo | Descripción | DEV | PROD |
|---|---------|-------------|-----|------|
| 001 | `001_initial_schema.sql` | Schema inicial completo | ✅ | ✅ |
| 002 | `002_cotizacion_y_precio_historico.sql` | Cotización USD y precio costo histórico | ✅ | ✅ |
| 003 | `003_clientes_y_rentabilidad.sql` | Módulo clientes + rentabilidad real | ✅ | ✅ |
| 004 | `004_caja_cierre_real.sql` | Caja: conteo real al cierre, diferencia, cerrado_por | ✅ | ✅ |
| 005 | `005_combos.sql` | Tabla combos (reglas de precio por volumen) | ✅ | ✅ |
| 006 | `006_ventas_numero_trigger.sql` | Trigger para auto-generar número de venta por tenant | ✅ | ✅ |
| 007 | `007_precio_moneda.sql` | Columnas precio_costo_moneda / precio_venta_moneda en productos | ✅ | ✅ |
| 008 | `008_gastos.sql` | Tabla gastos con RLS | ✅ | ✅ |
| 009 | `009_actividad_log.sql` | Tabla audit log con RLS (INSERT todos, SELECT owner/supervisor/admin) | ✅ | ✅ |
| 010 | `010_inventario_prioridad.sql` | Mover `prioridad` de `inventario_lineas` a `ubicaciones` | ✅ | ✅ |
| 011 | `011_reglas_inventario.sql` | `regla_inventario` en `tenants` (default FIFO) y `productos` (nullable override) | ✅ | ✅ |
| 012 | `012_ubicacion_disponible_surtido.sql` | `disponible_surtido` en `ubicaciones` — filtro de surtido en ventas | ✅ | ✅ |
| 013 | `013_aging_profiles.sql` | Tablas aging_profiles + reglas + función `process_aging_profiles()` | ✅ | ✅ |

### NUNCA
- ❌ Modificar tablas directamente en PROD sin pasar por DEV primero
- ❌ Hacer ALTER TABLE fuera de un archivo de migration
- ❌ Claude Code aplica migration en PROD sin pedido explícito del usuario

---

## Configurar ambiente DEV (una sola vez)

### 1. Crear proyecto Supabase DEV
1. Ir a https://supabase.com/dashboard → New project
2. Nombre: `stokio-dev`
3. Contraseña: elegir una segura (guardarla)
4. Región: South America (São Paulo)
5. Plan: Free

### 2. Aplicar el schema completo
1. En el nuevo proyecto → SQL Editor
2. Pegar y ejecutar el contenido de `supabase/schema_full.sql`

### 2b. Crear bucket de Storage
El bucket `productos` no se crea con SQL, hay que crearlo por API:
```bash
curl -X POST "https://{PROJECT_REF}.supabase.co/storage/v1/bucket" \
  -H "Authorization: Bearer {SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"id": "productos", "name": "productos", "public": true}'
```
Las políticas RLS del bucket ya están incluidas en `schema_full.sql`.

### 3. Obtener credenciales DEV
En Settings → API del proyecto DEV:
- `Project URL` → `VITE_SUPABASE_URL_DEV`
- `anon public` key → `VITE_SUPABASE_ANON_KEY_DEV`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY_DEV`

### 4. Actualizar .env.local
```env
# DEV (para desarrollo local)
VITE_SUPABASE_URL=https://NUEVO_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...DEV_KEY...

# PROD (guardar por separado, no usar localmente)
# VITE_SUPABASE_URL_PROD=https://jjffnbrdjchquexdfgwq.supabase.co
# VITE_SUPABASE_ANON_KEY_PROD=eyJ...PROD_KEY...
```

### 5. Configurar Vercel para preview en `dev`
1. En Vercel → Settings → Environment Variables
2. Agregar variables del proyecto DEV con scope: **Preview**
3. Las variables del proyecto PROD quedan con scope: **Production**
4. Vercel detecta automáticamente el branch `dev` → usa vars de Preview

---

## Crear usuario de prueba en DEV

En Supabase DEV → Authentication → Users → Invite user (o crear desde onboarding).

---

## Releases y versioning

Seguimos SemVer pre-launch: `v0.X.Y`
- **PATCH** (`v0.x.Y`): bugfixes
- **MINOR** (`v0.X.0`): features nuevos
- No usamos MAJOR hasta el lanzamiento público

### Historial de releases
| Versión | Descripción | Fecha |
|---------|-------------|-------|
| v0.12.0 | Búsquedas, config, movimientos, descuentos en ventas, fix métricas | 2026-03 |
| v0.13.0 | Combos, separar unidades, vuelto al Enter, fix número de venta | 2026-03 |
| v0.14.0 | Emails transaccionales (Resend), fix trigger ventas, ingresos con unidades en dashboard | 2026-03 |
| v0.15.0 | Crear producto desde foto (Claude Vision + Open Food Facts), fix flujo suscripción MP | 2026-03 |
| v0.16.0 | Branding centralizado (tailwind.config.js + CSS vars) + rebrand Genesis360 | 2026-03 |
| v0.17.0 | Export/Import data master + moneda en Excel de productos | 2026-03 |
| v0.18.0 | Módulo de gastos (egresos del negocio con categorías, filtros y stats) | 2026-03 |
| v0.18.1 | Importar datos maestros movido a Configuración → Importar | 2026-03 |
| v0.19.0 | Tab 'Inventario' en importar + reorden menú + Configuración ownerOnly + clientes mejorado | 2026-03 |
| v0.20.0 | Fix bucket storage 'productos' en DEV + fix fecha import inventario + botones unificados con BTN en brand.ts | 2026-03 |
| v0.21.0 | BTN unificados en toda la app + MP producción: crear-suscripcion con external_reference | 2026-03 |
| v0.22.0 | Historial de actividad (audit log): tabla actividad_log, logActividad() en 6 módulos, HistorialPage con timeline/filtros/export | 2026-03 |
| v0.23.0 | Walkthrough interactivo 11 slides (auto-launch + re-trigger desde sidebar) + fix etiquetas medios de pago en métricas | 2026-03 |
| v0.24.0 | Keyboard shortcuts + fix historial caja FK + audit log caja + tipo comercio unificado + banner ubicación + precio tachado carrito + dot live caja | 2026-03 |
| v0.25.0 | Prioridad ubicaciones + reglas FIFO/FEFO/LEFO/LIFO/Manual + disponible_surtido + aging profiles | 2026-03 |

### Crear release
```bash
GH_TOKEN="ghp_..." "/c/Program Files/GitHub CLI/gh.exe" release create vX.Y.Z \
  --target dev \
  --title "vX.Y.Z — Título descriptivo" \
  --notes "## Novedades..." \
  --prerelease
```

**Nota legacy** — también se puede con curl:
```bash
# Tag manual (solo si no se usa gh CLI)
git tag -a v0.X.Y -m "Descripción del release"
git push origin v0.X.Y

# GitHub Release (via API)
curl -s -X POST "https://api.github.com/repos/tongas86/stokio/releases" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tag_name": "v0.X.Y",
    "name": "v0.X.Y — Nombre del release",
    "body": "## Cambios\n- Feature 1\n- Feature 2",
    "draft": false,
    "prerelease": true
  }'
```

---

## Estructura de branches

```
main          ← producción (solo merges desde dev via PR)
dev           ← desarrollo activo
feature/xxx   ← features grandes (opcional, se mergean a dev)
fix/xxx       ← hotfixes urgentes (pueden ir directo a main en emergencias)
```
