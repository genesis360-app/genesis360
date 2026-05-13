---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.8.3** ✅ · DEV: **v1.8.14** (pendiente PR → PROD)

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV — v1.8.14 (al cierre de sesión 2026-05-13)

- APP_VERSION: `v1.8.14` en `src/config/brand.ts` ✅
- Migrations DEV: 001–099 ✅
- Migrations PROD: 001–092 ✅ (093–099 pendientes — aplicar al deployar)
- Edge Functions DEV: todas activas (`invite-user`, `cancel-suscripcion`, `ai-assistant`, etc.)
- Edge Functions PROD: desactualizadas (falta `invite-user`, `cancel-suscripcion`, `ai-assistant`)
- GROQ_API_KEY: DEV ✅ · PROD ❌

---

## Migrations pendientes en PROD (093–099)

| # | Archivo | Descripción |
|---|---------|-------------|
| 093 | `093_ordenes_compra_sucursal.sql` | `ordenes_compra.sucursal_id` |
| 094 | `094_users_sucursal_permisos.sql` | `users.sucursal_id` + `puede_ver_todas` + índice |
| 095 | `095_oc_derivadas_reembolso.sql` | `ordenes_compra.oc_padre_id/es_derivada/tiene_reembolso_pendiente` |
| 096 | `096_oc_costo_envio_contactos_proveedor.sql` | `ordenes_compra.tiene_envio/costo_envio` + tabla `proveedor_contactos` |
| 097 | `097_gastos_recurso_cuotas.sql` | `gastos.recurso_id/es_cuota/cuotas_total/monto_cuota/tasa_interes` + tabla `gasto_cuotas` |
| 098 | `098_ventas_costo_envio.sql` | `ventas.costo_envio` |
| 099 | `099_notificaciones_metadata.sql` | `notificaciones.metadata JSONB` |

---

## Lo producido en esta sesión (v1.8.7 → v1.8.14 DEV)

### Fixes críticos operativos

**Caja — Solicitudes CAJERO a Caja Fuerte (aprobación real)**
- Bug fix crítico: `enviarSolicitudFuerte` insertaba con `tipo: 'solicitud_caja_fuerte'` (viola CHECK), sin `user_id`, sin `titulo`, campo `leido` en lugar de `leida` → siempre fallaba silenciosamente
- Corregido: notifica a OWNER/SUPERVISOR/SUPER_USUARIO del tenant con `tipo: 'warning'` y `metadata` JSONB
- `NotificacionesButton`: detecta `metadata.accion === 'solicitud_caja_fuerte'` → muestra botones "Aprobar"/"Rechazar"
  - Aprobar: valida sesión abierta → ejecuta egreso en caja cajero + ingreso en caja fuerte → marca leída
  - Rechazar: solo marca leída + toast

**Inventario — Multi-sucursal (fix LPNs)**
- `inventario_lineas` INSERT en `ingresoMutation` omitía `sucursal_id` → LPNs creados sin sucursal → filtrar por sucursal mostraba 0 unidades
- Fix: `sucursal_id: sucursalId ?? ingresoSucursalId ?? null` en INSERT
- Para OWNER en vista global: selector ámbar en el form de ingreso
- `LpnAccionesModal`: fix selector sucursal (`sucursalDestino: string | null` en lugar de `string`, opción "Sin sucursal" explícita, `??` en lugar de `||` en `sucursalFinal`)

**Envíos — Selector venta**
- Selector "Nueva venta" excluye ventas que ya tienen un envío asignado

**IA Asistente — system prompt**
- Reescrito con los 20 módulos del sidebar en orden correcto, botones exactos y roles actualizados (SUPER_USUARIO)

### Dashboard General — rediseño completo

Nueva arquitectura: tab General con sub-navegación de área. 9 áreas implementadas:

| Área | Componente | KPIs | Gráficos principales |
|------|-----------|------|---------------------|
| Ventas | `DashVentasArea` | 4 | Funnel + Heatmap días×horas + Pie canales |
| Gastos | `DashGastosArea` | 4 | Pie categorías + Barras mensuales + Top 5 destinos |
| Productos | `DashProductosArea` | 6 | Scatter Cuadrante Mágico + Pareto 80/20 + Pie cat + Tijera precios |
| Inventario | `DashInventarioArea` | 8 | Dona patrimonio + Gauge SVG salud + Aging barras + Recursos apilados + Combos bloqueados |
| Clientes | `DashClientesArea` | 6 | Pirámide RFM + Cohort analysis + Origen + Aging CC |
| Proveedores | `DashProveedoresArea` | 8 | Donut top proveedores + Aging OC + Evolución gastos |
| Facturación | `DashFacturacionArea` | 6 | Barras IVA apiladas + Donut alícuotas + banner legal |
| Envíos | `DashEnviosArea` | 6 | Funnel pipeline + Courier 100% barras + Scatter subsidio/ganancia |
| Marketing | `DashMarketingArea` | 6 | POAS real + Evolución inversión/ganancia + Donut canal + Radar campañas |

**Detalles técnicos relevantes:**
- recharts `^3.8.0`: `Treemap` con `content={<Comp/>}` crashea en v3 → reemplazado por barras horizontales con divs en `DashInventarioArea`
- Supabase JS: filtros en tablas unidas via `.eq('joined_table.col', val)` NO funcionan → siempre hacer dos queries separados
- `DashProductosArea`: período default `'trimestre'` para mostrar datos por defecto
- `DashFacturacionArea`: topes de Monotributo son estimaciones aproximadas al año 2024 — actualizar anualmente

### DB (migration 099)
- `notificaciones.metadata JSONB` — payload estructurado para acciones en notificaciones (aprobación caja fuerte, etc.)

---

## Para la próxima sesión — prioridad 1

### 1. Deploy a PROD (v1.8.14)
Checklist completo:
- [ ] PR `dev → main` con título `v1.8.14 — Dashboard General + fixes multi-sucursal, caja, envíos`
- [ ] Aplicar migrations 093–099 en PROD (`jjffnbrdjchquexdfgwq`)
- [ ] Deploy EF `invite-user` en PROD
- [ ] Deploy EF `cancel-suscripcion` en PROD
- [ ] Deploy EF `ai-assistant` en PROD (system prompt mejorado incluido)
- [ ] Configurar secret `GROQ_API_KEY` en PROD
- [ ] GitHub release v1.8.14
- [ ] Bump APP_VERSION a v1.8.15 en dev (próximo ciclo)

### 2. Dashboard General — specs pendientes de cada área
El dashboard tiene 9 áreas funcionales, pero los insights son aproximaciones. Cada área tiene 150 insights documentados en los specs del usuario que se pueden implementar progresivamente.

---

## Backlog — próximas sesiones

### Dashboard (continuación)
- **Specs de KPIs por área** pendientes de recibir y validar contra datos reales del tenant
- **Tab "Gráficos"** — placeholder activo, definir contenido (todos los gráficos en un lugar)
- **Topes de Monotributo** en `DashFacturacionArea` — actualizar anualmente (valores son aprox. 2024)

### Funcionalidad
- **Envíos proveedor logístico**: mejorar UI cotizador (Andreani/OCA) cuando haya APIs disponibles
- **GS1 Argentina**: integrar en `scan-product` EF cuando usuario tenga credenciales
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas
- **WMS Fase 3** — `wms_tareas` (putaway/picking/replenishment)

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar créditos en console.anthropic.com para `scan-product` (Claude Haiku ~$0.0003/img)
- Constitución empresa → CUIT activo (bloquea AFIP en PROD real)
- Google Ads Standard Token (proceso largo)
- Iniciar proceso de membresía GS1 Argentina (gs1ar.org) para lookup de barcodes nacionales

---

## Referencias técnicas clave

### Componentes Dashboard General
```
src/components/
├── DashVentasArea.tsx        # área Ventas — POAS, Funnel, Heatmap, Pie canales
├── DashGastosArea.tsx        # área Gastos — Pie cat, barras mensuales, Top 5
├── DashProductosArea.tsx     # área Productos — Scatter, Pareto, Pie, Tijera
├── DashInventarioArea.tsx    # área Inventario — Dona, Gauge SVG, Aging, Combos
├── DashClientesArea.tsx      # área Clientes — RFM, Cohort, Origen, Aging CC
├── DashProveedoresArea.tsx   # área Proveedores — Donut, Aging OC, Evolución
├── DashFacturacionArea.tsx   # área Facturación — IVA, Alícuotas, Topes
├── DashEnviosArea.tsx        # área Envíos — Funnel, Courier, Scatter subsidio
└── DashMarketingArea.tsx     # área Marketing — POAS real, Evolución, Radar
```

### Gotchas recharts v3 (`^3.8.0`)
- `Treemap content={<Comp/>}` → **CRASHEA**. Usar divs custom o función render.
- `Tooltip formatter={(v, name) => ...}` → `name` es `any` en v3, no `string`
- `Legend` dentro de `BarChart` con layout="vertical" funciona correctamente

### Gotchas Supabase JS
- `.eq('joined_table.col', val)` después de join **NO funciona** → hacer 2 queries separados
- `!inner` en select string (`tabla!inner(cols)`) es válido, pero filtrar en esa tabla via `.eq()` no
- `.select('*', { count: 'exact', head: true })` → destructurar `{ count }`, no `{ data: { count } }`

### Edge Functions DEV (activas)
| EF | Auth | Descripción |
|---|---|---|
| `invite-user` | JWT-less | Invita usuario, crea perfil. Roles: OWNER, SUPER_USUARIO, ADMIN |
| `cancel-suscripcion` | JWT | PATCH preapproval MP + actualiza tenant |
| `ai-assistant` | JWT-less | Groq/Llama 3.1 — chat + bug report (system prompt actualizado) |
| `scan-product` | JWT-less | Claude Haiku + Open Food Facts — escaneo foto producto |
| `send-email` | JWT | Resend — invitaciones + bug reports |
| `emitir-factura` | JWT | AFIP factura electrónica |
| `crear-suscripcion` | JWT-less | MP preapproval |
| `mp-webhook` | JWT-less | Webhooks MP |
| `data-api` | JWT | API pull externa |
| `tn-stock-worker` | JWT-less | Sync stock TiendaNube |
| `meli-stock-worker` | JWT-less | Sync stock MercadoLibre |

### Roles del sistema
| Rol | `puedeVerTodas` | Acceso |
|-----|----------------|--------|
| OWNER | Siempre sí | Total |
| ADMIN | Siempre sí | Solo plataforma (`/admin`) |
| SUPER_USUARIO | Sí por DB | Igual que OWNER dentro del tenant |
| SUPERVISOR | Sí por DB | Sin config/usuarios |
| CONTADOR | Sí por DB | Dashboard/gastos/reportes |
| CAJERO | No | Solo ventas/caja/clientes |
| DEPOSITO | No | Solo inventario/productos |
| RRHH | No | Solo módulo RRHH |

### Supabase projects
- PROD: `jjffnbrdjchquexdfgwq`
- DEV: `gcmhzdedrkmmzfzfveig` · Tenant dev: `5f05f3eb-6757-4f60-b9d2-8853fdfae806`

### pg_cron activo DEV+PROD
- `tn-stock-sync`: cada 5 min
- `meli-stock-sync`: cada 5 min
- `notif-cc-vencidas`: diario 09:00 AR

### PDF Factura QR AFIP (RG 4291)
- `src/lib/facturasPDF.ts`: QR = `btoa(JSON.stringify(payload))` → `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- tipoCmp: A=1 · B=6 · C=11 · NC-A=3 · NC-B=8 · NC-C=13
