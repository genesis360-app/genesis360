---
title: Módulo Configuración
category: features
tags: [configuracion, config, metodos-pago, ubicaciones, estados, categorias, sucursales, zonas, picking, alertas, notificaciones, cuenta-corriente]
sources: [CLAUDE.md, migrations 289, 290, 292, 299, 370]
updated: 2026-08-18
---

# Módulo Configuración

**Página:** `src/pages/ConfigPage.tsx` (`/configuracion`)  
**Acceso:** DUEÑO · ADMIN (lectura para otros roles según campo)

> [!NOTE] **🧾 2026-08-06 (✅ PROD desde v1.159.0):** los tabs **Clientes**, **Alertas** y
> **Notificaciones** dejaron de ser placeholders ("próximamente") — ver sección "Clientes, Alertas y
> Notificaciones" más abajo.

> [!WARNING] **🐛✅ 2026-08-08, ✅ EN PROD desde v1.161.0:** las sub-pestañas **Métodos de pago** y
> **Operativa** de **Ventas** existían como botones pero no mostraban ningún contenido desde el commit
> `6661d5c6` (backlog Fede 25/7, módulo Comercial) — reorganizó las pestañas de `ConfigPage.tsx` y
> borró por completo el JSX de renderizado de ambas sub-pestañas sin tocar los botones ni el
> estado/mutations, que seguían intactos. Causa raíz encontrada y **corregida** (commit `36ab5a89`) —
> restauradas ambas, verificadas en el navegador real, ya deployadas a PROD junto con el resto de
> v1.161.0 (PR #319). Detalle completo en la sección "Ventas" más abajo. Ver
> `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ") y `log.md` (2026-08-08).

---

## 🧾 Pedidos → "Canales que generan pedido" (v1.147.0, mig 315, ✅ PROD desde 2026-07-29)

`Configuración → Pedidos`. Chips con los canales de venta **activos** del tenant; los marcados quedan
en `tenants.pedido_canales_auto` (se guardan **ids**, así que renombrar un canal no rompe la
selección, y se sanean contra los canales vivos para no dejar pintado uno borrado o desactivado).

Una venta de un canal marcado genera automáticamente un **Pedido de preparación**. Si la venta es una
**reserva**, el pedido se genera recién cuando queda **100% pagada**. **Sin ningún canal marcado la
función está apagada** — que es el default, así que ningún tenant existente cambia de comportamiento.

Reglas completas y guards: [[wiki/features/pedidos]] → "Pedido nacido de una VENTA".


## Estructura de tabs (v1.8.33 — Fase 1)

La ConfigPage fue reorganizada de 10 tabs planas a **11 tabs temáticas** con separadores de grupo:

> [!NOTE] **Guardado consolidado (v1.67.0):** todas las cards de un tab que editan la config del negocio comparten el mismo `handleSaveBiz` (guarda todo el estado), así que ya **no hay un botón "Guardar" por card** — hay **un solo botón por tab**. Se consolidó en Envíos (11→1) y Ventas→Operativa (5→1). Al agregar una card nueva a uno de esos tabs, **no** agregues otro botón Guardar: el del final del tab ya la cubre.

### Grupo: Negocio

| Tab | Contenido |
|-----|-----------|
| **Mi negocio** | Nombre, tipo de comercio, timeout de sesión, plan actual, marketplace |
| **Ventas** | Sub-tabs: Métodos de pago · Descuentos y combos · Operativa |
| **Caja** | Contraseña maestra, umbral bóveda |
| **Clientes** | **🟡 EN DEV (2026-08-06): políticas de Cuenta Corriente** (antes sin input en pantalla) — ver "Clientes, Alertas y Notificaciones" |
| **Inventario** | Sub-tabs: Reglas de stock · Categorías · Ubicaciones · Estados · Motivos · Unidades · Atributos (✅ PROD v1.134.0) · **Zonas y picking** (✅ PROD desde v1.144.0) |
| **Envíos** | Costo por km, plantilla WhatsApp |
| **Facturación** | CUIT, condición IVA, razón social, domicilio fiscal, umbral factura B, token AFIP, certificados, puntos de venta |
| **RRHH** | Asistencia/tardanzas, Nómina, Documentos (v1.81.x, H4) |

### Grupo: Sistema

| Tab | Contenido |
|-----|-----------|
| **Alertas** | **🟡 EN DEV (2026-08-06): margen negativo + devoluciones repetidas** (antes sin input en pantalla) — ver "Clientes, Alertas y Notificaciones" |
| **Notificaciones** | **🟡 EN DEV (2026-08-06): canales CC + cumpleaños** (antes sin input en pantalla) — ver "Clientes, Alertas y Notificaciones" |
| **Conectividad** | Sub-tabs: Integraciones (TN, MELI, MP, MODO) · API |

---

## Mi negocio (v1.8.34 · consolidado v1.8.38)

Configuración a nivel tenant — aplica a todo el negocio independientemente de la sucursal.

> [!NOTE] Los campos por sucursal (CP, email, horario, PV AFIP) fueron movidos al formulario de edición de **SucursalesPage** en v1.8.38. Config → Mi negocio ya no tiene sección "por sucursal".

| Campo | DB | Descripción |
|-------|-----|-------------|
| Nombre | `tenants.nombre` | Nombre del negocio |
| Tipo de comercio | `tenants.tipo_comercio` | Selector + campo libre "Otro" |
| Redondeo de precios | `tenants.precio_redondeo` | none / $10 / $50 / $100 / $500 / $1.000 — ✅ **aplicado (v1.82.0, H4)**: redondea el precio unitario efectivo del POS al múltiplo más cercano. Helper puro `redondearPrecio` (round-half-up, fail-safe, default none) en el punto canónico `precioTierEfectivo` → subtotal/IVA/`venta_items.precio_unitario`/factura derivan todos del mismo valor redondeado. No toca precios ya guardados del catálogo. |
| Timeout de sesión | `tenants.session_timeout_minutes` | Cierre automático por inactividad |

> [!NOTE] **Email legal QUITADO (H4, 2026-06-22):** el campo `email_legal` se removió del frontend — `tenants.email` ya cubre comprobantes y emails salientes; la columna DB queda inerte.

### Marketplace
Toggle activo + webhook URL (`tenants.marketplace_activo`, `tenants.marketplace_webhook_url`)

---

## Ventas

> [!WARNING] **🐛✅ Bug real encontrado y corregido (2026-08-08, ✅ EN PROD desde v1.161.0):** las
> sub-pestañas **Métodos de pago** y **Operativa** (documentadas abajo) existían como botones en
> `subTabNav` pero, desde el commit `6661d5c6`, **no tenían ningún JSX de renderizado** — la pestaña
> "cargaba" sin error y quedaba vacía. El estado/mutations (`nuevoMetodo`, `metodosPago`,
> `cuotasBancos`, `bizReservaSenaObligatoria`, etc.) nunca se tocó, solo el bloque de render.
> Restauradas en `src/pages/ConfigPage.tsx` (líneas ~6130 y ~6416) y **verificadas en el navegador
> real** (Playwright contra el dev server, no solo `tsc`/`build`) — 7 métodos de pago reales con
> comisión/cuenta vinculada visibles en "Métodos de pago"; Canales de venta + las 4 secciones de
> "Operativa" (ver abajo) visibles y con datos reales. Regresión del spec e2e
> `98_config_ventas_envios_mutante.spec.ts`: 4/4 verde (2 fallos de la primera corrida fueron timeout
> de 30s, flake de timing, no relacionado). "Operativa" se restauró **recortada a propósito**: NO se
> duplicaron "Alertas de ventas" ni "Cuenta corriente de clientes" (esas 2 ya se habían reconstruido en
> su propio lugar — tabs Alertas/Clientes/Notificaciones, sesión 2026-08-06 — duplicarlas crearía dos
> pantallas editando el mismo dato). **Estado real: ✅ commiteado (`36ab5a89`) y deployado a PROD**
> (v1.161.0, PR #319). Sin migración nueva (fix 100% frontend). A pedido de GO también se auditó
> **Config → Caja** con el mismo método (cruzar estado `biz*` contra su uso en JSX) y **no tiene ningún
> bloque huérfano** — lo único "faltante" ahí es un placeholder explícito ("Tolerancia de diferencia en
> arqueo y panel cajero — próximamente"), no un bug.

### Sub-tab: Métodos de pago

- **Lista de métodos**: toggle activo, color, nombre — cargados desde tabla `metodos_pago` (ISS-133)
- **Comisión % por método** (`metodos_pago.comision_pct`): el % que cobra la plataforma (MP cobra 5%, tarjeta 3%). Útil para calcular ganancia neta en Dashboard.
- **Vínculo a cuenta de origen** (`metodos_pago.cuenta_origen_id`): a qué cuenta se acredita el cobro con ese método (badge azul en la lista).
- **Promo por método** (`metodos_pago.config` jsonb): descuento **al cliente** por pagar con ese método — % + tope $ opcional + días de la semana + vigencia desde/hasta. Distinto de la comisión (naranja = costo del tenant; verde = descuento al cliente). Detalle de aplicación en el POS: [[wiki/features/ventas-pos]] → "Promo por método de pago".
- **Agregar método personalizado**
- **Cuotas por banco** (`tenants.cuotas_bancos JSONB`): config por banco → planes de cuotas

### Sub-tab: Descuentos y combos

- **Combos de productos**: CRUD, 3 tipos de descuento (%, $ARS, USD), presets 3×2/2×1/2da unidad
- **Cupones** (backlog Fede Fase C, mig 332, EN DEV): card debajo de Combos — **temporal** ahí hasta
  que exista el módulo Comercial dedicado (Fase D), mismo criterio que Combos hoy. Descuento fijo en
  $ (nunca %) sobre el TOTAL de la venta, código único alfanumérico por campaña (hasta 100), vigencia
  desde/hasta, nombre + motivo. Lista de campañas con códigos usados/total y $ generado. Detalle
  técnico completo en [[wiki/features/precios-tiers-empaque]] → Fase C.
- **Descuento máximo por rol**:
  - **CAJERO** (y demás roles operativos): **100% bloqueado** de descuentos (regla C3/G3). El campo `descuento_max_cajero_pct` se **quitó** del frontend en H4 (2026-06-22) — era un tope ilusorio; la columna DB queda inerte.
  - `tenants.descuento_max_supervisor_pct`: límite para SUPERVISOR (vacío = sin límite). Se valida el **% efectivo** (los descuentos en $ se convierten a % → no esquivan el tope, lib `validarDescuentosPorRol`).
  - DUEÑO/ADMIN nunca tienen límite. Sobre el tope: con clave maestra configurada se autoriza (override); sin clave, bloquea.

### Sub-tab: Operativa

- **Canales de venta** (`<CanalesVentaPanel />`): CRUD de `canales_venta` con clasificación
  online/presencial + reglas por clasificación (`tenants.reglas_canal`) — cliente obligatorio, tope de
  descuento, lista de precio, plazo de devolución. Detalle completo: [[wiki/features/ventas-pos]] →
  "VF2 — Canales configurables + reglas online/presencial".
- **Documentos** → **Validez de presupuesto** (`tenants.presupuesto_validez_dias`): días antes de expirar
- **Reservas** (E1/E2/E6, mig 160) — políticas de seña y cancelación, dinero de clientes (Regla de Oro #0):
  - `tenants.reserva_sena_obligatoria` (default ON): sin seña no se puede reservar
  - `tenants.reserva_sena_minima_pct`: seña mínima como % del total (0 = cualquier seña > 0)
  - `tenants.reserva_vencimiento_dias`: vacío = sin vencimiento; pasados estos días sin despachar, el
    stock reservado se libera automáticamente y la reserva se cancela
  - `tenants.reserva_penalidad_pct`: % de la seña que se retiene al cancelar (0 = se devuelve completa)
  - Detalle de operación completo (liberación automática, cancelación con crédito a favor, redención):
    [[wiki/features/ventas-pos]] → "Reservas — operaciones especiales"
- **Cliente en el punto de venta**:
  - `cliente_obligatorio`: siempre / solo reservas / nunca
  - `cliente_datos_minimos`: nombre / nombre+DNI / nombre+DNI+email / todos
  - `cliente_consumidor_final` BOOLEAN: permite vender sin identificar al cliente
  - `cliente_creacion_inline` BOOLEAN: crear clientes desde el POS

---

## Caja (v1.8.34)

| Campo | DB |
|-------|-----|
| Contraseña maestra | `tenants.clave_maestra` — requerida para cerrar caja ajena, abrir con diferencia, anular, dar de baja incobrable, pago OC/courier sobre umbral. **Guardada HASHEADA (bcrypt, mig 233)** — se setea vía el RPC `set_clave_maestra` (solo DUEÑO, mínimo 6 chars, con campo de confirmación); se verifica con `verificar_clave_maestra`. No se compara nunca en el cliente. |
| Umbral bóveda | `tenants.boveda_umbral_caja` — desde **H4 (2026-06-22)** genera una **alerta no-bloqueante**: cuando una caja operativa abierta tiene efectivo sobre este monto → "conviene depositar a la Caja Fuerte". Aparece en el badge del sidebar (`useAlertas`) y en `AlertasPage`. No mueve plata. Helper `cajasSobreUmbralBoveda` (`lib/cajaSaldo.ts`). |

> [!NOTE] **2026-08-06 (EN DEV):** se corrigió el texto del placeholder "Más configuraciones de
> Caja" — decía que faltaba "doble validación cierre" cuando esa función ya estaba implementada con
> un checkbox real (ver [[wiki/features/caja]] → v1.9.5, B7). Ahora solo menciona lo que sigue
> pendiente: tolerancia de diferencia en arqueo y panel cajero.

> [!NOTE] **🆕 Sección "Caja en Dólares" (mig 370, Fase 2 de Caja USD/G5, 🟡 EN DEV, COMMITEADO Y
> PUSHEADO a `origin/dev` — commit `310d9b3b`, tag `v1.171.0`, SIN deploy a PROD, 2026-08-18).** Nueva
> sección junto a "Diferencias en cierre de caja": pills de roles habilitados para elegir tipo de
> cotización (`tenants.cotizacion_usd_roles_permitidos`), pills de roles habilitados para operar la
> futura Caja USD (`caja_usd_roles_permitidos`), input de umbral de diferencia de arqueo en USD
> (`diferencia_caja_umbral_usd`) e input de umbral de clave maestra en USD
> (`caja_usd_clave_maestra_umbral`), con botón de guardado propio. Detalle completo en
> [[wiki/features/caja]] → "Caja en USD — Fase 2 de 8".

---

## Clientes, Alertas y Notificaciones — 8 configuraciones YA VIVAS, recién con UI real (2026-08-06, ✅ PROD desde v1.159.0)

> [!IMPORTANT] Estos 3 tabs eran placeholders puros ("próximamente") hasta el 2026-08-06. La
> auditoría encontró que **8 columnas de `tenants` ya se leían en producción** (`VentasPage.tsx`,
> `ClientesPage.tsx`, `src/lib/notificacionesCC.ts`) y **ya se guardaban** desde el mega-form de
> `ConfigPage.tsx` (`handleSaveBiz`) — pero el usuario nunca tuvo un input para tocarlas salvo por SQL
> directo. Se construyó el UI real exponiendo exactamente lo que el código ya hacía, sin inventar
> comportamiento nuevo. **✅ Deployado a PROD desde v1.159.0** (PR #314, 2026-08-06) — nota corregida
> el 2026-08-08, había quedado stale como "sin commitear". Ver `wiki/business/roadmap.md` (v1.159.0) y
> `log.md` (2026-08-06).

### Tab Clientes → Cuenta corriente — políticas

| Campo | DB | Ya gatea en |
|-------|-----|-------------|
| Al superar el límite de CC | `tenants.cc_enforcement_politica` (permitir / avisar / bloquear) | `VentasPage.tsx` vía `src/lib/ccLogic.ts` — despacho a CC |
| Cliente con deuda vencida | `tenants.cc_morosidad_politica` (permitir / bloqueo_cc / bloqueo_total) | ídem |
| Límite de CC por defecto | `tenants.limite_cc_default` — fallback si el cliente no tiene `clientes.limite_credito` propio | ídem |
| Vencimiento de venta a CC (días) | `tenants.cc_dias_vencimiento` | `ventas.fecha_vencimiento_cc` |
| Interés mensual por mora (%) | `tenants.cc_interes_mensual_pct` | `recalcular_intereses_cc()` |

Ver [[wiki/features/clientes-proveedores]] → CL2 (estas mismas columnas ya estaban documentadas ahí
como parte de la lógica de negocio; la referencia a dónde se configuraban en el UI estaba stale,
corregida en esta misma sesión).

### Tab Alertas → Márgenes y devoluciones

| Campo | DB | Ya gatea en |
|-------|-----|-------------|
| Alertar venta con margen negativo | `tenants.alerta_margen_negativo` (bool) | `VentasPage.tsx` al cerrar una venta despachada |
| Alertar devoluciones repetidas — cantidad | `tenants.alerta_devoluciones_n` (vacío = desactivado) | `procesarDevolucion` |
| ...en los últimos (días) | `tenants.alerta_devoluciones_dias` | ídem |

El resto de las alertas del sistema (reservas vencidas, OC por vencer, stock sin categoría, deuda de
clientes, umbral de bóveda, vencimiento de lote, pedidos atrasados) siguen con reglas fijas, sin
configuración — ver [[wiki/features/alertas]].

### Tab Notificaciones → Cuenta corriente + Cumpleaños de clientes

| Campo | DB | Ya activo en |
|-------|-----|-------------|
| Canales (email / WhatsApp) | `tenants.cc_notif_canales` (default `['whatsapp']`) | `src/lib/notificacionesCC.ts` |
| Avisar al registrar deuda CC | `tenants.cc_notif_registro_deuda` (bool) | ídem, envía email real vía EF `send-email` |
| Avisar al recibir un pago CC | `tenants.cc_notif_pago` (bool) | ídem |
| Aviso de pre-vencimiento (días antes) | `tenants.cc_notif_pre_venc_dias` | resalta "próxima a vencer" en el tab CC del cliente |
| Saludo por WhatsApp al cliente que cumple años | `tenants.cumple_notif_cliente` (bool) | `ClientesPage.tsx` |
| Mostrarme la lista de cumpleaños del día | `tenants.cumple_notif_duenio` (bool) | ídem |

> [!WARNING] **Deuda pendiente, a propósito NO implementada:** `tenants.cc_notif_escalado_dias` (C3
> "escalado por mora") existe en la tabla desde la **mig 175** pero **nunca tuvo ninguna lógica de
> consumo** en ningún lado del código — ni backend ni frontend. Es la única pieza de este
> relevamiento que sí requiere diseño de negocio (¿qué pasa al escalar? ¿a quién se avisa? ¿qué
> acción dispara?) antes de construirse. Queda para un futuro relevamiento de Clientes/CC — no
> confundir con las 8 configuraciones de arriba, que sí estaban 100% implementadas y solo les
> faltaba el input.

---

## Inventario

### Sub-tab: Reglas de stock
- **Regla de inventario** (`tenants.regla_inventario`): FIFO / FEFO / LIFO / LEFO / Manual
- **Over-receipt** (`tenants.permite_over_receipt`): permite ingresar más cantidad que la OC
- **📦 Cubicaje volumétrico** (`tenants.cubicaje_habilitado`, default `false` — ✅ PROD desde
  v1.151.0, migs 322/325/326): calcula cuánto **espacio** ocupa lo guardado en cada ubicación.
  Al activarlo, el peso y las tres medidas pasan a ser **obligatorios por nivel** en el editor de
  estructura del producto — ésa es la clave del diseño, porque con medidas a medias el número
  miente. Incluye el **factor de aprovechamiento** (`cubicaje_factor_aprovechamiento`, default
  **0.70**: ninguna posición real se llena al 100% geométrico) y un **panel de cobertura**
  (`fn_cubicaje_cobertura`) que dice cuántos SKU están medidos — prenderlo NO completa el catálogo
  que ya existe. Detalle en [[wiki/features/wms]] → "Cubicaje volumétrico opt-in".

### Sub-tabs heredados
Todas estas secciones existían antes como tabs autónomas; ahora son sub-tabs de Inventario:
- **Categorías** → ABM de categorías de productos
- **Ubicaciones** → ABM con WMS (dimensiones, tipo, mono-SKU, surtido, devolución). **✅ EN PROD desde
  v1.160.0 (migs 334/335, cerradas en PROD recién el 2026-08-08 vía la mig 344 — nunca habían llegado
  a la base de PROD pese a lo que este wiki decía antes, ver [[wiki/features/ubicaciones]]):**
  reescrita como ÁRBOL — selector de ubicación padre (breadcrumb), código autogenerado/editable,
  `tipo_logico` (enum de negocio, con `InfoTip`) + sub-tipo de almacenamiento condicional (reemplaza al
  `tipo_ubicacion` viejo, dropeado en la mig 339, ✅ EN PROD desde v1.160.0), lista indentada por
  profundidad + búsqueda, guard de borrado si tiene niveles adentro. **🔒 `disponible_surtido`/
  `disponible_tn`/`disponible_meli` pasan de `DEFAULT true` a `DEFAULT false` (mig 336, ✅ EN PROD
  desde v1.159.0)** — las ubicaciones nuevas ya no nacen expuestas a picking/venta ni a sync de
  TN/MercadoLibre, se activan a demanda (Regla de Oro #0). Detalle completo:
  [[wiki/features/ubicaciones]].
- **Estados** → ABM + Grupos de estados + Progresión (aging profiles) + **columna % desc.** en
  "Permisos por estado" (v1.139.0, mig 284) — descuento automático al vender stock de ese estado,
  ver [[wiki/features/ventas-pos]] → "Descuento automático por estado de inventario"
- **Motivos** → ABM de motivos de movimiento (ingreso / rebaje / caja)
- **Unidades de medida** → ABM de unidades custom — desde v1.137.0 toda UdM (predefinida o propia) es usable como nivel de las estructuras de producto (footprints); Pallet se sumó a las predefinidas (mig 282). Ver [[wiki/features/estructuras-udm]]

### Sub-tab: Atributos (✅ PROD desde v1.134.0, 2026-07-18)

Catálogo configurable de valores para talle/color/encaje/formato/sabor·aroma (mig 273, tabla
`atributos_variante_valores`). CRUD por atributo (tabs), soft-delete `activo=false` (patrón Motivos).
Alimenta `AtributoValorSelect` en Recepciones/Ingreso manual y el picker de rebaje en VentasPage.
Detalle: [[wiki/features/atributos-variante]].

### Sub-tab: Zonas y picking (✅ PROD desde v1.144.0, migs 289-290)

Cierra las Fases 3-5 del roadmap de [[wiki/features/estructuras-udm]]:

- **2 toggles de reabastecimiento**, independientes (habilitables por separado, juntos o ninguno):
  `tenants.wms_reabastecimiento_on_demand` (default ON, encadena reabastecimiento al generar
  picking de un envío) y `tenants.wms_reabastecimiento_umbral` (default OFF, sweep manual
  "Procesar ahora" cuando el stock de una ubicación de picking cae bajo el mínimo configurado).
- **CRUD de Zonas** (`zonas`, catálogo tenant-scoped) — agrupan ubicaciones; el form de
  **Ubicaciones** ganó un selector de zona.
- **CRUD de Reglas de almacenaje** (`reglas_almacenaje`) — UdM → zona sugerida al ingresar stock;
  la sugerencia es editable, nunca bloquea.
- **CRUD de Umbrales** (`producto_ubicacion_umbrales`) — mín/máx por producto+ubicación de picking,
  usado por el sweep de reabastecimiento por umbral.

Detalle completo del schema/RPCs/UI: [[wiki/features/wms]] → "Fase 3" y "Fase 4".

> **Nota (2026-07-22, actualizada 2026-07-23):** el toggle `wms_reabastecimiento_on_demand` describía
> "encadena reabastecimiento al generar picking de un envío" — con el pivote F4 de
> [[wiki/features/pedidos]] (Ventas/Envíos ya NO generan tareas WMS), ese encadenamiento en la
> práctica solo se dispara desde Pedidos (`fn_generar_tareas_picking_pedido`, mig 294), no desde un
> envío de Ventas. Sin cambios en el comportamiento actual de este toggle en sí. **Tab "Pedidos" ya
> construida (PED7):** numeración, tipos de pedido, cierre automático, y editor de
> `pedido_transiciones_roles` (E3, quién puede confirmar/lanzar/entregar/cancelar/deslanzar por rol)
> — ver [[wiki/features/pedidos]] → PED7.

---

## Envíos

| Campo | DB |
|-------|-----|
| Costo por km | `tenants.costo_envio_por_km` — para calcular delivery propio |
| Plantilla WhatsApp | `tenants.whatsapp_plantilla` — variables: Nombre_Cliente, Numero_Orden, etc. |

---

## Facturación (AFIP/ARCA)

| Campo | DB |
|-------|-----|
| Habilitada | `tenants.facturacion_habilitada` |
| CUIT | `tenants.cuit` |
| Condición IVA | `tenants.condicion_iva_emisor` |
| Razón social | `tenants.razon_social_fiscal` |
| Domicilio fiscal | `tenants.domicilio_fiscal` |
| Umbral factura B | `tenants.umbral_factura_b` (RG 5616) |
| Token AfipSDK | `tenants.afipsdk_token` — de afipsdk.com |
| Certificados | tabla `tenant_certificates` (crt + key) — upload via Storage |
| Puntos de venta | tabla `puntos_venta_afip` — número + nombre |

---

## RRHH (H4 — v1.81.x, 2026-06-22)

Tab construido para configurar los flags `rrhh_*` que RrhhPage lee pero antes no tenían UI (eran "placeholder vacío"). Los otros flags de RRHH (doble validación, portal del empleado, notificaciones, aviso/remanente de vacaciones) **ya se configuran dentro de RRHH** en su sección.

| Sección | Campo | DB | Descripción |
|---------|-------|-----|-------------|
| Asistencia/tardanzas | Tratamiento de la tardanza | `tenants.rrhh_tardanza_modo` | `registrar` (no descuenta) / `proporcional` (descuenta todos los minutos) / `umbral` (descuenta lo que excede la tolerancia) — afecta la liquidación |
| Asistencia/tardanzas | Tolerancia (min) | `tenants.rrhh_tardanza_tolerancia_min` | Minutos que no se descuentan. Solo aplica al modo `umbral`. |
| Asistencia/tardanzas | Horas/mes base | `tenants.rrhh_horas_mes_base` | Divisor para el valor hora a partir del sueldo bruto (default 200) |
| Asistencia/tardanzas | Horas extra requieren aprobación | `tenants.rrhh_horas_extra_requiere_aprobacion` | Bool |
| Nómina | SUPERVISOR puede aprobar la nómina | `tenants.rrhh_nomina_supervisor_aprueba` | Cuenta como 2ª validación (si la doble validación está activada en RRHH → Nómina) |
| Documentos | Avisar vencimientos con (días) | `tenants.rrhh_doc_alerta_dias` | Anticipación para marcar un documento como "por vencer" (default 30) |

---

## Conectividad

### Sub-tab: Integraciones

Conectar cuentas externas por sucursal:

| Plataforma | OAuth | Modelo |
|---|---|---|
| TiendaNube | ✅ | Sync stock bidireccional + mapeo productos + sync de precio (🆕 D3, mig 346) |
| MercadoLibre | ✅ | Sync stock + mapeo + precios |
| MercadoPago | ✅ | Credenciales de pago por sucursal |
| MODO | Credenciales | Merchant ID + API Key + ambiente (test/prod) |

**🆕 Card "Repricing automático por margen" (Fase D3, 2026-08-08, mig 346, backend EN PROD)** — modo
(automático siempre / alerta para aprobar / automático desde un monto en $), tope de suba (%,
opcional) y umbral de aviso ($, opcional). Config a nivel tenant del mecanismo 1 (ajuste ÚNICO
cross-canal por margen objetivo); el interruptor por producto y el ajuste % propio por canal viven en
la ficha del producto. Detalle completo: [[wiki/integrations/mercado-libre]] → "Repricing automático
por margen".

### Sub-tab: API

- API de datos externa (solo lectura)
- Genera claves `g360_xxxxx` con hash SHA-256
- Endpoints: productos, clientes, proveedores, inventario
- Rate limit: 120 req/min

---

## Links relacionados

- [[wiki/features/gastos]]
- [[wiki/features/caja]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/wms]] — "Zonas y picking" (v1.143.0)
- [[wiki/features/ubicaciones]] — rediseño en árbol + `tipo_logico` del sub-tab Ubicaciones (migs
  334/335, ✅ PROD desde v1.160.0 — recién el 2026-08-08 vía mig 344, gap real de deploy); defaults de
  picking/TN/MELI apagados (mig 336, ✅ EN PROD desde v1.159.0)
- [[wiki/features/clientes-proveedores]] — CL2 (políticas de CC, ahora con UI real en tab Clientes)
- [[wiki/features/alertas]] — márgenes/devoluciones, ahora con UI real en tab Alertas
- [[wiki/features/ventas-pos]] — VF4/K2 (alertas de margen negativo/devoluciones), ahora con UI real
- [[wiki/features/pedidos]] — módulo NUEVO, tab "Pedidos" en Config (PED7, completa: numeración,
  tipos, cierre automático, editor de roles por transición)
- [[wiki/features/estructuras-udm]] — roadmap de Zonas/Picking/Reabastecimiento
- [[wiki/integrations/roadmap-apis]]
