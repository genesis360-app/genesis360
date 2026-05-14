---
title: Módulo Envíos
category: features
tags: [envios, logistica, courier, remito, tracking, whatsapp, google-maps, km-auto]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-05-14
---

# Módulo Envíos

Módulo de seguimiento de envíos y entregas. Implementado en v1.3.0 PROD ✅.

**Página:** `src/pages/EnviosPage.tsx` (`/envios`)  
**Acceso:** OWNER · SUPERVISOR · CAJERO

---

## Funcionalidades

- Lista de envíos con filtros: estado / courier / canal / fechas / búsqueda
- Fila expandible: destinatario completo, courier + tracking, productos
- **Avanzar estados**: pendiente → despachado → en_camino → entregado
- **Cancelar** y registrar **devolución**
- **Generar remito PDF** (jsPDF)
- Ver tracking externo en nueva pestaña
- Ver venta asociada con link directo
- Modal nuevo/editar: vincular venta, domicilio del cliente, courier/tracking/dimensiones
- Bloqueo de edición si estado = `entregado`

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

### En SucursalesPage:
- Campo `costo_km_envio` ($ por km, varía por sucursal)
- Panel expandible "Couriers" → edición inline de precios por courier
- Guarda en tabla `courier_tarifas(tenant_id, sucursal_id, courier, precio)`

### Google Maps (env var requerida)
```
VITE_GOOGLE_MAPS_API_KEY=...   # Places API + Distance Matrix API habilitadas
```
- Sin key: funciona como input de texto normal, sin autocomplete ni cálculo de KM
- `src/hooks/useGoogleMaps.ts`: `getGoogleMapsLoader()`, `calcularDistanciaKm()`
- `src/components/AddressAutocompleteInput.tsx`: componente reutilizable
- **Selector de venta**: excluye automáticamente ventas que ya tienen un envío asignado (v1.8.7)

---

## Estados del envío

```
pendiente → despachado → en_camino → entregado
                                   → devolucion
           (cancelado desde cualquier estado)
```

---

## Schema (migration 075)

```sql
envios(
  id, tenant_id, venta_id,
  numero    -- AUTO por tenant
  courier TEXT
  servicio TEXT    -- selectbox por courier (SERVICIOS_POR_COURIER)
  tracking_number TEXT
  estado CHECK(pendiente|despachado|en_camino|entregado|devolucion|cancelado)
  canal TEXT    -- autocompletado desde ventas.origen
  destino_id FK cliente_domicilios
  peso_kg DECIMAL
  dimensiones TEXT
  costo_cotizado DECIMAL
  fecha_entrega_acordada DATE
  etiqueta_url TEXT    -- bucket etiquetas-envios (privado, 5MB)
  created_by
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
