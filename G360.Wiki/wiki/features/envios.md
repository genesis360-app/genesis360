---
title: Módulo Envíos
category: features
tags: [envios, logistica, courier, remito, tracking, whatsapp, google-maps, km-auto, pod, transportista]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-05-23
---

# Módulo Envíos

Módulo de seguimiento de envíos y entregas. Implementado en v1.3.0 PROD ✅.  
**Última actualización:** v1.8.40 (2026-05-23) — POD, página transportista, pagos courier, QR remito.

**Página:** `src/pages/EnviosPage.tsx` (`/envios`)  
**Página transportista:** `src/pages/TransportistePage.tsx` (`/transporte/:token` — pública sin auth)  
**Acceso:** DUEÑO · SUPERVISOR · CAJERO

---

## Pestañas

1. **Envíos** — lista principal con filtros, expandible
2. **Pagos Courier** (v1.8.40) — pagos pendientes al courier con selección múltiple

---

## Funcionalidades

### Tab Envíos
- Lista de envíos con filtros: estado / courier / canal / fechas / búsqueda
- Fila expandible: destinatario completo, courier + tracking, productos + LPN + ubicación
- **Avanzar estados**: pendiente → despachado → en_camino → **en_bodega** → entregado
- **Cancelar** y registrar **devolución**
- **Generar remito PDF** con QR codes (envío + venta) y tabla con SKU/LPN/Ubicación
- Ver tracking externo en nueva pestaña
- Ver venta asociada con link directo
- Modal nuevo/editar: vincular venta, domicilio del cliente, courier/tracking/dimensiones, POD
- **Compartir con transportista**: genera token único + link mobile-first sin login
- **Bloqueo de progresión si costo no pagado** (ISS-171): si `costo_cotizado > 0 AND costo_pagado = false` no permite avanzar estado

### Tab Pagos Courier (ISS-169)
- Lista todos los envíos con `costo_cotizado > 0 AND costo_pagado = false`
- Filtro por sucursal aplicado
- Checkbox individual + "Seleccionar todo"
- Medio de pago (Efectivo / Transferencia / Débito / Crédito / Otro)
- Fecha de pago
- Total dinámico de seleccionados
- "Marcar como pagados" actualiza `costo_pagado=true + fecha_pago_courier + medio_pago_courier`
- Badge naranja en la pestaña con cantidad pendiente

---

## Tipos de envío (2026-05-14)

### Envío Propio (KM-based)
- **Dirección de entrega**: `AddressAutocompleteInput` con Google Places Autocomplete
  - Sugerencias de Google Maps mientras se escribe
  - Dropdown de domicilios guardados del cliente (de `cliente_domicilios`)
- **KM auto**: calcula distancia sucursal → cliente via Distance Matrix API
- **Costo auto**: `KM × costo_km_envio` (configurado en SucursalesPage)
- No editable manualmente — resultado se muestra en panel informativo

### Envío por Tercero (courier)
- **Canal de venta**: auto-populado desde `venta.origen` cuando viene de una venta (read-only)
- **Costo courier**: auto-completa desde `courier_tarifas` al seleccionar el courier
- Editable como override si el precio difiere
- Tab Cotizador: **eliminado** (reemplazado por tarifa configurada en SucursalesPage)

---

## Configuración de tarifas (migration 107)

### En SucursalesPage (modal de edición):
- Campo `costo_km_envio` ($ por km específico de la sucursal — sobreescribe el global)
- Panel expandible "Couriers" → edición inline de precios por courier
- Guarda en tabla `courier_tarifas(tenant_id, sucursal_id, courier, precio)`

### En Config → Envíos:
- Campo `tenants.costo_envio_por_km` — valor global para todas las sucursales
- **Jerarquía**: `sucursal.costo_km_envio` tiene prioridad; si está vacío, se usa el global
- Útil para negocios donde todas las sucursales tienen el mismo precio por km

### Google Maps (env var requerida)
```
VITE_GOOGLE_MAPS_API_KEY=...   # Places API + Distance Matrix API habilitadas
```
- Sin key: funciona como input de texto normal, sin autocomplete ni cálculo de KM
- `src/hooks/useGoogleMaps.ts`: `getGoogleMapsLoader()`, `calcularDistanciaKm()`
- `src/components/AddressAutocompleteInput.tsx`: componente reutilizable
- **Selector de venta**: excluye automáticamente ventas que ya tienen un envío asignado (v1.8.7)

---

## Estados del envío (v1.8.39+)

```
pendiente → despachado → en_camino → en_bodega → entregado
                                              → devolucion
           (cancelado desde cualquier estado)
```

- `en_bodega` (NUEVO v1.8.39, migration 127): paquete está en depósito del courier, esperando recolección final
- Badge violeta + icono Warehouse
- Desde `en_bodega` el botón "Avanzar" lleva al modal POD para confirmar entrega

---

## POD — Proof of Delivery (v1.8.39, migration 127)

Campos en `envios` para registrar prueba de entrega:
- `pod_fecha DATE` — fecha real de entrega
- `pod_receptor TEXT` — nombre de quien recibió
- `pod_notas TEXT` — observaciones de entrega
- `pod_url TEXT` — link a foto/firma (URL externa o foto subida a Storage)

### Modal POD standalone
- Disponible desde panel expandido para estados `en_camino` / `en_bodega` / `entregado`
- Botón "Registrar POD" o "Actualizar POD" si ya existe
- Al confirmar → cambia estado a `entregado` automáticamente
- También accesible desde modal de edición (sección POD)

### ISS-166 — Botón cámara (v1.8.40)
- `<input type="file" accept="image/*" capture="environment">` abre cámara trasera en mobile
- Upload a bucket `etiquetas-envios/pod/{envioId}/{timestamp}.{ext}`
- URL firmada con expiración 365 días almacenada como `pod_url`
- Disponible en modal POD del dashboard Y en página transportista

---

## Página Transportista (v1.8.40, ISS-165, migration 129)

Página pública mobile-first para que el driver actualice el envío sin login.

**Ruta:** `/transporte/:token` — sin AuthGuard  
**Componente:** `src/pages/TransportistePage.tsx`

### Flujo
1. Desde panel expandido del envío en EnviosPage: botón "Compartir con transportista"
2. Genera UUID v4 como token y guarda en `envios.token_transportista`
3. Copia link `{VITE_APP_URL}/transporte/{token}` al portapapeles
4. Se envía al chofer (WhatsApp, SMS, etc.)
5. Driver abre el link en su celular → ve el envío
6. Botones grandes: **En camino / En bodega / Entregado / No entregado**
7. POD inline: fecha, receptor, observaciones, foto con cámara
8. Al marcar Entregado → guarda POD y bloquea ediciones futuras

### Funciones SECURITY DEFINER públicas (anon + authenticated)
- `get_envio_by_token(p_token TEXT)` — devuelve envío + cliente + tenant + domicilio
- `get_envio_items_by_token(p_token TEXT)` — devuelve productos de la venta vinculada
- `update_envio_by_token(p_token, p_estado, p_pod_fecha, p_pod_receptor, p_pod_notas)` — actualiza estado y POD

### Seguridad
- Token UUID v4 único por envío
- Solo permite actualizar si estado NOT IN (`entregado`, `cancelado`)
- No expone datos sensibles del tenant (solo los necesarios para el envío)

---

## Schema (migration 075 + 127 + 128 + 129)

```sql
envios(
  id, tenant_id, venta_id, sucursal_id,
  numero    -- AUTO por tenant
  courier TEXT    -- 'Envío propio' si se eligió propio en VentasPage
  servicio TEXT    -- selectbox por courier (SERVICIOS_POR_COURIER)
  tracking_number TEXT
  tracking_url TEXT
  estado CHECK(pendiente|despachado|en_camino|en_bodega|entregado|devolucion|cancelado)  -- en_bodega agregado en m127
  canal TEXT    -- autocompletado desde ventas.origen
  destino_id FK cliente_domicilios
  destino_descripcion TEXT    -- snapshot al crear
  peso_kg, largo_cm, ancho_cm, alto_cm DECIMAL
  costo_cotizado, costo_real DECIMAL
  fecha_entrega_acordada DATE
  hora_entrega_acordada TIME
  zona_entrega TEXT
  etiqueta_url TEXT    -- bucket etiquetas-envios (privado, 5MB)
  notas TEXT

  -- POD (migration 127)
  pod_url TEXT          -- URL firmada del comprobante/foto
  pod_fecha DATE        -- fecha real de entrega
  pod_receptor TEXT     -- nombre de quien recibió
  pod_notas TEXT        -- observaciones de entrega

  -- Pago al courier (migration 128, ISS-169)
  costo_pagado BOOLEAN DEFAULT false
  fecha_pago_courier DATE
  medio_pago_courier TEXT

  -- Token transportista (migration 129, ISS-165)
  token_transportista TEXT UNIQUE   -- UUID v4 para página pública /transporte/:token

  created_by, created_at, updated_at
)
```

---

## Canal autocompletado

Al seleccionar una venta: el campo `canal` se autocompleta desde `ventas.origen` (POS/MELI/TiendaNube/MP).

---

## Prerequisito: Domicilios de clientes

`cliente_domicilios` (migration 074): cada cliente puede tener múltiples domicilios con alias, referencias para courier, domicilio principal marcado con ⭐.

---

## WhatsApp Click-to-Chat (migration 078/079, v1.3.0)

**`src/lib/whatsapp.ts`:**
```typescript
normalizeWhatsApp(telefono)     // ARG: 549+área+número
expandirPlantilla(plantilla, vars)  // vars: {{Nombre_Cliente}} {{Numero_Orden}} etc.
buildWhatsAppUrl(telefono, mensaje) // URL encoding para abrir WA
```

**Variables de plantilla disponibles:**
`{{Nombre_Cliente}}` · `{{Nombre_Negocio}}` · `{{Numero_Orden}}` · `{{Tracking}}` · `{{Courier}}` · `{{Fecha_Entrega}}`

**UI EnviosPage:**
- Ícono verde WA en cada fila
- Botón "Coordinar entrega" en detalle expandido → abre WhatsApp Web/app en nueva pestaña

**Configuración (ConfigPage → Negocio):**
- Textarea de plantilla personalizable
- Campo `$ por km` para delivery propio

**Schema:**
```sql
tenants.whatsapp_plantilla TEXT
tenants.costo_envio_por_km DECIMAL
```

> [!NOTE] Limitación documentada: manual-asistido. 1 clic = 1 mensaje = 1 pestaña. No es automatización masiva.

---

## Fase 2 — Couriers con contrato (pendiente)

Cuando haya contratos con OCA / CorreoAR / Andreani / DHL:
- **EF `courier-rates`**: consulta APIs en paralelo → tabla comparativa de precios
- **Label printing**: etiqueta base64 del courier → bucket → impresión

---

## Links relacionados

- [[wiki/features/clientes-proveedores]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/facturacion-afip]]

---

## Mejoras v1.8.21

### ISS-097 — Fix crítico: "Agregar nueva dirección"
- Bug: `useState` dentro de una IIFE (función autoejecutable) violaba las Rules of Hooks de React → error "Algo salió mal"
- Fix: la sección del formulario de nueva dirección ahora usa el `domForm` / `setDomForm` que ya existía en el scope del componente
- Comportamiento restaurado: al hacer click en "Agregar nueva dirección" dentro del modal de nuevo envío con cliente seleccionado, aparece el formulario correctamente
