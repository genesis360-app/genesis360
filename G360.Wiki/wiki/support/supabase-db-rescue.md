---
title: Supabase — Soporte y rescate de la DB
category: support
tags: [supabase, database, soporte, emergencia, pool, conexiones]
updated: 2026-05-13
---

# Supabase — Soporte y rescate de la DB

Referencia rápida para diagnosticar y resolver problemas de base de datos en producción y DEV.

**Proyectos:**
- DEV: `gcmhzdedrkmmzfzfveig` — `https://supabase.com/dashboard/project/gcmhzdedrkmmzfzfveig`
- PROD: `jjffnbrdjchquexdfgwq` — `https://supabase.com/dashboard/project/jjffnbrdjchquexdfgwq`

**Ver también:**
- [[wiki/architecture/backend-supabase]] — arquitectura general del backend
- [[wiki/development/supabase-dev-vs-prod]] — reglas DEV vs PROD y flujo de migraciones
- [[wiki/database/migraciones]] — historial completo de migraciones

---

## 1. Diagnóstico rápido

### ¿El proyecto está caído?

Dashboard Supabase → indicador de salud → debe decir **"Healthy"**.  
Si dice **"Unhealthy"** o hay un banner de recursos agotados → hay un problema activo.

### Ver logs de errores

`Dashboard → Logs → Postgres logs` → filtrar por `ERROR` o `FATAL`.

- Errores repetidos cada pocos segundos = **query en loop** desde el frontend (setInterval con query rota)
- Error único + lentitud = query sin índice o tabla grande sin filtro

### Ver conexiones activas

```sql
SELECT pid, state, query_start, left(query, 80) AS query
FROM pg_stat_activity
WHERE datname = 'postgres' AND pid <> pg_backend_pid()
ORDER BY query_start;
```

### Contar conexiones por estado

```sql
SELECT count(*), state
FROM pg_stat_activity
WHERE datname = 'postgres'
GROUP BY state;
```

Si hay muchas en `idle` o `active` → pool saturado → ver acciones de rescate.

---

## 2. Acciones de rescate

### A. Matar conexiones idle (sin reiniciar el proyecto)

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'postgres'
  AND pid <> pg_backend_pid()
  AND state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)');
```

### B. Cancelar queries activas lentas (más de 5 minutos)

```sql
SELECT pg_cancel_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
  AND query_start < NOW() - INTERVAL '5 minutes'
  AND pid <> pg_backend_pid();
```

### C. Ver queries lentas en este momento

```sql
SELECT pid, now() - query_start AS duracion, left(query, 100) AS query
FROM pg_stat_activity
WHERE state = 'active'
  AND query_start < NOW() - INTERVAL '10 seconds'
  AND pid <> pg_backend_pid()
ORDER BY duracion DESC;
```

### D. Reiniciar el proyecto (nuclear — cuando nada más funciona)

**Opción 1 — Dashboard (recomendado si el SQL no responde):**
`Settings → General → Restart project` → confirmar.
Tarda ~60 segundos. Mata todas las conexiones y reinicia PostgreSQL.

**Opción 2 — MCP (desde Claude Code):**
```
mcp__claude_ai_Supabase__pause_project  → project_id
mcp__claude_ai_Supabase__restore_project → project_id
```

> ⚠ Usar solo en DEV o cuando no hay usuarios activos en PROD. El restart deja la DB inaccesible durante ~60s.

---

## 3. Cómo identificar la query problemática

Los dos síntomas más comunes y su origen:

| Síntoma | Causa probable |
|---|---|
| Mismo error repetido cada 30s | `setInterval` en frontend con query que usa columna inexistente |
| Pool saturado pero DB "Healthy" | Query fallida en loop agotó los slots de conexión |
| DB lenta pero sin errors | Query sin índice sobre tabla grande |

**Pasos para encontrar la query del frontend:**
1. Copiar el mensaje de error del log (ej: `column X.Y does not exist`)
2. Buscar el nombre de columna en el código fuente: `grep -r "Y" src/`
3. Verificar si la query corre en un `setInterval`, `useEffect` sin dependencias, o `useQuery` con `staleTime: 0`
4. Corregir la columna o agregar la columna faltante en la DB

**Caso real (2026-05-13):**
- `ventas_externas_logs.created_at` → la tabla tiene `procesado_at`. AppLayout corría esta query cada 30s → saturó el pool.
- `estados_inventario.es_default` → columna inexistente en esa tabla. ReportesPage la pedía en cada carga.

---

## 4. Mantenimiento preventivo

### Ver tablas más grandes

```sql
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

### Ver índices faltantes

```sql
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public' AND n_distinct > 100
ORDER BY n_distinct DESC;
```

### VACUUM (liberar espacio de filas eliminadas)

```sql
VACUUM ANALYZE;
```

### Ver tamaño del connection pool

El plan gratuito/pequeño de Supabase tiene **60 conexiones** via PgBouncer (pool compartido).
Si hay más de 50 conexiones activas simultáneas → riesgo de saturación.

---

## 5. Checklist al detectar DB lenta o caída

1. [ ] Ir al dashboard → verificar estado del proyecto
2. [ ] Revisar logs de Postgres → buscar errores repetidos
3. [ ] Correr `pg_stat_activity` para ver conexiones y queries activas
4. [ ] Si hay queries en loop → identificar el archivo del frontend y corregir
5. [ ] Matar conexiones idle con `pg_terminate_backend`
6. [ ] Si el SQL tampoco responde → **Restart project** desde el dashboard
7. [ ] Verificar que la app vuelva a funcionar (abrir pestaña nueva, hard reload)
8. [ ] Pushear el fix del frontend para evitar que vuelva a ocurrir
