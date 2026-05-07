---
name: api_plan
description: Plan de APIs internas — pull API + exportaciones manuales (fase 1 aprobada, pendiente implementar)
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Scope aprobado (Fase 1)

- ✅ API pull (EF `data-api`) — solo maestros
- ✅ Exportar JSON/CSV desde UI (ProductosPage, ClientesPage)
- ✅ Documentación inline básica (tabla estática)
- ❌ Webhooks push — fase 2
- ❌ Endpoints de escritura — fase 2
- ❌ SDK cliente — fase 2

---

## Migration 086 (pendiente)

```sql
-- API keys por tenant
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,   -- primeros 8 chars para display (ej: "g360_ab1")
  key_hash     TEXT NOT NULL,   -- SHA-256 de la clave completa (nunca plain text)
  permisos     TEXT[] DEFAULT ARRAY['read'],
  activo       BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
RLS: tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
```

Tabla `tenant_webhooks` y `webhook_logs` → fase 2 (no implementar en v1).

---

## Edge Function `data-api` (pendiente)

**Auth:** Header `X-API-Key: g360_xxxxxxxxxxxxxxxx`

**Endpoint:** `GET /data-api?entity=productos&format=json&limit=100&offset=0&updated_since=ISO`

**Entidades disponibles (solo maestros):**

| entity | campos |
|---|---|
| `productos` | id, nombre, sku, precio_venta, precio_costo, stock_actual, categoria, unidad_medida, activo |
| `clientes` | id, nombre, dni, telefono, email, domicilio, saldo_cc |
| `proveedores` | id, nombre, cuit, contacto, email, saldo_cc |
| `inventario` | lpn, producto, cantidad, ubicacion, estado, lote, vencimiento |

**Parámetros:**
- `entity` — obligatorio
- `format` — json (default) | csv
- `limit` — default 100, máx 1000
- `offset` — default 0
- `updated_since` — ISO timestamp para sync incremental
- `sucursal_id` — filtrar por sucursal (opcional)

**Rate limiting:** 120 req/min por API key en memoria del isolate.

**Seguridad:**
- Clave: `g360_` + 32 chars random → se muestra solo una vez al crear
- Se guarda solo el hash SHA-256 en DB
- Lookup: hash de la key recibida → buscar en `api_keys` → verificar tenant_id + activo
- Actualizar `last_used_at` en cada request exitoso

---

## UI — ConfigPage tab "API" (pendiente)

Nueva tab `api` en ConfigPage (icono `Key`), solo OWNER/ADMIN.

**Sección 1 — Mis API Keys:**
- Tabla: nombre, prefijo (g360_abc...), permisos, activo, last_used_at
- Crear: input nombre → genera clave → modal "Copiá la clave ahora, no se volverá a mostrar" con botón Copy
- Revocar: soft delete (`activo = false`)

**Sección 2 — Documentación (estática):**
- Base URL: `https://gcmhzdedrkmmzfzfveig.supabase.co/functions/v1/data-api`
- Tabla de entidades y parámetros
- Ejemplo curl por entidad

---

## Botones Exportar en UI (pendiente)

Páginas a modificar:
- `ProductosPage.tsx` — botón dropdown "↓ Exportar" → JSON / CSV
- `ClientesPage.tsx` — ídem
- `ProveedoresPage.tsx` — ya tiene descarga OC; agregar exportar maestro proveedores

Comportamiento: exporta los datos actualmente filtrados en pantalla (no hace nueva query).

---

## Notas de implementación

- Usar `crypto.subtle.digest('SHA-256', ...)` en Deno para hashear la API key (nativo, sin dependencias)
- `key_prefix` = primeros 8 chars del plain text para que el user identifique la key en la UI
- La EF `data-api` debe ser `--no-verify-jwt` (autenticación propia via header)
- `saldo_cc` en clientes/proveedores = llamar a `fn_saldo_proveedor_cc()` o calcular inline
- Para CSV: incluir BOM UTF-8 (`﻿`) para compatibilidad con Excel argentino
- Rate limit: Map en memoria del isolate (se resetea con cada cold start — suficiente para v1)

---

## Versión estimada: v1.7.0
