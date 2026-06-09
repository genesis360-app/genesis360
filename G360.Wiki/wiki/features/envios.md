---
title: Módulo Envíos
category: features
tags: [envios, logistica, courier, remito, tracking, whatsapp, google-maps, km-auto, pod, transportista, iss-174, cotizacion-courier]
sources: [CLAUDE.md, ROADMAP.md, relevamiento_envios_respuestas.md]
updated: 2026-06-06
---

# Módulo Envíos

Módulo de seguimiento de envíos y entregas. Implementado en v1.3.0 PROD ✅.  
**Última actualización:** 2026-06-06 — **relevamiento de Envíos respondido por GO** → plan por fases EN1-EN7 (ver al final, "Relevamiento Envíos 2.0").

> **Relevamiento respondido (2026-06-06):** respuestas A-I + diseño + modelo de datos + recomendación contable/IVA + plan EN1-EN7 en `sources/raw/relevamiento_envios_respuestas.md`. **Pendiente de implementar.** Resumen al final de esta página.

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

### Costo del envío cobrado en la venta (ISS-156/175/176 · v1.10.1)
- El costo del envío que paga el **cliente** entra con la venta. El envío auto-creado nace `costo_pagado=true` cuando es **propio** (no hay courier a quien pagar) o cuando la venta se **despachó** (cobrada al 100%). Reservas con pago parcial quedan pendientes hasta el despacho.
- El tab **Pagos Courier** excluye `courier='Envío propio'` (solo lista pagos a couriers terceros pendientes).
- Al crear un envío manual seleccionando una venta despachada con `costo_envio > 0`, también nace saldado.
- **Página `/transporte`**: si el envío tiene `costo_cotizado > 0 AND costo_pagado = false`, muestra banner rojo "Envío pendiente de pago" y deshabilita los botones de avance de estado (misma regla que `verificarPagoAntes` del operador).

### Tab Pagos Courier (ISS-169)
- Lista todos los envíos con `costo_cotizado > 0 AND costo_pagado = false AND courier != 'Envío propio'`
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

### Rangos horarios de entrega (ISS-178 · migration 152 · 2026-05-29)

`tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos (8-13 / 13-18 / 18-22). Array de objetos `{desde:"HH:MM", hasta:"HH:MM"}`.

- **Config → Envíos**: card nueva "Rangos horarios para entrega" con CRUD inline (agregar, editar inputs `<input type="time">`, eliminar). Sin tope técnico de cantidad de rangos.
- **VentasPage modal envío**: selector "Rango horario" al lado del campo "Fecha de entrega acordada". Lista los rangos del tenant; opción "Sin definir" como default. Disabled cuando no hay rangos cargados.
- **EnviosPage**: el form de edición agrega selector "Rango horario" junto a "Hora acordada" (son alternativas, ambas pueden coexistir). La tabla muestra el rango con badge accent debajo de la fecha/hora.
- **Snapshot**: al guardar el envío se persisten `envios.rango_horario_desde/hasta TIME` con los valores del rango elegido. Si después se borra el rango de la config, el envío conserva intacto lo acordado. Al editar, se reconstruye el `idx` haciendo match `desde+hasta` contra la config actual (si el rango fue borrado, queda "Sin definir").

### Google Maps (env var requerida)
```
VITE_GOOGLE_MAPS_API_KEY=...   # Places API + Distance Matrix API habilitadas
```
- Sin key: funciona como input de texto normal, sin autocomplete ni cálculo de KM
- `src/hooks/useGoogleMaps.ts`: `getGoogleMapsLoader()`, `calcularDistanciaKm()`
- `src/components/AddressAutocompleteInput.tsx`: componente reutilizable
- **Selector de venta**: excluye automáticamente ventas que ya tienen un envío asignado (v1.8.7)

---

## Cotización de envíos por API de courier (ISS-174 — en progreso)

Reemplaza el costo manual/KM por cotización en tiempo real contra la API de cada courier y genera la orden + etiqueta + tracking. **Integración: APIs directas** (Andreani → Correo Argentino → OCA). **Credenciales por tenant.** Cotización en POS y en Envíos. Operador elige servicio (precio editable). Diseño completo en `sources/raw/project_pendientes.md` → ISS-174.

### F1 — Fundación (2026-05-31, DEV) ✅
Capa de datos y config, sin tocar APIs todavía:
- **Catálogo compartido** `src/lib/couriers/catalogo.ts` (`COURIERS`, `SERVICIOS_POR_COURIER`, `serviciosDe`, `CAMPOS_CREDENCIALES`). Usado por `EnviosPage` y `VentasPage`.
- **POS** (`VentasPage`): el campo *Servicio* del modal de envío pasó de texto libre a **select dependiente del courier** (igual que Envíos); se resetea al cambiar de courier.
- **Config → Envíos**:
  - Card "**Peso y medidas para cotizar envíos**" → toggle `tenants.envio_peso_fuente`: `manual` (operador carga peso/medidas del bulto por envío, default) o `producto` (se toma del dato maestro y se suma el carrito).
  - Panel "**Credenciales de courier**" (`CourierCredencialesPanel`, owner-only): carga por courier (Andreani/Correo/OCA) con campos típicos de cada API; secretos como `password`; estado "Configurado". Guarda en `courier_credenciales` (JSONB por tenant). Aún no se usan.
- **Producto** (`ProductoFormPage`): campos `peso_kg / largo_cm / ancho_cm / alto_cm` (para fuente `producto`).
- **CP estructurado**: `sucursales.codigo_postal` y `cliente_domicilios.codigo_postal` (ya existían, mig 124/074) son el origen/destino para cotizar. `AddressAutocompleteInput` ahora devuelve `postcode` best-effort (Nominatim) para autocompletar el CP en F2.
- Migrations **162** (`courier_credenciales` + `envio_peso_fuente`), **163** (CP, idempotente), **164** (productos peso/dim).

### F2-F5 — Integración API (v1.14.0, PROD) ✅
Edge Function **`courier-api`** (`supabase/functions/courier-api/`) con router por `action`:
- **`cotizar`** → devuelve lista normalizada `[{servicio, precio, plazo_dias, codigo_servicio}]`.
- **`generar`** → crea la orden en el courier y guarda tracking + etiqueta + `courier_orden_id` (mig 165: `envios.cotizacion_json/courier_orden_id/cotizado_api`).
- **`tracking`** → eventos de seguimiento.
- **Adapters**: `andreani.ts` (REST, F2), `correo.ts` (Paq.ar, F3), `oca.ts` (SOAP, F4); tracking en los tres (F5). Las credenciales (`courier_credenciales`) se leen SOLO server-side con service_role.
- **Front** (`src/lib/couriers/api.ts`): `cotizarEnvio` / `generarEnvioCourier` / `trackingEnvioCourier`.
  - **POS**: botón "Cotizar {courier}" (CP destino + peso) → elegir opción setea servicio + costo (editable).
  - **EnviosPage**: "Cotizar" en el modal; "Generar con courier" / "Etiqueta" / "Actualizar tracking" en el panel del envío (solo couriers con API vía `esCourierApi()`).

**⚠ Adapters pendientes de validar con cuentas B2B reales** — escritos según documentación pública de cada courier. Al cargar credenciales reales en Config → Envíos hay que validar/ajustar endpoints y mapeos. Sin credenciales la cotización devuelve un error claro y el alta manual de envíos sigue intacta.

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

### Múltiples fotos POD (v1.10.1, migration 144)

Soporte para N fotos por envío. Mantiene compatibilidad con `envios.pod_url` (la primera foto, orden=0).

- **Tabla `envio_pod_fotos`**: `id, envio_id, tenant_id, url, storage_path, orden, created_at, created_by` con RLS por tenant
- **Backfill automático** en la migration: cada envío con `pod_url` no-nulo genera fila orden=0
- **Componente `PodFotosManager`** (`src/components/PodFotosManager.tsx`): upload múltiple desde cámara/galería con `multiple + capture="environment"`, thumbnails con badge "Principal", botón eliminar con confirm + cleanup del storage path
- **Integración**: modal POD del dashboard + sección POD del modal de edición de envío (solo con `editId` existente)
- **Sincronización**: al subir o eliminar, el componente actualiza `envios.pod_url` con la primera foto (orden 0). La página transportista pública sigue usando `pod_url` (no fue migrada al manager — pendiente como follow-up con SECURITY DEFINER)
- **Storage**: bucket `etiquetas-envios` path `pod/{envioId}/{ts}_{idx}.{ext}` con signedUrl 365 días

### Cron limpieza tokens transportista (v1.10.1, migration 143)

pg_cron diario 07:00 UTC `cleanup_envio_tokens_transportista` que setea `token_transportista = NULL` en envíos en `entregado`/`cancelado`/`devolucion` con +30 días desde el último update. Invalida los links públicos viejos sin tocar el resto del envío. Los chofers no pueden seguir actualizando estado vía un link que ya cumplió su propósito.

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

## Relevamiento Envíos 2.0 — plan por fases EN1-EN7 (respondido 2026-06-06, PENDIENTE)

Relevado con GO (HTML `relevamiento-envios-reglas-negocio.html`, secciones A-I). Respuestas + diseño + modelo de datos + recomendación contable/IVA + plan completo en **`sources/raw/relevamiento_envios_respuestas.md`**. **Pendiente de implementar.**

**Estado:** ✅ **EN1 (v1.40.0, mig 189)** y ✅ **EN2 (v1.41.0, mig 190)** deployados a PROD. Faltan EN3-EN7.

**Plan deployable por fases (cada una a PROD con su versión):**
- **EN1 — Pagos a courier contables (C1-C4) ✅ v1.40.0:** marcar pagado **genera gasto** "Transporte y fletes" (solo courier **tercero**, con IVA crédito fiscal vía `desgloseIvaFlete`) + egreso de caja si efectivo + link `envios.gasto_id` · tab **"Facturas Courier"**: cargar **factura del courier** + conciliar contra lo registrado + alerta de diferencias (`courier_facturas`/`courier_factura_lineas`) · doble firma por umbral (clave maestra). Lib `enviosCourierPago.ts`.
- **EN2 — POD robusto (D1-D6) ✅ v1.41.0:** campos requeridos configurables (`pod_campos_requeridos`) · multi-foto (mín. config) · **firma (canvas `SignaturePad`) + DNI + OTP sobre umbral** (envío propio, `envio_otp` + RPCs `generar/verificar_otp_envio`, código al cliente por WA) · **geoloc con fallback** (`pod_geo_estado`, si no se puede registra `no_disponible` y no frena) · **sub-estados de no-entrega** (`subestado_no_entrega` ausente/rechazado/dirección) + motivo · re-intento con contador (`intentos`/`envio_reintentos_max`) + recargo. Lib `enviosPod.ts`.
- **EN3 — Reparto (G1/G3 + E1-E5):** catálogo de **repartidores** + productividad · **hoja de ruta** por chofer (token agrupador) + orden por proximidad + cumplimiento · página transportista (token config, llamar/WA/incidencia, identidad config) · notificación **"en camino"** WA (default).
- **EN4 — Costos/tarifas (B1-B6):** nivel courier + recargo horario · factor KM config · costo mínimo/escalonado · política de cobro al cliente (margen/subsidio) · envío gratis condicional · **diferencia real vs cotizado a-favor/pérdida con motivo** (precio al cliente **inmutable** post-pago).
- **EN5 — Creación/alcance (A1-A5):** DEPOSITO crea · **envíos libres** (traslado/muestra/dev_proveedor) · sugerencia de courier por CP · plazo de despacho por canal + alerta · **múltiples envíos por venta con `envio_items`** (desglose de qué se fue en cada envío).
- **EN6 — Integraciones courier (F1/F2/F3):** tracking por número + **cotización comparativa ("más barato")** + etiquetas (descarga + térmica). **Reusa `courier-api` (ISS-174) → depende de validar adapters con cuentas B2B reales.**
- **EN7 — Envío propio + reportes (G2 + H1-H3):** recurso (moto/auto) + KM + **combustible auto-gasto** · todos los reportes (margen logístico, mapa por zona) · todas las alertas · export Excel/PDF/CSV + hoja de ruta PDF + etiquetas A4 con QR.

**Recomendación contable/IVA (C2):** courier tercero = gasto con **IVA crédito fiscal** (respaldo factura courier); envío propio NO genera gasto courier (su costo real va por **combustible**, G2); lo que paga el cliente es **ingreso dentro de la venta**. Margen logístico = ingreso − costo real.

**Top 3 (GO delegó):** EN1 → EN2 → EN3. **Pendiente confirmar:** alícuota IVA flete, plazos por canal, canal del OTP, cuentas B2B para EN6.

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
