---
title: Notificaciones
category: features
tags: [notificaciones, campana, alertas, push, email, v1.5.0]
sources: [CLAUDE.md]
updated: 2026-05-05
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
  action_url TEXT    -- URL a la que navegar al hacer click
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

| Evento | Tipo | Destinatarios |
|--------|------|--------------|
| Diferencia apertura caja | `warning` | OWNER + SUPERVISOR |
| *(futuro)* Stock crítico | `danger` | OWNER + SUPERVISOR |
| *(futuro)* Venta CC sin cobrar vencida | `warning` | OWNER |

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
