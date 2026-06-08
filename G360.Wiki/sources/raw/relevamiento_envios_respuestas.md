---
name: relevamiento_envios_respuestas
description: Respuestas de GO al relevamiento de Envíos + diseño consolidado, sugerencias, modelo de datos y plan por fases (EN1-EN7)
type: project
---

# Relevamiento Envíos (logística / courier / POD / envío propio) — respuestas + diseño

> Relevado con GO (HTML `relevamiento-envios-reglas-negocio.html`, secciones A-I).
> Respuestas crudas pasadas por GO el 2026-06-06. Este doc consolida respuesta + diseño + sugerencias
> + el plan por fases (EN1-EN7). Filosofía del proyecto: **simple para el PyME por fuera, robusto por dentro**.

## Estado actual (código real, para no reinventar)
- `EnviosPage.tsx` (`/envios`): tabs **Envíos** + **Pagos Courier**. Estados pendiente→despachado→en_camino→en_bodega→entregado + cancelar/devolución. Remito PDF con QR. Bloqueo de avance si `costo_cotizado>0 AND costo_pagado=false` (ISS-171).
- `TransportistePage.tsx` (`/transporte/:token`, pública): el chofer avanza estados + carga POD (fecha/receptor/notas/foto vía `PodFotosManager`).
- **Costos:** `sucursal.costo_km_envio` > `tenant.costo_envio_por_km` (KM × $/km, Haversine×1.35 o Distance Matrix). `courier_tarifas(tenant,sucursal,courier,precio)`. Rangos horarios de entrega (ISS-178, `tenants.envio_rangos_horarios` + `envios.rango_horario_desde/hasta`).
- **Couriers API (ISS-174, v1.14.0):** Edge Function `courier-api` (cotizar/generar/tracking) con adapters Andreani/Correo/OCA, `courier_credenciales` por tenant, `envios.cotizacion_json/courier_orden_id/cotizado_api`. **⚠ adapters sin validar con cuentas B2B reales** (ver `project_pendientes.md` → "Email + Couriers — pendientes a seguir").
- **Pagos courier:** marcar pagado = `costo_pagado=true + fecha_pago_courier + medio_pago_courier`. **Hoy NO genera gasto en módulo Gastos** (gap que cierra C2).
- Catálogo `src/lib/couriers/catalogo.ts`: `COURIERS` (OCA/Correo/Andreani/DHL/Otro), `COURIERS_API` (Andreani/Correo/OCA).

## Leyenda
- **Resp GO** = lo elegido. **Diseño** = cómo se implementa. **💡** = sugerencia/observación.

---

## A — Creación y alcance del envío

| # | Resp GO | Diseño |
|---|---|---|
| A1 | **A + C** | Mantener auto-creación desde venta + creación manual (a) **y sumar DEPOSITO** como rol que gestiona la logística (c). Capacidad de creación: DUEÑO/SUPERVISOR/CAJERO (actual) **+ DEPOSITO**. |
| A2 | **B** | **Envíos "libres" sin venta** con `tipo` distinto: `traslado_interno` / `muestra` / `dev_proveedor` / `otro`. Nuevo campo `envios.tipo` + `motivo`. El traslado_interno cruza con multi-sucursal (origen→destino sucursal). |
| A3 | **C** | **Sugerencia automática de courier por CP** + **override manual**. Mapping `cp_courier_preferido` (por tenant: rango/lista de CP → courier). Al cargar destino, propone courier; el operador puede cambiarlo. |
| A4 | **C (+ alerta)** | **Plazo de despacho por canal configurable** (presencial / online / mayorista, ej. 24/48/72h) + **alerta si se pasa**. `tenants.envio_plazo_despacho` JSONB por clasificación de canal; sweep lazy marca atrasados (cruza con H2-a). |
| A5 | **B (+ desglose)** | **Varios envíos por venta.** **Pedido GO clave:** hay que saber **qué se fue en cada envío** (qué ítems/cantidades) y que la venta se dividió en **N envíos**. → tabla `envio_items` (desglose por envío: producto/cantidad/LPN) + la venta muestra "dividida en N envíos" con el contenido de cada uno. Permite split por lote o por sucursal (c queda cubierto por b). |

## B — Costos y tarifas

| # | Resp GO | Diseño |
|---|---|---|
| B1 | **(envío propio = $/km) + B + D** | **$/km es solo para envío propio** (+ **tarifa por horario** sumable, d). **Courier tercero: cada courier tiene su tarifa** (b) y, además, se **consulta vía API a todos los couriers** para obtener el **precio más barato por venta** (→ F2). Jerarquía propio: `sucursal.costo_km_envio` > global + recargo por franja horaria. |
| B2 | **B** | **Factor KM configurable por tenant** (1.2 / 1.35 / 1.5). `tenants.envio_factor_km` (default 1.35). |
| B3 | **B + C (configurables)** | **Costo mínimo** (hasta X km cuesta $fijo) **y costo escalonado** (0-5/5-10/+10 km), **configurables** por tenant (envío propio). `tenants.envio_costo_minimo` + `envio_tramos` JSONB. |
| B4 | **D (configurable a/b/c)** | **Configurable por tenant** entre: cliente paga 100% (a) / cliente + margen % (b) / subsidio hasta umbral = envío gratis si venta > $X (c). `tenants.envio_cobro_politica` + parámetros. |
| B5 | **B + C + D (configurables)** | **Envío gratis condicional configurable**: por monto mínimo (b) + por etiqueta de cliente (Mayorista/VIP, c) + promoción temporal desde/hasta (d). `tenants.envio_gratis_reglas` JSONB. |
| B6 | **A (inmutable) + motivo a-favor/pérdida** | **El precio que pagó el cliente NO se modifica** una vez pagado. Si `costo_real < costo_cotizado` → queda **a favor**; si `costo_real > costo_cotizado` → queda en **pérdida**. **Registrar el motivo** del por qué (catálogo + obs) para **trazar y resolver el error**. Campos `envios.diferencia_tipo` (`a_favor`/`perdida`) + `diferencia_motivo` + `diferencia_monto`. Reporte de diferencias (H1-d). |

## C — Pagos a courier  *(GO preguntó cómo se lleva la contabilidad/IVA → ver recomendación abajo)*

| # | Resp GO | Diseño |
|---|---|---|
| C1 | **A** | Mantener pago **individual o múltiple** a discreción (como hoy). La liquidación programada (b/c) queda para backlog si aparece volumen. |
| C2 | **B + C** | **Generar gasto automático al marcar pagado** (categoría "Logística/Courier", proveedor = courier) **+ descontar de caja si efectivo**. **Solo courier tercero** (el envío propio NO genera gasto courier — su costo real va por combustible G2). Cierra el gap actual (hoy solo flag). |
| C3 | **C** | **Cargar factura del courier** (PDF/CSV) + matchear contra los envíos del período **+ alerta de diferencias** entre lo facturado y lo registrado. `courier_facturas` + `courier_factura_lineas`. |
| C4 | **A + C (configurable por rol)** | Aprobar pagos a courier: **cualquier rol con acceso** por default **+ umbral por monto y rol configurable** (doble firma sobre umbral, mismo patrón que OC pago D5 de Compras). `tenants.envio_pago_doble_firma_umbral`. |

### 💡 Recomendación contable/IVA (respuesta a la pregunta de GO en C2)
- **Courier tercero (OCA/Andreani/Correo/etc.):** es un **servicio de flete que te factura el courier** → al marcar pagado, **generar un gasto** categoría "Logística/Courier", **proveedor = courier**, con **IVA = crédito fiscal** (flete suele ser 21%; registrar `tipo_iva`/`iva_monto` como cualquier gasto para que entre al cómputo de IVA). Si fue **efectivo**, egreso de caja. La **factura del courier (C3)** es el respaldo del crédito fiscal → conciliar facturado vs registrado.
- **Envío propio (delivery interno):** **NO hay tercero que te facture** → **no genera gasto "courier"**. El costo real propio = **combustible + vehículo + tiempo del repartidor**; el combustible se captura como gasto con su propio IVA (G2). Lo que el **cliente paga** por el envío es **ingreso** y ya entró con la **venta** (su IVA es **débito fiscal** dentro de la venta, no se duplica).
- **Clave:** separar **ingreso** (lo que cobra el cliente, dentro de la venta) de **costo** (lo que paga al courier / gasta en propio). El **margen logístico** = ingreso del envío − costo real (reporte H1-d). Por eso C2 genera gasto **solo** para courier tercero.

## D — POD y cierre de entrega

| # | Resp GO | Diseño |
|---|---|---|
| D1 | **D** | **Campos del POD requeridos configurables por tenant** (qué exige para marcar "entregado": fecha/receptor/foto/firma/DNI). `tenants.pod_campos_requeridos` JSONB. |
| D2 | **B (mínimo 1)** | **Varias fotos** en el POD (paquete + receptor + DNI + estado), **mínimo 1**. Reusa `PodFotosManager` (ya soporta multi-foto, migration 144) → ajustar mínimo configurable. |
| D3 | **D (firma + DNI) + OTP sobre umbral** | **Firma del receptor (canvas) + DNI**, ambos. **Pedido GO:** a partir de un **monto configurable**, exigir **código enviado al cliente** (OTP) para validar la entrega — **solo envío propio**. `envios.pod_firma_url` + `pod_dni` + flujo OTP (`envio_otp` con código + verificación en `/transporte`). |
| D4 | **B + C (con fallback)** | **Geolocalización** del celular del driver al marcar "Entregado" (b) **+ alerta si está > X km** del destino (c). **Pedido GO:** si **no se puede capturar** (permiso denegado/sin señal), **queda registrado que no se pudo PERO no detiene la entrega** (fallback graceful). `envios.pod_lat/lon` + `pod_geo_estado` (`ok`/`fuera_rango`/`no_disponible`). |
| D5 | **C** | **Sub-estados de no-entregado** (`no_entregado` cliente ausente / `rechazado` cliente no quiso / `direccion_incorrecta`) **+ motivo obligatorio del catálogo**. Reemplaza el `devolucion` único actual con granularidad. |
| D6 | **C** | **Re-intento de entrega**: el envío vuelve a `en_camino` con **contador de intentos** (b) **+ costo adicional si supera N intentos** (re-cobro al cliente, c). `envios.intentos` + `tenants.envio_reintentos_max`. |

## E — Página pública del transportista

| # | Resp GO | Diseño |
|---|---|---|
| E1 | **C / D configurable** | **Expiración del token configurable**: al marcar entregado/devolución (c) **o** N días configurable (d). `tenants.envio_token_politica` + `envios.token_expira_at`. |
| E2 | **D** | **Todas las acciones**: avanzar estados (actual) + **"Llamar al cliente"** (`tel:`) + **"Mensaje WA"** (`wa.me`) + **reportar incidencia** (rotura / problema dirección / cliente agresivo, catálogo). |
| E3 | **A / B / C configurable (A default)** | **Hoja de ruta** configurable: por default un link por envío (a); opción **hoja de ruta agrupada por chofer** con N envíos (b); opción **+ orden optimizado por proximidad** (TSP simple, c). |
| E4 | **A / B / C configurable (A default)** | **Identidad del transportista** configurable: anónimo por token (a, default); **vincular a chofer registrado** (b, cruza con G1); **pedir nombre+DNI** al abrir el link (c). |
| E5 | **A / B / C configurable (B default)** | **Notificación "en camino"** configurable: no notificar (a); **WA automático "su pedido está en camino"** (b, default — vía `wa.me`/plantilla); **+ link de tracking público** con mapa (c). |

## F — Integraciones

| # | Resp GO | Diseño |
|---|---|---|
| F1 | **B** | **Tracking automático por número** contra OCA/Andreani/CorreoAR (reusa `courier-api` action `tracking` de ISS-174). Sin cron (pg_cron no disponible) → refresco on-demand / sweep lazy al abrir Envíos. |
| F2 | **B** | **Cotización automática comparativa**: EF que consulta los couriers en paralelo y devuelve **tabla comparativa al cargar el envío** (reusa `courier-api` action `cotizar`) → habilita el **"más barato"** que pidió GO en B1. |
| F3 | **C** | **Etiquetas de courier**: descargar etiqueta (base64 desde API) **+ impresión directa a impresora térmica** (Zebra/ESC-POS). |
| F4 | **A** | **WhatsApp click-to-chat manual** (como hoy). No migrar a WhatsApp Business API. |

## G — Envío propio (delivery interno)

| # | Resp GO | Diseño |
|---|---|---|
| G1 | **C** | **Catálogo de repartidores** (vinculados o no a empleados de RRHH) + asignación por envío **+ reporte de productividad** por repartidor. `repartidores` + `envios.repartidor_id`. |
| G2 | **C** | **Asociar el envío con un recurso** (moto/auto del módulo Recursos) — **suma KM al recurso** **+ combustible consumido auto-generado como gasto**. Cruza con módulo Recursos + Gastos. |
| G3 | **C + D** | **Planificación diaria**: vista calendario/lista por día y repartidor (b) **+ orden por proximidad geográfica** (c) **+ reporte de cumplimiento** (envíos del día vs entregados, d). |

## H — Reportes y alertas

| # | Resp GO | Diseño |
|---|---|---|
| H1 | **TODOS (a-f)** | Reportes: envíos pendientes/atrasados · cumplimiento por courier (tiempo medio + % entregados) · pagos a courier acumulados por mes/courier · **subsidio vs ganancia por envío (margen logístico)** · mapa de envíos por zona/CP · productividad de repartidores. |
| H2 | **TODOS (a-d)** | Alertas: envío sin despachar tras N horas/días · POD pendiente tras N días · costo courier no pagado tras N días · diferencia importante cotizado vs real. |
| H3 | **D (todo)** | Export **Excel + PDF + CSV** + **hoja de ruta PDF** imprimible para el chofer + **etiquetas A4** (4/6/12 por hoja) con **QR + datos del destinatario**. |

## I — Prioridades
- **I1:** GO delega el Top 3 → ver recomendación abajo. **I2:** sin comentarios libres.

---

## Resumen de sugerencias / observaciones
1. **C2/contabilidad:** gasto auto **solo** para courier tercero (con IVA crédito fiscal); envío propio va por combustible (G2). El cobro al cliente es ingreso dentro de la venta. Ver recomendación detallada arriba.
2. **A5 (múltiples envíos):** lo importante es el **desglose de ítems por envío** (`envio_items`) — sin eso, "dividir la venta en N envíos" no es trazable.
3. **B6:** precio al cliente inmutable post-pago; la diferencia real va a **a-favor/pérdida con motivo obligatorio** (auditable, no se "corrige" el cobro).
4. **F2 + B1:** la cotización comparativa (el "más barato") **reusa `courier-api`** de ISS-174 → **antes hay que validar los adapters con cuentas B2B reales** (bloqueante conocido). Sin credenciales, cae a tarifa manual/`courier_tarifas` como hoy.
5. **D3 OTP + D4 geoloc:** ambos con **fallback graceful** (si no se puede, se registra y no frena la entrega) — pedido explícito de GO en D4 y sensato para D3.
6. Mucho es **configurable** (A4, B2-B5, D1, E1/E3/E4/E5, C4): centralizar en **Config → Envíos** (ya existe).

---

## Modelo de datos (propuesto)
- **`envios`** (ampliar): `tipo` (venta/traslado_interno/muestra/dev_proveedor/otro, A2) · `motivo` · `repartidor_id` (G1) · `recurso_id` (G2) · `intentos` INT + `reintento_motivo` (D6) · sub-estado vía `estado` ampliado o `subestado_no_entrega` + `no_entrega_motivo` (D5) · `pod_firma_url` + `pod_dni` (D3) · `pod_lat/lon` + `pod_geo_estado` (D4) · `token_expira_at` (E1) · `diferencia_tipo`/`diferencia_motivo`/`diferencia_monto` (B6) · `gasto_id` (C2, link al gasto generado).
- **`envio_items`** (A5): `envio_id, producto_id, cantidad, lpn` — desglose de qué se fue en cada envío.
- **`repartidores`** (G1): `id, tenant_id, nombre, empleado_id?, telefono, vehiculo, activo` + reporte productividad.
- **`hojas_ruta`** (E3/G3): `id, tenant_id, fecha, repartidor_id, token` + `hoja_ruta_envios(hoja_id, envio_id, orden)`.
- **`courier_facturas`** + **`courier_factura_lineas`** (C3): factura del courier + líneas para matchear contra envíos.
- **`envio_incidencias`** (E2): `envio_id, tipo (rotura/direccion/cliente), detalle, reportado_at`.
- **`envio_otp`** (D3): `envio_id, codigo, enviado_at, verificado_at`.
- **`tenants`** (config): `envio_plazo_despacho` (A4), `envio_factor_km` (B2), `envio_costo_minimo`/`envio_tramos` (B3), `envio_cobro_politica` (B4), `envio_gratis_reglas` (B5), `envio_pago_doble_firma_umbral` (C4), `pod_campos_requeridos` (D1), `envio_reintentos_max` (D6), `envio_token_politica` (E1), `envio_hoja_ruta_modo`/`envio_identidad_modo`/`envio_notif_modo` (E3/E4/E5), `cp_courier_preferido` (A3), `envio_recargo_horario` (B1-d).

---

## Plan por fases (EN1-EN7) — propuesto
Cada fase deployable a PROD con su versión (patrón del proyecto). Orden por dependencia/valor.

- **EN1 — Pagos a courier contables + conciliación (C2/C3/C4 + C1):** gasto auto "Logística/Courier" al pagar (solo tercero, con IVA crédito fiscal) + egreso de caja si efectivo · cargar factura courier + match + alerta diferencias · aprobación configurable por rol/umbral. *Cierra el gap contable que GO marcó explícitamente.*
- **EN2 — POD robusto + cierre de entrega (D1-D6):** campos requeridos configurables · multi-foto (mín. 1) · firma+DNI + OTP sobre umbral (propio) · geoloc con fallback · sub-estados no-entrega + motivo · re-intento con contador + re-cobro.
- **EN3 — Operación de reparto: repartidores + hoja de ruta + transportista (G1/G3 + E1-E5):** catálogo de repartidores + productividad · hoja de ruta por chofer (token agrupador) + orden por proximidad + cumplimiento · página transportista (token config, llamar/WA/incidencia, identidad config) · notificación "en camino" WA (default).
- **EN4 — Costos y tarifas avanzados (B1-B6):** nivel courier + recargo horario · factor KM config · costo mínimo/escalonado · política de cobro al cliente (margen/subsidio) · envío gratis condicional · diferencia real vs cotizado a-favor/pérdida con motivo.
- **EN5 — Creación y alcance (A1-A5):** DEPOSITO crea · envíos libres (traslado/muestra/dev) · sugerencia courier por CP · plazo de despacho por canal + alerta · **múltiples envíos por venta con `envio_items`** (desglose).
- **EN6 — Integraciones courier (F1/F2/F3):** tracking por número + cotización comparativa ("más barato") + etiquetas (descarga + térmica). **Depende de validar adapters ISS-174 con cuentas B2B.**
- **EN7 — Envío propio + recursos + reportes/alertas (G2 + H1/H2/H3):** recurso (moto/auto) + KM + combustible auto-gasto · todos los reportes (incl. margen logístico y mapa por zona) · todas las alertas · export Excel/PDF/CSV + hoja de ruta PDF + etiquetas A4 QR.

### Top 3 (I1 — recomendación, GO delegó)
1. **EN1 — Pagos courier contables** (cierra el agujero contable/IVA que GO preguntó; valor diario, bajo riesgo).
2. **EN2 — POD robusto** (firma/DNI/OTP/geoloc/sub-estados/reintento — reduce disputas y reclamos, alto valor operativo).
3. **EN3 — Repartidores + hoja de ruta + notif "en camino"** (la operación de reparto en sí; GO marcó muchos ítems de G/E).

> EN6 (integraciones) conviene **después** de validar los adapters de courier con cuentas B2B reales (bloqueante de ISS-174). Reordenable.

---

## Pendientes de confirmación antes de implementar
- **EN1/C2:** confirmar alícuota de IVA por defecto del flete courier (¿21%?) y si el gasto debe deducir ganancias.
- **A4:** confirmar los plazos default por canal (presencial 24h / online 48h / mayorista 72h?).
- **D3 OTP:** canal del código al cliente (WA por `wa.me` manual vs email automático). Default sugerido: email (automático) o WA link.
- **EN6:** depende de cuentas B2B de courier (GO) para validar adapters.
