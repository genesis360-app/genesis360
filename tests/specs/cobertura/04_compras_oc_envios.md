# Cobertura de testing — Compras / OC / Proveedores + Envíos

> Auditoría de cobertura (GO 2026-06-21). Marco y convención: `tests/specs/uat-cobertura.plan.md`.
> Zona **REGLA #0** (afecta stock + plata: recepciones, pagos de OC, devoluciones a proveedor con crédito CC,
> pago a courier). Leyenda cobertura: ✅e2e (spec NN) · ✅unit · ✅UAT(§) · 🟡parcial · 🔴gap.
>
> Archivos cubiertos: `ProveedoresPage.tsx` (OC + devolución + CC + servicios), `RecepcionesPage.tsx`
> (parte OC), `EnviosPage.tsx`, `TransportistePage.tsx`, `GastosPage.tsx` (pago de OC), `ChequesPanel.tsx`
> (rechazo de cheque), `EnviosReportesPanel.tsx`, libs `compras*.ts`, `recepcionLogic.ts`,
> `devolucionProveedor.ts`, `envios*.ts`, `serviciosRecurrentes.ts`, `ocPDF.ts`.

---

## 1) Tabla de Lógicas

| # | Lógica | file:función | REGLA #0 | Cobertura |
|---|--------|--------------|:--------:|-----------|
| **Compras / OC / Proveedores** |
| L1 | Capacidad de crear OC por rol (completa/borrador/ninguna) | `comprasPermisos.ts:capacidadCrearOC` | — | ✅unit |
| L2 | OC requiere aprobación (gate activo + umbral) | `comprasPermisos.ts:ocRequiereAprobacion` · uso `ProveedoresPage.tsx:1010,1026,1051` | 🟠 (gobierno) | ✅unit · 🔴e2e/UAT runtime |
| L3 | Quién aprueba / quién envía OC | `comprasPermisos.ts:puedeAprobarOC,puedeEnviarOC` · uso `ProveedoresPage.tsx:1151-1166,2237-2262,3152-3178` | 🟠 | ✅unit · 🔴e2e runtime (transición borrador→enviada con aprobación) |
| L4 | Crear / editar OC (recalcula `requiere_aprobacion`, snapshot anticipo/schedule, ítems) | `ProveedoresPage.tsx:998-1090` | 🟠 (montos) | 🟡e2e **34** (alta sin aprobación, en borrador) |
| L5 | Numeración de OC (`tenant`/`sucursal`/`proveedor`) — etiqueta `S-OC-0001` vs `#N` | `ProveedoresPage.tsx:136-138` (etiqueta) + trigger `set_oc_numero` (DB) | 🟠 | 🔴gap (etiqueta y trigger por valor) |
| L6 | Anticipo por proveedor (default + monto) | `comprasPago.ts:defaultAnticipoOC,montoAnticipo` | 🟠 | ✅unit |
| L7 | Schedule de pago por OC (validez suma 100, base, monto cuota) | `comprasPago.ts:scheduleValido,totalPctSchedule,montoCuota` · uso `ProveedoresPage.tsx:1013` | 🟠 | ✅unit |
| L8 | **Pago de OC** (medios mixtos, CC, efectivo→egreso caja, no-efectivo→egreso_informativo) | `GastosPage.tsx:694-861` | 🔴 **plata** | 🔴gap e2e/UAT |
| L9 | Pago de OC: CONTADOR read-only | `comprasPermisos.ts:puedeRegistrarPagoOC` · uso `GastosPage.tsx:720` | 🔴 | ✅unit · 🔴e2e (rol) |
| L10 | Pago de OC: doble firma por umbral (clave maestra) | `comprasPermisos.ts:requiereDobleFirmaPago` · uso `GastosPage.tsx:721-727,3413` | 🔴 **plata** | ✅unit (cálculo) · 🔴e2e/UAT (clave real + gate) |
| L11 | Pago de OC: saldo no excedible (`montoTotalMedios > saldo`) | `GastosPage.tsx:729-732` | 🔴 | 🔴gap |
| L12 | Pago de OC con CC: bloqueo por vencidas/límite (override autorización) | `GastosPage.tsx:741-759` (`chequearBloqueoCC`,`existeAutorizacionCCAprobada`) | 🔴 **plata** | 🔴gap |
| L13 | Pago de OC con Cheque: crea cheque vinculado (`oc_id`) + fecha cobro obligatoria | `GastosPage.tsx:734-739,803-822` | 🔴 | 🟡 (alta cheque cubierta por spec 31 vía gasto; OC no) |
| L14 | **Rechazo de cheque propio → revierte pago de OC** (monto_pagado/estado_pago) + reaparece deuda en CC | `comprasCheques.ts:reversionPagoOC` · uso `ChequesPanel.tsx:143-168` | 🔴 **plata** | ✅unit (cálculo) · 🟡e2e 31 (vía gasto) · 🔴e2e brazo OC |
| L15 | Rechazo de cheque → revierte pago de gasto | `comprasCheques.ts:reversionPagoGasto` · uso `ChequesPanel.tsx:169-178` | 🔴 | ✅unit · ✅e2e 31 |
| L16 | Cheques diferidos: transiciones de estado por tipo, endoso, alerta cobro, validación alta | `comprasCheques.ts:estadosSiguientes,puedeEndosar,chequeProximoACobrar,validarChequeAlta` | 🔴 | ✅unit |
| L17 | **Recepción → estado de OC** desde acumulado (recibida/parcial/sin_recibir) | `recepcionLogic.ts:estadoOCdesdeRecibido` · uso `RecepcionesPage.tsx` | 🔴 **stock** | ✅unit · ✅e2e **35** (recibida) · 🔴parcial |
| L18 | **Over-receipt** (acum > tope permitido) bloquea/permite | `recepcionLogic.ts:superaOverReceipt` · uso `RecepcionesPage.tsx:488` | 🔴 **stock** | ✅unit · 🔴e2e/UAT runtime |
| L19 | Under-receipt: motivo de faltante obligatorio | `recepcionLogic.ts:tieneFaltante` · uso `RecepcionesPage.tsx:493` | 🔴 | ✅unit · 🔴e2e |
| L20 | Ajuste de cantidad (over/under) requiere SUPERVISOR+ | `recepcionLogic.ts:esAjusteCantidad` · uso `RecepcionesPage.tsx:466` | 🔴 | ✅unit · 🔴e2e (rol) |
| L21 | Remito obligatorio al recibir (`recepcion_remito_obligatorio`) + subida a bucket `remitos` | `RecepcionesPage.tsx:500-516,1200` | 🟠 | 🔴gap |
| L22 | Alerta de cambio de costo al recibir + actualizar `precio_costo` | `comprasCostos.ts:cambioCostoPct,superaAlertaCosto` · uso `RecepcionesPage.tsx:1443` (alerta), `656-671` (efecto) | 🔴 **costo** | ✅unit (umbral/pct) · ✅code-verified 2026-06-24 (confirm de recepción: `if (it.actualizar_costo && |nuevo−default|>0.001) UPDATE productos SET precio_costo=nuevo` + logActividad; si no tildado → no toca el costo + log "no actualizado". Operador decide, sin pisar silencioso) |
| L23 | Costo total OC con accesorios | `comprasCostos.ts:totalOCconAccesorios` · `ocPDF.ts:totalOC` | 🟠 | ✅unit |
| L24 | **Devolución a proveedor — rebaja stock FIFO + movimiento `ajuste_rebaje`** | `ProveedoresPage.tsx:1208-1229`; valida `devolucionProveedor.ts:validarDevolucion,montoDevolucion` | 🔴 **stock** | ✅unit (valida) · ✅e2e **33** (forma credito_cc) |
| L25 | Devolución forma **credito_cc** → `nota_credito` negativa en `proveedor_cc_movimientos` | `ProveedoresPage.tsx:1234-1239` | 🔴 **plata** | ✅e2e **33** |
| L26 | Devolución forma **efectivo** → ingreso a caja (con fallback "primera abierta" + toast si no hay) | `ProveedoresPage.tsx:1240-1250` | 🔴 **plata** | 🔴gap |
| L27 | Devolución forma **reposicion** → crea OC borrador con los ítems | `ProveedoresPage.tsx:1251-1262` | 🔴 | 🔴gap |
| L28 | Reportes de compras: por proveedor, calificación A/B/C, top productos, aging, OC vencidas, evolución costo | `comprasReportes.ts:*` | 🟠 | ✅unit |
| L29 | Servicios recurrentes: vencimiento, períodos acumulados, comparar presupuestos | `serviciosRecurrentes.ts:*` | 🟠 | ✅unit |
| L30 | OC PDF / texto WhatsApp / wa.me | `ocPDF.ts:generarOCPDF,textoOC,waLinkOC` | — | ✅unit (texto/total) · 🔴 capa manual (PDF visual) |
| L31 | Alerta anticipo→OC sin recibir (badge rojo) | `GastosPage.tsx:3040` (`gastos_dias_alerta_anticipo_oc`) | 🟠 | 🔴gap |
| **Envíos** |
| L32 | Crear envío: tipos, sugerir courier por CP, plazo despacho por canal, unidades enviadas | `enviosCreacion.ts:*` · uso `EnviosPage.tsx:2181` | 🟠 | ✅unit |
| L33 | Costo envío propio ($/km × factor, tramos, recargo horario, mínimo) | `enviosTarifas.ts:costoEnvioPropio` · uso `EnviosPage.tsx:471-478` | 🟠 (costo) | ✅unit |
| L34 | Cobro al cliente por política (cliente_100/margen/subsidio) + envío gratis condicional + diferencia real | `enviosTarifas.ts:cobroCliente,envioGratis,diferenciaReal` | 🔴 (cobra al cliente) | ✅unit · 🔴e2e (efecto en venta) |
| L35 | **Pago a courier → genera gasto** por courier (IVA crédito) + egreso/egreso_informativo en caja | `EnviosPage.tsx:780-868`; `enviosCourierPago.ts:agruparPagosPorCourier,desgloseIvaFlete` | 🔴 **plata** | ✅unit (cálculo) · 🔴e2e/UAT (efecto gasto+caja) |
| L36 | Pago a courier: doble firma por umbral (clave maestra) | `enviosCourierPago.ts:requiereDobleFirma` · uso `EnviosPage.tsx:787-795,1740` | 🔴 **plata** | ✅unit · 🔴e2e/UAT |
| L37 | Conciliación factura courier vs registrado | `enviosCourierPago.ts:diffFactura,totalRegistrado` | 🟠 | ✅unit |
| L38 | **Envío propio → combustible → gasto** (litros, costo, IVA, km acumulado al recurso) | `enviosRecurso.ts:*` · uso `EnviosPage.tsx:335,2789` | 🔴 **plata** | ✅unit · ✅e2e **38** |
| L39 | POD: campos requeridos + foto mínima | `enviosPod.ts:podFaltantes` · uso `EnviosPage.tsx:704-705`, `TransportistePage.tsx:101-102` | 🟠 | ✅unit · 🔴e2e |
| L40 | POD: OTP por umbral (propio), geoloc fallback, no-entrega/reintento, recargo reintento | `enviosPod.ts:requiereOtp,geoEstado,resolverNoEntrega,recargoReintento` · uso `EnviosPage.tsx:757`, `TransportistePage.tsx:103,415` | 🟠 | ✅unit |
| L41 | Reparto: productividad, cumplimiento día, orden hoja de ruta (proximidad), token expira, identidad | `enviosReparto.ts:*` · uso `EnviosPage.tsx:957,1031` | 🟠 | ✅unit |
| L42 | Notif "en camino" por modo (no/wa/wa_tracking) | `EnviosPage.tsx:654` (`envio_notif_en_camino`) | — | 🔴gap |
| L43 | Reportes envíos + alertas (sin despacho/POD/pago courier/diferencia) | `enviosReportes.ts:*` · uso `EnviosReportesPanel.tsx:100-103` | 🟠 | ✅unit |

**Resumen lógicas:** 43 lógicas. Pura (libs) muy bien cubierta por unit. El **runtime con efecto en DB
(plata/stock)** es donde está el grueso del gap: solo 4 caminos felices con un único valor de flag tienen
e2e (specs 33/34/35/38).

---

## 2) Matriz de flags de `tenants`

> uso = file:line donde se LEE el flag · "CON" = comportamiento con el flag activo/valor · "SIN/por-valor"
> = comportamiento con el flag inactivo/default o el otro valor del enum. Cobertura = ✅/🟡/🔴.

### Compras / OC / Recepciones / Gastos

| flag | default | uso (file:line) | CON | SIN / por-valor | Cobertura |
|------|---------|-----------------|-----|-----------------|-----------|
| `oc_aprobacion_activa` | `false` | `ProveedoresPage.tsx:134` → `comprasPermisos.ts:18-25` | OC con monto ≥ umbral (o todas, si umbral nulo) queda `requiere_aprobacion=true`; solo rol aprobador la envía | OC nunca requiere aprobación; cualquiera con capacidad completa la envía | ✅unit · 🔴e2e/UAT runtime |
| `oc_aprobacion_umbral` | `NULL` | `ProveedoresPage.tsx:134` → `comprasPermisos.ts:23-24` | OC sobre el umbral requiere aprobación; debajo no | activa + umbral nulo ⇒ **toda** OC requiere aprobación | ✅unit · 🔴e2e |
| `oc_pago_doble_firma_umbral` | `NULL` | `GastosPage.tsx:721,3414` → `comprasPermisos.ts:52-57` | pago de OC ≥ umbral exige clave maestra (**solo si `clave_maestra` está seteada**) | sin umbral (0/null) ⇒ nunca exige doble firma | ✅unit (cálculo) · 🔴e2e/UAT |
| `oc_numeracion` | `'sucursal'` | `ProveedoresPage.tsx:136-138` + trigger `set_oc_numero` | `sucursal`→ etiqueta `S-OC-0001` (`numero_sucursal`); `tenant`/`proveedor`→ otra secuencia | default `sucursal` | 🔴gap (los 3 valores) |
| `permite_over_receipt` | `false` | `RecepcionesPage.tsx:119` → `recepcionLogic.ts:41-51` | recibir más que lo pedido permitido (hasta `over_receipt_pct_max`) | cualquier exceso sobre lo pedido se bloquea | ✅unit · 🔴e2e/UAT |
| `over_receipt_pct_max` | `NULL` | `RecepcionesPage.tsx:119` → `recepcionLogic.ts:48-50` | over-receipt permitido solo hasta `esperada×(1+pct/100)` | permite + pctMax null/0 ⇒ over-receipt **libre** (sin tope) | ✅unit · 🔴e2e/UAT |
| `recepcion_remito_obligatorio` | `false` | `RecepcionesPage.tsx:120,500,1200` | no se puede confirmar recepción sin adjuntar remito (sube a bucket `remitos`) | remito opcional | 🔴gap |
| `compras_costo_alerta_pct` | `10` | `RecepcionesPage.tsx:121,1443` → `comprasCostos.ts:16-20` | si el costo recibido varía ≥ pct vs actual → alerta + checkbox "actualizar precio_costo" | umbral más alto/bajo cambia la sensibilidad de la alerta | ✅unit · 🔴e2e (efecto en producto) |
| `gastos_dias_alerta_anticipo_oc` | `15` | `GastosPage.tsx:3040` | OC con anticipo sin recibir hace N días → badge **rojo** | < N días → badge naranja | 🔴gap |

### Envíos (todas, según prompt)

| flag | default | uso (file:line) | CON | SIN / por-valor | Cobertura |
|------|---------|-----------------|-----|-----------------|-----------|
| `envio_cobro_politica` | `'cliente_100'` | `EnviosPage`/`VentasPage` → `enviosTarifas.ts:cobroCliente` | `cliente_margen`→ costo+margen%; `subsidio`→ gratis si venta ≥ umbral | `cliente_100`→ cobra el costo tal cual | ✅unit · 🔴e2e |
| `envio_cobro_margen_pct` | `0` | `ConfigPage.tsx:670` → `cobroCliente` params | con `cliente_margen` aplica el % | 0 ⇒ sin margen | ✅unit · 🔴e2e |
| `envio_subsidio_umbral` | `0` | `ConfigPage.tsx:671` → `cobroCliente` | con `subsidio` y venta ≥ umbral ⇒ envío gratis | 0 ⇒ subsidio nunca aplica | ✅unit · 🔴e2e |
| `envio_courier_genera_gasto` | `true` | `EnviosPage.tsx:797,1766` | pagar courier crea un gasto "Transporte y fletes" (+ egreso caja) | `false` ⇒ marca pagado sin crear gasto | 🔴gap (**afecta plata**) |
| `envio_courier_iva_pct` | `21` | `EnviosPage.tsx:798,810` → `desgloseIvaFlete` | desglosa IVA crédito del flete a ese % | 0 ⇒ sin IVA crédito | ✅unit (cálculo) · 🔴e2e |
| `envio_pago_doble_firma_umbral` | `0` | `EnviosPage.tsx:787,1740` → `enviosCourierPago.ts:57-60` | pago courier ≥ umbral exige clave maestra (**solo si `clave_maestra` seteada**) | 0 ⇒ nunca exige | ✅unit · 🔴e2e/UAT |
| `costo_envio_por_km` | `NULL` | `EnviosPage.tsx:471,2313`; `VentasPage.tsx:735` | $/km global (fallback de `sucursal.costo_km_envio`) | sin valor ⇒ costo 0 / aviso "configurá tarifa" | 🟡unit (cálculo) · 🔴e2e |
| `envio_factor_km` | `1.35` | `EnviosPage.tsx:475` → `costoEnvioPropio` | penaliza la distancia real (km×$/km×factor) | otro factor escala el costo | ✅unit |
| `envio_costo_minimo` | `0` | `EnviosPage.tsx:476` → `costoEnvioPropio` | piso del costo de envío propio | 0 ⇒ sin piso | ✅unit |
| `envio_tramos` (jsonb) | `[]` | `EnviosPage.tsx:477` → `costoEnvioPropio` | costo escalonado por km (ignora $/km) | vacío ⇒ usa $/km×factor | ✅unit |
| `envio_recargo_horario` (jsonb) | `[]` | `EnviosPage.tsx:478` → `costoEnvioPropio` | suma recargo fijo si la hora cae en la franja | vacío ⇒ sin recargo | ✅unit |
| `envio_gratis_reglas` (jsonb) | `{}` | `ConfigPage.tsx:672` → `enviosTarifas.ts:envioGratis` | gratis por monto/etiqueta cliente/promo vigente | vacío ⇒ nunca gratis por regla | ✅unit · 🔴e2e |
| `envio_combustible_precio_litro` | `0` | `EnviosPage.tsx:335,2789,2801` → `enviosRecurso.ts:costoCombustible` | estima costo combustible del envío propio | 0 ⇒ costo 0 (operador tipea a mano) | ✅unit · ✅e2e 38 |
| `pod_campos_requeridos` (jsonb) | `{fecha,receptor:true}` | `EnviosPage.tsx:704`; `TransportistePage.tsx:101` → `podFaltantes` | exige los campos marcados para cerrar entrega | otros toggles ⇒ otros faltantes | ✅unit · 🔴e2e |
| `pod_foto_min` | `0` | `EnviosPage.tsx:705`; `TransportistePage.tsx:102` → `podFaltantes` | exige ≥ N fotos | 0 ⇒ no exige fotos | ✅unit |
| `pod_otp_umbral` | `0` | `TransportistePage.tsx:103` → `enviosPod.ts:requiereOtp` | envío propio ≥ umbral exige OTP del receptor | 0 ⇒ nunca OTP | ✅unit |
| `envio_reintentos_max` | `3` | `EnviosPage.tsx:757,2694`; `TransportistePage.tsx:415` → `resolverNoEntrega` | "ausente" reintenta hasta N; luego devolución | otro N cambia el corte | ✅unit |
| `envio_token_politica` | `'al_entregar'` | `EnviosPage.tsx:1031,1583` → `tokenExpiraAt` | `dias`→ token expira ahora+`envio_token_dias` | `al_entregar`→ token sin expiración (lo limpia el cron) | ✅unit |
| `envio_token_dias` | `30` | `EnviosPage.tsx:1031` → `tokenExpiraAt` | días de vida del token (con política `dias`) | default 30 | ✅unit |
| `envio_identidad_modo` | `'anonimo'` | `TransportistePage.tsx:261` | `nombre_dni`→ chofer ingresa nombre+DNI antes de operar | `anonimo`→ acceso directo por link | 🔴gap |
| `envio_notif_en_camino` | `'wa'` | `EnviosPage.tsx:654` | `wa`/`wa_tracking`→ ofrece WhatsApp al despachar | `no`→ no notifica | 🔴gap |
| `envio_hoja_ruta_modo` | `'agrupada'` | `EnviosPage.tsx:957` → `ordenarHojaRuta` | `agrupada_proximidad`→ orden por vecino más cercano; `por_envio`→ 1 link c/u | `agrupada`→ por chofer/zona | 🟡unit (orden) · 🔴e2e |
| `envio_peso_fuente` | `'manual'` | `ConfigPage.tsx:632` | `producto`→ peso desde producto | `manual`→ se tipea | 🔴gap |
| `envio_rangos_horarios` (jsonb) | `[]` | `EnviosPage.tsx:578,1205,2489`; `VentasPage.tsx:2888` | franjas de entrega seleccionables | vacío ⇒ sin franjas | 🔴gap |
| `cp_courier_preferido` (jsonb) | `[]` | `EnviosPage.tsx:2181` → `sugerirCourierPorCp` | sugiere courier según CP (exacto o rango) | vacío ⇒ no sugiere | ✅unit · 🔴e2e |
| `envio_alerta_sin_despacho_horas` | `24` | `EnviosReportesPanel.tsx:100` → `alertasEnvios` | alerta envíos pendientes ≥ N horas | otro N cambia el corte | ✅unit |
| `envio_alerta_pod_pendiente_dias` | `3` | `EnviosReportesPanel.tsx:101` → `alertasEnvios` | alerta POD pendiente ≥ N días | — | ✅unit |
| `envio_alerta_pago_courier_dias` | `7` | `EnviosReportesPanel.tsx:102` → `alertasEnvios` | alerta pago courier pendiente ≥ N días (excluye propio) | — | ✅unit |
| `envio_alerta_diferencia_pct` | `15` | `EnviosReportesPanel.tsx:103` → `alertasEnvios` | alerta diferencia cotizado vs real ≥ pct | — | ✅unit |

**Resumen flags:** ~40 flags relevantes. La **lógica pura detrás de cada flag** está bien testeada por unit
(cálculos de tarifa/IVA/aprobación/over-receipt/POD), pero **ningún flag tiene un escenario CON/SIN a nivel
runtime con efecto en DB** (los e2e existentes corren con el valor default). El gap de GO ("probar con y sin
cada flag y validar el comportamiento") está casi 100% abierto en la capa de runtime para este grupo.

---

## ✅ CIERRE REGLA #0 — barrido 2026-06-23 (módulo CERRADO, DB-verificado)

Todos los gaps de plata/stock del §3 quedaron cubiertos. Método: impersonación SQL del RPC con ROLLBACK
(autoridad server-side) + specs e2e mutantes (env-gated) como artefactos de regresión.

- **L8/L11/L12 — Pago de OC contable** ✅ **DB-validado** (RPC `registrar_pago_oc`, mig 237, ROLLBACK):
  efectivo → `caja_movimientos` **`egreso`** + `proveedor_cc` `pago` (−monto) + OC `monto_pagado`/`estado_pago`;
  no-efectivo → **`egreso_informativo`** + `cuenta_origen`; CC → `proveedor_cc` `oc` (+monto, venc +Nd) sin caja;
  **saldo no excedible** bloquea ("supera el saldo"); CONTADOR bloqueado por rol.
- **L10 — Doble firma pago OC** ✅ **DB-validado** (matriz completa): umbral CON clave → mala bloquea / correcta
  procesa; **umbral SIN clave configurada → BLOQUEA** ("configurá una clave maestra") — el bug latente del §2
  está cerrado server-side; debajo del umbral procesa sin pedir clave.
- **L35/L36 — Pago a courier** ✅ **DB-validado** (RPC `marcar_envios_pagados`, mig 238, ROLLBACK): genera 1
  gasto "Flete {courier}" + caja **`egreso`** (efectivo) + marca `costo_pagado`/`gasto_id`; `genera_gasto=false`
  → marca pagado **sin** gasto ni caja; doble firma idéntica a L10 (clave mala/ok/sin-clave). 📌 **Observación
  fiscal (no bug):** el flete genera el gasto SIN `tipo_comprobante`, así que `fn_gastos_iva_guard` (mig 227)
  **anula el IVA crédito** salvo RI+Factura A — para un Monotributo es correcto (sin crédito); para un RI que
  quiera crédito sobre fletes, cargar la Factura A del courier como gasto detallado. Conservador/seguro.
- **L18 — Over-receipt** ✅ specs 52 (SIN tope → bloquea) + 74 (CON tope → acepta dentro del +pct).
- **L19 — Under-receipt motivo obligatorio** ✅ **spec 79** (recibir 5<10 sin motivo → "Indicá el motivo del
  faltante", no crea recepción) — guard `RecepcionesPage:493` sobre `tieneFaltante` (✅unit).
- **L20 — Ajuste de cantidad requiere SUPERVISOR+** ✅ code-verified (`RecepcionesPage:466`, `esAjusteCantidad`
  ✅unit). Como OWNER no aplica; un rol no-supervisor recibe ≠ pedido → bloquea.
- **L24/L25 — Devolución credito_cc** ✅ spec 33.
- **L26 — Devolución efectivo** ✅ **spec 77** (ingreso a caja + rebaja stock FIFO + `ajuste_rebaje`).
  ✅ **HALLAZGO RESUELTO (v1.87.0):** el reembolso en efectivo ahora **EXIGE una caja OPERATIVA abierta**
  (excluye la bóveda) **ANTES** de rebajar stock; sin caja **BLOQUEA** con un toast que incluye un **link a Caja**
  ("Abrí una caja") para abrir una en el momento (`ProveedoresPage.confirmarDevolucion`). Cierra el hueco de
  "plata fuera del arqueo" (mismo patrón del bug venta #26). El reembolso se asienta en la caja operativa, no
  en la bóveda (corregía un bug latente: `cajasAbiertasProv[0]` podía ser la bóveda).
- **L27 — Devolución reposición** ✅ **spec 78** (crea OC borrador con ítems + rebaja stock + `oc_reposicion_id`).
- **L14 — Rechazo de cheque (brazo OC)** ✅ **DB-validado** (réplica `ChequesPanel.cambiarEstado`/`reversionPagoOC`,
  ROLLBACK): OC `monto_pagado`→0, `estado_pago`→`pendiente_pago`, `proveedor_cc` `ajuste` (+monto, deuda
  reaparece). ✅unit (`reversionPagoOC`) + spec 31 (brazo gasto, mismo path) + **spec 80** (brazo OC, fixture).

**Residual no-REGLA-#0 (UX/secundario):** `oc_numeracion` por valor (L5), `recepcion_remito_obligatorio` (L21),
alerta de costo→`precio_costo` (L22), `gastos_dias_alerta_anticipo_oc` (L31), cobro al cliente por política→venta
(L34), `envio_identidad/notif/peso/rangos` (UX). No tocan integridad fiscal/contable/inventario.

---

## 3) Gaps priorizados REGLA #0 (plata / stock)

> Cada uno: escenario CON el flag y SIN/por-valor, aserción POSITIVA + verificación de la mutación en DB.

1. **Gate de pago de OC con efecto contable (L8/L11/L12)** — 🔴 sin e2e/UAT.
   Pagar una OC confirmada: (a) **efectivo** ⇒ `egreso` en `caja_movimientos` + `proveedor_cc_movimientos`
   tipo `pago` (-monto) + `monto_pagado/estado_pago` (`GastosPage.tsx:761-841`); (b) **no efectivo** ⇒
   `egreso_informativo` con `cuenta_origen_id`; (c) **CC** ⇒ `tipo='oc'` (+monto, suma deuda) y bloqueo por
   vencidas/límite (`GastosPage.tsx:741-759`); (d) **saldo no excedible** (`:729`). **Riesgo:** plata que no
   cuadra en caja/CC. CON/SIN caja abierta (fallback + toast).

2. **Doble firma por umbral en pago de OC y de courier (L10/L36)** — 🔴 sin e2e/UAT runtime.
   `oc_pago_doble_firma_umbral` y `envio_pago_doble_firma_umbral`. **Bug latente a avisar a GO:** ambos
   guards solo exigen clave maestra **si `tenant.clave_maestra` está seteada** (`GastosPage.tsx:721-722`,
   `EnviosPage.tsx:788`). Si el tenant superó el umbral pero **no** configuró clave maestra, el pago grande
   pasa **sin segunda firma, en silencio**. Escenarios: umbral CON+clave / umbral CON+sin clave (hoy
   bypassea) / debajo del umbral. Guard solo en UI (no server-side).

3. **Over-receipt + ajuste de cantidad por rol (L18/L19/L20)** — 🔴 sin e2e/UAT (stock).
   `permite_over_receipt` SIN ⇒ exceso bloqueado; CON + `over_receipt_pct_max` ⇒ permitido hasta el tope,
   bloqueado arriba; CON + pctMax null ⇒ **over-receipt libre** (verificar que es la intención). Bajo-recibo
   exige `motivo_faltante`. Over/under requiere SUPERVISOR+ (`RecepcionesPage.tsx:466,488,493`). Verificar
   `stock_actual`/`movimientos_stock` y `estado` de la OC resultante. Guard solo en UI.

4. **Devolución a proveedor: formas `efectivo` y `reposicion` (L26/L27)** — 🔴 sin e2e (solo `credito_cc` en spec 33).
   `efectivo` ⇒ `ingreso` en caja (con fallback "primera abierta", `ProveedoresPage.tsx:1240-1250`) +
   rebaja stock; **CON/SIN caja abierta** (hoy: sin caja, el reembolso **no se asienta**, solo toast — plata
   fuera del arqueo, avisar a GO). `reposicion` ⇒ crea OC borrador con los ítems (`:1251-1262`) + rebaja
   stock. Verificar `caja_movimientos` / `ordenes_compra` nueva / `movimientos_stock` `ajuste_rebaje`.

5. **Brazo OC del rechazo de cheque (L14)** — 🔴 e2e cubre solo el brazo gasto (spec 31).
   Cheque propio que pagó una **OC** y se rechaza: `reversionPagoOC` baja `monto_pagado`, recalcula
   `estado_pago`, y reinserta deuda en `proveedor_cc_movimientos` tipo `ajuste` (+monto)
   (`ChequesPanel.tsx:143-168`). Verificar que la OC vuelve a pendiente_pago/pago_parcial y la deuda del
   proveedor reaparece. **Riesgo:** un cobro fallido que queda como pagado.

6. **Pago a courier genera gasto + caja (L35) y flag `envio_courier_genera_gasto`** — 🔴 sin e2e del pago courier.
   (El spec 38 cubre combustible de envío **propio**, no el pago a courier tercero.) CON ⇒ 1 gasto por
   courier con IVA crédito (`envio_courier_iva_pct`) + egreso/egreso_informativo en caja
   (`EnviosPage.tsx:807-846`); SIN (`envio_courier_genera_gasto=false`) ⇒ marca pagado **sin** gasto ni caja.
   Verificar `gastos` (iva_monto, estado_pago) + `caja_movimientos` + `envios.gasto_id`.

**Secundarios (no REGLA #0 pero configurables sin runtime):** `oc_numeracion` por valor (L5),
`recepcion_remito_obligatorio` (L21), alerta de costo→efecto en `precio_costo` (L22),
`gastos_dias_alerta_anticipo_oc` (L31), cobro al cliente por política→efecto en la venta (L34),
`envio_identidad_modo`/`envio_notif_en_camino`/`envio_peso_fuente`/`envio_rangos_horarios` (UX).
