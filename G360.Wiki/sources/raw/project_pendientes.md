---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.10.2** ✅ · DEV: **v1.10.2** + ISS-194 (sin versionar aún)

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV / PROD — cierre sesión 2026-05-28

| | DEV | PROD |
|---|---|---|
| APP_VERSION | `v1.10.2` | `v1.10.2` |
| Migrations | 001–150 ✅ | 001–150 ✅ |
| Branch | `dev` (1 commit adelante: ISS-194) | `main` (commit `cc5c2073`) |
| Vercel | preview auto desde `dev` | PROD deploy v1.10.2 |

**Migrations DEV pendientes de aplicar en PROD:** ninguna (ISS-194 no requiere migration)

---

## Backlog — pendientes próxima sesión

### Features grandes (requieren relevamiento o diseño antes de implementar)

| ID | Módulo | Descripción | Complejidad |
|---|---|---|---|
| ISS-127 | Config + Inventario | Perfiles de códigos de barra/QR compuestos: configurar campos (SKU, Lote, Vencimiento, Cantidad, etc.) y leer/escribir ese código en ingreso y rebaje de stock | Alta — nuevo subsistema |
| ISS-137 | Config | Evaluación: integración con Google Drive como almacenamiento propio del cliente para documentos/imágenes | Requiere evaluación primero |
| ISS-174 | Ventas + Envíos | Servicio de envío como select (igual que en módulo Envíos) + cotización automática por API de cada courier (precio + disponibilidad según servicio, dirección y fecha) | Alta — depende APIs externas |
| ISS-178 | Ventas + Config | Rango horario acordado para entrega: selector en modal envío de Ventas. Rangos configurables en Config/Envíos con defaults (8-13, 13-18, 18-22), editables/eliminables | Media-alta |

### Deuda técnica / pendientes abiertos

| Área | Descripción |
|---|---|
| RRHH | Vincular `empleados.user_id` en UI para reactivar "Mi Equipo" del SUPERVISOR (relevamiento RRHH A5) |
| Gastos | Crash en GastosPage — pendiente stack trace Sentry del ErrorBoundary instrumentado |
| Relevamientos | 5 HTMLs generados (Ventas / RRHH / Clientes / Compras / Envíos) esperando respuestas de GO + socio |

---

## Historial de lotes 2026-05-28

### Lote 1 — commit `f96fd4d1` · release `dev-2026-05-28-lote-iss`

| ID | Módulo | Fix |
|---|---|---|
| ISS-140/141 | Config | Scrollbar oculto en sub-tabs Ventas e Inventario |
| ISS-149 | Gastos | Descuento OC acepta $ o % con toggle |
| ISS-152 | Gastos | `cajasAbiertasOC` filtra por sucursal activa (client-side) |
| ISS-172 | Envíos | KM haversine redondeado a entero |
| ISS-173 | Ventas | "Ya cobrado" → "Seña cobrada" cuando saldo > 0 |
| ISS-177 | Ventas | $/km modal envío es read-only |
| ISS-179 | Config | Form crear ubicación incluye sucursal, Mono-SKU y dims WMS |
| ISS-181 | Config | Comprobantes: reglas mutuamente excluyentes + texto más claro |
| ISS-194 | Caja | ~~Confirmado ya implementado~~ **REFIX**: default `caja_fuerte_roles=['DUEÑO']`; SUPERVISOR/SUPER_USUARIO como toggles habilitables |

### Lote 2 — commits `07d306c5` + `9ba1e3f9` · release `dev-2026-05-28-lote2-iss`

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| ISS-135 | Config | `metodos_pago`: toggles POS/Gastos; VentasPage y GastosPage filtran por flag | 149 |
| ISS-142 | Config + Ventas | `cliente_obligatorio`/`creacion_inline`/`datos_minimos` conectados al POS | — |
| ISS-180 | Config | Unidades predefinidas no eliminables (lock) + validación duplicados | 148 |
| ISS-190 | Gastos | Badges "Sin pagar"/"Pago parcial" + modal pago parcial con movimiento en caja | 150 |

---

## Para el próximo deploy a PROD

Checklist obligatorio:
1. Bump `APP_VERSION` en `src/config/brand.ts` a `v1.10.3` (o v1.11.0 si se agrega feature)
2. PR `dev → main` con título `vX.Y.Z — descripción`
3. GitHub release `vX.Y.Z` sobre `main` como `--latest`
4. Actualizar este archivo + `log.md` + `roadmap.md`

**Nota para tenants existentes (ISS-194):** al deployar, avisar que deben ir a Config → Caja → Acceso a Caja Fuerte y desactivar SUPERVISOR/SUPER_USUARIO si no los quieren habilitados (el valor viejo queda guardado en DB).
