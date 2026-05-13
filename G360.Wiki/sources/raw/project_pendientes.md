---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.8.3** ✅ · DEV: **v1.8.13** (pendiente PR → PROD)

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV — v1.8.8 (al cierre de sesión 2026-05-12)

- APP_VERSION: `v1.8.8` en `src/config/brand.ts` (pendiente bump)
- Migrations DEV: 001–099 ✅
- Migrations PROD: 001–092 ✅ (093–099 pendientes — aplicar al deployar v1.8.8)
- Edge Functions DEV: todas activas (invite-user, cancel-suscripcion nuevas en esta sesión)
- Edge Functions PROD: desactualizadas (falta invite-user, cancel-suscripcion, ai-assistant)
- GROQ_API_KEY: DEV ✅ · PROD ❌

---

## Migrations resumen (093–098) — pendientes en PROD

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

## Lo producido en esta sesión (v1.8.6 DEV)

### Roles y usuarios
- Rol ADMIN de tenant renombrado a **SUPER_USUARIO** (ADMIN queda solo para admin de plataforma)
- EF `invite-user` deployada en DEV (faltaba) — agrega SUPER_USUARIO a roles permitidos
- EF `cancel-suscripcion` creada y deployada — cancela preapproval en MP + actualiza tenant
- MiCuentaPage: botón "Cancelar suscripción" (solo OWNER con plan activo)

### Recepciones
- Bug fix: detalle expandido ahora carga `recepcion_items` (antes no mostraba nada)
- Validaciones: `tiene_lote`, `tiene_vencimiento`, `tiene_series` antes de confirmar — auto-expande ítem con error
- Sucursal predeterminada sincronizada con header al abrir formulario
- Modal de resultado post-confirmación: tabla Esperado/Recibido/Diferencia
- Botones violeta: "Crear OC derivada" (oc_padre_id, precio_unitario=0) y "Solicitar reembolso → Gastos OC"

### Permisos multi-sucursal por usuario
- `users.sucursal_id` + `users.puede_ver_todas` (migration 094)
- authStore: `puedeVerTodas` — OWNER/ADMIN hardcoded global; resto desde DB
- Usuarios restringidos quedan bloqueados a su sucursal al loguearse
- AppLayout: selector visible solo para `puedeVerTodas`; restringidos ven nombre fijo
- UsuariosPage: toggle Globe + selector sucursal inline; updateRol auto-actualiza `puede_ver_todas`

### Caja
- Historial tab excluye sesiones de caja fuerte
- "Ingresar a Caja Fuerte": sin restricción de sesión activa (ingreso externo para OWNER)
- "Enviar a Caja": selector de caja destino (antes fijo en la caja activa)
- Historial en tab Caja Fuerte: ingresos + egresos coloreados
- CAJERO: botón "Caja Fuerte" → crea solicitud de notificación para OWNER/SUPERVISOR

### Inventario
- Historial de conteos: muestra quién hizo el conteo (`created_by`)
- Bulk actions en LPNs: barra desde 1 LPN — "Cambiar estado" + "Cambiar ubicación" (cross-producto)
- "Combinar" solo aparece si todos los LPNs son del mismo producto

### Envíos
- Cotizador: tabla con inputs de precio+días por courier; botón "Usar" pre-carga el formulario
- Domicilios cliente: edición inline por tarjeta + agregar nueva dirección inline (guarda en `cliente_domicilios`)

### Ventas
- Aviso visible cuando no hay sucursal seleccionada (inventario no filtrado)
- Toggle "Incluir envío" expandible con:
  - Tipo: monto fijo ($) o por KM (km × $/km → auto-calcula)
  - Dirección de entrega + botón 🗺 abre Google Maps con ruta
  - Costo aparece en totales como línea separada + suma al total a pagar
  - `ventas.costo_envio` guardado en DB; envío creado con destino y costo

### Productos
- Modal OC rápida: precio unitario read-only (antes era editable)

### Proveedores / OC
- OC: toggle "Con envío / Sin envío" + campo monto; detalle muestra subtotal+envío+total
- Contactos múltiples: sección "Contactos adicionales" en form — CRUD inline (nombre, puesto, email, teléfono)
- Tabla `proveedor_contactos` con RLS

### Recursos
- Tab "Patrimonio" → **"Recursos activos"**; tab "Por adquirir" → **"Recursos pendientes"**
- Al crear recurso con valor > 0 (y no pendiente_adquisicion): crea gasto automático en GastosPage tab Recursos
- Recursos activos: aplica filtro de sucursal activa

### Gastos
- Nueva tab **"Recursos"**: muestra gastos con `recurso_id`. Botón "Marcar como recibido" → recurso.estado = 'activo'
- **Cuotas con tarjeta de crédito**: toggle + selector de cuotas (2/3/6/9/12/18/24) + tasa de interés % + cálculo automático del monto por cuota. Genera N registros en `gasto_cuotas` con vencimientos mensuales.

### Documentación
- `app-reference.md`: revisión completa (7 tabs inventario, Estructuras ≠ combos, Kit vs Combo vs Estructura)
- `CLAUDE.md`: regla wiki-first para preguntas generales
- Roles en docs actualizados a SUPER_USUARIO

---

## Lo producido en esta sesión (v1.8.7 DEV)

### Envíos
- Selector de venta en "Nuevo envío" excluye automáticamente ventas que ya tienen envío asignado

### Caja — Solicitudes CAJERO (aprobación real)
- Fix bug crítico: `enviarSolicitudFuerte` antes insertaba con tipo inválido (`solicitud_caja_fuerte` viola CHECK), sin `user_id` y sin `titulo` → siempre fallaba silenciosamente
- Corregido: notifica a OWNER/SUPERVISOR/SUPER_USUARIO del tenant con `tipo: 'warning'` y `metadata` JSONB estructurado
- `NotificacionesButton`: detecta `metadata.accion === 'solicitud_caja_fuerte'` → muestra botones "Aprobar" / "Rechazar"
  - Aprobar: valida sesión abierta → obtiene/crea sesión permanente caja fuerte → egreso en caja cajero + ingreso en caja fuerte → marca leída
  - Rechazar: solo marca leída + toast

### Asistente IA — system prompt
- Reescrito con los 20 módulos del sidebar en orden exacto
- Botones y acciones clave de cada módulo
- Roles actualizados (SUPER_USUARIO en lugar de ADMIN, CAJERO correcto)

### DB (migration 099)
- `notificaciones.metadata JSONB` — payload estructurado para acciones en notificaciones

---

## Para la próxima sesión — prioridad 1

### 1. Deploy v1.8.6+v1.8.7 a PROD
Checklist completo:
- [ ] Bump `APP_VERSION` a `v1.8.7` en `src/config/brand.ts`
- [ ] PR `dev → main` con título `v1.8.7 — Ventas/Caja/IA mejoras`
- [ ] Aplicar migrations 093–099 en PROD (`jjffnbrdjchquexdfgwq`)
- [ ] Deploy EF `invite-user` en PROD
- [ ] Deploy EF `cancel-suscripcion` en PROD
- [ ] Deploy EF `ai-assistant` en PROD (system prompt mejorado incluido)
- [ ] Configurar secret `GROQ_API_KEY` en PROD
- [ ] GitHub release v1.8.7

---

## Backlog — próximas sesiones

### Pendientes de módulos trabajados esta sesión
- **Envíos proveedor logístico**: mejorar la UI del cotizador (Andreani/OCA) cuando haya APIs disponibles
- **GS1 Argentina**: integrar en `scan-product` EF cuando el usuario tenga credenciales (gepir.gs1.org — gestionar acceso en gs1ar.org)

### Backlog general
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas
- **Roadmap APIs** (pausado — ver `wiki/integrations/roadmap-apis.md`)
- **WMS Fase 3** — `wms_tareas` (putaway/picking/replenishment)

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar créditos en console.anthropic.com para `scan-product` (Claude Haiku ~$0.0003/img)
- Constitución empresa → CUIT activo (bloquea AFIP en PROD real)
- Google Ads Standard Token (proceso largo)
- Iniciar proceso de membresía GS1 Argentina (gs1ar.org) para lookup de barcodes nacionales

---

## Referencias técnicas clave

### Edge Functions DEV (activas)
| EF | Auth | Descripción |
|---|---|---|
| `invite-user` | JWT-less | Invita usuario, crea perfil. Roles: OWNER, SUPER_USUARIO, ADMIN |
| `cancel-suscripcion` | JWT | PATCH preapproval MP + actualiza tenant |
| `ai-assistant` | JWT-less | Groq/Llama 3.1 — chat + bug report |
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
