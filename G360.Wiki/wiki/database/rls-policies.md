---
title: Políticas RLS
category: database
tags: [rls, postgresql, seguridad, multi-tenant, policies]
sources: [CLAUDE.md]
updated: 2026-04-30
---

# Políticas RLS (Row Level Security)

RLS aísla los datos de cada tenant. Habilitado en **todas** las tablas de negocio.

---

## Patrón estándar

```sql
-- ✅ SIEMPRE usar subquery (performance)
CREATE POLICY "tenant_isolation" ON tabla
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- ❌ NUNCA funciones en USING (PostgreSQL no puede optimizarlas)
CREATE POLICY "bad_policy" ON tabla
  USING (tenant_id = get_tenant_id());
```

---

## Funciones helper SECURITY DEFINER

```sql
is_admin()
-- TRUE si el usuario tiene rol ADMIN globalmente
-- Usado en políticas que requieren permisos amplios

is_rrhh()
-- TRUE si el usuario tiene rol RRHH o OWNER
-- Usado en tablas del módulo RRHH

get_supervisor_team_ids()
-- Retorna array de empleado_id donde supervisor_id = auth.uid()
-- Usado en políticas SUPERVISOR para limitar vista a su equipo
-- STABLE para que PostgreSQL pueda cachearla en la query
```

---

## Políticas por tipo de tabla

### Tablas de negocio estándar

```sql
-- Lectura y escritura solo para el propio tenant
USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
```

Aplica a: `productos`, `inventario_lineas`, `movimientos_stock`, `ventas`, `venta_items`, `caja_sesiones`, `caja_movimientos`, `gastos`, `clientes`, `proveedores`, etc.

### Tablas RRHH (acceso restringido por rol)

```sql
-- Solo OWNER y RRHH (via is_rrhh())
USING (
  tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  AND is_rrhh()
)
```

Aplica a: `empleados`, `rrhh_salarios`, `rrhh_conceptos`, `rrhh_documentos`, `rrhh_capacitaciones`.

### Políticas SUPERVISOR (PERMISSIVE — se suman)

```sql
-- Política adicional: SUPERVISOR ve solo su equipo
CREATE POLICY "supervisor_team" ON rrhh_asistencia
  AS PERMISSIVE FOR SELECT
  USING (empleado_id IN (SELECT id FROM get_supervisor_team_ids()));
```

Aplica a: `rrhh_asistencia`, `rrhh_vacaciones_solicitud`, `rrhh_vacaciones_saldo`, `empleados` (SELECT).

### Tablas de Storage

```sql
-- Bucket productos: el archivo debe estar en path con tenant_id del usuario
DELETE ONLY IF split_part(name, '/', 1) = tenant_id_del_usuario
```

Buckets con RLS por tenant: `productos`, `empleados`, `archivos-biblioteca`, `certificados-afip`, `comprobantes-gastos`, `etiquetas-envios`.

Bucket `avatares`: RLS por `auth.uid()` (cada usuario solo ve/edita el suyo).

### Edge Functions públicas (sin JWT)

Las Edge Functions que reciben webhooks externos no validan JWT:
- `mp-webhook`, `mp-ipn`, `tn-webhook`, `meli-oauth-callback`, `tn-oauth-callback`
- `mp-oauth-callback`, `birthday-notifications`, `monitoring-check`, `marketplace-api`

Estas usan `SUPABASE_SERVICE_ROLE_KEY` internamente para acceder a los datos con bypass de RLS.

---

## Orden correcto del schema

Al crear nuevas tablas:
```
1. Tablas helper
2. tabla planes
3. tabla tenants
4. tabla users
5. funciones (is_admin, is_rrhh, etc.)
6. resto de tablas
7. triggers
8. políticas RLS
```

---

## Cómo crear una nueva política

```sql
-- Patrón seguro (IF NOT EXISTS no existe en PostgreSQL)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mi_tabla' AND policyname = 'mi_policy'
  ) THEN
    CREATE POLICY "mi_policy" ON mi_tabla
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
```

---

## Política DELETE en tabla users (migration 113)

La tabla `users` no tenía política DELETE — RLS bloqueaba silenciosamente todo `DELETE` (0 filas, sin error). Esto impedía "Salir del negocio" y "Eliminar cuenta".

```sql
-- El usuario puede eliminar su propio registro
CREATE POLICY users_delete_self ON users
  FOR DELETE USING (id = auth.uid());

-- DUEÑO/ADMIN puede eliminar usuarios de su tenant
CREATE POLICY users_delete_owner ON users
  FOR DELETE USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['DUEÑO', 'ADMIN'])
  );
```

> [!WARNING] Sin política DELETE explícita, PostgreSQL con RLS deniega silenciosamente. Siempre verificar que el resultado del DELETE fue > 0 filas.

---

## Links relacionados

- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/database/schema-overview]]
- [[wiki/database/migraciones]]
