---
title: Notificaciones
category: features
tags: [notificaciones, campana, alertas, push, email, v1.5.0]
sources: [CLAUDE.md, migrations 373, 374]
updated: 2026-08-19
---

# Notificaciones

Sistema de notificaciones en tiempo real implementado en v1.5.0 (migration 084).

---

## Schema — tabla `notificaciones`

```sql
notificaciones(
  id, tenant_id, user_id,
  tipo CHECK('info','warning','danger','success'),
  titulo TEXT,
  mensaje TEXT,
  leida BOOLEAN DEFAULT FALSE,
  action_url TEXT,   -- URL a la que navegar al hacer click
  metadata JSONB     -- payload estructurado para acciones (v1.8.7, migration 099)
)
-- RLS: user_id = auth.uid() (cada usuario ve solo sus notificaciones)
```

---

## Componente `NotificacionesButton`

Reescrito en v1.5.0 con datos reales (antes era mock):
- Query a Supabase con `refetchInterval: 30_000`
- Badge rojo con conteo de no leídas
- Popover con lista de notificaciones
- `markRead(id)` — marca una como leída
- `markAllRead()` — marca todas como leídas

---

## Cómo se crean notificaciones

### Diferencia en apertura de caja

Si el monto de apertura ≠ monto sugerido (cierre anterior):
1. Warning inline en tiempo real (ámbar si diferencia leve, rojo si significativa)
2. Botón con confirmación en 2 pasos
3. Al confirmar → INSERT en `notificaciones` para cada usuario con rol OWNER o SUPERVISOR del tenant
4. Email automático vía EF `send-email` tipo `notificacion`

```typescript
// Para notificar a OWNER/SUPERVISOR:
const supervisores = await supabase
  .from('users')
  .select('id')
  .eq('tenant_id', tenantId)
  .in('rol', ['OWNER', 'SUPERVISOR'])

// INSERT en notificaciones por cada usuario
```

### Otras fuentes de notificaciones

| Evento | Tipo | Destinatarios | Acción en UI |
|--------|------|--------------|--------------|
| Diferencia apertura caja | `warning` | OWNER + SUPERVISOR | Ir → /caja |
| CC clientes vencida | `warning` | OWNER + ADMIN | Ir → /clientes |
| OC vencida sin pagar | `danger` | OWNER + ADMIN | Ir → /proveedores |
| Solicitud Caja Fuerte (CAJERO) | `warning` + `metadata` | OWNER + SUPERVISOR + SUPER_USUARIO | Aprobar / Rechazar (ejecuta transferencia real) |

### Notificaciones con metadata (v1.8.7+)

Cuando `metadata.accion === 'solicitud_caja_fuerte'`, `NotificacionesButton` muestra botones "Aprobar" y "Rechazar" en lugar del botón "Ir →". Al aprobar:
1. Valida que la sesión del cajero sigue abierta
2. Crea/obtiene la sesión permanente de la caja fuerte
3. Inserta `egreso_traspaso` en la sesión del cajero
4. Inserta `ingreso_traspaso` en la sesión de la caja fuerte
5. Marca la notificación como leída

> 💵 **G5 Fase 5 de Caja USD (migs 373+374, 2026-08-19, EN DEV, código TODAVÍA SIN COMMITEAR): moneda-aware
> de extremo a extremo.** `aprobarSolicitudCajaFuerte` ya NO rechaza en bloque las solicitudes en USD —
> resuelve la Caja Fuerte de la MISMA moneda que la sesión que pidió la transferencia, vía
> `ensureFuerteSesionId()` (`src/lib/cajaBoveda.ts`, reemplaza 4 bloques de código antes duplicados que
> nunca stampeaban `moneda` al crear/buscar esa sesión). Además, a quién se notifica una solicitud en USD
> se filtra (cableado en `CajaPage.tsx` al crear la notificación): solo DUEÑO + roles con permiso de operar
> Caja USD (`tenants.caja_usd_roles_permitidos`) — para no notificar a alguien que de todos modos no
> podría aprobarla (el trigger `fn_validar_rol_opera_caja_usd`, mig 371, la rechazaría igual). Ver
> [[wiki/features/caja]] → "Caja en USD — Fase 5 de 8".

Payload `metadata` de `solicitud_caja_fuerte`:
```json
{
  "accion": "solicitud_caja_fuerte",
  "monto": 1500,
  "concepto": "Para el cierre",
  "sesion_id": "uuid-sesion-cajero",
  "caja_id": "uuid-caja",
  "caja_nombre": "Caja 1",
  "cajero_nombre": "Juan Pérez"
}
```

---

## EF `send-email` — nuevo tipo `notificacion`

```typescript
{
  type: 'notificacion',
  to: email_del_usuario,
  data: {
    titulo: string,
    mensaje: string,
    action_url?: string   // opcional, link directo
  }
}
// → renderiza con notificacionTemplate()
```

---

## `caja_sesiones` — nuevos campos (migration 084)

```sql
caja_sesiones:
  monto_sugerido_apertura DECIMAL   -- cierre anterior de esa caja
  diferencia_apertura DECIMAL       -- monto_apertura - monto_sugerido
```

Ambos guardados al abrir la sesión. Visibles en el historial de sesiones (diferencia apertura y cierre mostradas por separado).

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/integrations/resend-email]]
- [[wiki/database/migraciones]]
