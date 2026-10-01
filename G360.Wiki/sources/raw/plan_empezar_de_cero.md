---
name: plan_empezar_de_cero
description: Plan (2026-09-28) para "Empezar de cero conservando los datos maestros" — borrar lo operado durante la etapa de prueba de un negocio nuevo antes de facturar en serio. Clasificación real de las 153 tablas por negocio, resguardos REGLA #0, fases y 8 preguntas para GO/Fede (EC-1..EC-8).
type: plan
---

# Plan — "Empezar de cero" (conservar los datos maestros) — 2026-09-28

**Estado: PROPUESTA, sin código.** Pedido de GO: los clientes nuevos operan un tiempo "de prueba" (ventas, stock, caja)
hasta validar que todo anda; antes de pasar a facturar en serio necesitan borrar esas operaciones sin perder lo que
cargaron (productos, clientes, configuración, certificado).

## Qué hay hoy (verificado en el código)

No existe nada intermedio. Las opciones actuales:
1. **Anular venta por venta** (Supervisión): devuelve stock y registra el egreso en caja, pero quedan como "canceladas"
   y no cubre gastos, compras, ingresos de stock, conteos, etc.
2. **Borrar a mano en la base**: 153 tablas por negocio + 7 hijas sin `tenant_id`; alto riesgo de dejar huérfanos, sin
   registro de quién lo hizo, y rompe la regla de ledger inmutable de `movimientos_stock`. **Descartado.**
3. **Baja del negocio** (Mi Cuenta o panel de soporte): borra TODO, incluido el certificado (recuperarlo = cert nuevo en
   ARCA + volver a autorizar). Sirve para irse, no para reiniciar.
4. **Negocio aparte para practicar**: duplica la carga de maestros y en la práctica se practica en el real.

## 🛑 Hallazgo previo (REGLA #0): una factura no dice si su CAE es de prueba o real

`ventas` guarda `cae`, `vencimiento_cae`, `tipo_comprobante`, `numero_comprobante`, `afip_provider_usado`;
`devoluciones` guarda `nc_cae`. **Ninguna guarda el ambiente** (homologación / producción). Consecuencias:
- No se puede aplicar la regla "se puede reiniciar mientras no haya CAE real": un CAE de homologación y uno real se ven
  iguales.
- Independiente de este plan: un negocio que probó en homologación y después pasó a producción ve sus comprobantes de
  prueba mezclados con los reales en el historial y en los reportes.

→ **Fase 0** de este plan lo corrige para adelante. Los CAE que ya existen sin ambiente se tratan como **reales**
(criterio conservador: ante la duda, no se borra nada fiscal).

## Diseño propuesto

**Un botón en Configuración → "Empezar de cero"**, solo DUEÑO, que:
1. Muestra una **vista previa con cantidades** de lo que se borra y lo que se conserva.
2. Pide **escribir el nombre del negocio + clave maestra**.
3. Lo ejecuta **el servidor en UNA transacción** (todo o nada): `fn_reiniciar_operaciones`.
4. Deja un **registro permanente** (tabla nueva `reinicios_operaciones`: quién, cuándo, cantidades borradas, opción de
   stock) que el propio reinicio no borra.
5. Se **ofrece solo** al activar producción: "¿Querés borrar las operaciones de prueba antes de empezar?".

**Resguardos (servidor, no solo pantalla):**
- 🛑 **Bloqueado si existe algún CAE de producción** (o sin ambiente conocido) en ventas o notas de crédito del negocio.
  Desde el primer comprobante real hay obligación de conservación y no se reescribe historia fiscal (REGLA #0 punto 7).
- Bloqueado si hay un **período contable cerrado** (`cierres_contables`) — alguien ya dio por buenos esos números.
- Bloqueado con **cajas abiertas**: primero se cierran (o el reinicio las cierra y las borra: ver EC-5).
- 🛑 **Toda tabla nueva con `tenant_id` tiene que estar clasificada**: un test lista las tablas de `schema_full.sql` y
  falla si aparece una sin clasificar. Sin esto, dentro de 3 meses alguien agrega una tabla operativa y el reinicio la
  deja con datos de prueba colgados.

## Clasificación de las tablas (propuesta, a validar en la Fase 1)

**Se BORRA — operaciones** (+ sus hijas sin `tenant_id`):
- Ventas: `ventas`, `venta_items`, `venta_item_despachos`, `venta_series`, `venta_auditoria`, `ventas_externas_logs`,
  `devoluciones` (+`devolucion_items`), `nc_afip_pendientes`, `emision_factura_locks`, `cliente_creditos`,
  `autorizaciones_cc`, `cupones_codigos` (usos).
- Caja: `caja_sesiones`, `caja_movimientos`, `caja_arqueos`, `caja_traspasos`, `boveda_arqueos`, `boveda_retiros`,
  `boveda_conversiones_usd`, `cheques`.
- Stock: `movimientos_stock`, `inventario_lineas`, `inventario_series`, `inventario_conteos` (+`inventario_conteo_items`),
  `kitting_log`, `traslados`, `traslado_items`, `wms_tareas`, `tareas_repositor`.
- Compras y gastos: `ordenes_compra` (+`orden_compra_items`), `recepciones` (+`recepcion_items`), `devoluciones_proveedor`
  (+items), `proveedor_cc_movimientos`, `gastos`, `gasto_cuotas`, `retenciones_sufridas`, `whatsapp_gastos_borrador`.
- Pedidos y envíos: `pedidos`, `pedido_items`, `pedido_lanzamientos`, `envios`, `envio_items`, `envio_incidencias`,
  `envio_otp`, `envio_pod_fotos`, `hojas_ruta`, `hoja_ruta_envios`, `courier_facturas` (+`courier_factura_lineas`),
  `servicio_presupuestos` (+`servicio_items`).
- Avisos y bitácoras de la operación: `alertas`, `notificaciones`, `autorizaciones`, `integration_job_queue`,
  `whatsapp_mensajes_log`, `precios_programados` ya aplicados/cancelados (ver EC-7), `actividad_log` (ver EC-6).
- RRHH operativo (ver EC-4): `rrhh_fichadas`, `rrhh_asistencia`, `rrhh_anticipos`, `rrhh_horas_extra`,
  `rrhh_liquidaciones_finales`, `rrhh_vacaciones_solicitud`, `rrhh_evaluaciones`, `rrhh_capacitaciones`.

**Se CONSERVA — datos maestros y configuración:** `productos` y todo `producto_*`, `categorias`, `combos`/`combo_items`,
`kit_recetas`, `cupones` (la campaña), `precios_programados` pendientes, `clientes` (+domicilios, notas, categorías de
cliente — ver EC-2), `proveedores` (+contactos, cuentas, productos), `sucursales`, `ubicaciones`, `zonas`,
`reglas_almacenaje`, `estados_inventario`, `grupos_estados`, `aging_profiles`, `unidades_medida*`, `codigo_perfiles`,
`motivos_movimiento`, `cajas` (la definición), `cuentas_origen`, `metodos_pago`, `canales_venta`, `tipos_pedido`,
`categorias_gasto`, `gastos_fijos` (plantillas), `ventas_recurrentes` (plantillas), `users`, `roles_custom`,
`empleados` y catálogos de RRHH, `emisores_fiscales`, `puntos_venta_afip`, `tenant_certificates`, credenciales de
integraciones, `inventario_meli_map`/`inventario_tn_map`, `recursos`, `repartidores`, `courier_*` de configuración.

**NO se toca — plataforma, cobro y soporte:** `consumo_eventos` (uso facturable), `billing_*`, `mp_billing_alertas`,
`tenant_addons`, `addon_batch_changes`, `support_tickets`, `admin_customer_notes`, `leads`, `api_keys`,
`ai_tenant_memoria`, `ai_config_audit`, `proveedor_account_tenants`, `cierres_contables` (bloquean, no se borran).

**Stock (EC-1):** borrar `inventario_lineas` deja el stock en 0 (lo recalculan los triggers). La opción "mantener el
stock como inicial" recrea una línea por producto/sucursal/estado con la cantidad actual y **un** movimiento
"Stock inicial (reinicio)", en vez de conservar el historial de prueba.

**Numeración — verificado en DEV:** no hay contadores guardados; los 9 triggers de numeración (`gen_venta_numero`,
`fn_set_caja_sesion_numero`, `set_cheque_numero`, `set_devprov_numero`, `set_envio_numero`, `set_oc_numero`,
`set_pedido_numero`, `set_traslado_numero`, `trg_fn_set_recepcion_numero`) calculan `MAX(numero) + 1`, así que al
borrar las operaciones vuelven a empezar desde 1 solos. (La numeración fiscal de ARCA es otra cosa: la lleva ARCA por
punto de venta y no se toca.)

## Fases

| Fase | Qué | Tamaño |
|---|---|---|
| **0** | **(+ 29/09) sellar también `ventas.punto_venta`** — la factura no guarda en qué PV se emitió; la NC y el PDF lo adivinan. Sellar el ambiente de cada CAE: `ventas.cae_ambiente` y `devoluciones.nc_cae_ambiente` (`homologacion`/`produccion`), escrito por `emitir-factura` desde el modo del emisor al emitir. Los existentes quedan `NULL` = "desconocido" = tratado como real. Útil también para separar comprobantes de prueba en historial y reportes | chica |
| **1** | Clasificación versionada en código (`src/lib/reinicioTablas.ts` o SQL) + test que falla con una tabla sin clasificar + verificación de numeraciones | chica |
| **2** | Servidor: `fn_reiniciar_operaciones_preview` (cantidades) + `fn_reiniciar_operaciones` (SECURITY DEFINER, resguardos, borrado en orden de dependencias, opción de stock, registro en `reinicios_operaciones`) | media |
| **3** | Pantalla: Configuración → "Empezar de cero" (vista previa, opciones, confirmación) + ofrecimiento al activar producción | chica |
| **4** | (Opcional, EC-5) desde el panel de soporte `admin.genesis360.pro`, con confirmación del cliente | chica |

**Pruebas (REGLA #0):** en DEV con un negocio descartable cargado con operaciones de todos los módulos: (a) todo lo
operativo queda en 0, (b) **todo lo maestro queda idéntico** (conteo y hash antes/después), (c) cero huérfanos (FK),
(d) bloquea con un CAE de producción y con período cerrado, (e) el stock inicial cuadra con el stock previo, (f) un
negocio vecino no se toca (aislamiento), (g) e2e de la pantalla.

## ❓ Preguntas para GO y Fede (EC-1..EC-8)

- **EC-1 · Stock al reiniciar.** A: siempre a 0 (hacen después el conteo inicial real). B: siempre mantener lo que hay
  como stock inicial. **C (propuesta): que lo elija el dueño en el momento**, con B marcado por defecto.
- **EC-2 · Clientes y proveedores cargados durante la prueba.** **A (propuesta): se conservan todos** (suelen ser
  reales). B: se borran los que no tengan datos fiscales. C: que el dueño elija.
- **EC-3 · Cuántas veces.** **A (propuesta): las que quieran, mientras no haya ningún CAE real.** B: una sola vez.
- **EC-4 · RRHH.** Fichadas, liquidaciones, vacaciones y anticipos del período de prueba: **A (propuesta): se borran
  junto con lo demás** (empleados y su configuración se conservan). B: RRHH no se toca nunca.
- **EC-5 · Cajas abiertas y quién puede hacerlo.** **A (propuesta): lo hace solo el DUEÑO desde la app, con las cajas
  cerradas; soporte también desde el panel, siempre con el pedido del cliente por escrito.** B: solo el dueño.
- **EC-6 · Historial de actividad** (`actividad_log`). **A (propuesta): se borra lo del período de prueba y queda el
  registro permanente del reinicio.** B: se conserva todo el historial.
- **EC-7 · Precios programados.** **A (propuesta): se conservan los pendientes, se borra el historial de aplicados.**
- **EC-8 · Integraciones (Mercado Libre / Tienda Nube).** Si durante la prueba entraron ventas reales de un canal
  online, borrarlas de Genesis360 no las borra del canal. **A (propuesta): la vista previa las muestra aparte y pide
  confirmarlas explícitamente**; B: si hay ventas de canales, bloquear.

Las respuestas se suman a `preguntas_pendientes_2026-09-28.md`.
