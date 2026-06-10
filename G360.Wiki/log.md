# Log — Genesis360 Wiki

Log cronológico append-only. Cada entrada empieza con `## [YYYY-MM-DD] tipo | título`.

Tipos: `init` · `ingest` · `query` · `update` · `lint`

---

## [2026-06-09] deploy | v1.48.0 PROD — RRHH RH7+RH8 · 🎉 RRHH 2.0 (RH1-RH8) COMPLETO

**Cierre del módulo RRHH 2.0** (migs 201-202 en DEV+PROD, PR #177, release v1.48.0 latest). Build verde, suite **613** (596 + 17). GO pidió RH7+RH8 seguidas y autónomas hasta PROD.

- **RH7 (mig 201):** **catálogo de documentos obligatorios** (E1, `rrhh_documentos_catalogo`) + alerta de **faltantes** y **próximos a vencer** (E2, `rrhh_documentos.fecha_vencimiento` + umbral `rrhh_doc_alerta_dias`) · **capacitación obligatoria** por puesto (E3) · **evaluación de desempeño** 1-10 + 360° (F4, `rrhh_evaluaciones`, panel en Reportes) · config **portal del empleado** (F2) + **notificaciones del ciclo** (F3). E4 (costo capacitación) = NO. Lib `rrhhDocumentos.ts`.
- **RH8 (mig 202):** nuevo **tab Reportes** (`RrhhReportesPanel`): costo laboral por depto · asistencia consolidada · vacaciones gozadas/pendientes · antigüedad/rotación · recibos + export Excel/CSV/PDF · **liquidación final** al egreso (A2-c, `liquidacionFinal.ts`): indemnización LCT 245 + SAC proporcional + vacaciones no gozadas, **editable**, genera gasto + `rrhh_liquidaciones_finales`. Libs `rrhhReportes.ts` + `liquidacionFinal.ts`.

**🎉 RRHH 2.0 (RH1-RH8) COMPLETO en PROD.** Diferidos (mejoras futuras): fichado por **QR público** + **auto-descuento de tardanza** en nómina (RH6; lib `descuentoTardanza` lista) y la **UI completa del portal del empleado** (F2; flag ya configurable). Confirmado por GO: fórmula de indemnización LCT 245 editable.

## [2026-06-09] deploy | v1.47.0 PROD — RRHH RH4+RH5 (frecuencia/anticipos + vacaciones 2.0)

**2 fases más de RRHH a PROD** (migs 199-200 en DEV+PROD, PR #176, release v1.47.0 latest). Build verde, suite **596** (578 + 18). GO pidió RH4+RH5 seguidas y autónomas hasta PROD.

- **RH4 — Frecuencia + anticipos (mig 199):** `empleados.frecuencia_liquidacion` (+`frecuencia_dias`) **prorratea el básico** al generar la liquidación (mensual=1 / quincenal=½ / semanal=¼ / personalizado=días/30, lib `rrhhLiquidacion.ts`) · **anticipos** (`rrhh_anticipos`, panel en Nómina): registra + opcional genera gasto "Adelantos al personal" (pendiente) y **se descuentan automáticamente en la próxima liquidación** sin dejar el neto negativo (descuento parcial deja el resto pendiente).
- **RH5 — Vacaciones 2.0 (mig 200):** **días por antigüedad LCT** 14/21/28/35 (botón "Sugerir LCT" + override) · aprobación con **alerta de plazo de aviso** (sin/alerta/bloquea) + **solapamiento** con otras vacaciones aprobadas · **remanente auto-calculado** con límite configurable · panel de config en el tab (aviso + remanente máx). Vacaciones se pagan dentro del sueldo (C7). Lib `rrhhVacaciones.ts`.

**Pendientes RRHH:** **RH7** (documentos obligatorios/portal del empleado/evaluación de desempeño), **RH8** (reportes + liquidación final con indemnización) + (en RH6) fichado por QR público y auto-descuento de tardanza. Detalle en `relevamiento_rrhh_respuestas.md` + `project_pendientes.md`.

## [2026-06-09] deploy | v1.46.0 PROD — RRHH RH1+RH2+RH3+RH6 (empleados 2.0, aportes/SAC, nómina contable, asistencia 2.0)

**4 fases de RRHH deployadas a PROD** (migs 195-198 en DEV+PROD, PR #175, release v1.46.0 latest, Vercel production). Build verde, suite **578** (558 + 20). GO confirmó las 4 asunciones del plan y pidió RH1+RH2+RH3+RH6 seguidas y autónomas hasta PROD. El módulo RRHH ya era maduro (13 tablas, RrhhPage ~3700 líneas); estas fases lo potencian.

- **RH1 — Empleados 2.0 (mig 195):** obligatorios en el alta (email/tel/puesto/depto) · **motivo de egreso** (modal de baja) + reactivar · **tipo de contrato configurable** (tabla `rrhh_tipos_contrato` + seed base AR, se eliminó la CHECK rígida; `es_relacion_dependencia` dispara aportes) · datos bancarios (CBU/alias/banco/tipo cuenta/titular).
- **RH2 — Aportes AR + SAC (mig 196):** `rrhh_conceptos` += tipo_calculo/default_pct/es_aporte + seed AR (Jubilación 11%/OS 3%/Ley 19.032 3%/etc.) · **aportes configurables por empleado vía checkbox** (`empleados.config_aportes`; el % vive en el concepto/Config; "en negro" = sin checkboxes) + **beneficios extra** ($/%) · `crearLiquidacion` inyecta básico+beneficios+aportes (lib pura `rrhhNomina.ts`) · **SAC = 50% del mejor sueldo del semestre** (botones SAC 1°/2° sem). +11 tests.
- **RH3 — Nómina contable (mig 197):** **"Generar gasto"** por salario → inserta gasto en módulo **Gastos** (categoría Sueldos, estado pendiente, link `rrhh_salarios.gasto_id`) · **"Cargas sociales → Gastos"** acumula aportes del período por concepto (categoría Cargas sociales) · **recibo de sueldo PDF** (`reciboSueldoPDF.ts`) + **comprobante firmado** opcional · **doble validación** configurable (RRHH prepara → DUEÑO/ADMIN o SUPERVISOR firma; toggle owner-only). Categorías Sueldos/Cargas sociales seedeadas idempotentes.
- **RH6 — Asistencia 2.0 (mig 198):** **fichado** clock-in/out (`rrhh_fichadas`, origen manual/celular/qr) · **horario por empleado** · **licencias subdivididas** (`tipo_licencia` + catálogo) + comprobante · **horas extra** (`rrhh_horas_extra`, multiplicador 50/100 + aprobación, panel con monto) · **feriados con regla de pago** (simple/doble/triple). Lib pura `rrhhAsistencia.ts` (+9 tests).

**Diferido (backlog RRHH):** **RH4** (frecuencia/anticipos), **RH5** (vacaciones 2.0), **RH7** (documentos/portal/evaluación), **RH8** (reportes + liquidación final), y dentro de RH6 el **fichado por QR público** + el **auto-descuento de tardanza** inyectado en nómina (la lib `descuentoTardanza` ya existe, falta el sweep). Detalle en `relevamiento_rrhh_respuestas.md` + `project_pendientes.md`.

## [2026-06-09] deploy | v1.45.0 PROD — Envíos EN7 (envío propio + recursos + reportes/alertas) — Envíos cerrado salvo EN6

**EN7 deployado a PROD** (mig 194 aplicada en DEV+PROD, PR #174 dev→main merged, release v1.45.0 latest, Vercel production deploy desde `main`). Build verde, suite **558** = 541 + 17. **Cierra el módulo Envíos salvo EN6** (integraciones courier, bloqueado por cuentas B2B reales que GO aún no tiene).

- **G2 — Envío propio + vehículo + combustible:** el modal de envío propio permite asociar un **vehículo** (recurso categoría Vehículo) + KM del viaje. Desde el detalle del envío, "**Registrar combustible**" genera un **gasto "Combustible"** (IVA crédito fiscal, link `envios.gasto_combustible_id`), **suma los KM al vehículo** (`recursos.km_acumulado`) y estima el monto con `consumo_litros_100km × precio del litro` (`tenants.envio_combustible_precio_litro`, editable). El consumo se carga por vehículo en Recursos. Lib pura `enviosRecurso.ts`.
- **H1 — Reportes (nuevo tab Reportes, `EnviosReportesPanel`):** pendientes/atrasados · cumplimiento por courier (tiempo medio + % entregados) · pagos a courier por mes · **margen logístico** (ingreso `ventas.costo_envio` − costo real, cuenta subsidiados) · distribución por zona/CP · productividad de repartidores (reusa `productividadRepartidor` de EN3). Lib pura `enviosReportes.ts`.
- **H2 — Alertas (sección del tab Reportes):** sin despachar +Nh · POD pendiente +Nd · pago courier pendiente +Nd · diferencia cotizado vs real ≥N%. Umbrales configurables (`tenants.envio_alerta_*`).
- **H3 — Export + etiquetas:** Excel/CSV/PDF en cada reporte (patrón `ComprasReportesPanel`) + **etiquetas A4** 4/6/12 por hoja con QR (link `/transporte/:token`) + datos del destinatario (`etiquetasEnvioPDF.ts`, botón en tab Reparto) + hoja de ruta PDF (ya existía en EN3).
- **Config → Envíos:** card "Envío propio y alertas" (precio litro + 4 umbrales). **Recursos:** campo "Consumo (L/100km)" en vehículos.
- **Mig 194** (aditiva): `envios.recurso_id/km_recorridos/gasto_combustible_id`, `recursos.km_acumulado/consumo_litros_100km`, `tenants.envio_combustible_precio_litro` + 4 umbrales de alerta, seed idempotente de categoría "Combustible".

**Único pendiente del módulo Envíos:** **EN6** (integraciones courier: tracking + cotización comparativa + etiquetas térmicas) — bloqueado hasta tener cuentas B2B reales de courier (Andreani 1ro) para validar los adapters de `courier-api`.

## [2026-06-09] update | Email saliente (Resend) RESUELTO — era API key vieja en el secret

**El correo saliente quedó funcionando.** GO confirmó que le llegaron mails de Genesis. Causa real: el secret `RESEND_API_KEY` en Supabase era una **API key vieja/revocada** → Resend devolvía 401 "API key is invalid" (afectaba TODO el correo: ticket de venta, OC, etc.). NO era un problema de dominio (`genesis360.pro` estaba verificado DKIM/SPF) ni de código (FROM=noreply@genesis360.pro correcto en DEV v21 / PROD v24). GO regeneró la key en Resend y actualizó el secret → resuelto.

Fix de diagnóstico que quedó en el código (v1.42.0/v1.44.0): `enviarOCEmail` (Proveedores → OC) y el envío de **ticket de venta** (VentasPage) ahora leen `error.context.json()` y muestran el **mensaje real de Resend** en vez del genérico "No se pudo enviar". **Aprendizaje:** ante `send-email` non-2xx, revisar primero la validez del `RESEND_API_KEY`. Wiki `resend-email.md` actualizada (estaba desfasada: decía FROM=onboarding@resend.dev).

---

## [2026-06-09] cierre-sesión | Envíos EN1-EN5 en PROD (v1.40.0→v1.44.0) · falta EN6 (bloqueado B2B) + EN7

**Sesión larga. Relevamiento Envíos EN1-EN5 deployado a PROD, una fase por release. Suite 541 verde. `dev=main`.** Resumen de lo hecho hoy:

1. **EN1 (v1.40.0, mig 189)** — pagos courier contables: gasto auto (Transporte y fletes, IVA crédito) + egreso caja + tab "Facturas Courier" (conciliación) + doble firma.
2. **EN2 (v1.41.0, mig 190)** — POD robusto: campos requeridos config, firma canvas, DNI, OTP sobre umbral (propio), geoloc con fallback, sub-estados no-entrega + reintento.
3. **EN3 (v1.42.0, mig 191)** — reparto: repartidores + productividad, tab Reparto (hoja de ruta PDF + link agrupado `/hoja-ruta/:token` + cumplimiento), token expiración config, transportista llamar/WA/incidencia, identidad config, notif "en camino".
4. **EN4 (v1.43.0, mig 192)** — costos/tarifas: factor KM, costo mínimo/tramos, recargo horario, cobro al cliente (100/margen/subsidio), envío gratis condicional, diferencia real vs cotizado (B6).
5. **EN5 (v1.44.0, mig 193)** — creación/alcance: DEPOSITO crea, envíos libres, sugerencia courier por CP, plazo despacho por canal + alerta, múltiples envíos por venta con `envio_items`.

**Libs puras nuevas:** `enviosCourierPago`, `enviosPod`, `enviosReparto`, `enviosTarifas`, `enviosCreacion` (todas con tests). Componentes nuevos: `SignaturePad`, `RepartidoresPanel`, `HojaRutaPage`. Migraciones 189-193.

**Pendiente Envíos:** **EN6** (integraciones courier: tracking/cotización comparativa/etiquetas) **bloqueado** hasta validar adapters de `courier-api` con cuentas B2B reales (ver Email+Couriers). **EN7** (envío propio + recursos + reportes/alertas/export). Quedan también RRHH/Caja sin relevar.

**⚠ Email saliente (Resend) — acción pendiente de GO:** el `RESEND_API_KEY` cargado en Supabase (DEV+PROD) está **inválido** (Resend 401 "API key is invalid"); el dominio `genesis360.pro` SÍ está verificado. Claude NO tocó el secret. GO debe generar una API key nueva en Resend (Sending access) y cargarla como secret en ambos proyectos. El front ya muestra el error real de Resend (OC + ticket).

---

## [2026-06-09] update | Envíos EN5 — creación y alcance (v1.44.0, mig 193, PROD ✅)

**Quinta fase de Envíos en PROD.** Build + 541 tests verdes. Mig 193 (aditiva) DEV+PROD. PR #173, release `v1.44.0`, `dev=main`.

- **A1** DEPOSITO ve y crea envíos (`AppLayout`: `/envios` con `depositoVisible` + agregado a `DEPOSITO_ALLOWED`).
- **A2** Envíos **libres sin venta**: `envios.tipo` (venta/traslado_interno/muestra/dev_proveedor/otro) + `motivo` + `sucursal_destino_id` (traslado interno). Select de tipo en el modal; badge de tipo en la lista.
- **A3** Sugerencia de courier por CP: `tenants.cp_courier_preferido` (rangos desde-hasta → courier); al elegir domicilio con CP propone el courier (`sugerirCourierPorCp`, override permitido). Config → Envíos editor de reglas.
- **A4** Plazo de despacho por canal: `tenants.envio_plazo_despacho` {presencial/online/mayorista} en horas; badge **"Atrasado"** en la lista (`plazoDespachoVencido` + `clasificarCanal`). Config → Envíos.
- **A5** Múltiples envíos por venta con **desglose** (`envio_items`): al seleccionar la venta se cargan los ítems con cantidad restante (descuenta lo ya despachado en envíos previos); editor de qué sale en este envío; se relajó la exclusión de ventas con envío (badge "N envíos" en el selector). Persiste en `envio_items` al crear.
- **Lib pura** `src/lib/enviosCreacion.ts` (`TIPOS_ENVIO`, `sugerirCourierPorCp`, `clasificarCanal`, `plazoDespachoVencido`, `unidadesEnviadas`) + 12 tests.

---

## [2026-06-08] update | Envíos EN4 — costos y tarifas avanzados (v1.43.0, mig 192, PROD ✅)

**Cuarta fase de Envíos en PROD.** Build + 529 tests verdes. Mig 192 (aditiva) en DEV y PROD. PR #172, release `v1.43.0`, `dev=main`.

- **Motor de tarifas puro** `src/lib/enviosTarifas.ts`: `costoEnvioPropio` (B1 recargo franja horaria + B2 factor KM + B3 costo mínimo/tramos escalonados), `cobroCliente` (B4 cliente_100/cliente_margen/subsidio), `envioGratis` (B5 monto/etiqueta/promo), `diferenciaReal` (B6 a_favor/perdida).
- **Config → Envíos** card "Tarifas y cobro del envío propio": factor KM, costo mínimo, editor de tramos, editor de recargo horario, política de cobro (+margen/umbral), envío gratis condicional (monto/etiquetas/promo). Campos en `tenants`: `envio_factor_km`, `envio_costo_minimo`, `envio_tramos`, `envio_recargo_horario`, `envio_cobro_politica`, `envio_cobro_margen_pct`, `envio_subsidio_umbral`, `envio_gratis_reglas`.
- **Aplicación:** el cálculo de KM del envío propio (EnviosPage `calcularKmAuto`) ahora usa `costoEnvioPropio` (factor + mínimo + tramos + recargo horario según la hora acordada).
- **B6:** modal "Registrar costo real" en cada envío con costo cotizado → calcula la diferencia a-favor/pérdida + motivo (catálogo `DIFERENCIA_MOTIVOS`), persiste `envios.costo_real/diferencia_tipo/diferencia_monto/diferencia_motivo`. El precio que pagó el cliente (`costo_cotizado`) NO se toca. +15 tests. **Próximo: EN5 (creación/alcance).**

---

## [2026-06-08] update | Envíos EN3 — reparto: repartidores + hoja de ruta + transportista (v1.42.0, mig 191, PROD ✅)

**Tercera fase de Envíos en PROD.** Build + 514 tests verdes. Mig 191 (aditiva) en DEV y PROD. PR #171, release `v1.42.0`, `dev=main`.

- **G1 repartidores:** tabla `repartidores` (vinculables a `empleados` RRHH) + `envios.repartidor_id`. CRUD en Config → Envíos (`RepartidoresPanel`), asignación en el modal de envío (envío propio), productividad (`productividadRepartidor`).
- **G3/E3 hoja de ruta:** nuevo tab **Reparto** en EnviosPage. Elegís fecha + repartidor → lista ordenada (`ordenarHojaRuta`: vecino más cercano si hay coords y modo proximidad, si no por zona/hora) → **PDF** (jsPDF/autotable) + **link agrupado para el chofer** (`crearHojaRutaToken` → `/hoja-ruta/:token`, página pública `HojaRutaPage` con RPC `get_hoja_ruta_by_token`) + **cumplimiento del día** (`cumplimientoDia`). Tablas `hojas_ruta` + `hoja_ruta_envios`.
- **E1 expiración token:** `tenants.envio_token_politica` (al_entregar/dias) + `envio_token_dias`; al compartir se setea `envios.token_expira_at` (`tokenExpiraAt`); `get_envio_by_token` devuelve null si expiró.
- **E2 transportista:** botones **Llamar** (`tel:`) + **WhatsApp** al cliente + **reportar incidencia** (catálogo `INCIDENCIA_TIPOS` → `envio_incidencias` vía RPC `reportar_incidencia_envio`).
- **E4 identidad:** `tenants.envio_identidad_modo` (anonimo/nombre_dni); en modo nombre_dni la página del chofer pide nombre+DNI antes de operar.
- **E5 notif "en camino":** `tenants.envio_notif_en_camino` (no/wa/wa_tracking); al pasar a en_camino se abre WhatsApp al cliente (con link de tracking si wa_tracking).
- **Lib pura** `src/lib/enviosReparto.ts` (`productividadRepartidor`, `cumplimientoDia`, `ordenarHojaRuta`, `tokenExpiraAt` + constantes) + 8 tests. RPCs públicas SECURITY DEFINER (anon+auth). **Próximo: EN4 (costos/tarifas).**

**Email saliente (Resend) — diagnóstico actualizado con GO:** el dominio `genesis360.pro` **SÍ está verificado** (DKIM/SPF OK, captura de GO). El error real es **"API key is invalid"** (Resend 401) → el secret `RESEND_API_KEY` en Supabase está inválido/desactualizado. Claude NO tocó el secret. Acción de GO: generar API key nueva en Resend y cargarla como secret en ambos proyectos (DEV+PROD). Front mejorado: `enviarOCEmail` (OC) y el envío de ticket de venta ahora muestran el mensaje real de Resend.

---

## [2026-06-08] update | Envíos EN2 — POD robusto + cierre de entrega (v1.41.0, mig 190, PROD ✅)

**Segunda fase de Envíos en PROD.** Build + 506 tests verdes. Mig 190 (aditiva) en DEV y PROD. PR #170, release `v1.41.0`, `dev=main`.

- **D1** campos del POD requeridos configurables por tenant (`tenants.pod_campos_requeridos` JSONB: fecha/receptor/foto/firma/dni). **D2** mínimo de fotos (`pod_foto_min`). Validación con `podFaltantes`.
- **D3** firma del receptor con **canvas** (nuevo `src/components/SignaturePad.tsx`, sin deps → dataURL PNG a `etiquetas-envios`, `envios.pod_firma_url`) + **DNI** (`pod_dni`) + **OTP** sobre umbral solo envío propio (`tenants.pod_otp_umbral`, tabla `envio_otp`). Flujo OTP: el transportista genera el código (`generar_otp_envio`), se lo manda al cliente por WhatsApp (`buildWhatsAppUrl`), el cliente se lo dicta y se verifica (`verificar_otp_envio`); sin OTP verificado no se puede marcar entregado (gate en el RPC). Default off (umbral 0).
- **D4** geoloc del celular al entregar con **fallback graceful** (`navigator.geolocation`; `pod_lat/lon` + `pod_geo_estado` ok/no_disponible). Si el permiso falla o no hay señal, registra `no_disponible` y **no frena** la entrega (pedido GO).
- **D5** sub-estados de no-entrega (`subestado_no_entrega`: ausente/rechazado/direccion_incorrecta + `no_entrega_motivo`), botón "No entregado" en EnviosPage y TransportistePage. **D6** reintento: ausente vuelve a `en_camino` con `intentos++` hasta `envio_reintentos_max`; rechazado/dirección o agotado → `devolucion`. Recargo configurable (`envio_reintento_recargo`). Lógica en `resolverNoEntrega` + el RPC `update_envio_by_token`.
- **RPCs del transportista ampliadas** (`get_envio_by_token` devuelve config POD + `es_propio`; `update_envio_by_token` toma firma/DNI/geoloc/sub-estado; nuevas `generar_otp_envio`/`verificar_otp_envio`), todas SECURITY DEFINER con GRANT a anon+authenticated.
- **Config → Envíos**: card "Prueba de entrega (POD)" con los toggles de requeridos + mín fotos + OTP + geoloc alerta + reintentos + recargo. `PodFotosManager` ahora expone `onCountChange` (validación D2).
- **Lib pura** `src/lib/enviosPod.ts` (`podFaltantes`, `requiereOtp`, `geoEstado`, `resolverNoEntrega`, `recargoReintento`, `haversineKm`, `generarCodigoOtp`) + `tests/unit/enviosPod.test.ts` (18 tests). **Próximo: EN3 (reparto).**

**Bug de email de OC (DEV) — diagnóstico:** GO reportó "No se pudo enviar el email" al mandar una OC a un gmail. Causa: **Resend rechaza** (logs DEV `send-email → 500`). El código está OK (FROM=noreply@genesis360.pro en DEV v21 y PROD v24); falta verificar el dominio `genesis360.pro` en la cuenta de Resend del `RESEND_API_KEY` de DEV (en testing solo envía al email del dueño). Se mejoró `enviarOCEmail` para **mostrar el mensaje real de Resend** (lee `error.context.json`). Acción pendiente de GO: verificar dominio en Resend + confirmar que la API key es de esa cuenta.

---

## [2026-06-08] update | Envíos EN1 — pagos a courier contables + conciliación (v1.40.0, mig 189, PROD ✅)

**Primera fase del relevamiento de Envíos deployada a PROD.** Build + 488 tests verdes. Mig 189 (aditiva) en DEV y PROD. PR #169, release `v1.40.0`, `dev=main`.

- **C2 — gasto automático:** al marcar pagado un courier **tercero** en el tab "Pagos Courier", se genera un gasto contable (categoría **Transporte y fletes**, proveedor=courier, **IVA crédito fiscal** desglosado del bruto vía `desgloseIvaFlete`) + **egreso de caja** si el medio es efectivo (`egreso`/`egreso_informativo`). Se linkea `envios.gasto_id`. Un gasto por courier (`agruparPagosPorCourier` agrupa la selección).
- **C3 — Facturas Courier** (nuevo tab): cargar la factura/resumen del courier por período (courier + nº + período + total + archivo opcional a `etiquetas-envios`) → el sistema busca los envíos del courier en el período, suma lo registrado y calcula la diferencia (`diffFactura`). Persiste `courier_facturas` + `courier_factura_lineas` (una línea por envío). Badge "Conciliada" / "Dif. $X". Estado conciliada si |dif| < 1.
- **C4 — doble firma:** `tenants.envio_pago_doble_firma_umbral` (0 = sin); pagos sobre el umbral piden clave maestra del dueño (`verificar_clave_maestra`, `requiereDobleFirma`).
- **C1:** pago individual o múltiple (sin cambios).
- **Config → Envíos:** card "Pagos a courier (contabilidad)" — toggle generar gasto + alícuota IVA flete (default 21%) + umbral doble firma.
- **Lib pura** `src/lib/enviosCourierPago.ts` (`agruparPagosPorCourier`, `desgloseIvaFlete`, `requiereDobleFirma`, `diffFactura`, `totalRegistrado`) + `tests/unit/enviosCourierPago.test.ts` (14 tests).

**Recomendación contable aplicada:** el gasto se genera SOLO para courier tercero (envío propio va por combustible, EN7); el costo se toma bruto (IVA incluido) y se desglosa el crédito fiscal. **Próximo: EN2 (POD robusto).**

---

## [2026-06-06] cierre-sesión | Resumen para retomar tras /clear (estado: PROD v1.39.0, mig 188)

**Sesión larga. Compras 2.0 completo en PROD. Suite 474 tests verdes.** ⚠ Al cierre, `dev` quedó **adelante de `main`** por: docs del wiki + cambios de email (FROM + email OC HTML/PDF — la Edge Function ya está en PROD, falta el front, que viaja en el próximo merge). Tres bloques:

1. **🎉 Compras 2.0 (CO1-CO8) CERRADO al 100% en PROD.** Esta sesión se hicieron CO5→CO8 (antes ya estaban CO1-CO4): CO5 pago anticipo/contra-entrega/schedule (v1.35.0, mig 186) · CO6 cheques diferidos (v1.36.0, mig 187) · CO7a OC inteligente: enviar OC PDF/email/WhatsApp + auto-draft desde stock bajo (v1.37.0) · CO7b servicios recurrentes/genéricos/comparar presupuestos (v1.38.0, mig 188) · CO8 reportes/alertas/export/calificación proveedor (v1.39.0). Libs nuevas: `comprasPago`, `comprasCheques`, `ocPDF`, `serviciosRecurrentes`, `comprasReportes` (+62 tests). Detalle en entradas de abajo + `project_compras_backlog` (memoria).

2. **Email saliente ✅ RESUELTO + couriers pendiente** (sección "Email + Couriers" en `project_pendientes.md` + memoria `project_email_courier_pendientes`):
   - **Email saliente ✅:** el dominio `genesis360.pro` ya estaba verificado en Resend → se cambió `FROM` a `noreply@genesis360.pro` **y** se mejoró el **email de OC** (template `type:'oc'` HTML + **PDF adjunto** vía Resend `attachments`). `send-email` redeployada **DEV v21 / PROD v24** (`verify_jwt` ok). Todo el correo saliente usa el dominio propio. Patrón `attachments` reutilizable para factura/estado de cuenta. ⚠ El cambio de **frontend** (`enviarOCEmail`) está en `dev`; llega a PROD con el próximo merge a `main` (la función ya está en PROD y es backward-compatible).
   - **Couriers:** adapters Andreani/Correo/OCA completos pero **sin validar con cuentas B2B reales**. Plan: GO consigue cuenta (Andreani 1ro) → validar end-to-end; Claude puede dejar logging diagnóstico + botón "Probar credenciales" sin esperar credenciales.

3. **Relevamiento Envíos respondido por GO (A-I)** → `relevamiento_envios_respuestas.md` con respuestas + diseño + modelo de datos + **recomendación contable/IVA** + plan **EN1-EN7**. **Pendiente de implementar.** Top 3: EN1 (pagos courier contables) → EN2 (POD robusto: firma/DNI/OTP/geoloc/sub-estados/reintento) → EN3 (reparto: repartidores/hoja de ruta/notif "en camino"). EN6 (integraciones courier) depende de validar adapters B2B. Pendiente confirmar: alícuota IVA flete, plazos por canal, canal del OTP.

**Próximo paso sugerido al retomar:** empezar **Envíos EN1** (pagos courier contables, cierra gap contable) — es el Top 1 del relevamiento. Pendiente menor: si `dev` sigue adelante de `main`, el próximo deploy (PR dev→main + Vercel) lleva el front del email de OC a PROD. Couriers EN6 espera cuenta B2B. Relevamientos sin responder: **RRHH / Caja**.

---

## [2026-06-06] update | Compras CO8 — reportes + alertas + export + calificación (v1.39.0, PROD ✅) · 🎉 Compras 2.0 COMPLETO

**Deployada a PROD la fase CO8** (G1/G2/G3/E4) — última del plan Compras 2.0. Sin migración. Build + 474 tests verdes. PR #168, release `v1.39.0`, `dev=main`.

- **G1 — reportes:** nuevo tab **Reportes** en Gastos (`src/components/ComprasReportesPanel.tsx`): compras por proveedor (volumen $ + # OCs + % cumplimiento), top productos comprados, **aging** de pagos pendientes (0-30/31-60/61-90/+90), OCs vencidas (entrega esperada pasada sin recibir), evolución de costos por producto (primer vs último precio + variación %).
- **E4 — calificación de proveedor:** score A/B/C según % de OCs recibidas completas (`calificarProveedor`).
- **G3 — export:** Excel (xlsx) / CSV / PDF (jsPDF+autotable) por reporte. PDF de OC ya estaba en CO7a.
- **G2 — alerta:** "bajo mínimo sin OC pendiente" en Alertas (badge *OC en camino* / *Sin OC pendiente* cruzando productos bajo mínimo con ítems de OCs abiertas). Las demás alertas de compras (anticipo sin recepción, cheque próximo a cobrar, costo subió X%) ya existían (CO3/CO5/CO6).
- **Lib pura** `src/lib/comprasReportes.ts` (`comprasPorProveedor`, `topProductosComprados`, `agingPagos`, `ocsVencidas`, `evolucionCostos`, `calificarProveedor`) + `tests/unit/comprasReportes.test.ts` (10 tests).

**🎉 Compras 2.0 (CO1-CO8) CERRADO al 100% en PROD:** CO1 gobierno OC · CO2 recepción robusta · CO3 costos · CO4 devolución a proveedor · CO5 pago anticipo/schedule · CO6 cheques diferidos · CO7a OC inteligente (enviar OC + auto-draft) · CO7b servicios (recurrentes/genéricos/comparar) · CO8 reportes/alertas/export/calificación. Sin pendientes del módulo.

---

## [2026-06-06] update | Compras CO7b — servicios: recurrentes + catálogo genérico + comparar presupuestos (v1.38.0, mig 188, PROD ✅)

**Deployada a PROD la fase CO7b** (F1+F2+F3). Build + 464 tests verdes. Mig 188 en DEV y PROD. PR #167, release `v1.38.0`, `dev=main`.

- **F1 — servicios recurrentes:** `servicio_items` += `recurrente`/`frecuencia`/`proximo_vencimiento`/`activo`. En el tab Servicios, checkbox recurrente en el form + badge en el listado + **banner de recurrentes vencidos** con "Generar gasto" (`generarGastoServicio`: inserta en `gastos` categoría Servicios y avanza `proximo_vencimiento` con `proximoVencimiento`). Sweep lazy = al abrir el módulo.
- **F2 — catálogo genérico:** `servicio_items.proveedor_id` ahora nullable → panel **"Servicios generales del negocio"** (toggle) para servicios del tenant sin proveedor, con su propio alta/edición.
- **F3 — comparar presupuestos:** modal **"Comparar presupuestos"** que trae todos los `servicio_presupuestos` del tenant, los agrupa por concepto normalizado (`compararPresupuestos`) y marca el **más barato** lado a lado.
- **Lib pura** `src/lib/serviciosRecurrentes.ts` (`proximoVencimiento`, `servicioVencido`, `periodosVencidos`, `normalizarNombre`, `compararPresupuestos`) + `tests/unit/serviciosRecurrentes.test.ts` (11 tests).

**Próximo (CO8 — última fase de Compras):** G1 reportes (OCs vencidas, compras por proveedor, top productos, aging de pagos, evolución de costos) · G2 alertas · G3 export Excel/PDF/CSV + PDF OC · E4 calificación de proveedor.

---

## [2026-06-06] update | Compras CO7a — OC inteligente: enviar OC + auto-draft stock bajo (v1.37.0, PROD ✅)

**Deployada a PROD la fase CO7a de Compras** (A6 + A3). Sin migración. Suite 453 verde. PR #166, release `v1.37.0`, `dev=main`.

- **A6 — enviar OC al proveedor:** lib pura `src/lib/ocPDF.ts` (`generarOCPDF` jsPDF/autotable, `textoOC`, `waLinkOC`, `totalOC`/`subtotalItems`). En el detalle de OC (ProveedoresPage): botones **PDF** (descarga), **Email** (`send-email` type notificacion con el resumen de la OC) y **WhatsApp** (link `wa.me` con plantilla). La query de OC ahora trae `proveedores(email, telefono, cuit, plazo_pago_dias)` + `sucursales(nombre)`. +6 tests.
- **A3 — auto-draft desde stock bajo:** en AlertasPage, botón **"Generar OC sugerida"** en la sección Stock bajo mínimo: consolida los productos bajo mínimo por proveedor (vía `proveedor_productos`), calcula la cantidad faltante sugerida (`max(minimo-actual, cantidad_minima, 1)`) y crea **OCs borrador** (una por proveedor), navega a Proveedores → OC. Gateado por `capacidadCrearOC`; exige sucursal específica; reporta productos sin proveedor.

**Próximo (CO7b + CO8):** CO7b servicios (F1 recurrentes sweep lazy + F2 catálogo genérico del tenant + F3 comparar presupuestos) · CO8 reportes (G1) + alertas (G2) + export + PDF OC (G3) + calificación de proveedor (E4).

---

## [2026-06-06] update | Compras CO6 — cheques diferidos (v1.36.0, mig 187, PROD ✅)

**Implementada y deployada a PROD la fase CO6 de Compras** (D4). Build + 447 tests verdes. Mig 187 en DEV y PROD. PR #165 mergeado, release `v1.36.0`, `dev=main`.

- **Tabla `cheques`** (RLS por tenant + trigger correlativo `set_cheque_numero`): `tipo` propio/tercero, `nro_cheque`, `banco`, `monto`, `fecha_emision`, `fecha_cobro` (diferida), `estado` (en_cartera/entregado/depositado/cobrado/endosado/rechazado/anulado), `proveedor_id`, `endosado_a_proveedor_id`, `cliente_origen`, `oc_id`, `sucursal_id`.
- **Nuevo tab "Cheques" en Gastos** (`src/components/ChequesPanel.tsx`): registro/edición, transiciones de estado guiadas por tipo (`estadosSiguientes`), **endoso** de cheque de tercero a un proveedor, filtros (tipo/estado), total pendiente y **alerta de próximos a cobrar** (badge en el tab + resaltado de vencidos). Config → Gastos: `cheques_alerta_dias` (default 7).
- **Lib pura** `src/lib/comprasCheques.ts` (estados/transiciones, `chequeProximoACobrar`, `chequeVencido`, `puedeEndosar`, `validarChequeAlta`, `totalPendiente`) + `tests/unit/comprasCheques.test.ts` (19 tests). `EntidadLog` += `'cheque'`.

**Próximo (CO7-CO8):** CO7 enviar OC email/WA (A6) + auto-draft desde stock bajo (A3) + servicios recurrentes (F1) + catálogo (F2) + comparar presupuestos (F3) · CO8 reportes (G1) + alertas (G2) + export Excel/PDF/CSV + PDF OC (G3) + calificación de proveedor (E4).

---

## [2026-06-06] update | Compras CO5 — pago anticipo/contra-entrega + schedule (v1.35.0, mig 186, PROD ✅)

**Implementada y deployada a PROD la fase CO5 de Compras** (D1/D2/D3). Build + 428 tests verdes. Mig 186 aplicada en DEV y PROD (aditiva). PR #164 mergeado a `main`, release `v1.35.0` (`--latest`), Vercel PROD deployado. `dev=main`.

- **D1 — modo de pago por proveedor:** `proveedores.modo_pago` (`contado|anticipo|contra_entrega|cuenta_corriente`, CHECK) + `anticipo_pct`. En el form de proveedor: select de modo + % anticipo (solo si modo=anticipo). Al elegir el proveedor en una OC se propone "paga con anticipo" + % (`defaultAnticipoOC`), con override por OC: `ordenes_compra.paga_con_anticipo` + `anticipo_pct` (snapshot). El badge 💰 Anticipo + alerta por días sin recepción ya existía en Gastos → OC (escalado D1b).
- **D2 — plan de pagos opcional por OC:** `ordenes_compra.pago_schedule JSONB` = `[{etiqueta,base 'confirmacion'|'recepcion'|'dias',dias?,pct}]`. Editor de cuotas en el form de OC (valida suma 100% con `scheduleValido`); se muestra como guía en el modal de pago de Gastos → OC.
- **D3 — comprobante de transferencia:** reusa `ordenes_compra.comprobante_url` (ISS-096). En el modal de pago, cuando hay un medio Transferencia con monto, aparece "Adjuntar comprobante" (o "Ver" si ya está) vía `subirComprobanteOC`/`verComprobante`.
- **Lib pura nueva:** `src/lib/comprasPago.ts` (`MODOS_PAGO_PROVEEDOR`, `defaultAnticipoOC`, `montoAnticipo`, `scheduleValido`, `totalPctSchedule`, `montoCuota`, `labelBaseCuota`) + `tests/unit/comprasPago.test.ts` (16 tests).
- **Tocado:** `ProveedoresPage.tsx` (form proveedor + form OC + saveOC), `GastosPage.tsx` (modal de pago de OC), `brand.ts` (v1.35.0), `schema_full.sql`.

**Próximo paso (Compras CO6-CO8):** CO6 cheques diferidos + endoso (D4) · CO7 enviar OC email/WA + auto-draft stock bajo + servicios recurrentes (A6/A3/F1/F2/F3) · CO8 reportes/alertas/export + reporte diferencias OC vs recepción (E4) + calificación de proveedor (G1/G2/G3).

---

## [2026-06-05] cierre-sesión | Resumen para retomar (estado: PROD v1.34.0, mig 185)

**Sesión larga — todo deployado a PROD, dev=main (salvo commits docs en dev, se foldean en el próximo PR). Suite 412 tests verdes.**

Lo hecho en esta sesión, en orden:
1. **Conteos 2.0 cerrado al 100%** — F2b scan-to-count (v1.28→1.29), F4 ABC/cíclico/reportes/trazabilidad (v1.29.0, mig 180), y cierre F2b-ref + F3b (doble conteo formal) + A2 (wall-to-wall bloquea sucursal) (v1.30.0, mig 181). Módulo sin pendientes. Memoria: `project_conteos2_backlog.md`.
2. **ISS-151 cerrado** (v1.30.1) — excluir `Incobrable` de los medios de pago del Dashboard + unificar `PSEUDO_METODOS_PAGO` en `ccLogic.ts`.
3. **Relevamiento Compras respondido** por GO → `relevamiento_compras_respuestas.md` (plan CO1-CO8). Decisiones GO: E3/B6/D1/A6 ✅.
4. **Compras CO1-CO4 deployado a PROD:** CO1 gobierno OC (v1.31.0, mig 182) · CO2 recepción robusta + fix B5 (v1.32.0, mig 183) · CO3 costos (v1.33.0, mig 184) · CO4 devolución a proveedor (v1.34.0, mig 185).

**Próximo paso (Compras CO5-CO8):** CO5 anticipo/contra-entrega por proveedor + schedule de pago (D1/D2/D3) · CO6 cheques diferidos + endoso (D4) · CO7 enviar OC email/WA + auto-draft desde stock bajo + servicios recurrentes (A6/A3/F1/F2/F3) · CO8 reportes/alertas/export + reporte diferencias OC vs recepción (E4) + calificación de proveedor (G1/G2/G3). Detalle y diseño en `relevamiento_compras_respuestas.md` + `project_pendientes.md`.

**Otros pendientes abiertos (fuera de Compras):** RLS por sucursal a nivel servidor (deuda técnica, pedido GO) · relevamientos sin responder: RRHH/Envíos/Caja · bug GastosPage (espera stack trace Sentry) · Clientes diferidos (B7 tope deuda global, F2 fidelización -necesita relevamiento-, cobranza CC→arqueo) · convertir planes `.plan.md` e2e a Playwright reales.

**Libs puras nuevas de la sesión:** `conteoAbc.ts`, `comprasPermisos.ts`, `recepcionLogic.ts`, `comprasCostos.ts`, `devolucionProveedor.ts` (todas con tests).

---

## [2026-06-05] deploy | v1.33.0 + v1.34.0 PROD — Compras CO3 (costos) + CO4 (devolución a proveedor)

Dos fases más del módulo **Compras** a PROD. Migraciones **184** (CO3) y **185** (CO4), ambas en DEV y PROD. Build verde, **412 tests** (+10 `comprasCostos`, +9 `devolucionProveedor`).

**CO3 — Costos (v1.33.0, mig 184):**
- E1 alerta de cambio de costo al recibir (`tenants.compras_costo_alerta_pct`, default 10%) → checkbox por línea para actualizar el `precio_costo` del producto (lib `comprasCostos.superaAlertaCosto`).
- E2 costos accesorios sueltos en la OC (`costo_aduana/comision/otros`, sin distribuir).
- B6 editar precio en recepción con audit (`actividad_log`).
- E3 alta rápida de producto desde la recepción (DUEÑO/SUPERVISOR → `productos.pendiente_revision=true`).
- Config en Config → Gastos. (E4-reporte de diferencias OC vs recepción se hace en CO8.)

**CO4 — Devolución a proveedor (v1.34.0, mig 185):**
- C1 entidad separada `devoluciones_proveedor` + `devolucion_proveedor_items` (RLS por tenant + trigger correlativo).
- Desde el detalle de una OC recibida → "Devolver a proveedor": ítems + cantidades, motivo (catálogo C3) + observación opcional, forma del reembolso (C2): **crédito_cc** (nota de crédito en `proveedor_cc_movimientos`, reduce deuda) / **efectivo** (ingreso a caja abierta) / **reposicion** (OC nueva borrador).
- Al confirmar rebaja stock FIFO por producto en la sucursal + movimiento `ajuste_rebaje`; valida stock disponible (`devolucionProveedor.validarDevolucion`). Cierra el `tiene_reembolso_pendiente` huérfano.

**Pendiente Compras:** CO5 (anticipo/contra-entrega) · CO6 (cheques) · CO7 (envío+inteligente+servicios) · CO8 (reportes + E4-reporte + calificación proveedor). Plan en `relevamiento_compras_respuestas.md`.

---

## [2026-06-05] deploy | v1.31.0 + v1.32.0 PROD — Compras CO1 (gobierno OC) + CO2 (recepción robusta)

Dos fases del módulo **Compras** deployadas a PROD. Migraciones **182** (CO1) y **183** (CO2), ambas en DEV y PROD. Build verde, **393 tests** (+14 `comprasPermisos`, +13 `recepcionLogic`).

**CO1 — Gobierno de OC (v1.31.0, mig 182):**
- A1 creación por rol (`comprasPermisos.capacidadCrearOC`): DUEÑO/ADMIN/SUPERVISOR completa · DEPOSITO solo borradores · CAJERO/CONTADOR sin acceso.
- A2 aprobación por umbral: OC sobre `oc_aprobacion_umbral` queda `requiere_aprobacion` y solo un rol aprobador la envía ("Aprobar y enviar" → `aprobada_por/at`). `puedeEnviarOC`.
- A4 sucursal obligatoria en la OC. A5 numeración configurable `tenants.oc_numeracion` (default sucursal; `set_oc_numero` asigna `numero_sucursal`; etiqueta `S-OC-0001`).
- D5 pago: CONTADOR read-only (`puedeRegistrarPagoOC`) + doble firma por umbral (`oc_pago_doble_firma_umbral`) con clave maestra en el modal de pago de Gastos.
- Config en Config → Gastos → Órdenes de compra. Lib pura `src/lib/comprasPermisos.ts`.

**CO2 — Recepción robusta (v1.32.0, mig 183):**
- **B5 (el bug):** el estado de la OC se recalcula desde el **acumulado de todas las recepciones confirmadas** (`recepcionLogic.estadoOCdesdeRecibido`), no solo la actual → una OC completada en varias parciales ahora llega bien a `recibida`. (Antes `RecepcionesPage` lo calculaba solo con la recepción en curso.)
- B3 over-receipt con umbral % acumulado (`tenants.over_receipt_pct_max`, `superaOverReceipt`). B4 motivo de faltante obligatorio en under-receipt (catálogo) + `recepcion_alerta_faltante_dias`. B1c over/under requiere SUPERVISOR+ (`esAjusteCantidad`). B7 adjuntar remito (bucket privado `remitos` scoped por tenant + `recepcion_remito_obligatorio`). B2 recepción sin OC exige proveedor.
- Lib pura `src/lib/recepcionLogic.ts`.

**Decisiones de GO confirmadas en sesión:** E3 alta producto en recepción ✅ · B6 editar precio remito ✅ · D1 modos de pago por proveedor ✅ · A6 WA por link ✅ (van en CO3/CO5/CO7).

**Pendiente Compras:** CO3 (costos) · CO4 (devolución a proveedor) · CO5 (anticipo/contra-entrega) · CO6 (cheques) · CO7 (envío+inteligente+servicios) · CO8 (reportes). Plan en `relevamiento_compras_respuestas.md`.

---

## [2026-06-05] ingest | Relevamiento Compras respondido — plan por fases CO1-CO8

GO + socio respondieron el relevamiento de Compras (OC + Recepciones, 34 preguntas A-H). Consolidado en `relevamiento_compras_respuestas.md`: respuestas + diseño + modelo de datos + plan por fases **CO1-CO8** + mis sugerencias donde difiero.

- **Hallazgos del código:** (1) B2 — la recepción **ya admite sin OC** (`oc_id` nullable, `RecepcionesPage.tsx:433`), está OK; (2) **B5 — NO es robusto hoy**: el estado de la OC se recalcula solo con la recepción actual, no acumulando entre múltiples recepciones (`RecepcionesPage.tsx:538-548`) → se arregla en CO2.
- **Sugerencias propuestas (esperan OK de GO):** E3 alta rápida de producto en recepción (rol alto + "pendiente revisión") en vez de "no permitir"; B6 editar precio en recepción con audit; D2 schedule opcional; A6 WA por link.
- **Top 3 recomendado:** CO2 (recepción robusta) → CO3 (costos) → CO4 (devolución a proveedor). CO1 (governance) puede ir 1º.

**Pendiente:** confirmar decisiones abiertas con GO → implementar por fases (cada una deployable a PROD).

---

## [2026-06-05] deploy | v1.30.1 PROD — ISS-151: excluir 'Incobrable' del Dashboard + unificar pseudo-métodos

**Deployado a PROD.** Bugfix frontend, sin migración. Build verde, **366 tests verdes** (+4). PR #159, release v1.30.1, dev=main. Cierra **ISS-151**.

- **Fix:** el write-off `Incobrable` (B6) se guarda en `medio_pago` pero el Dashboard solo excluía `Cuenta Corriente`/`Cancelación CC`/`Condonación CC` → contaba como ingreso y distorsionaba la ganancia. Ahora se excluye.
- **Unificación:** `PSEUDO_METODOS_PAGO` + `esMetodoRealPago` en `src/lib/ccLogic.ts` (fuente única, testeada) reemplazan los 3 sets duplicados en `MixCajaChart` y `MetricasPage`.
- **Nota:** Condonar/Revertir CC + las exclusiones base ya estaban en PROD desde un release previo (el wiki tenía el estado 🔄 DEV desactualizado); este patch cerró el gap real (`Incobrable`).

---

## [2026-06-05] deploy | v1.30.0 PROD — Conteos 2.0 cierre 100% (F2b-ref + F3b + A2)

**Deployado a PROD.** Migración **181** (aditiva) en DEV y PROD. Build verde, **362 tests verdes**. PR #158 mergeado, release v1.30.0, dev=main. Vercel PROD en build al cierre. Cierra el 100% de Conteos 2.0 (ISS-CONT).

- **F2b-ref (E3):** escanear durante el conteo un producto **fuera de alcance** que tiene stock en la sucursal lo agrega como fila "fuera de alcance" (mercadería mal ubicada, badge en la tabla); sin stock en la sucursal → aviso accionable hacia Ingreso (el alta de stock nuevo sigue siendo del flujo Ingreso, con LPN/lote/serie). `inventario_conteo_items.fuera_de_scope`.
- **F3b — doble conteo formal + snapshot de costo:**
  - `inventario_conteo_items.costo_snapshot` — el costo se congela al cargar la línea; la valorización deja de usar el `precio_costo` actual al continuar un borrador (bug del pending note).
  - Doble conteo **formal**: las filas cuyo 1er conteo supera el umbral de discrepancia (`conteo_reconteo_*`) exigen **re-ingreso** (columna "Recontar", idealmente otro operador) antes de finalizar; se puede **saltar con clave maestra** (SUPERVISOR/DUEÑO, `verificar_clave_maestra`). Persiste `cantidad_reconteo` + `reconteo_por`; el ajuste usa el valor recontado (`contadaEfectiva`).
- **A2 — wall-to-wall bloquea la sucursal:** toggle `tenants.conteo_wall_to_wall_bloquea` (**default OFF** → sin cambios para tenants actuales). Al iniciar un conteo de sucursal completa con el toggle on: confirmación (DUEÑO/SUPERVISOR) + se crea el borrador con `inventario_conteos.bloquea_movimientos=true` en el acto. Mientras esté abierto, el **POS** no permite reservar/despachar (presupuesto sí, no mueve stock) y el **Inventario** no permite ingreso/rebaje en esa sucursal. Hook compartido `src/hooks/useConteoBloqueante.ts`; badge "🔒 Bloqueante" en el historial; se libera al finalizar/eliminar el conteo.

**🎉 Conteos 2.0 (ISS-CONT) CERRADO al 100% — F1-F4 + refinamientos en PROD.** Diseño/relevamiento en `relevamiento_conteos_respuestas.md`.

---

## [2026-06-05] deploy | v1.29.0 PROD — Conteos 2.0 F2b (scan-to-count) + F4 (ABC/cíclico/reportes/trazabilidad) — cierre del módulo

**Deployado a PROD.** Migración **180** (aditiva) en DEV y PROD. Build verde, **362 tests verdes** (+16 de `conteoAbc`). PR #157 mergeado, release v1.29.0, dev=main. Vercel PROD en build al cierre.

- **F2b — scan-to-count:** botón "Escanear para contar" en el tab Conteo abre `BarcodeScanner` en modo **persistente** (sigue escaneando). Cada lectura resuelve el código (GS1 vía `resolverScanCompuesto` con fallback a barcode/SKU) y **suma a la fila del producto** la cantidad del AI GS1 (30) o **+1**. Respeta unidad entera/decimal; ref espejo `conteoRowsRef` para scans rápidos consecutivos; toast `+N Producto → total`. `BarcodeScanner` gana prop `persistentCloseLabel` (para no decir "Finalizar venta" fuera del POS).
- **F4 — cierre de Conteos 2.0 (4 piezas):**
  - **Clase ABC:** `productos.clase_abc` (A/B/C, CHECK) + `clase_abc_manual` + `ultimo_conteo_at`. "Recalcular ABC" client-side (reusa `clasificarABC`, **Pareto 80/95** por valor de movimiento de 12m = Σ cantidad × `precio_costo_historico`); respeta overrides manuales; 3 updates agrupados por clase. Override por producto desde el panel.
  - **Conteo cíclico sugerido:** `tenants.conteo_ciclico_dias_a/b/c` (default 30/90/180, editables en Config → Inventario). Panel "Conviene contar" (vencidos por clase, nunca contado = prioridad máxima) con atajo "Contar" → conteo por producto preseleccionado.
  - **Reportes de exactitud + valorización:** `reporteExactitud` (% exactitud + $ faltante/sobrante/neto). Por conteo (detalle finalizado) + **acumulado** (panel) + **export Excel** por conteo.
  - **Trazabilidad por operador:** `inventario_conteo_items.contado_por` seteado al guardar + columna "Contado por" en el detalle.
- **Lógica pura** en `src/lib/conteoAbc.ts` (`clasificarABC`, `sugerirConteoCiclico`, `reporteExactitud`) + 16 tests.
- **schema_full.sql** actualizado con bloque consolidado Conteos 2.0 (mig 177-180), que estaba desfasado en mig 176.

**Conteos 2.0 (ISS-CONT) CERRADO — F1-F4 en PROD.** Pendientes futuros (no bloqueantes): F2b-refinamiento (alta de fila al escanear fuera de scope) · F3b (doble conteo formal 2º operador + clave maestra C4 + snapshot de costo) · wall-to-wall A2 (bloqueo POS durante conteo full).

---

## [2026-06-03] deploy | v1.27.0 PROD — Conteos 2.0 F3 (gate de ajustes + autorizaciones + reconciliación delta)

**Deployado a PROD.** Migración **179** en DEV y PROD. Build verde, **346 tests verdes** (+16 de `conteoAjuste`).

- **Gate de aprobación de ajustes (D):** las diferencias de un conteo ya no tocan el stock directo. Config en Config → Inventario: `tenants.conteo_gate_activo` + umbrales `conteo_gate_umbral_u/_pct/_valor`. **Gate inactivo → toda diferencia va a aprobación**; activo → solo las que superen algún umbral (unidades / % / valor $), el resto se aplica directo.
- **Tab Autorizaciones (D1):** las diferencias que pasan el gate se insertan en `autorizaciones_inventario` con `tipo='ajuste_conteo'` (motivo "Diferencia Conteo") → un DUEÑO/SUPERVISOR las aprueba en Inventario → Autorizaciones. `aprobarAutorizacion` aplica el ajuste al aprobar.
- **Reconciliación por delta (G1):** al aplicar (directo o aprobado) NO se pisa el stock; se aplica `vivo + (contado − esperada_snapshot)` sobre el stock vivo → respeta ventas ocurridas durante el conteo en vez de revertirlas. `reconciliarDelta` (testeada).
- **Doble conteo (C):** umbrales `conteo_reconteo_umbral_u/_pct/_valor`; al finalizar avisa qué filas superan el umbral para recontar (versión "aviso", `window.confirm`).
- **Lógica pura** en `src/lib/conteoAjuste.ts`: `superaUmbral` (combinado u/%/$), `requiereAutorizacion`, `requiereReconteo`, `reconciliarDelta` + 16 tests.

**QA (híbrido):** `migration-reviewer` (APTA) + `code-reviewer` detectó 2 bloqueantes — `stock_antes` se leía después de mutar la línea (auditoría errónea, **bug preexistente**) + posible movimiento con cantidad 0 → ambos corregidos en finalizar y en aprobar.

**Pendiente Conteos 2.0:** F2b (scan-to-count) · F3b (doble conteo formal con 2º operador + clave maestra C4; snapshot de costo por ítem) · F4 (clase ABC + cíclico + reportes exactitud/valorización).

---

## [2026-06-03] deploy | v1.26.0 PROD — Conteos 2.0 F2a (modos + a ciegas + unidad de medida + secuencia)

**Deployado a PROD.** Migración **178** en DEV y PROD. Build verde, 330 tests verdes.

- **Modo de conteo configurable** (`tenants.conteo_modo` = rapido | guiado | elegir; Config → Inventario): **Rápido** = informado (precarga la esperada, como antes); **Guiado** = a ciegas (input vacío, oculta Esperado/Diferencia); **Elegir** = el operador decide al crear el conteo (toggle).
- **Conteo a ciegas (B1/B2):** en guiado no se ve el stock del sistema; DUEÑO/SUPERVISOR/ADMIN puede "revelar" la esperada de una fila puntual (botón ojo). Banner de modo.
- **Filas en blanco (B3):** `inventario_conteo_items.cantidad_contada` ahora nullable. `null` = no contada → se omite del ajuste; `0` = contó cero → ajusta. Al finalizar avisa cuántas quedaron sin contar.
- **🐛 Fix (pedido GO): el input "Contado" respeta la unidad de medida.** Antes, con la flechita, 15 → 14,999 en productos de unidades. Ahora: unidades/piezas → enteros (step 1, redondeo); kg/gr/lt/ml → decimales. Reusa `esDecimal()`.
- **`ubicaciones.secuencia`** (I3): nuevo campo de orden de recorrido (conteo + picking), editable en Config → Inventario → Ubicaciones (junto a prioridad de rebaje, que es distinta). El conteo ordena las líneas por esta secuencia (fallback prioridad → nombre).

**QA (híbrido):** `migration-reviewer` corrigió el patrón del CHECK (usar `information_schema.table_constraints` con `table_name`, como mig 134/135). `code-reviewer` detectó 2: `modo` no se persistía al actualizar un borrador + valor negativo tratado como "no contada" en silencio → ambos corregidos.

**Pendiente Conteos 2.0:** F2b (scan-to-count) · F3 (gate ajustes + autorizaciones + doble conteo + reconciliación delta) · F4 (clase ABC + cíclico + reportes).

---

## [2026-06-03] deploy | v1.25.0 PROD — Conteos 2.0 F1 (scope por Marca / Categoría / Wall-to-wall)

**Deployado a PROD.** Migración **177** aplicada en DEV y PROD. Build verde, 330 tests verdes. Primera fase de **Conteos 2.0** (ISS-CONT), arrancando por lo que pidió GO: conteo por **Marca**.

- **Scope ampliado:** el conteo de inventario (InventarioPage → tab Conteo) ahora soporta **por Marca, por Categoría y Sucursal completa (wall-to-wall)**, además de ubicación/producto. Toggle de 5 alcances + selector dinámico.
- **Mig 177:** CHECK de `inventario_conteos.tipo` ampliado (`+ marca, categoria, sucursal`) + `filtros JSONB` (guarda el criterio cuando no es FK directa).
- `cargarLineasParaConteo` arma el query dinámico con `productos!inner` para filtrar por `marca`/`categoria_id`. Las marcas/categorías del selector se derivan del **stock de la sucursal activa** (no del maestro entero).
- **Aislamiento por sucursal:** los scopes amplios (marca/categoría/wall-to-wall) **exigen una sucursal específica** (no "Todas") — guard en la carga + toggles deshabilitados con tooltip.

**Flujo de QA (modelo híbrido):** `migration-reviewer` → APTA (nombre de constraint correcto, idempotencia aceptable, sin DDL destructivo). `code-reviewer` → detectó **un bloqueante**: wall-to-wall con `sucursalId=null` cruzaba sucursales y el ajuste pisaba stock ajeno → corregido (guard + toggles). También reset de `conteoTipo` y filtrado de marcas/categorías por sucursal. Ver [[feedback_usar_subagentes_proyecto]].

**Pendiente Conteos 2.0:** F2 (modos + ciego + scan + secuencia ubicación) · F3 (gate ajustes + tab Autorizaciones + doble conteo + reconciliación delta) · F4 (clase ABC + cíclico + reportes). Diseño completo en `relevamiento_conteos_respuestas.md`.

---

## [2026-06-03] deploy | v1.24.0 PROD — Clientes C6 (segmentación+export) + D4 (NC manual proveedor)

**Deployado a PROD.** Backlog diferido de Clientes, **sin migración** (usa columnas de mig 176 + el tipo `'nota_credito'` ya en el CHECK de mig 085). Build verde, 330 tests verdes.

- **C6 — segmentación de clientes (marketing):** en ClientesPage → tab Reportes, sección "Segmentación de clientes". Filtros por etiqueta, estado CC (habilitada/con deuda/sin deuda), actividad (compraron/nunca/inactivos +60d), mínimo comprado y con contacto (email/tel). Export CSV/Excel de la lista segmentada con datos de marketing. Reusa `statsMap`/`ventasCC`/`creditoMap`/`etiquetasCatalogo`. Cierra C6 (era "solo segmentación+export, sin bulk-sender nativo").
- **D4 — NC manual de proveedor:** en ProveedoresPage → modal CC, sección "Nota de crédito". Form (monto, nº `NC-NNNN` correlativo sugerido sobre toda la historia del proveedor + editable, motivo, adjunto opcional al bucket `comprobantes-gastos`). Inserta movimiento `tipo='nota_credito'`, `monto` negativo (acredita/reduce deuda), con `nc_numero` + `adjunto_url`. Link al comprobante en el historial. Cierra el ◑ que dejó CL5 (las columnas existían, faltaba la UI).

**Flujo de QA estrenado:** `code-reviewer` (subagente, vía Agent) revisó el diff antes de mergear → confirmó behavior/multi-tenant OK y detectó 2 cosas que se arreglaron: correlativo calculado sobre los 50 movimientos visibles (→ query dedicada al máximo real) + form NC sin resetear al cambiar de proveedor (→ reset al abrir el panel). Ver [[feedback_usar_subagentes_proyecto]] (modelo híbrido: grueso inline + agente para revisión read-only del diff).

---

## [2026-06-03] deploy | v1.23.2 PROD — QA: extensión de tests a Caja / Inventario / Ventas (+101)

**Deployado a PROD.** Refactor interno + cobertura de tests, **sin cambio de comportamiento, sin migración**. Sesión autónoma (GO autorizó alcance + deploy de antemano).

Segundo estreno del pipeline de QA, ahora sobre **3 módulos**:

- **Caja:** lógica de arqueo extraída de `CajaPage.tsx` a `src/lib/cajaArqueo.ts` (rewire behavior-preserving): `signoMovimiento`, `saldoSesion`, `calcularDiferenciaCierre`, `calcularDiferenciaApertura`, `superaUmbralDiferencia` (B1/B2/B3), `clasificarAjusteDiferencia` (B4), `tipoAjusteTraspaso` (ISS-193), `acumularTotalesPorMetodo`, `extraerMedioPago`/`extraerNumeroVenta`. Tests: `cajaArqueo.test.ts` (38) + `cajaPermisos.test.ts` (matriz J3 / B5 / B6, 19). **+57**.
- **Inventario:** `unidades.test.ts` (17) — conversión kg↔gr / lt↔ml, compatibilidad, formato es-AR.
- **Ventas:** `ventasDescuentoCombo.test.ts` (7, gap `calcularDescuentoComboMulti`) + `permisosCosto.test.ts` (8, `puedeVerCosto` G4) + `umbralGasto.test.ts` (13, `evaluarUmbralGasto` + `puedeAprobar`). **+28**.
- Planes de escenarios: `tests/specs/{caja,inventario,ventas}.plan.md`.

**Suite total: 329 unit tests verdes** (228 → +101). Build verde (`tsc && vite build`).

---

## [2026-06-03] update | v1.23.1 PROD — QA: lógica de CC testeable + ecosistema de subagentes

**Deployado a PROD** (PR #148). Refactor interno + cobertura de tests, **sin cambio de comportamiento, sin migración**.

**Ecosistema de subagentes de proyecto** (`.claude/agents/`, commiteados): 9 agentes — relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper. Ver [[wiki/development/agentes-claude-code]].

**Primer estreno del pipeline de QA** sobre Clientes:
- `spec-extractor` → `tests/specs/clientes.plan.md` (41 escenarios; detectó que la lógica de plata de CC estaba 100% sin cubrir).
- Lógica de CC extraída a `src/lib/ccLogic.ts` (single source of truth): `evaluarLimiteCC` (B1), `evaluarMorosidad` (B4), `calcularInteresMora` (B3, espejo RPC), `calcularEstadoCC` (espejo RPC), `planificarCobranzaFIFO` (B5), `agruparAgingCC` (G1). Rewire behavior-preserving en VentasPage/cobranzaCC/ClientesPage.
- `test-author` → `tests/unit/ccLogic.test.ts` (50 casos) + detectó un error de cálculo en el plan (CL2-B3-08: 287.40 → 288.07; el código era correcto).
- Suite total: **228 unit tests verdes**. Build verde.

**Infra de testing confirmada (Fase 0):** `.env.test.local` + auth por rol (cajero/supervisor/rrhh/owner) + 16 specs e2e ya existían.

**Caveat:** los subagentes creados a mitad de sesión recién son invocables por nombre al reiniciar Claude Code; en esta sesión se corrieron vía `general-purpose` embebiendo sus instrucciones.

---

## [2026-06-02] deploy | v1.23.0 PROD — Clientes CL4+CL5+CL6 — MÓDULO CLIENTES COMPLETO

**Deployado a PROD** (PR #143). Migrations 175 (CL4) + 176 (CL5) en DEV y PROD; CL6 sin migración. Build verde. Sesión retomada tras reinicio de máquina (estado verificado: mig 171-174 + v1.20.0 ya en PROD).

- **CL4 notificaciones (mig 175):** `lib/notificacionesCC.ts` (email event-driven vía `send-email`). C1 email al registrar deuda CC; C4 comprobante de pago en las 3 vías (ficha/POS/Caja); C2 umbral pre-vencimiento configurable (resaltado tab CC); C5 panel cumpleaños + saludo WA. Config en ConfigPage → Ventas → Operativa. Defaults OFF (opt-in). C3 escalado configurable (envío background no disponible sin pg_cron).
- **CL5 CC proveedores (mig 176):** tabla `proveedor_cuentas_bancarias` (D6) + CRUD en modal CC; PDF estado de cuenta proveedor (D3); columnas `nc_numero`/`adjunto_url` (D4). D2/D5 ya existían.
- **CL6 reportes/audit (sin migración):** tab "Reportes" (top clientes, inactivos +60d, aging CC 0-30/31-60/61-90/+90); export Excel (G3); audit log de cambios del cliente en sub-tab "Cambios" (F4); tipos `EntidadLog`/`AccionLog` ya extendidos en CL3.
- **🐛 Fix autofill:** Chrome escribía un email guardado en el buscador de ventas (Historial) al aparecer el input de clave maestra. Fix: `autoComplete="new-password"` en el password + `autoComplete="off"` en los buscadores.

**🎉 Módulo Clientes CL1–CL6 COMPLETO.** Backlog diferido: B7, C6, F2, D4 UI NC, C3 background (cron), cobranza CC con impacto en arqueo.

---

## [2026-06-02] deploy | v1.20.0 PROD — Clientes CL3 (incobrables + estado de cuenta) + bugfix origen

**Deployado a PROD.** Migrations 173 (CL3) + **174 (bugfix)**, ambas en DEV y PROD. Build verde.

- **B6 incobrables:** botón "Incobrable" en tab CC (DUEÑO/ADMIN/SUPER_USUARIO) → modal motivo + clave maestra → condona deuda CC del cliente (tag `Incobrable`) + gasto automático "Deudores incobrables" + `logActividad`. Tipos `EntidadLog`/`AccionLog` extendidos (`cliente`/`incobrable`).
- **B8 estado de cuenta:** lib `estadoCuentaPDF.ts` (PDF jspdf) + portal público `/cuenta/:token` (`CuentaClientePage`) vía `clientes.cuenta_token` (mig 173) + RPC `get_cuenta_cliente_by_token` (anon). Botones "Estado de cuenta" y "Link cliente" en el tab CC.
- **🐛 Bugfix (mig 174):** `DROP CONSTRAINT ventas_origen_check`. Reportado por GO: "new row violates check constraint ventas_origen_check" al vender. Causa: mig 168 hizo el canal configurable por tenant, pero la constraint rígida (mig 122) seguía con lista fija. Aplicado directo en DEV+PROD (toma efecto inmediato).

**Pendiente:** CL4 (notificaciones) · CL5-CL6.

---

## [2026-06-01] deploy | v1.19.0 PROD — Clientes CL1 + CL2 (CC + cobranza)

**Deployado a PROD.** PR #140 (`dev → main`) mergeado · release `v1.19.0` (`--latest`) · migrations **171 + 172 aplicadas en PROD** (aditivas/idempotentes) · DEV alineado con PROD · build verde. Vercel PROD deploy desde `main`.

Arranque de implementación del backlog Clientes. Build verde (`tsc && vite build`). Migrations 171+172 en DEV y PROD.

**CL1 — v1.18.0 · mig 171 (soft delete + etiquetas):**
- A6: baja = soft delete con razón (`clientes.motivo_baja/baja_at/baja_por`); botón "Dar de baja" + modal motivo, badge "Baja", toggle "Ver inactivos" + reactivar. El hard-delete (código muerto) se reemplazó.
- A2: alerta de duplicado al crear (DNI/tel/nombre) sin trabar.
- A5: import detecta duplicados contra toda la base + 3 modos (ignorar existentes/nuevos/procesar todos) con UPDATE de existentes; columna `etiquetas` en plantilla.
- F1: autocomplete de etiquetas (`<datalist>`) = `tenants.cliente_etiquetas_catalogo` ∪ usadas.
- B2: habilitar CC solo DUEÑO/SUPERVISOR. H2: CONTADOR read-only en `/clientes`.

**CL2 — v1.19.0 · mig 172 (CC: límite/vencimiento/interés/morosidad):**
- B1: enforcement configurable (`cc_enforcement_politica` permitir/avisar/bloquear) + `limite_cc_default`; reusa `clientes.limite_credito`. Aplicado en el POS al despachar CC.
- B3: `ventas.fecha_vencimiento_cc` al crear venta CC + interés de mora (`cc_interes_mensual_pct` → `ventas.interes_cc`) por RPC `recalcular_intereses_cc` (sweep-lazy, pg_cron no habilitado). Tab CC muestra interés + vencimiento.
- B4: morosidad (`cc_morosidad_politica` permitir/bloqueo_cc/bloqueo_total) en el POS, con RPC `cliente_cc_estado`.
- B5: cobranza FIFO desde las 3 vías — ficha + **POS** (botón "Deuda CC" en el chip) + **Caja** (tab "Cobranzas CC", `CajaCobranzasCC`). Helper compartido `src/lib/cobranzaCC.ts`. **CL2 COMPLETO.**
- ConfigPage → Ventas → Operativa: sección "Cuenta corriente de clientes".

**Pendiente:** CL3-CL6 · deploy a PROD (aplicar mig 171+172).

---

## [2026-06-01] update | Relevamiento Clientes COMPLETO — respuestas consolidadas + plan por fases CL1-CL6

Relevamiento de reglas de negocio del módulo **Clientes** (GO + socio) procesado y cruzado con `relevamiento_ventas_respuestas.md`.

**Qué se hizo:**
- Volcadas todas las respuestas (A-H) a `sources/raw/relevamiento_clientes_respuestas.md`.
- Cruce con Ventas donde GO lo pidió: B4↔Ventas D6, B5↔D5, B6↔D7, B7↔D8, B3↔D2, C1↔D3, H2↔J3. Coherencia confirmada.
- **Resuelto contradicción F3 vs Ventas G2:** GO decidió **precio solo por cantidad por producto** (`producto_precios_mayorista`, ya en PROD). Se **descarta** lista atada al cliente (`cliente.lista_id`).
- Sugerencias cerradas donde GO pidió "¿qué sugerís?": A2 (alerta duplicado vs rechazo duro), B1 (enforcement configurable), D3/D4/D5/D6 (proveedores).
- **GO no eligió Top 3: entra todo.** Plan por fases **CL1-CL6** (v1.18.0 → v1.23.0) documentado en `project_pendientes.md`.
- **Transversal:** disparos por tiempo (intereses, recordatorios, escalados) por sweep lazy (pg_cron no habilitado).

**Pendiente:** arrancar implementación por CL1 (fundación datos + permisos, bajo riesgo). Sin código aún — esta sesión fue relevamiento + diseño.

---

## [2026-06-01] update | v1.17.0 PROD — Relevamiento Ventas VF5 (edición post-venta + NC interna) — RELEVAMIENTO VENTAS COMPLETO

Quinta y última fase del backlog Ventas H-K. Bump v1.16.0 → **v1.17.0**. **Sin migración** (reusa `devoluciones` + `venta_auditoria`).

- **H1a — autorización post-cobro**: quitar/editar ítems de una venta **cobrada** (vía Devolver) ahora requiere rol **DUEÑO/SUPERVISOR/ADMIN**; otros roles (CAJERO) necesitan la **clave maestra** de un autorizado (si no hay clave configurada, se bloquea). Gate en `abrirModalDevolucion` (refactor con closure `abrir` + `pedirClaveMaestra`).
- **H1b — NC interna**: al devolver/ajustar una venta **facturada**, el comprobante se identifica como **"NOTA DE CRÉDITO INTERNA · NO FISCAL"** (no reemplaza la NC electrónica AFIP, que queda como feature aparte). Se registra en el audit log de la venta (`venta_auditoria`, acción `nc_interna` con `numero_nc` + monto + motivo + ítems); las devoluciones de ventas despachadas se loguean como `devolucion`. El timeline del detalle muestra N° de NC + monto.
- Typecheck + `vite build` OK. **Relevamiento de Ventas (A-K) COMPLETO**; único pendiente futuro: NC electrónica AFIP (L1) + venta física en USD/caja USD.

---

## [2026-06-01] update | v1.16.0 PROD — Relevamiento Ventas VF4 (reportes + alertas + export)

Cuarta fase del backlog Ventas H-K. Bump v1.15.0 → **v1.16.0**. Migration **170** (DEV+PROD).

- **K1 (ReportesPage)** — 5 reportes nuevos: **baja rotación** (unidades vendidas asc, incl. no vendidos), **más devoluciones** (ranking de productos por unidades devueltas), **anuladas y devueltas** (devoluciones + ventas canceladas con motivo), **comparativa por canal** (ventas/total/ticket promedio por canal + clasificación online/presencial vía `useCanalesVenta`), **margen real por venta** (total − costo histórico, % de margen).
- **K3** — export **CSV** además de Excel/PDF en cada reporte (`exportarCSV` con `sheet_to_csv` + BOM UTF-8).
- **K2 (mig 170)** — alertas **event-driven** a DUEÑO/SUPERVISOR/ADMIN (`notificarRolesVentas` → `notificaciones`): **margen negativo** al cerrar venta despachada (costo > total); **cliente/producto con >N devoluciones en M días** (chequeo al `procesarDevolucion`, fire-and-forget). Umbrales en Config → Ventas → Operativa (`alerta_margen_negativo`, `alerta_devoluciones_n`, `alerta_devoluciones_dias`).
- Typecheck + `vite build` OK. `schema_full.sql` + wiki actualizados.

---

## [2026-06-01] update | v1.15.0 PROD — Relevamiento Ventas VF1-VF3 (POS operativo + canales + auditoría)

Implementadas las 3 primeras fases del backlog Ventas H-K (relevamiento respondido el 2026-06-01). Bump v1.14.1 → **v1.15.0**. Migrations **167-169** (DEV+PROD). PR `dev → main` + Vercel.

**VF1 — POS operativo (H2-H5):**
- **H4** — reserva y venta directa (incl. 100% CC) **siempre exigen caja abierta**; solo el presupuesto (`pendiente`) puede crearse sin caja. Se quitó la excepción que permitía despachar 100% CC sin caja (`registrarVenta`).
- **H5** (mig 167) — flag **"Consumidor Final" vs "Cliente registrado"** al iniciar la venta (`ventas.consumidor_final`). Con facturación activa y no-CF → cliente obligatorio. Toggle en el panel Cliente (si `factHabilitada && permiteCF`); elegir cliente registrado lo marca como no-CF.
- **H2** — botón **"Enviar por email"** en el modal de ticket (reusa el template `venta_confirmada` de `send-email`), junto a "Imprimir".
- **H3** — reimpresión desde el historial ya disponible vía "Ver / Imprimir ticket" del detalle.

**VF2 — Canales configurables + reglas online/presencial (I1+I2, mig 168):**
- **I1** — tabla `canales_venta` por tenant (CRUD en Config → Ventas → Operativa, `CanalesVentaPanel`) con clasificación **online/presencial**; seed `SECURITY DEFINER` + trigger. El POS toma los canales del tenant (antes hardcodeado). **MP** no se seedea (es medio de pago). Hook `useCanalesVenta` (+ `clasificacionDe`/`reglaDe`).
- **I2** — `tenants.reglas_canal` con reglas por clasificación, **aplicadas** en POS/devoluciones: `requiere_cliente` (cliente obligatorio), `descuento_max_pct` (tope por canal), `lista_precio` (fuerza minorista/mayorista en `precioTierEfectivo`), `devolucion_dias` (plazo en `abrirModalDevolucion`).

**VF3 — Auditoría y permisos (J1-J3, mig 169):**
- **J1** — tabla `venta_auditoria` + helper `logVentaAuditoria` + **timeline en el modal** de la venta. Se registran anulación, cambio de cliente y override de descuento.
- **J2** — **clave maestra** (RPC `verificar_clave_maestra`) para **anular venta despachada**, **cambiar cliente** (botones nuevos en el detalle) y **override de descuento** (autoriza descuentos sobre el tope por rol/canal). Sin clave configurada no se exige.
- **J3** — **CONTADOR** con acceso **read-only** a Ventas: ruta en `CONTADOR_ALLOWED` + nav visible + en VentasPage solo el historial (sin POS, sin devolución/anular/registrar).
- Typecheck + `vite build` OK. `schema_full.sql` + wiki actualizados.

---

## [2026-05-31] hotfix | v1.14.1 PROD — fix RLS en seed de categorías de gasto (onboarding roto)

**Bug reportado por GO:** al registrar un negocio nuevo (Google + datos del negocio → "Crear") saltaba `new row violates row-level security policy for table "categorias_gasto"`.

**Causa raíz:** el onboarding (`OnboardingPage.tsx`) inserta **tenant primero, users después**. El trigger `trg_seed_categorias_gasto_new_tenant` (AFTER INSERT en `tenants`, mig 130) seedea `categorias_gasto` durante el INSERT del tenant — antes de que exista la fila en `users` que liga al usuario con el tenant. La función `fn_seed_categorias_gasto_new_tenant` / `seed_categorias_gasto` **NO eran SECURITY DEFINER**, así que el INSERT quedaba sujeto al RLS `WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))` → conjunto vacío → rechazo. Las otras 2 funciones de seed del tenant (`fn_seed_tenant_defaults`, `fn_crear_caja_fuerte`) ya eran SECURITY DEFINER; ésta quedó sin serlo desde mig 130. No relacionado con ISS-174.

**Fix (mig 166):** ambas funciones pasan a `SECURITY DEFINER` + `SET search_path = public`. Aplicada en DEV + PROD; verificado `prosecdef=true`. Surte efecto inmediato (fix de función en DB). Bump v1.14.0 → v1.14.1.

---

## [2026-05-31] update | v1.14.0 PROD — ISS-174 F2-F5: cotización/generación de envíos por API de courier

Continuación del mismo día: tras F1, se implementaron **todas las fases F2-F5** de ISS-174 y se deployó a PROD como **v1.14.0** (bump v1.13.0 → v1.14.0). Migration **165** aplicada en DEV+PROD. Edge Function `courier-api` deployada en DEV+PROD. PR `dev → main` + Vercel.

- **Edge Function `courier-api`** (`supabase/functions/courier-api/`) — router por `action` (cotizar | generar | tracking) + adapters **Andreani** (F2, REST), **Correo Argentino** (F3, Paq.ar), **OCA** (F4, SOAP); tracking en los tres (F5). Auth por JWT → tenant; credenciales leídas SOLO server-side (service_role), nunca al front. Errores de negocio → 400 con mensaje accionable.
- **mig 165** — `envios.cotizacion_json` (snapshot opciones) + `courier_orden_id` + `cotizado_api`.
- **Front** — `src/lib/couriers/api.ts` (cotizarEnvio / generarEnvioCourier / trackingEnvioCourier). **POS**: botón "Cotizar {courier}" (CP destino + peso) → lista servicio/precio/plazo → elegir setea servicio + costo (editable). **Envíos**: "Cotizar" en el modal + "Generar con courier" / "Etiqueta" / "Actualizar tracking" en el panel del envío. `esCourierApi()` gatea la UI a Andreani/Correo/OCA.
- **⚠ Adapters NO validados con cuentas reales** (GO aún no tiene contratos B2B). Escritos según documentación pública; al conseguir credenciales hay que validar/ajustar endpoints y mapeos. Fail-safe: sin credenciales → error claro, el alta manual de envíos no se ve afectada.
- Typecheck + `vite build` OK. Edge Function deployada (el bundle Deno compila). `schema_full.sql` (F1 cols) + wiki actualizados.

---

## [2026-05-31] update | ISS-174 F1 — Fundación cotización de envíos por courier (DEV)

Relevado con GO el diseño completo de ISS-174 (cotización + generación de envíos por API de courier) y arrancada la **Fase 1** (fundación, sin tocar APIs). Decisiones: **APIs directas** por courier (Andreani → Correo Argentino → OCA), alcance **completo** (cotizar + generar orden + etiqueta + tracking), **credenciales por tenant**, peso **configurable** (manual por envío | dato maestro del producto), cotizar en **POS + Envíos**, **CP estructurado**, operador **elige servicio** (precio editable). Diseño y fases en `project_pendientes.md` → sección ISS-174.

**F1 implementado en DEV:**
- **Parte 1** — *Servicio* de envío en el POS pasó de input libre a **select dependiente del courier** (igual que en Envíos). Catálogo `COURIERS`/`SERVICIOS_POR_COURIER` extraído a `src/lib/couriers/catalogo.ts` (compartido por `EnviosPage` y `VentasPage`).
- **mig 162** — `courier_credenciales` (credenciales de API por tenant, RLS por tenant) + `tenants.envio_peso_fuente` ('manual'|'producto', default manual).
- **mig 163** — idempotente: `codigo_postal` ya existía (sucursales mig 124, cliente_domicilios mig 074); re-documenta para ISS-174.
- **mig 164** — `productos.peso_kg/largo_cm/ancho_cm/alto_cm`.
- **Config → Envíos** — card "Peso y medidas para cotizar envíos" (toggle manual/producto) + `CourierCredencialesPanel` (owner-only; Andreani/Correo/OCA, campos por courier, secretos como password, estado "Configurado"). Campos peso/dim en `ProductoFormPage`. `AddressAutocompleteInput` ahora pasa `postcode` best-effort (Nominatim) para F2.
- Typecheck + `vite build` OK. Migrations 162-164 aplicadas en DEV. `schema_full.sql` actualizado. **Pendiente**: deploy a PROD + F2 (Edge Functions cotizar/generar Andreani, requiere credenciales reales del negocio).

---

## [2026-05-31] update | v1.12.0 PROD — Relevamiento Ventas E/F/G

Deploy a PROD. Bump `APP_VERSION` v1.11.6 → **v1.12.0**. Migrations **159 + 160** aplicadas en PROD (aditivas, antes del merge). PR `dev → main` + merge → Vercel PROD. Release + tag `v1.12.0`.

Contenido: reservas (seña obligatoria/mínima, vencimiento + liberación automática, penalidad + crédito a favor + redención, motivo cancelación), presupuestos (`PRES-NNNN` + actualizar on-demand), mayorista por cantidad en POS, costo/margen oculto por rol. Detalle por ítem en `relevamiento_ventas_respuestas.md`. Pendientes del relevamiento: G3 (refinamiento) y G5 (USD).

---

## [2026-05-31] update | v1.13.0 PROD — Ventas G3 (descuentos por rol) + G5 (precio USD) — relevamiento COMPLETO

Cierra el relevamiento de Ventas E/F/G. Bump v1.12.0 → **v1.13.0**. Migration **161** (DEV+PROD).

- **G3** — solo DUEÑO/SUPERVISOR/ADMIN aplican descuentos (`ROLES_DESCUENTO`; antes solo CAJERO bloqueado). Bloqueo de inputs en POS + validación dura en `registrarVenta` (ítem y global). SUPERVISOR limitado por `descuento_max_supervisor_pct` (ítem + global); DUEÑO/ADMIN sin tope. Config: campo "máx CAJERO" reemplazado por nota (cajero no aplica descuentos). Sin migración.
- **G5** (mig 161) — `productos.precio_usd` + `productos.moneda_venta` ('local'|'usd'). Form: select moneda + input USD + preview de conversión. POS: si `moneda_venta='usd'`, convierte a pesos a la cotización vigente al cargar (`precio_usd_origen` para el hint en el carrito). Venta física en USD/caja USD: diferida.
- Typecheck + build OK. `schema_full.sql` actualizado (productos precio_usd/moneda_venta). Deploy: PR dev→main + merge → Vercel PROD; release+tag v1.13.0.

---

## [2026-05-31] update | Ventas G1/G2 (mayorista por cantidad) + E3 (motivo cancelación) (DEV)

- **G1/G2** — el POS aplica precios mayoristas por **cantidad de la línea** (`producto_precios_mayorista`, infra que ya existía). `tiersMayoristaMap` (query) + helper `precioTierEfectivo(item)` (tier de mayor `cantidad_minima` ≤ cantidad; si no, minorista). Usado en `getItemSubtotal` y persistido en `venta_items.precio_unitario`. Indicador "Precio mayorista" en el carrito (minorista tachado). Sin migración. CartItem += `tiers`.
- **E3** — catálogo cerrado de motivo de cancelación de reserva (`MOTIVOS_CANCELACION_RESERVA`) + observación opcional. **Toda** cancelación de reserva ahora pasa por el modal (antes solo las que tenían seña); motivo obligatorio. Se guarda en `ventas.notas`. Sin migración.
- Typecheck + build OK.

---

## [2026-05-31] update | E2 reservas — redención del crédito a favor en POS (DEV)

Cierre de E2. La redención del saldo a favor quedó completa:
- POS: medio de pago **"Crédito a favor"** (visible si el cliente tiene saldo). Cuenta como pagado (cubre total + suma a `monto_pagado`) pero NO entra a caja (excluido de los 2 loops de `ingreso_informativo`). Al confirmar inserta consumo negativo en `cliente_creditos` (`origen='consumo_venta'`). Validación: no supera el saldo. Effect que trae el saldo al seleccionar cliente (`clienteCredito`).
- ClientesPage: query `creditoMap` (saldo por cliente) + badge "🎁 Saldo a favor $X" en la ficha.
- Typecheck + build OK. Sin migración nueva (usa `cliente_creditos` de mig 160).

---

## [2026-05-31] update | Relevamiento Ventas E/F/G — G4, F1, F5, bloque reservas (DEV)

Implementación de respuestas del relevamiento de Ventas (secciones E/F/G), sin deployar a PROD aún.

- **G4** — `src/lib/permisosCosto.ts` (`puedeVerCosto`). Costo y margen ocultos para CAJERO/DEPOSITO en `ProductosPage` (cards, panel expandido, botón Orden de Compra) y `ProductoFormPage` (precio de costo, margen actual, margen objetivo, precio sugerido). El POS no exponía costo. Sin migración.
- **F1** — botón "Actualizar presupuesto" on-demand en el detalle (presupuestos no vencidos): recrea con precios actuales y resetea el contador de validez. La config `presupuesto_validez_dias` ya existía.
- **F5** (mig **159**) — correlativo independiente de presupuestos `PRES-{cod}-NNNN` por sucursal. `ventas.presupuesto_numero` + `presupuesto_numero_sucursal`, trigger `gen_venta_numero` extendido + backfill (deshabilitando `trg_ventas_cierre` durante el UPDATE). `formatTicket` muestra el prefijo PRES.
- **E6 + E1** (mig **160**) — `tenants.reserva_sena_obligatoria` + `reserva_sena_minima_pct` (validación al reservar, ambos paths) + `reserva_vencimiento_dias` (NULL=sin venc.) + `ventas.reservado_at`. Función `liberar_reservas_vencidas(tenant)` libera stock reservado + cancela las vencidas (NO toca dinero, saltea período cerrado por reserva). Sweep lazy al entrar a Ventas. Config UI nueva en ConfigPage → Ventas → Operativa → "Reservas".
- **E2 parcial** (mig **160**) — cancelación de reserva con seña: penalidad % (`reserva_penalidad_pct`) + elección devolución / crédito a favor. Tabla `cliente_creditos` (ledger, saldo = SUM(monto)). Gate E4: solo DUEÑO/SUPERVISOR/ADMIN cancelan reserva con seña. **Pendiente**: redención del crédito en POS + saldo a favor en ficha del cliente.
- **G1/G2** confirmado por GO: mayorista por **cantidad de unidades del producto**. Hallazgo: `producto_precios_mayorista` (tiers) ya existe; falta aplicarlo en el POS. Queda en backlog.
- Typecheck + `vite build` OK. Migrations 159+160 aplicadas en DEV. `schema_full.sql` actualizado (gen_venta_numero + columnas ventas).

---

## [2026-05-31] update | v1.11.6 PROD — ISS-127: GS1 QR Code como 3ª simbología

Pedido GO al cierre. Los perfiles de códigos compuestos ahora soportan **GS1 QR Code** además de GS1-128 y DataMatrix.

- `bwip-js` bcid `gs1qrcode` (confirmado; `gs1-qrcode` con guión NO existe). `CodigoCompuestoModal` y `CodigoMasivoModal`: mapa de bcid por simbología + solo el 1D (GS1-128) lleva height/texto. `CodigoPerfilesPanel`: opción "GS1 QR Code (2D)" en el select + label en la lista. Tipo `simbologia` += `'qr'`. Sin migración (la columna es TEXT libre).
- Typecheck + build OK. Bump v1.11.6. Wiki: `escaneo-barcode.md`, `project_pendientes.md`, `log.md`, `roadmap.md`.

---

## [2026-05-31] update | v1.11.5 PROD — ISS-127 Códigos compuestos GS1 COMPLETO (F3c/d/e)

Cierre de ISS-127. Deploy a PROD como v1.11.5 (mig 157+158 aplicadas en DEV y PROD).

- **F3c — Recepciones**: botón de scanner en el buscador (`handleScanRecepcion`) → `agregarProducto(prod, {nro_lote, fecha_vencimiento, cantidad_recibida})` con datos del GS1.
- **F3d — Rebaje + modo directo**: el scanner compartido ya identifica el producto por GTIN; `pendingRebaje` + effect auto-seleccionan la **línea por lote** y setean cantidad. Modo `directo`: `pendingDirectoIngreso` + `directoFiredRef` + effect auto-crean el LPN cuando el form queda completo (perfil con `lectura_modo='directo'`).
- **F3e — Generación masiva**: `CodigoMasivoModal` — seleccionando varios LPNs en Inventario, botón "Etiquetas GS1" genera la hoja imprimible con todos los códigos (marca los sin GTIN válido).
- Typecheck + `vite build` OK. Bump v1.11.5. Wiki: `escaneo-barcode.md`, `roadmap.md`, `project_pendientes.md`, `log.md`.

---

## [2026-05-30] update | ISS-127 F3 (parcial) — DataMatrix lectura (ZXing) + Ventas/POS + cierre PR Dependabot #129

- **PR Dependabot #129 cerrado**: bump de vite a 8 incompatible con el peer de @vitejs/plugin-react@4 → build rojo, no aplicable. Vulns involucradas son dev-server only (cluster vite/esbuild, diferido). Rama aislada, no afectaba dev/main.
- **F3a — DataMatrix lectura**: `@zxing/library` restringido a DATA_MATRIX como fallback en `BarcodeScanner`. Se carga/ejecuta solo cuando el primario no cubre data_matrix (zbar activo o BarcodeDetector sin soporte), throttle 1/3 frames, vía `HTMLCanvasElementLuminanceSource`. Audit sin vulns nuevas.
- **F3b — Ventas/POS**: `procesarScan` usa `resolverScanCompuesto` → identifica producto por GTIN (fallback codigo_barras) + suma la cantidad del AI 30 en el incremento del carrito.
- **Fixes previos en este bloque**: AI cantidad 37→30, validación de GTIN (gtinCheckDigit/isValidGtin) con sugerencia del dígito correcto, mensajes GS1 accionables, y DataMatrix sin `height:undefined`.
- Typecheck + build OK. Pendiente F3: Recepciones (scanner propio) + Rebaje (lote→LPN) + modo directo + generación masiva.

---

## [2026-05-30] update | ISS-127 fix — AI cantidad (37→30) + validación GTIN + errores claros (QA GO)

Fixes tras prueba de GO al generar un código desde un LPN.

- **AI de cantidad 37→30**: (37) "count of trade items" requiere contexto logístico GS1 (00/02) → bwipp tiraba `GS1missingAIs`. El correcto para "cantidad de unidades" suelto es **(30)**. `buildGS1ElementString` ahora emite siempre (30) para cantidad; `AIS_SOPORTADOS` y defaults pasan a 30. Perfiles existentes en DEV migrados (37→30) + default de la columna `codigo_perfiles.ais` actualizado (mig file + schema_full).
- **Validación de GTIN**: `gs1.ts` += `gtinCheckDigit` + `isValidGtin`. El modal valida el GTIN antes de bwip-js y, si el dígito verificador está mal, **avisa el dígito correcto** (ej: barcode `0378912345689` inválido → "el correcto sería 8"). Antes salía el críptico `GS1badChecksum`.
- **Mensajes accionables**: falta de GTIN en el producto / perfil sin (01) / checksum → mensajes en español que dicen qué corregir, en vez del error de bwipp.
- Typecheck OK. Aún en DEV (F1+F2+fix sin deployar).

---

## [2026-05-30] update | ISS-127 F2 — lectura GS1 en ingreso (individual + masivo) — en DEV

Fase 2 del subsistema GS1: leer un código compuesto en el ingreso de stock y autocompletar. En DEV sin deployar (sigue a F1).

- **`gs1.ts → looksLikeGS1`**: distingue GS1 compuesto de EAN/SKU plano (prefijo simbología / FNC1 / AI 01+14díg+datos). **Crítico** para no parsear un EAN como GS1. Testeado: EAN-13/SKU→plano, GS1 variantes→GS1.
- **`src/lib/scanCompuesto.ts → resolverScanCompuesto`**: parseo + match del producto por GTIN (normalizaciones 14/13/sin-ceros) con fallback a `codigo_barras`; resuelve `lectura_modo` (perfil del proveedor → perfil único → autocompletar). Devuelve null si no es GS1 (caller cae a búsqueda plana).
- **InventarioPage**: `handleBarcodeScan` (ingreso individual) → selecciona producto + autocompleta lote/venc/cantidad. `handleMasivoScan` + `addMasivoRow(prod, overrides)` (masivo) → fila con lote/venc/cantidad pre-cargados.
- **Rebaje NO incluido**: no tiene scanner propio y requiere resolución lote→LPN → movido a F3 junto con modo `directo`.
- Typecheck OK. Wiki: `escaneo-barcode.md`, `project_pendientes.md`, `log.md`.

---

## [2026-05-30] update | ISS-127 F1 COMPLETA — códigos compuestos GS1: lib + Config perfiles + generación desde LPN — en DEV

Subsistema de códigos compuestos GS1 (relevado con GO, diseño en `project_pendientes.md`). **Fase 1 — fundación, completa y con build OK**. En DEV sin deployar.

- **Migrations 157+158** (DEV): `codigo_perfiles` (perfiles GS1/custom: proveedor_id, tipo, simbologia, ais, custom_format, lectura_modo) + `productos.gtin` (fallback a codigo_barras).
- **`src/lib/gs1.ts`**: parser + encoder GS1 testeado (round-trip OK). `parseGS1` (FNC1/GS, strip prefijo simbología, AIs fijos/variables, YYMMDD incl. día 00→último del mes, precio 392x con decimales), `buildGS1ElementString` (paréntesis para bwip-js), `normalizeGtin`, `AIS_SOPORTADOS`. AIs: 01/10/17/11/21/37/30/392x.
- **`bwip-js@4`** (genera GS1-128 + DataMatrix). `npm audit` sigue en 5 moderate.
- **`CodigoPerfilesPanel`** → Config → Inventario → **Códigos**: CRUD de perfiles (nombre, proveedor, tipo, simbología, AIs por chips, modo lectura, activar/desactivar).
- **`CodigoCompuestoModal`** → botón en `LpnAccionesModal` (al lado del QR): genera el código compuesto con los datos reales del LPN (lote/venc/cantidad/serie/precio + GTIN del producto) según el perfil elegido. Descargar/imprimir.
- Typecheck + `vite build` OK. Wiki: `escaneo-barcode.md`, `migraciones.md`, `schema_full.sql`, `project_pendientes.md`, `log.md`.
- **Pendiente F2**: lectura en ingreso/rebaje (autocompletar/directo). **F3**: DataMatrix lectura (ZXing) + ventas/recepciones + masiva.

---

## [2026-05-30] update | v1.11.4 PROD — Reservas: selección manual de LPN persistida (mig 156) + anti-patrón stock_actual confirmado resuelto

Cierre del "anti-patrón de reservas". Hallazgo: el rótulo del wiki estaba desactualizado.

- **(b) `stock_actual` manual en reserva→despacho**: **ya estaba resuelto desde v1.11.0** (`cambiarEstado` no toca `stock_actual`, lo deja al trigger y reconstruye con `stockVendibleSucursal`). Era el que causaba desync; ya no existe. Corregido el wiki.
- **(a) selección manual de LPN no persistía en reservas** (lo que sí quedaba): **mig 156** `venta_items.lpn_plan JSONB`. `registrarVenta` ya honraba el plan al crear la reserva (`consumirLinea` Fase A/B) pero no lo persistía → al despachar la reserva, `cambiarEstado` re-ordenaba por sort e ignoraba el LPN elegido. Ahora: el plan `[{linea_id,lpn,cantidad,manual}]` se guarda en `venta_items`; `cambiarEstado` (reservar + despachar) lo honra (Fase A) + autocompleta por sort si cambió el stock (Fase B), con `origen` manual/auto en el desglose. `cantidad_reservada` cuadra porque reserva y despacho usan las mismas líneas. Sin impacto en cantidades (solo trazabilidad fina). Aditiva: venta directa / series / legacy quedan NULL.
- Typecheck OK. Mig 156 aplicada en DEV + `schema_full.sql`. Wiki: `project_pendientes.md`, `migraciones.md`, `log.md`.

---

## [2026-05-30] update | Seguridad deps (npm audit 13→5) + restyle visual (fondo slate + scrollbars) — deployado en v1.11.4

Deployado a PROD como parte de v1.11.4 (junto con reservas mig 156).

- **npm audit**: de 13 vulnerabilidades a **5** (todas las restantes son dev-server: vite/esbuild/uuid, requieren vite@8 major — diferido). Resueltas las de riesgo real: `jspdf` 2→4 (crítica: ReDoS/XSS/path traversal), `jspdf-autotable` 3→5, `dompurify` (transitiva de jspdf), `xlsx` reemplazado por la distribución oficial de SheetJS (`xlsx-0.20.3` desde CDN, el paquete de npm está abandonado y sin fix). +fixes transitivos seguros (@babel, fast-uri, brace-expansion, ws). **Build de prod OK.** jspdf usa solo APIs estables (`new jsPDF({...})`, `autoTable(doc,{...})`, `internal.pageSize`) → bajo riesgo; verificar visualmente un PDF antes de deploy.
- **Restyle visual** (`index.css`): fondo de pantalla `--ds-page` `#F5F0FF` (lila) → **`#F8FAFC`** (slate frío, look tech). Scrollbars: el light mode usaba el gris default del navegador → ahora **pill flotante fino con tinte violeta de marca** (light+dark+Firefox). Pedido GO de dar un toque más artístico/tecnológico.

---

## [2026-05-30] update | v1.11.3 PROD — cierre Trazabilidad-extendida: devoluciones + recall por producto

Cierre de los pendientes futuros de la Trazabilidad-extendida. **Solo código** (usa columnas de mig 155 ya en PROD). Deployado a PROD (PR #127, release v1.11.3).

- **Devoluciones en `/historial`**: antes la mutación de devolución (`VentasPage`) no llamaba `logActividad` → las devoluciones no aparecían. Ahora cada ítem reintegrado emite una fila `tipo_transaccion='devolucion'`, agrupadas por `transaccion_id` (1 por devolución), con `producto_id` + LPN de la nueva línea (no-serie) → entran al recall de la unidad. Render legible (`describir` campo `devolución` → "Devolvió N u de Venta #X").
- **Clasificación de estados**: la transición `cambiarEstado` (reserva→despacho, venta→devuelta) ahora tag `tipo_transaccion` (`venta`/`devolucion`) + `sucursal_id`.
- **Recall por producto**: `HistorialPage` suma input "Producto (nombre o SKU)" al panel "Trazá una unidad". Resuelve nombre/SKU → `producto_id` y cruza tanto los snapshots `producto_id` del ledger (`.or(producto_id.in.(...),entidad_nombre.ilike)`) como `venta_item_despachos.producto_id`. Incluido en el export.
- Typecheck `tsc --noEmit` OK. Wiki: `reportes-metricas.md`, `project_pendientes.md`, `roadmap.md`, `log.md`. Bump `APP_VERSION` v1.11.3.

---

## [2026-05-30] update | v1.11.2 PROD — Trazabilidad-extendida /historial grado WMS (mig 155) + aislamiento sucursal

Pedido GO: que `/historial` sea el hub único de trazabilidad para recall/auditoría, "igual o mejor que un WMS como Manhattan / Blue Yonder". Decisión de diseño consensuada: **ledger inmutable con `transaccion_id` write-time**, NO heurística read-time (frágil/no auditable). **Deployado a PROD como v1.11.2** (mig 155 aplicada en DEV y PROD; release junta también el aislamiento por sucursal v1.11.2-candidato: guard setSucursal + rótulo stock global).

- **Mig 155** (`155_actividad_log_ledger.sql`, aditiva): `actividad_log` += `transaccion_id`, `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id` (todas nullables/snapshot). Sin backfill: filas legacy quedan con `transaccion_id` NULL = evento único. Índices por transacción + unidad (producto/lpn/serie). Aplicada en DEV + `schema_full.sql`.
- **logActividad** (`actividadLog.ts`): nuevos campos opcionales + helper `nuevaTransaccion()` (`crypto.randomUUID()`). Tipo `TipoTransaccion`.
- **Call-sites**: `LpnAccionesModal` edición de LPN ahora genera **1 `transaccion_id`** para todas las filas (antes hasta 7 sueltas) + clasifica `tipo_transaccion` y snapshots (lpn/serie/lote) en traslado/eliminación/serie. `InventarioPage` ingreso/rebaje y `VentasPage` creación de venta también clasifican tipo + snapshots.
- **HistorialPage (3 fases)**: (1) **consolida** filas por `transaccion_id` en 1 tarjeta ("Editó LPN X — N cambios") con detalle campo por campo en el modal (cabecera+detalle); (2) **filtro recall** "Trazá una unidad" por LPN/serie que cruza `actividad_log` + `venta_item_despachos` y muestra la historia completa sin paginar; (3) **export** del set filtrado completo (hasta 10k filas) con columnas del ledger. Nuevo filtro "Transacción" (tipo WMS).
- Typecheck `tsc --noEmit` OK. Wiki: `reportes-metricas.md`, `migraciones.md`, `project_pendientes.md`, `index.md`, `log.md`.
- **Pendiente futuro**: `transaccion_id` en devoluciones y reserva→despacho; filtro de unidad por `producto_id` además de LPN/serie.

---

## [2026-05-30] update | Aislamiento por sucursal + stock display Agregar Stock (en DEV, v1.11.2-candidato)

Cierre de sesión. Cambios en DEV **sin deployar a PROD** (esperan validación de GO → v1.11.2).

- **Display Agregar Stock/Rebaje**: en vista global "Todas" el form mostraba "Stock total" (global) sin aclarar; ahora rotula **"Stock total (todas las sucursales)"**. Con sucursal activa o destino elegido ya mostraba "Stock en sucursal". No es bug — es la vista global.
- **Aislamiento por sucursal (pedido GO)**: un usuario sin `puedeVerTodas` (CAJERO, roles no habilitados) no debe poder ver/operar otra sucursal. **Triple blindaje cliente**: (1) fijado a su sucursal al cargar (`effectiveSucursalId`), (2) selector de header oculto, (3) **nuevo guard en `setSucursal`** (`if (!get().puedeVerTodas) return`). Documentado en `multi-sucursal.md` → "Aislamiento por sucursal — enforcement".
- **Limitación marcada**: la RLS es por `tenant_id`, no por `sucursal_id` → el aislamiento real (a prueba de API directa) requiere **RLS por sucursal**. Agregado a `project_pendientes.md` (Deuda técnica) como pendiente grande.
- Commits en dev: rótulo stock (`9b18734a`), guard setSucursal (`71bec577`). Pendiente bump v1.11.2 + merge a main cuando GO valide.

---

## [2026-05-30] update | v1.11.1 PROD — patch ISS-075 (manual/auto + stock vendible + Inventario→Historial)

Patch correctivo tras QA de GO sobre v1.11.0. Sin migrations nuevas.

- **manual/auto correcto**: `CartItem.lpn_manual_ids` rastrea los LPN que el operador eligió en el picker; en el rebaje solo esos son `origen='manual'`, el resto del plan autocompletado es `auto`. Antes todo salía `manual`.
- **Stock del movimiento de venta = vendible por sucursal**: `stock_antes/despues` ahora usa `stockVendibleSucursal()` (estados `es_disponible_venta` + ubicación pickeable en la sucursal de la venta), no el total global del producto. Aplica en Fase 3 y en reserva→despacho (B1).
- **Bug de archivo equivocado**: el modal de "Inventario → Historial" lo dibuja `InventarioPage.tsx`, NO `MovimientosPage.tsx` (huérfana, `/movimientos`→`/inventario`). Se **eliminó** MovimientosPage (1221 líneas) y se agregó el desglose por LPN ("Surtido desde") al modal real. Regla [[feedback_mapear_mod_tab_a_ruta]].
- **Log de ingreso/rebaje manual**: portado a InventarioPage. Ingreso → `ingreso_stock` (destino: ubicación+LPN), rebaje → `rebaje_stock` (origen: ubicación+LPN), con cantidad+unidad.
- **Versión** `v1.11.1`. Migrations 153+154 ya estaban en PROD desde v1.11.0.

---

## [2026-05-30] update | v1.11.0 PROD — ISS-075 trazabilidad + ISS-151 CC + fix race rebaje + log de asignación

Release grande. Cierre de toda la sesión 075/151 + bugs encontrados en QA → PROD.

- **Feature log de asignación (mig 154)**: `venta_item_despachos.origen` (`manual`/`auto`) + `tenants.trazabilidad_asignacion` (toggle en Config → Inventario, default ON). El desglose ahora indica si cada LPN lo eligió el operador o la regla de rebaje.
- **Trazabilidad en /historial**: el detalle de una venta en HistorialPage trae `venta_items` + `venta_item_despachos` y muestra, por ítem, de qué LPN/ubicación/serie salió cada unidad (con `origen`). También en VentasPage (detalle) y MovimientosPage (detalle de movimiento de venta).
- **Fix race condition (crítico)**: `registrarVenta` procesaba las líneas del carrito en `Promise.all`. Con el mismo producto en 2 líneas, el rebaje se pisaba (race). Ahora **secuencial**. Además Fase 3 (y el B1 de reserva→despacho) **ya no actualizan `stock_actual` a mano** — lo hace el trigger `lineas/series_recalcular_stock` (`stock_actual = SUM líneas activas`). El update manual peleaba con el trigger y desincronizaba/doble-restaba.
- **Recalc global** de `stock_actual` corrido en DEV (113 productos, 0 desfasados) y en PROD post-deploy.
- **Versión** `v1.11.0` (feature). Migrations 153+154 aplicadas en PROD antes del merge ([[feedback_deploy_order_migrations_aditivas]]).
- Pendiente futuro: Trazabilidad-extendida (consolidar todas las transacciones en /historial) — ver `project_pendientes.md`.

---

## [2026-05-29] update | ISS-075 despacho por LPN (mig 153) + ISS-151 impl + fix BUG-LPN manual — todo en DEV

**ISS-075 — implementado en DEV** (mig 153 aplicada en DEV, pendiente PROD):

- **Migration 153** `153_venta_item_despachos.sql`: nueva tabla con desglose de despacho por LPN/ubicación de cada `venta_item` (fila por porción/línea o por serie). Snapshots de texto (`lpn`/`ubicacion_nombre`/`nro_serie`) intactos ante edición/borrado del LPN. RLS por tenant. Aplicada en DEV + `schema_full.sql`.
- **VentasPage `registrarVenta` (Fase 2)** + **transición reserva→despacho (`cambiarEstado`)**: acumulan y persisten `despachoRows` (fire-and-forget) con el detalle real de qué LPN/ubicación se consumió. Selects enriquecidos con `lpn`, `ubicacion_id`, `ubicaciones(nombre)`.
- **Modal detalle de venta**: query `venta-despachos` + render del desglose por ítem (`Nu · LPN · Ubicación` / `#serie · Ubicación`). Fallback al LPN único para ventas previas a la mig.
- **MovimientosPage**: ingreso/rebaje manual ahora se vuelcan al `actividad_log` con acciones nuevas `ingreso_stock`/`rebaje_stock` (origen/destino + ubicación + LPN). Renderizadas en HistorialPage (`ACCION_LABELS` + `describir()`).
- **LpnAccionesModal traslado**: diff enriquecido con ubicación de **origen** (antes solo LPN).
- **`actividadLog.ts`**: `AccionLog` += `ingreso_stock | rebaje_stock`.
- Corregido gotcha desactualizado en CLAUDE.md (`venta_items.linea_id` sí se escribe; desglose en `venta_item_despachos`).
- Typecheck `tsc --noEmit` OK. Wiki: `ventas-pos.md`, `reportes-metricas.md`, `migraciones.md`, `project_pendientes.md`, `index.md`.

**ISS-151 — implementado en DEV** (sin migración):
- `MixCajaChart` + `MetricasPage`: excluyen pseudo-métodos `Cuenta Corriente`, `Cancelación CC`, `Condonación CC` del mix de medios de pago (ya no distorsionan la ganancia). El cobro real de una CC (abono) agrega su método real y ése sí aparece.
- `ClientesPage`: el botón único "Cancelar deuda" se reemplaza por **Condonar** (write-off, tag `Condonación CC`, monto_pagado=total) y **Revertir** (deshace condonación, restaura monto_pagado a pagos reales). Ambos solo DUEÑO/SUPERVISOR/ADMIN. Las condonadas quedan visibles en la lista CC con badge + botón Revertir. Ninguna acción toca estado de entrega ni stock (P4).
- Helper `esCondonadaCC()` + constante `TAGS_CONDONACION_CC` (incluye el legacy `Cancelación CC`).

**BUG-LPN — corregido en DEV**: la selección manual de LPN en el carrito se ignoraba en el rebaje real (Fase 2 re-ordenaba por sort). Fix: rebaje en 2 fases (A: honra `lpn_fuentes` con cantidades exactas; B: fallback por sort). Limitación: reserva→despacho aún rebaja por sort (no persiste selección manual). Detalle en `project_pendientes.md` → BUG-LPN.

**Config**: tenant DEV "Almacén Jorgito" tenía `cliente_obligatorio='siempre'` (bloqueaba venta directa sin cliente) → cambiado a `'nunca'`. Es config por tenant (ISS-142), no un bug de código.

Estado: **todo en DEV, sin deployar a PROD** (el usuario valida primero). Pendiente para PROD: bump versión (v1.11.0 — feature), aplicar mig 153 en PROD, merge `dev → main`, release ([[feedback_deploy_order_migrations_aditivas]]).

---

## [2026-05-29] update | v1.10.4 PROD — ISS-178 + C3/A7 → PROD

Cierre del tren acumulado en DEV (2 commits desde v1.10.3). Sin breaking change.

- **Migration 152 aplicada en PROD** pre-merge (validado: las 3 columnas no existían). Regla `feedback_deploy_order_migrations_aditivas`.
- **Bump APP_VERSION** a `v1.10.4` en `src/config/brand.ts`.
- **Merge `dev → main`** + release `v1.10.4` `--latest` en GitHub.
- Contenido: ISS-178 (rangos horarios de entrega — Config + VentasPage + EnviosPage), C3 parcial (CAJERO bloqueado para descuentos en POS), A7 (radio destino stock en modal devolución).

---

## [2026-05-29] update | Lote 6 — C3 + A7 del relevamiento Ventas

Dos puntos cerrados del relevamiento Ventas A-D (ver `G360.Wiki/sources/raw/relevamiento_ventas_respuestas.md`). Sin schema change, sin migration.

**C3 (parcial) — CAJERO bloqueado para descuentos** (`src/pages/VentasPage.tsx`)
- Nueva constante `descuentoBloqueadoCajero = user?.rol === 'CAJERO'`.
- 4 controles del POS quedan `disabled` con tooltip "Pedile al SUPERVISOR/DUEÑO": input descuento por ítem + toggle %/$ por ítem + input descuento general + toggle %/$ global.
- Labels muestran "— bloqueado para CAJERO" / "Bloqueado" y el contenedor se atenúa con `opacity-60`.
- Lo más complejo de C3 queda pendiente como feature mayor (descuentos automáticos por medio de pago + umbral por monto para SUPERVISOR).

**A7 — Destino del stock en devolución** (`src/pages/VentasPage.tsx`)
- Nuevo estado `devDestinoStock: 'dev' | 'vendible'` (default `'dev'`). Reset al abrir el modal.
- Radio en el modal de devolución debajo del campo Motivo con 2 opciones: "Dejar en DEV para revisión" (default — flujo previo, va a `ubicDevId`/`estadoDevId`) y "Reintegrar a stock vendible" (`ubicacion_id: null` + `estado_id = primer estados_inventario.es_disponible_venta`, aparece en alerta "Inventario sin ubicación").
- Solo afecta a items no serializados; los serializados siempre reactivan a su línea original.
- Validación: si elige "vendible" pero no hay estado `es_disponible_venta = true` configurado, toast de error sugiriendo cargarlo o elegir "Dejar en DEV".

Wiki: `ventas-pos.md` (sección C3 dentro de Descuentos), `devoluciones.md` (sección A7 nueva en Flujo de devolución), `project_pendientes.md` (Lote 6 en historial), `index.md`.

---

## [2026-05-29] update | ISS-178 — rangos horarios de entrega configurables (mig 152)

Feature acotada, sin dependencias externas. Habilita que el operador elija un rango horario predefinido (8-13 / 13-18 / 18-22) en lugar de tipear una hora exacta — más alineado con el flujo real de coordinación con clientes.

- **Migration 152** (`152_envios_rangos_horarios.sql`): `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos + `envios.rango_horario_desde/hasta TIME` (snapshot). Aplicada en DEV.
- **ConfigPage tab Envíos**: nueva card "Rangos horarios para entrega" con CRUD inline (agregar, editar via inputs `<input type="time">`, eliminar). Defaults visibles inmediatamente.
- **VentasPage modal de envío**: selector "Rango horario" al lado del campo "Fecha de entrega acordada". Reset post-venta.
- **EnviosPage**: form de edición agrega selector "Rango horario" junto a "Hora acordada" (coexisten). Tabla muestra el rango como badge accent debajo de la fecha. Reconstrucción del `idx` matcheando `desde+hasta` contra la config actual del tenant.
- Wiki: `envios.md` sección nueva en Configuración, `migraciones.md` entrada 152, `project_pendientes.md` (ISS-178 removido de features grandes, agregado a Lote 5), `index.md`.

Pendiente PROD: aplicar mig 152 antes del merge `dev → main` ([[feedback_deploy_order_migrations_aditivas]]).

---

## [2026-05-29] update | v1.10.3 PROD — ISS-194 caja fuerte + RRHH-A5 + 3 bugs UX → PROD

Cierre del tren acumulado en DEV (3 commits desde v1.10.2). Sin breaking change.

- **Migration 151 aplicada en PROD** pre-merge (UNIQUE parcial `empleados(tenant_id, user_id)`). Validado sin duplicados antes (regla `feedback_deploy_order_migrations_aditivas`).
- **Bump APP_VERSION** a `v1.10.3` en `src/config/brand.ts`.
- **Merge `dev → main`** + release `v1.10.3` `--latest` en GitHub.
- Contenido: ISS-194 (caja fuerte default solo DUEÑO + toggles), RRHH-A5 (selector usuario en form empleado), ISS-080 (alertas filtra por sucursal), ISS-108 (selector sucursal mobile), ISS-148 (UbicacionPicker en Recursos).

---

## [2026-05-28] update | lote 3 bugs UX — ISS-080, ISS-108, ISS-148

Lote de 3 bugs/mejoras de baja complejidad enfocadas en multi-sucursal y UX. Sin schema change.

- **ISS-080** (`src/pages/AlertasPage.tsx`): AlertasPage ahora filtra por sucursal activa **todas** las secciones. Las queries con `sucursal_id` ya filtraban (reservas viejas, OCs, LPN, inventario). Las 2 que no tenían columna (`alertas` y `productos sin categoría`) ahora cruzan client-side: para stock mínimo se suma `inventario_lineas.cantidad` del producto en la sucursal (JOIN a `ubicaciones.sucursal_id`) y se compara con `producto_stock_minimo_sucursal` o el global. Para sin categoría, se muestran solo los que tienen al menos una `inventario_lineas` activa en la sucursal.
- **ISS-108** (`src/components/layout/AppLayout.tsx`): Header mobile (< 640px). Bloque nuevo `sm:hidden` con ícono `Building2` + nombre de sucursal truncado. Si `puedeVerTodas`, `<select>` transparente superpuesto que permite cambiar con un tap. Antes el bloque era `hidden sm:flex` y desaparecía por completo en celular.
- **ISS-148** (`src/pages/RecursosPage.tsx`): Nuevo componente interno `UbicacionPicker` reemplaza al `<input>` libre en los 3 puntos donde se elegía ubicación: form crear/editar recurso, modal "Asignar ubicación" del tab Ubicaciones, edit inline. Opciones derivadas del histórico (`recursos.ubicacion` distinct, filtrado por sucursal vía `applyFilter`) + opción especial "+ Nueva ubicación..." para typing puntual. Sin schema change ni tabla catálogo.

Wiki: `alertas.md` (sección ISS-080 reemplaza la nota anterior), `recursos.md` (sección ISS-148 en Ubicaciones), `multi-sucursal.md` (selector mobile actualizado), `project_pendientes.md` (los 3 marcados como Resueltos, nuevo Lote 4 en historial).

---

## [2026-05-28] update | RRHH-A5 — vinculación empleado ↔ usuario del sistema (UI + migration 151)

Pendiente histórico de RRHH cerrado. Habilita "Mi Equipo" del SUPERVISOR sin scripts SQL manuales.

- **Migration 151** (`151_empleados_user_id_unique.sql`): índice UNIQUE parcial `empleados(tenant_id, user_id) WHERE user_id IS NOT NULL`. Aplicado en DEV. Garantiza el invariante que asume `get_supervisor_team_ids()` (1 user ↔ 1 empleado por tenant).
- **`src/pages/RrhhPage.tsx`**:
  - Nueva query `tenantUsers` (id, nombre_display, email, rol) por tenant, enabled solo en tabs empleados/equipo.
  - Selector "Usuario del sistema (opcional)" en el form de empleado, después de supervisor. Listado ordenado por nombre, deshabilita los users ya tomados por otro empleado mostrando "ya vinculado a …".
  - Validación cliente en `handleGuardarEmpleado`: rechaza guardar si el `user_id` elegido pertenece a otro empleado.
  - Columna nueva **Usuario** en la tabla de empleados con badge `UserCheck + nombre_display`.
- **schema_full.sql**: índice 151 documentado y FK `empleados.supervisor_id` corregido de `users(id)` → `empleados(id)` (estaba desactualizado desde migration 147).
- **Wiki**: `features/rrhh.md` sección nueva "Vinculación empleado ↔ usuario del sistema (RRHH-A5)". Pendiente removido de `project_pendientes.md`. Index sin cambios estructurales.

Pendiente PROD: aplicar migration 151 antes del merge `dev → main` (regla `feedback_deploy_order_migrations_aditivas`).

---

## [2026-05-28] update | mantenimiento: trim CLAUDE.md + convención GRANT Supabase oct-2026

- **CLAUDE.md trimado**: eliminadas secciones informativas ya cubiertas en el wiki (Stack, Estructura, Planes, Env vars, Deploy, Dominios, Multi-tenant). Reducción ~1.7k tokens/sesión. Se conservaron solo reglas de comportamiento, gotchas de código y IDs de Supabase.
- **wiki/development/convenciones-codigo.md**: nueva sección "GRANT obligatorio en tablas nuevas" — a partir del 30 oct 2026 Supabase deja de auto-exponer tablas del schema `public`; toda migration con `CREATE TABLE` debe incluir `GRANT ... TO authenticated`.
- **wiki/database/migraciones.md**: warning insertado en "Reglas de trabajo con migraciones" con el SQL de GRANT y la fecha límite.

---

## [2026-05-28] update | ISS-194 — caja fuerte: solo DUEÑO por defecto (dev, pendiente PROD)

- `caja_fuerte_roles` default cambia de `['DUEÑO','SUPERVISOR','SUPER_USUARIO']` a `['DUEÑO']`.
- SUPERVISOR y SUPER_USUARIO aparecen ahora en la lista de toggles habilitables (junto a CAJERO/CONTADOR/DEPOSITO/RRHH). ADMIN no tiene acceso.
- Tenants existentes con el valor viejo guardado en DB conservan su configuración actual; deben desactivar manualmente desde Config → Caja.
- Commit `62997596` en dev. Pendiente deploy a PROD (sin migration, solo cambio de código).

---

## [2026-05-28] update | v1.10.2 — bugfixes ISS-152/173 + caja sin PDF automático → PROD

- **ISS-152**: `sesionesAbiertas` en GastosPage ahora incluye `sucursalId` en queryKey y filtra client-side. `cajasAbiertasOC` corrige filtro estricto. El "nuevo gasto" ya no muestra cajas de otras sucursales.
- **ISS-173**: `monto_pagado` al crear reserva con pago parcial usa suma real de medios no-CC. Corrige "Ya cobrado" cuando se cobró seña parcial.
- **Caja**: eliminada descarga automática de PDF al cerrar sesión. Disponible manual desde historial.
- Deploy: migrations 148-150 aplicadas en PROD, PR `dev→main`, release v1.10.2 como `--latest`.

---

## [2026-05-28] update | lote ISS-135/142/180/190 + migrations 148-150 (dev)

4 issues resueltos en 2 commits sobre `dev`, con 3 migrations aplicadas en DEV.

- **ISS-135**: `metodos_pago` ahora tienen `habilitado_ventas` + `habilitado_gastos` (migration 149). ConfigPage muestra toggles "POS" y "Gastos" por método. VentasPage y GastosPage filtran según el flag.
- **ISS-142**: `cliente_obligatorio` / `cliente_creacion_inline` / `cliente_datos_minimos` del tenant conectados al POS en VentasPage — ya no hardcodeados.
- **ISS-180**: `predefinida` en `unidades_medida` (migration 148). 6 unidades predefinidas seed-eadas por tenant. ConfigPage bloquea edición/borrado y valida duplicados antes de insertar.
- **ISS-190**: `monto_pagado` + `estado_pago` en `gastos` (migration 150). Badges "Sin pagar"/"Pago parcial" en tabla y mobile. Modal para registrar pago parcial con movimiento en caja.

Commits: `07d306c5` (ISS-135/142/180) · `9ba1e3f9` (ISS-190)

---

## [2026-05-28] update | lote ISS-140/141/149/152/172/173/177/179/181 — 8 bugfixes (dev)

8 issues resueltos en un solo commit sobre `dev` (`f96fd4d1`), sin deploy a PROD.

- **ISS-140/141**: Scrollbar oculto en sub-tabs Config (Ventas e Inventario) — `[scrollbar-width:none]`
- **ISS-149**: Descuento OC acepta `$` o `%` con toggle en GastosPage
- **ISS-152**: `cajasAbiertasOC` filtra por sucursal activa (client-side filter sobre join)
- **ISS-172**: Haversine km redondeado a entero para consistencia con Distance Matrix
- **ISS-173**: Label reserva: "Ya cobrado" → "Seña cobrada" cuando saldo > 0.5
- **ISS-177**: Campo $/km en VentasPage cambiado a solo lectura (div en lugar de input)
- **ISS-179**: Formulario crear Ubicación incluye todos los campos: sucursal, mono-SKU, dims WMS
- **ISS-181**: Reglas comprobante mutuamente excluyentes (radio) + texto descriptivo mejorado
- **ISS-194**: Confirmado ya implementado (toggle SUPERVISOR boveda en Config → Caja)

Pendientes del backlog: ISS-127, ISS-135, ISS-137, ISS-142, ISS-174, ISS-178, ISS-180, ISS-190 + 5 relevamientos.

---

## [2026-05-28] update | PROD deploy v1.10.1 — Cierre HITO v1.9.0 + quick wins Envíos + 10 bugfixes

Cierre del lote v1.10.1 con despliegue completo a PROD.

### Deploy
- **Migrations 143-147 aplicadas en PROD** pre-merge (regla `feedback_deploy_order_migrations_aditivas`):
  - 143: cron limpieza `envios.token_transportista` +30d
  - 144: tabla `envio_pod_fotos` + RLS + backfill (POD múltiples fotos)
  - 145: fix `pagar_nomina_empleado` (saldo con traspasos)
  - 146: `caja_traspasos.movimiento_origen_id` + `movimiento_destino_id`
  - 147: `empleados.supervisor_id` → FK a `empleados(id)` + `get_supervisor_team_ids()` reescrita
- **Merge `dev → main` resuelto** localmente (conflictos en wiki/brand/CajaPage por squash distinto del previo): `git checkout --ours` en cada caso porque dev ya tenía todos los cambios de main + lo nuevo de v1.10.1. Merge commit `98ca4427` en dev.
- **PR #119 mergeado a main** (squash, commit `842d7353`)
- **Vercel PROD auto-deploy** desde commit del merge — `dpl_BxMq3Zu9iKEoNjLBEus76jk5xfX5`
- **GitHub release v1.10.1** creada como `latest` sobre main → https://github.com/genesis360-app/genesis360/releases/tag/v1.10.1
- `app.genesis360.pro` sirve v1.10.1 una vez termine el build (~90s)

### Score final del lote v1.10.1
- Features cierre HITO v1.9.0: candado por fila + PDF cierre con snapshot ✅
- Quick wins Envíos: cron tokens + múltiples fotos POD ✅
- Bugfixes: 10 (ISS-182/183/184/195/150/186/193/156/175/176/185) ✅
- Resiliencia: ErrorBoundary instrumentado a Sentry + boundary por-ruta ✅
- Relevamientos abiertos: 5 HTMLs (Ventas/RRHH/Clientes/Compras/Envíos)

### Pendientes para próxima sesión
- Vincular `empleados.user_id` (UI) para reactivar "Mi Equipo" del SUPERVISOR — relevamiento RRHH A5
- Crash intermitente "Algo salió mal" en Gastos: esperando stack real del ErrorBoundary instrumentado
- Avanzar con U1-U9 / F1-F7 / M1-M5 (bugfixes UX + features chicas + medianas) cuando GO retome
- Responder los 5 relevamientos abiertos con socio

---

## [2026-05-27] update | v1.10.1-dev — Tanda de bugfixes (10 issues) + resiliencia ErrorBoundary

Continuación de la sesión v1.10.1. Mientras los relevamientos esperan respuesta, se atacó la lista de bugs críticos priorizada con GO. Todo en DEV, parte del lote v1.10.1 (no deployado).

### Bugfixes
- **ISS-182/183 (Gastos)**: `guardar()` y `confirmarGenerarFijo()` ahora validan comprobante obligatorio (según las 4 reglas del tenant) y que los medios de pago cubran exactamente el total con tipo definido. Antes dejaba crear gastos sin comprobante y con medios sin definir.
- **ISS-184 (RRHH)**: la mutation de empleados usa `.select()` con joins + optimistic update via `setQueryData` → el empleado aparece al instante (antes "No hay empleados" hasta F5).
- **ISS-195 (Gastos/Cierre)**: el panel de cierres no listaba nada porque el select pedía `users.email` (columna inexistente; el email vive en auth.users). Removido de `CierresContablesPanel`.
- **ISS-150 (Recepción)**: al recibir una OC ya pagada, el precio costo se muestra como label "OC pagada (no editable)" en vez de input.
- **ISS-186 (RRHH/Caja)** · migration 145: `pagar_nomina_empleado` calculaba saldo sin contar `ingreso_traspaso`/`egreso_traspaso`. La bóveda (que recibe por traspaso) daba "saldo insuficiente". Alineado con la lógica del frontend.
- **ISS-193 (Caja)** · migration 146: `caja_traspasos` ahora guarda `movimiento_origen_id`/`movimiento_destino_id`. Al corregir un traspaso recibido, se inserta el ajuste de la diferencia en la caja origen (si está abierta; si no, error claro). Traspasos viejos sin FK no se propagan.
- **ISS-156/175/176 (Envíos)**: el envío cuyo costo cobró el cliente en la venta nace `costo_pagado=true` (propio siempre; tercero si la venta se despachó). Tab Pagos Courier excluye `Envío propio`. `/transporte` valida pago: banner rojo + botones de avance deshabilitados si el costo está pendiente (`get_envio_by_token` ya exponía `costo_cotizado`/`costo_pagado`).
- **ISS-185 (RRHH)** · migration 147: `empleados.supervisor_id` re-apuntado de `users(id)` a `empleados(id)`. El organigrama se arma con empleados de RRHH. `get_supervisor_team_ids()` reescrita para mapear `auth.uid()` → `empleados.user_id` → `supervisor_id`. Selector de supervisor lista empleados (excluye al editado). Los 8 supervisor_id viejos (a users) se nulearon. **Mi Equipo del SUPERVISOR queda vacío hasta vincular `empleados.user_id`** (pendiente UI — relevamiento A5).

### Resiliencia (Heisenbug "Algo salió mal" reportado por GO)
- ErrorBoundary: antes solo `console.error`. Ahora reporta a **Sentry** (con componentStack) + muestra el mensaje del error + Sentry ID + botón "Copiar detalle". Esto permite diagnosticar los crashes intermitentes que GO reportó en Config→Estados/Grupos y Gastos.
- **Boundary por-ruta** en AppLayout (`<ErrorBoundary inline key={pathname}>` alrededor del `<Outlet />`): un crash de página ya no tumba toda la app — el menú sobrevive y al navegar se resetea.
- `GruposEstadosPage`: blindado `grupo_estado_items ?? []` (causa probable del crash en esa pantalla).
- **Pendiente diagnóstico**: el crash en Gastos no se identificó a ojo — necesita el stack real que el boundary ahora captura.

### Estado al cierre
- DEV: v1.10.1 con migrations 130-147
- PROD: v1.10.0 (143-147 pendientes)
- Lote v1.10.1 listo para PR `dev→main` cuando GO decida deployar

---

## [2026-05-27] update | v1.10.1-dev — Cierre HITO v1.9.0 + quick wins Envíos

Sesión paralela al relevamiento de Ventas/RRHH/Clientes/Compras/Envíos (HTMLs generados ayer, pendientes de respuesta). Se cerraron los últimos pendientes del HITO Cierre Contable v1.9.0 + 2 quick wins del backlog de Envíos.

### Cambios
- **VentasPage**: badge ámbar 🔒 "Cerrado" en cada fila del historial cuando la venta cae en periodo contable cerrado. Botón "Eliminar venta" en el modal de detalle reemplazado por banner amber "Periodo cerrado hasta YYYY-MM-DD — no editable" para evitar errores del trigger DB.
- **CajaPage**: badge 🔒 "Cerrado" junto al nombre de cada sesión cerrada del historial. Botón "Corregir movimiento" reemplazado por candado deshabilitado en movimientos de periodos cerrados.
- **CierresContablesPanel**: nuevo botón "Descargar PDF" en el bloque expandido de cada cierre. Genera A4 con header BRAND + datos fiscales del tenant + periodo + observaciones + tabla snapshot (Ventas/Gastos/Sueldos/OC con counts) + bloque resumen (Egresos totales + Resultado neto). Lee de `cierres_contables.totales JSONB` (no recalcula). `logActividad('cierre_contable','descargar_pdf',…)`
- **Cron limpieza tokens transportista** (migration 143): pg_cron `cleanup_envio_tokens_transportista` corre diario 07:00 UTC. Para envíos en `entregado`/`cancelado`/`devolucion` con +30 días, setea `token_transportista = NULL` para invalidar links públicos. Activo en DEV.
- **Múltiples fotos POD** (migration 144): tabla `envio_pod_fotos` con RLS por tenant + backfill automático desde `envios.pod_url`. Componente `PodFotosManager` con upload múltiple desde cámara/galería (`multiple` + `capture="environment"`), thumbnails con badge "Principal" en orden 0, botón eliminar con confirm + cleanup del storage path. Integrado en modal POD y modal de edición de envío (solo si `editId` existe). La primera foto sincroniza con `envios.pod_url` para retro-compat. Helper `handleFotoCapture` viejo de ISS-166 eliminado del archivo.

### Estado al cierre
- DEV: **v1.10.1** con migrations 130-144 aplicadas
- PROD: v1.10.0 (143-144 pendientes de deploy)
- Cierre HITO v1.9.0: 100% completo en DEV
- Relevamientos abiertos esperando respuesta del usuario (5 HTMLs)

### Pendiente próxima sesión
- PR `dev → main` con título `v1.10.1 — Cierre HITO + quick wins Envíos`
- Aplicar migrations 143 + 144 en PROD antes del merge (aditivas)
- GitHub release v1.10.1 como latest

---

## [2026-05-26] update | PROD deploy v1.10.0 — Pipeline Reglas Caja CERRADO

Cierre del pipeline completo de Caja con 6 versiones consecutivas (v1.9.1 → v1.10.0) en 2 días.

### Deploy
- **Migrations 136–142 aplicadas en PROD** (7 migrations aditivas idempotentes)
  - 136: cajas.moneda + cuentas_origen + cuenta_origen_id en metodos_pago/caja_movimientos + vw_boveda_cuentas + seed
  - 137: boveda_retiros + RLS solo DUEÑO/ADMIN/SUPER_USUARIO + backfill cuenta_origen_id
  - 138: auto-seed cuentas_origen por método no-efectivo
  - 139: backfill fuzzy con normalización (sin tildes/sin "de")
  - 140: caja_sesiones.abierta_por + tenants.config_caja JSONB + RPCs requiere_clave_maestra y verificar_clave_maestra
  - 141: caja_sesiones.numero correlativo + snapshot_totales + tenants.diferencia_caja_* + vw_diferencias_por_cajero
  - 142: vw_caja_resumen_diario + vw_caja_mensual_por_sucursal
- **PR #118 mergeado** en main (squash, commit `c857384b`)
- **Vercel PROD** auto-deploy en estado BUILDING (`dpl_SKeSdLV75LfW2u2cnMWuMq5vLBLe` desde commit del merge)
- **GitHub release v1.10.0** actualizada como **latest** apuntando a main
- `app.genesis360.pro` servirá v1.10.0 una vez termine el build (~90s)

### Score final del pipeline Caja
**8 de 8 decisiones críticas implementadas (100%)** ✅

Recorrido completo:
- v1.9.1 Tanda 1 (F1/H1/G2/D3): cajas por moneda + Cuentas de Origen + sin egreso manual + arqueo pre-cierre
- v1.9.2 Tanda 1.5 (E4/E5): bóveda como billetera + extraer dinero solo DUEÑO + historial privado
- v1.9.3 Fase 2.0 (J1/J3/B5/B6/A2/A4/C2): permisos + CONTADOR read-only + abrir a nombre de cajero + clave maestra + mail al cierre
- v1.9.4 Fase 2.1 (C1/C3/K2/K3/B1-B4): ticket cierre A4/térmico + numeración correlativa + snapshot + umbral diferencia + alertas configurables
- v1.9.5 Fase 2.2a (L1/L4/L5/B7/G1): selector caja devolución + bloqueo sucursal + cadena anulación + corregir movs + doble validación cierre
- v1.10.0 HITO Fase 2.4 (I1/I2): 4 reportes (diario/consolidado/mensual/por cajero) + 3 exports (Excel/PDF/CSV)

### Estado al cierre
- DEV: v1.10.0 con migrations 130-142
- PROD: v1.10.0 con migrations 130-142 ✅ (en deploy)
- **Pipeline Reglas Caja: CERRADO** (todas las decisiones priorizadas del relevamiento implementadas)
- Pendientes opcionales no críticos: Fase 2.2b (L3 préstamos RRHH), Fase 2.3 (M2/M3/M4 + E1/E3 + G5)

### Fixes adicionales en la sesión
- ConfigPage tab Facturación: toggle auto-guarda + botón datos fiscales + `setTenant(data)` para sincronizar store
- VentasPage: caja predeterminada se pre-selecciona automáticamente (useMemo en lugar de useEffect con race)
- VentasPage: medios de pago dinámicos desde tabla `metodos_pago` (eliminada constante hardcodeada con "Otro" genérico)
- Bóveda: backfill fuzzy de cuenta_origen_id + helper `cuentaOrigenDeMetodo` tolerante (lowercase + sin tildes + sin "de")

---

## [2026-05-26] update | v1.10.0-dev — HITO Caja Fase 2.4 — Reportes (I1/I2)

Cierre del pipeline de Reportes con 4 vistas + 3 exports (Excel/PDF/CSV).
**Versión mayor v1.10.0** marca el módulo Caja como completo en su pipeline de relevamiento (todas las features de A a M implementadas según las decisiones priorizadas del relevamiento).

### Migration 142 aplicada en DEV
- Vista `vw_caja_resumen_diario` — agregado por día/caja/sucursal · cierres count + cerrados + total apertura/ingresos/egresos/ventas + saldo_sistema + conteo_real + diferencia_total/absoluta. Excluye caja fuerte (where `NOT es_caja_fuerte`)
- Vista `vw_caja_mensual_por_sucursal` — agregado por mes/sucursal · sesiones + cerradas + ingresos/egresos/ventas + diferencia + cajas_activas + cajeros_distintos. Periodo = `DATE_TRUNC('month', abierta_at)::DATE`

### Frontend
- **Nuevo componente `src/components/CajaReportes.tsx`** (~330 líneas) — 4 sub-tabs:
  - **(a) Diario por caja** — usa `vw_caja_resumen_diario` filtrado por fecha + opcional sucursal
  - **(b) Diario consolidado** — agrega todas las cajas por fecha en frontend (sin nueva vista)
  - **(c) Mensual por sucursal** — usa `vw_caja_mensual_por_sucursal`
  - **(d) Por cajero** — usa `vw_diferencias_por_cajero` (ya existente desde v1.9.4) - últimos 30 días
- **Filtros**: fecha desde/hasta (todos los reportes excepto cajero) + selector sucursal (a + c) opcional
- **Tabla**: render dinámico desde array `columnas[]` con `COL_LABELS` y `COLS_MONETARIAS` para detectar columnas a formatear como dinero. Color rojo/verde en columnas de diferencia. Tfoot con totales si hay >1 fila
- **3 botones de export** en cada reporte:
  - **Excel** (xlsx): hoja Info + hoja Datos. Labels en español
  - **PDF** (jspdf + autoTable): landscape si hay >6 columnas. Header con BRAND + período
  - **CSV** con BOM utf-8 para Excel ES + escape de comillas
- **CajaPage**: nuevo tab `'reportes'` (icono 📊) visible para DUEÑO/SUPERVISOR/SUPER_USUARIO/CONTADOR. Type `Tab` ampliado

### Score final del relevamiento Caja
- **8 de 8 decisiones críticas implementadas (100%)** ✅
- **I1/I2 reportes**: ✅ los 4 reportes prioritarios respondidos en el relevamiento + 3 formatos de export

### Estado al cierre
- DEV: **v1.10.0** con migrations 130-142 aplicadas
- PROD: v1.9.0 (136-142 pendientes de deploy)
- **Pipeline Reglas Caja: CERRADO** (todas las respuestas A-M del PDF de relevamiento implementadas con sus features priorizadas)
- Quedan opcionales: Fase 2.2b (L3 préstamos RRHH), Fase 2.3 (M2/M3/M4 + E1/E3 + G5) — refinos no críticos

---

## [2026-05-26] update | v1.9.5-dev — Caja Fase 2.2a — Operaciones especiales (L1/L4/L5/B7/G1)

Implementación de Fase 2.2 — sin migrations nuevas (solo frontend + uso de tablas existentes).
**L3 (préstamos RRHH) diferido a Fase 2.2b** porque toca otro módulo.

### Cambios

**L4 — Bloqueo cambio de sucursal con caja propia abierta** (`AppLayout.tsx`)
- Nueva query `mis-cajas-abiertas-por-suc` que devuelve `sucursal_id` de cajas abiertas propias
- Wrapper `handleCambiarSucursal(newId)` que intercepta el `onChange` de los 2 selectores de sucursal
- Si user tiene caja en otra sucursal: confirm "Tenés caja abierta en X. Cerrala antes de cambiar" → opción "Ir a esa caja" navega a `/caja` con la sucursal correcta seleccionada

**L1 — Selector de caja para egreso efectivo en devolución** (`VentasPage.tsx`)
- Nuevo state `devCajaSesionId`
- Modal de devolución: si hay medio "Efectivo" con monto > 0 → bloque ámbar pide elegir caja (auto-elige si solo hay 1 sesión)
- Validación: bloquea si hay >1 sesión abierta y no se eligió
- `procesarDevolucion`: usa `devCajaSesionId || sesionCajaId` como destino del egreso + asigna `cuenta_origen_id` de Efectivo
- Reset de `devCajaSesionId` al abrir modal

**L5 — Cadena de anulación venta según estado** (`VentasPage.tsx`)
- En `cambiarEstado` (case `cancelada`): si la venta estaba `despachada` con cobro > 0 y NO hay caja abierta → throw con mensaje detallado sugiriendo "Devolver" o emisión de NC
- `onError`: detecta SQLSTATE P0001 / "periodo_cerrado" del trigger BD y muestra mensaje específico "Generá una nota de corrección desde Gastos → Cierres contables"

**G1 — Botón "Corregir" en movimientos manuales** (`CajaPage.tsx`)
- Nuevo state `corregirMov`, `corregirMonto`, `corregirConcepto`
- Nueva mutation `corregirMovimiento`: inserta `[Reversión] <original>` (tipo opuesto) + nuevo movimiento `[Corregido] <nuevo>` con valores actualizados + `logActividad` con audit trail (valor_anterior → valor_nuevo)
- Botón inline 🔄 visible solo si `puedeEditarMovimiento` (DUEÑO/ADMIN o SUPERVISOR con flag `supervisor_puede_editar_movimientos`)
- Filtros: solo en `tipo='ingreso'` sin `#venta` (manual puro) y excluye los que ya son `[Reversión]`, `[Corregido]` o `[Diferencia caja]`
- Modal de corrección con form (concepto + monto) y referencia visible del original

**B7 — Doble validación al cierre** (`CajaPage.tsx`)
- Flag opcional `config_caja.doble_validacion_cierre` (default false)
- Si activado, modal de cierre muestra inputs email + password adicionales
- Mutation `cerrarCaja`: crea cliente Supabase secundario (`persistSession: false`) que llama `signInWithPassword` sin romper la sesión actual del cerrador
- Valida: credenciales OK + 2do usuario ≠ cerrador + mismo tenant + rol DUEÑO/SUPERVISOR/ADMIN/SUPER_USUARIO
- Logs `signOut` del cliente temporal en todos los paths

**ConfigPage tab Caja — nueva sección "Permisos avanzados"**:
- 3 toggles: doble validación cierre (B7) · SUPERVISOR puede editar movs (G1) · SUPERVISOR puede ver bóveda (E2)
- Mutation `handleSaveConfigCaja` que merge dentro de `tenants.config_caja` JSONB y refresca store

### Score final
- **8 de 8 decisiones críticas del relevamiento implementadas (100%)** 🎉
- B7 era la única que faltaba — ahora implementada como opcional configurable

### Estado al cierre
- DEV: v1.9.5 con migrations 130-141 aplicadas (sin migration nueva en esta fase)
- PROD: v1.9.0 (136-141 pendientes)
- Pipeline Caja: Tanda 1+1.5 (v1.9.1-2) + Fase 2.0 (v1.9.3) + Fase 2.1 (v1.9.4) + Fase 2.2a (v1.9.5)
- Quedan Fase 2.2b (L3 préstamos RRHH), 2.3 (UX + bóveda detalles), 2.4 (HITO v1.10.0 reportes)

---

## [2026-05-26] update | v1.9.4-dev — Caja Fase 2.1 — Ticket cierre + Diferencias (C1/C3/K2/K3/B1-B4)

### Migration 141 aplicada en DEV
- `caja_sesiones.numero INT` con trigger `fn_set_caja_sesion_numero()` que asigna correlativo por sucursal en INSERT (K3) + backfill de 43 sesiones existentes con `ROW_NUMBER() OVER (PARTITION BY tenant_id, sucursal_id ORDER BY abierta_at)`
- `caja_sesiones.snapshot_totales JSONB` para almacenar el estado completo al momento del cierre (K2)
- `tenants.diferencia_caja_umbral DECIMAL(14,2)` (B1)
- `tenants.diferencia_caja_alerta_roles TEXT[]` default `['DUEÑO','SUPERVISOR']` (B2)
- `tenants.diferencia_caja_alerta_canales TEXT[]` default `['inapp','email']` (B3)
- Vista `vw_diferencias_por_cajero` con `security_invoker=true` — cierres_count + cierres_con_diferencia + diferencia_neta/absoluta_acumulada + maxima, últimos 30 días por cajero (B4)

### Frontend
- **CajaPage `cerrarCaja` (K2)**: calcula snapshot completo al cerrar — `montos` (apertura/ingresos/egresos/saldo/conteo/diferencia) + `totales_por_metodo` (agrupados de movimientos) + `ventas` (las que matchean #N en concepto) + `movimientos_manuales` (ingresos/egresos manuales) + `arqueos` de la sesión + `numero_cierre`. Persistido en `caja_sesiones.snapshot_totales`
- **CajaPage `cerrarCaja` (B4)**: si hay diferencia ≠ 0, inserta `caja_movimientos` tipo `ingreso`/`egreso` con concepto `[Diferencia caja] Sobrante|Faltante` asociado al `sesionActiva.usuario_id` (cajero responsable, no quien cerró)
- **CajaPage `cerrarCaja` (B1/B2/B3)**: si `Math.abs(diferencia) >= umbral` (o umbral=null), envía alerta a usuarios con rol en `diferencia_caja_alerta_roles` por canales `inapp` (notificaciones) + `email` (send-email EF). WhatsApp queda como TODO
- **CajaPage `imprimirCierre(sesion, formato)` (C1+C3)**: refactor completo
  - Formato `'a4'` (default): header con logo + datos fiscales del negocio (CUIT, domicilio) · tabla resumen · totales por método de pago (del snapshot) · listado ventas (top 25) · listado movimientos manuales (top 15) · espacio para 2 firmas · numeración correlativa `#NNNN` en pie
  - Formato `'termico'` (nuevo): jsPDF con tamaño custom 80mm × dinámico · diseño tipo ticket de caja registradora · centrado · líneas dashed · misma data condensada
- **CajaPage historial**: botón "Reimprimir PDF" reemplazado por 2 botones (A4 + Tícket) visibles solo si `puedeReimprimirTicket`
- **CajaPage historial**: nueva card "Diferencias por cajero (últimos 30 días)" para DUEÑO/SUPERVISOR/CONTADOR con tabla — cierres count + con diferencia + neto + absoluto + máxima
- **ConfigPage tab Caja**: nueva sección "Diferencias en cierre de caja" con input umbral + chips toggles para roles destinatarios + chips toggles para canales (inapp/email/whatsapp deshabilitado)
- **ConfigPage**: nueva mutation `handleSaveDif` con `setTenant(data)` para refrescar store
- **ConfigPage**: state `bizDifUmbral` / `bizDifRoles` / `bizDifCanales` inicializados desde tenant

### Wiki
- `wiki/database/migraciones.md`: entrada 141
- `wiki/business/roadmap.md`: entrada v1.9.4
- `wiki/features/caja.md`: nueva sección Fase 2.1
- `log.md` + `index.md` + `project_pendientes.md` actualizados

### Estado al cierre
- DEV: v1.9.4 con migrations 130-141 aplicadas
- PROD: v1.9.0 (136-141 pendientes)
- Pipeline Caja: Tanda 1+1.5 (v1.9.1-2) + Fase 2.0 (v1.9.3) + Fase 2.1 (v1.9.4)
- Score: **7 de 8 decisiones críticas del relevamiento implementadas (87.5%)** — falta B7 doble validación

---

## [2026-05-26] update | v1.9.3-dev — Caja Fase 2.0 — Permisos + Roles (J/B5/B6/A2/A4/C2)

Implementación de respuestas J-M del relevamiento Caja (con socio en `relevamiento-caja-reglas-negocio.pdf` + respuestas guardadas en `sources/relevamientos/caja_2026-05-25.md`).

### Migration 140 aplicada en DEV
- `caja_sesiones.abierta_por UUID REFERENCES users(id)` + backfill = usuario_id (A2: registra quien hizo la apertura, distinto del propietario)
- `tenants.config_caja JSONB DEFAULT '{}'` — config flexible de permisos opcionales por rol (supervisor_puede_ver_boveda, supervisor_puede_editar_movimientos, forzar_cierre_dia_anterior)
- RPC `requiere_clave_maestra(tenant, accion)` — centraliza B5: cerrar_caja_ajena | abrir_caja_diferencia | anular_venta | anular_movimiento
- RPC `verificar_clave_maestra(tenant, clave)` SECURITY DEFINER — compara sin exponer clave al frontend

### Frontend
- **Nuevo helper `src/lib/cajaPermisos.ts`** — matriz J3 completa con `puede(rol, accion, configCaja?)` + lista de acciones con clave maestra
- **ConfigPage** tab Caja: clave maestra **solo editable por DUEÑO (B6)** — disabled para SUPERVISOR/ADMIN/CONTADOR + badge "🔒 Solo DUEÑO puede modificarla" + texto expandido sobre cuándo se requiere
- **AppLayout**: CONTADOR ahora ve y puede acceder a `/caja` (read-only)
- **CajaPage**: permisos granulares aplicados — `puedeAbrirAjena`, `puedeOperarCaja`, `puedeReimprimirTicket`, `puedeEditarMovimiento`, `esSoloLectura`
- **CajaPage tab Caja**: si `esSoloLectura` (CONTADOR) → ocultas las acciones Ingreso/Arqueo/Bóveda/Traspaso y se muestra banner "Modo solo lectura"
- **CajaPage modal Apertura (A2)**: si DUEÑO/SUPERVISOR, selector "Abrir caja para" con la lista de cajeros del tenant. Si se selecciona otro, la sesión queda con `usuario_id = cajero` y `abierta_por = current_user`
- **CajaPage abrirCaja mutation**: validación adicional — si abre a nombre de otro, verifica que ESE cajero no tenga ya una sesión abierta
- **CajaPage banner A4**: detecta si user tiene sesión propia abierta hace más de 24h y muestra banner ámbar con CTA "Ir a esa caja →" para forzar cierre
- **CajaPage cerrarCaja (B5)**: si es cierre ajeno Y el tenant tiene `clave_maestra` configurada → modal pide input password + valida vía RPC `verificar_clave_maestra` antes de cerrar
- **CajaPage cerrarCaja (C2)**: CAJERO ya no descarga PDF al cerrar — solo DUEÑO/SUPERVISOR/CONTADOR lo descargan. Toast muestra "El DUEÑO recibirá el detalle por email" para CAJERO. Mail al DUEÑO via EF `send-email` con detalle del cierre (saldo, conteo real, diferencia, ingresos, egresos, notas)
- **CajaPage**: botón "Cerrar caja" oculto para CONTADOR

### Wiki
- `wiki/database/migraciones.md`: entradas 139 + 140 (también 139 que se había olvidado documentar)
- `sources/relevamientos/caja_2026-05-25.md`: respuestas J-M con estado de implementación
- `wiki/business/roadmap.md`: entrada v1.9.3 con Fase 2.0
- `index.md`: actualizado

### Estado al cierre
- DEV: v1.9.3 con migrations 130-140 aplicadas
- PROD: v1.9.0 (136-140 pendientes de deploy)
- Pipeline Reglas Caja: Tanda 1 (v1.9.1) + Tanda 1.5 (v1.9.2) + Fase 2.0 (v1.9.3) implementadas. Resta Fase 2.1 (Ticket+Diferencias), 2.2 (Operaciones especiales), 2.3 (UX+Bóveda detalles), 2.4 (Reportes - HITO v1.10.0)

### Score implementación
- ✅ **6 de 8 decisiones críticas del relevamiento implementadas** (75%)
- Pendientes: B7 doble validación cierre · I1/I2 reportes

---

## [2026-05-25] update | v1.9.2-dev — Caja Tanda 1.5 — Bóveda como billetera del negocio + Extraer dinero (E4/E5)

Cierra el goal del usuario: la bóveda funciona como billetera del negocio con TODO el capital categorizado por cuenta de origen (efectivo, débito, crédito, MP, transferencia, etc.). Solo el DUEÑO puede extraer dinero con registro privado.

### Migration 137 — `137_boveda_retiros_y_backfill.sql`
- Tabla `boveda_retiros(id, tenant_id, cuenta_origen_id, monto, tipo_retiro, motivo, notas, usuario_id, movimiento_id, created_at)` con CHECK `tipo_retiro IN (banco/retiro_personal/gasto/inversion/pago_proveedor/otro)`
- 3 índices (tenant+created_at, cuenta_origen_id, usuario_id)
- **RLS estricta**: USING/WITH CHECK exige rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') vía EXISTS en users — otros roles no ven ni el listado ni el detalle
- Backfill cuenta_origen_id en `caja_movimientos` históricos: match por concepto `[Nombre Método]` para ingreso/egreso informativo; cuenta tipo='efectivo' para ingreso/egreso/ingreso_traspaso/egreso_traspaso/ingreso_reserva/egreso_devolucion_sena/ingreso_apertura
- UNIQUE partial index `uq_cuentas_origen_efectivo_por_tenant` (garantiza 1 cuenta efectivo por tenant)

### Migration 138 — `138_cuentas_origen_seed_metodos.sql`
- Auto-seed: crea cuenta_origen por cada método de pago no-efectivo activo (Mercado Pago/UALA → billetera · Tarjeta/Transferencia → banco · resto → otro) usando moneda del tenant
- Vincula `metodos_pago.cuenta_origen_id` con la cuenta recién creada (match por nombre)
- Re-aplica backfill con conceptos históricos `[Nombre Método]` → cuenta_origen_id del método

### Frontend
- **CajaPage**: nuevo estado para modal Extraer (`extraerCuentaId`, `extraerMonto`, `extraerTipo`, `extraerMotivo`, `extraerNotas`) + `puedeExtraerBoveda = DUEÑO/ADMIN/SUPER_USUARIO`
- **CajaPage**: nueva query `boveda-retiros` con `enabled: puedeExtraerBoveda` (RLS bloquea a otros roles igualmente)
- **CajaPage**: nueva mutation `extraerDeBoveda` que valida saldo de cuenta, obtiene/crea sesión permanente de caja fuerte, inserta movimiento (`egreso_traspaso` si efectivo o `egreso_informativo` si banco/billetera) con `cuenta_origen_id`, e inserta registro en `boveda_retiros` con link al movimiento
- **CajaPage** tab Bóveda: nuevo botón "Extraer dinero" (rojo, ml-auto) solo para DUEÑO+
- **CajaPage** tab Bóveda: nueva sección "Historial de extracciones (privado)" con borde rojo, badge tipo, cuenta, motivo, notas, monto, fecha/hora y usuario — solo para DUEÑO+
- **CajaPage** tab Bóveda: eliminada card hardcodeada "Efectivo (caja fuerte)" basada en `fuerteSaldo` — ahora la card Efectivo viene de `vw_boveda_cuentas` (cuenta tipo='efectivo' única); única fuente de verdad
- **CajaPage** tab Bóveda: indicador "Capital del negocio · Total: $X" arriba a la derecha (solo DUEÑO+) sumando todas las cuentas activas
- **CajaPage** `operarCajaFuerte`: los 4 inserts de traspaso (depósito caja → fuerte + retiro fuerte → caja) ahora setean `cuenta_origen_id = id cuenta efectivo` para que la vista los considere
- **CajaPage** modal Extraer Dinero: pide cuenta (con saldo disponible en label), monto, tipo (6 opciones), motivo obligatorio, notas opcionales

### Datos validados en DEV (tenant `3769b1db`)
- Efectivo: $12.874.811 (86 movs)
- Mercado Pago: $37.228 (10 movs)
- Transferencia: -$958.749 (7 movs · negativo porque hay más gastos que ingresos en transferencia)

### Wiki
- `wiki/features/caja.md`: nueva sección "Bóveda como billetera del negocio — Tanda 1.5"
- `wiki/database/migraciones.md`: entradas 137 y 138
- `sources/relevamientos/caja_2026-05-25.md`: marcadas E4 y E5 como implementadas

### Estado al cierre
- DEV: v1.9.2 con migrations 130-138 aplicadas
- PROD: v1.9.0 (migrations 136-138 pendientes de deploy)

---

## [2026-05-25] update | v1.9.1-dev — Reglas Caja Tanda 1 (moneda + Cuentas de Origen + bóveda discriminada)

Implementación de respuestas A-I del relevamiento de Caja (con socio en `relevamiento-caja-reglas-negocio.pdf` + respuestas guardadas en `sources/relevamientos/caja_2026-05-25.md`).

### Migration 136 aplicada en DEV
- `cajas.moneda TEXT NOT NULL DEFAULT 'ARS'` + índice + seed desde `tenants.moneda` (23 cajas existentes asignadas)
- Tabla `cuentas_origen(id, tenant_id, nombre, tipo, banco, numero, alias, moneda, activo, notas)` con CHECK `tipo IN (banco/billetera/efectivo/otro)` + RLS tenant
- Seed de 1 cuenta `Efectivo` por tenant (7 cuentas creadas) + auto-asociación al método de pago "Efectivo" (5 métodos vinculados)
- `metodos_pago.cuenta_origen_id` FK → cuentas_origen ON DELETE SET NULL
- `caja_movimientos.cuenta_origen_id` FK opcional + índice parcial
- Vista `vw_boveda_cuentas` con `security_invoker=true` → saldo neto por cuenta calculado de `caja_movimientos`

### Frontend
- **ConfigPage** tab Caja: nueva sección "Cuentas de Origen" con ABM completo (alta inline + edición inline + toggle activo + eliminar con guard de FK 23503)
- **ConfigPage** tab Ventas → Métodos de pago: selector "Cuenta de origen default" en cada método + badge `→ Cuenta` en modo display
- **VentasPage**: nueva query `metodos_pago_cfg` + helper `cuentaOrigenDeMetodo(nombre)` aplicado en los 5 puntos de insert informativo (despacho, seña reservada, seña en updateVentaEstado, despacho desde reservada, devolución seña cancelada)
- **GastosPage**: misma query + helper aplicado en los 5 puntos de insert (OC, edición gasto borrador, gasto nuevo caja fuerte/normal, reversión por eliminación, gasto fijo generado)
- **CajaPage** tab Bóveda: cards de saldos discriminados — card Efectivo (caja fuerte tradicional) + 1 card por cada `cuenta_origen` activa con icono por tipo + saldo + count + moneda + empty state que invita a Config
- **CajaPage** modal Nueva Caja: selector de moneda obligatorio (default = `tenant.moneda` o `'ARS'`)
- **CajaPage** selector pílulas: badge `MONEDA` cuando difiere de la del tenant
- **CajaPage** lista en tab Configuración: badge `MONEDA` siempre visible junto al nombre
- **CajaPage** modal movimiento manual: solo registra ingresos (eliminado `setMovTipo`, `movTipo` queda como constante `'ingreso'`), texto guía explica que los egresos pasan por Gastos
- **CajaPage** botón "Cerrar caja": cuando `arqueosSesion.length === 0` se muestra como "Arqueo requerido antes de cerrar" (amber, abre modal de arqueo); mutation `cerrarCaja` valida con throw si no hay arqueos previos

### Wiki
- Nueva página `sources/relevamientos/caja_2026-05-25.md` con respuestas A-I + recomendación B4 + decisiones críticas pendientes
- `wiki/features/caja.md`: nueva sección "Reglas relevadas — Tanda 1 (v1.9.1)" con F1, H1, G2, D3 + listado de pendientes para próximas tandas
- `wiki/database/migraciones.md`: entrada 136
- `index.md`: descripción Caja actualizada + pie con nuevo conteo y estado de relevamiento
- PDF generado en raíz: `relevamiento-caja-reglas-negocio.pdf` (50 preguntas, 14 secciones) — A-I respondidas, J-N pendientes

### Estado al cierre
- DEV: v1.9.1 con migrations 130-136 aplicadas
- PROD: v1.9.0 (migration 136 pendiente de deploy)
- Pendiente próximas tandas: respuestas J-N del relevamiento + features B4/B5/B7/C2/E1/E4/G1 (algunas dependen de respuestas pendientes)

---

## [2026-05-25] update | PROD deploy v1.9.0 — Reglas Gastos Fases 4+5 (capitalización + cierre contable)

- Migrations 134 + 135 aplicadas en PROD ✅ (3 columnas nuevas en gastos, tabla cierres_contables, vista vw_egresos_consolidados, 4 funciones, 5 triggers)
- PR #117 `dev → main` mergeado ✅ (squash commit `4ec5885b`)
- Vercel auto-deploy PROD `dpl_DH6q1FMCKxPnPN6tav1xC3j79Kab` en estado READY ✅ (build 66s)
- `app.genesis360.pro` ya sirviendo v1.9.0
- GitHub release v1.9.0 actualizada como **latest** (título limpio sin sufijo DEV)
- DEV y PROD ahora ambas en v1.9.0 — pipeline Reglas de Negocio Gastos cerrado

---

## [2026-05-25] update | v1.9.0-dev — Fases 4 + 5 reglas Gastos (capitalización + cierre contable)

### Migrations aplicadas en DEV
- **134** `134_gastos_capitaliza_egresos_consolidados.sql`
  - `gastos.capitaliza_recurso BOOLEAN DEFAULT FALSE` + CHECK constraint (TRUE solo si recurso_id IS NOT NULL) + índice parcial `idx_gastos_recurso_capit`
  - VIEW `vw_egresos_consolidados` (UNION ALL de `gastos` + `rrhh_salarios.pagado=true`, `security_invoker=true`)
- **135** `135_cierre_contable.sql`
  - Tabla `cierres_contables(tenant_id, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)` UNIQUE(tenant_id, periodo) + RLS + CHECK periodo=primer día del mes
  - `gastos.gasto_padre_id` + `gastos.es_correccion BOOLEAN` + índice parcial
  - Helpers `ultimo_cierre_hasta(tenant)` y `periodo_cerrado(tenant, fecha)` STABLE
  - 5 triggers BEFORE UPDATE/DELETE en `gastos / ventas / caja_movimientos / caja_sesiones / ordenes_compra` con RAISE EXCEPTION SQLSTATE P0001
  - RPC `cerrar_periodo(p_periodo, p_observaciones)` SECURITY DEFINER — DUEÑO/SUPERVISOR/CONTADOR/ADMIN, valida periodo > último cierre y no en curso, snapshot de totales
  - RPC `reabrir_periodo(p_cierre_id)` — solo último cierre, DUEÑO/ADMIN/SUPER_USUARIO

### Frontend
- **`src/lib/supabase.ts`**: nueva interface `CierreContable` + extensión de `Gasto` (`recurso_id`, `capitaliza_recurso`, `gasto_padre_id`, `es_correccion`)
- **`src/hooks/useCierreContable.ts`** (nuevo): hook que cachea el último cierre + `isPeriodoCerrado(fecha)` helper. Función auxiliar `manejarErrorPeriodoCerrado(error, toastFn)`.
- **`src/components/CierresContablesPanel.tsx`** (nuevo): selector de periodo a cerrar (sugerencias automáticas) + preview live de gastos/ventas/sueldos del periodo + botón "Cerrar periodo" con confirmación + listado histórico expandible con totales snapshot + botón "Reabrir" solo en el último cierre (DUEÑO/ADMIN).
- **GastosPage**:
  - Nuevo tab **"Cierres contables"** visible a DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN
  - Checkbox **"Sumar al valor del recurso"** debajo del selector de recurso (visible solo si hay recurso_id), persiste `capitaliza_recurso`
  - Query nueva `recursos-select-gasto` (carga recursos no dados de baja) para el dropdown del form
  - Modo **"Nota de corrección"**: estado `correccionPadre` + función `abrirCorreccion(g)` que pre-rellena form con datos del gasto original, fecha=hoy, descripción "Corrección de: ..."
  - Validación de monto: en modo corrección admite negativos (anular total/parcial), en modo normal solo positivos
  - En el listado (tab gastos + historial), reemplaza Editar/Eliminar por **🔒 Corregir** cuando `isPeriodoCerrado(g.fecha)`
  - `eliminar()` y `guardar()` chequean el periodo antes y capturan errores del trigger via `manejarErrorPeriodoCerrado`
- **RecursosPage**:
  - Query `gastos-por-recurso` que agrega `mantenimiento`/`capitalizado`/`total`/`count` por recurso_id
  - Nueva card en stats grid: **"Mantenimiento acumulado"** (suma de gastos no capitalizables vinculados)
  - Valor patrimonial ahora incluye capitalizaciones: `valor + capitalizado`
  - Cada `RecursoCard` muestra `+ $X cap.` junto al valor base y chips "🔧 Mantto" + "📈 Cap." con cantidad de gastos asociados
- **DashGastosArea**:
  - Query agrega `rrhh_salarios.pagado=true` del período (actual y previo) → calcula `costoLaboral` y `empleadosLiquidados`
  - Banner nuevo **"Costo laboral del período (RRHH)"** debajo de los 4 KPIs principales, con link a `/rrhh?tab=nomina` y total consolidado "Gastos + RRHH"
- **RentabilidadPage**:
  - Query nueva `rentabilidad-egresos` (gastos + sueldos del período)
  - Nueva sección **"Estado de resultados (período)"** con líneas: Ventas / CMV / Ganancia bruta / Gastos operativos / **Sueldos pagados (RRHH)** (con link a `/rrhh?tab=nomina`) / Resultado neto
- **VentasPage**: handler "Eliminar venta" intercepta y muestra el mensaje del trigger periodo cerrado

### Wiki
- Nueva página `wiki/development/cierre-contable.md` con concepto, schema, triggers, RPCs, hook, componente, casos de uso y pendientes opcionales
- `wiki/features/gastos.md`: nuevas secciones "Capitalización en recursos", "Vista vw_egresos_consolidados", "Cierre contable mensual"; tabs ampliados a 7
- `wiki/features/recursos.md`: nueva card stats "Mantenimiento acumulado" + sección "Capitalización en recursos"
- `wiki/database/migraciones.md`: entradas 134 + 135

### Estado al cierre
- DEV: v1.9.0 con migrations 130-135 aplicadas
- PROD: v1.8.44
- Pendiente deploy PROD: bloque DEV completo (v1.8.45 + v1.9.0)
- Cierre del pipeline Reglas de Negocio - Gastos ✅ — Fases 1-5 completas

---

## [2026-05-24] update | PROD deploy v1.8.44 — Reglas Gastos Fases 1-3 + Moneda multi-país

- PR #116 `dev → main` mergeado ✅ (commit f8f4e434)
- Vercel auto-deploy PROD `dpl_FqCFSJA64t19A9GXGQs7gEibpMmy` en estado READY ✅
- Migrations 130-133 aplicadas en PROD ✅ (4 tenants × 16 categorías = 64 categorías_gasto seedeadas + moneda default ARS + ambas tablas de autorizaciones creadas)
- GitHub release v1.8.44 como **latest** ✅
- DEV y PROD ahora ambas en v1.8.44

## [2026-05-24] update | v1.8.44-dev — Fase 3 reglas Gastos (moneda + IVA + CC proveedor)

### Migration aplicada en DEV
- **133** `133_moneda_iva_alicuota_cc_autorizaciones.sql`
  - `tenants.moneda TEXT NOT NULL DEFAULT 'ARS'` con CHECK (ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR)
  - `gastos.alicuota_iva DECIMAL(5,2)` + `gastos_fijos.alicuota_iva DECIMAL(5,2)` para selector de alícuota persistente
  - Nueva tabla `autorizaciones_cc(tenant_id, proveedor_id, oc_id, motivo_bloqueo, monto, motivo, payload, solicitante_rol, estado, aprobador_rol, ...)` con RLS por tenant
  - `motivo_bloqueo`: `limite_excedido | oc_vencida`

### Frontend
- **`src/lib/formato.ts`** (nuevo): `formatMoneda(monto, moneda, opts)` + `simboloMoneda()` + `localeMoneda()` + `MONEDAS_DISPONIBLES`. 11 monedas: ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR con símbolo + locale específico.
- **`src/lib/ccProveedor.ts`** (nuevo): `chequearBloqueoCC(proveedorId, monto)` retorna `{bloqueado, motivo, detalle, ocsVencidas, saldoActual, limite}`. `existeAutorizacionCCAprobada(proveedorId)` verifica autorización vigente <24h sin usar.
- **`src/components/SolicitarOverrideCCModal.tsx`** (nuevo): modal rojo con motivo obligatorio que crea fila en `autorizaciones_cc`
- **`src/components/BandejaAutorizacionesCC.tsx`** (nuevo): bandeja paralela a la de gastos, solo DUEÑO aprueba/rechaza overrides de CC
- **ConfigPage tab Mi Negocio**: nuevo selector "Moneda principal del negocio" con 11 opciones. Aviso explícito de que es etiqueta visual, no conversión.
- **GastosPage**:
  - `TASAS_IVA` extendido con 27%, 0% y opción `custom` (input numérico al lado del select)
  - `calcularIVA(monto, tipoIva, alicuotaCustom)` actualizado para soportar custom
  - `ivaAutoPorTipoComprobante(tipoComp)` mapea: Factura A/B/Nota A/B/Importación/Ticket → 21% · Factura C/Recibo C/bienes usados → sin_iva. Auto-fill del form al elegir tipo de comprobante (solo si tipo_iva está vacío)
  - Form `alicuota_iva_custom` para input numérico cuando `tipo_iva === 'custom'`
  - Persistencia de `alicuota_iva` en payload de gastos y gastos_fijos
  - Validación nueva en `guardar()`: si la categoría tiene `requiere_sucursal=true` y no hay sucursal activa → toast.error bloqueante. Aviso amber inline cuando el usuario selecciona una categoría con sucursal obligatoria sin tener sucursal activa
  - Validación nueva en `registrarPagoOC()`: si `montoCC > 0` y proveedor está bloqueado (OC vencida o límite excedido), se abre `SolicitarOverrideCCModal`. Si hay autorización aprobada <24h, se permite continuar.
  - Tab "Autorizaciones" extendido con sub-tabs **"Gastos"** y **"CC Proveedores"**
- **Migración formatMoneda a helper central**: GastosPage, CajaPage, ClientesPage, EnviosPage, FacturacionPage, MetricasPage, RentabilidadPage, ReportesPage — ahora cada página usa el helper centralizado con `tenant.moneda`. Cambiar moneda en ConfigPage refleja en toda la app.
- **`src/lib/supabase.ts`**: `Tenant.moneda?`, `Gasto.alicuota_iva?`, nueva interface `AutorizacionCC`

### Estado al cierre
- DEV: v1.8.44 con migrations 130-133 aplicadas
- PROD: v1.8.40
- Pendiente deploy PROD: bloque DEV completo (v1.8.41 + v1.8.42 + v1.8.43 + v1.8.44)
- Fases pendientes:
  - **v1.8.45**: Recursos↔Gastos + Dashboard consolidado + vw_egresos_consolidados
  - **v1.9.0**: Cierre contable mensual (HITO transversal)

---

## [2026-05-24] update | v1.8.43-dev — Fase 2 reglas Gastos (umbrales + autorizaciones)

### Migration aplicada en DEV
- **132** `132_gastos_umbrales_autorizaciones.sql`
  - `sucursales.umbral_gasto_supervisor` + `umbral_gasto_cajero` (DECIMAL nullable)
  - Nueva tabla `autorizaciones_gasto`: `tipo` (crear/editar/eliminar), `monto`, `descripcion`, `motivo`, `payload JSONB`, `solicitante_id/rol`, `estado` (pendiente/aprobada/rechazada/cancelada), `aprobador_id/rol`, `motivo_rechazo`, índices y RLS por tenant
  - Helper SQL `puede_aprobar_autorizacion_gasto(solic_rol, aprob_rol)` con reglas: CAJERO → SUPERVISOR+ · SUPERVISOR → ADMIN/DUEÑO

### Frontend
- **`src/lib/umbralGasto.ts`** (nuevo): helper `evaluarUmbralGasto(rol, sucursal, monto)` y `puedeAprobar(solicRol, aprobRol)`
  - DUEÑO/ADMIN/SUPER_USUARIO → sin restricción
  - SUPERVISOR → umbral configurable (NULL = sin restricción)
  - CAJERO → umbral configurable (NULL = todo requiere autorización)
  - CONTADOR → no crea/edita gastos (solo IVA)
- **`src/components/SolicitarAutorizacionGastoModal.tsx`** (nuevo): modal amber con motivo obligatorio que crea fila en `autorizaciones_gasto` con payload completo del gasto pendiente
- **`src/components/BandejaAutorizacionesGasto.tsx`** (nuevo): lista filtrable pendiente/aprobada/rechazada · expandible con motivo + payload JSON · botón aprobar ejecuta INSERT/UPDATE/DELETE en gastos según `tipo` + marca autorización · botón rechazar requiere motivo · SUPERVISOR ve solo solicitudes de CAJERO, ADMIN/DUEÑO ven todas
- **`SucursalesPage`**: nuevo bloque "Umbrales de autorización de gastos" con 2 inputs por sucursal
- **`GastosPage`**:
  - Query `sucursal-umbrales-gasto` carga umbrales según `sucursalId` activo (o primera del tenant)
  - En `guardar()`, después de armar `payload`, llama a `evaluarUmbralGasto`; si supera → abre `SolicitarAutorizacionGastoModal` con el payload y NO inserta
  - Nuevo tab "Autorizaciones" visible solo a DUEÑO/ADMIN/SUPERVISOR/SUPER_USUARIO con badge amber de pendientes (refetch cada 30s)
  - CAJERO solo ve sus propios gastos (filter `usuario_id = user.id` en queries de gastos + historial)
  - CONTADOR: botón "Nuevo gasto" oculto · aviso visible 📊 en modal de edición · monto bloqueado (disabled)
- **`src/lib/actividadLog.ts`**: agregada entidad `autorizacion_gasto` + acciones `solicitar`/`aprobar`/`rechazar`
- **`src/lib/supabase.ts`**: nueva interface `AutorizacionGasto`, `Sucursal` con campos `umbral_gasto_*`

### Estado al cierre
- DEV: v1.8.43 con migrations 130-132 aplicadas
- PROD: v1.8.40
- Pendiente deploy PROD: bloque DEV completo (v1.8.41 + v1.8.42 + v1.8.43)
- Fases pendientes:
  - **v1.8.44**: IVA auto + selector alícuota + CC proveedor (límite/vencimiento/override) + multi-sucursal por categoría
  - **v1.8.45**: Recursos↔Gastos + Dashboard consolidado
  - **v1.9.0**: Cierre contable mensual (HITO transversal)

---

## [2026-05-24] update | v1.8.42-dev — Fase 1 reglas Gastos (migrations 130, 131)

### Migrations aplicadas en DEV
- **130** `categorias_gasto`: catálogo por tenant + seed de 16 categorías predefinidas + flag `requiere_sucursal` + trigger AFTER INSERT en tenants para alta automática. FK opcional `gastos.categoria_id` + `gastos_fijos.categoria_id`. Verificado: 7 tenants en DEV recibieron las 16 categorías (7 con sucursal obligatoria).
- **131** `tenants.gastos_*`: 7 nuevas columnas — 4 reglas combinables OR de obligatoriedad de comprobante (`siempre`, `si_iva`, `si_monto + monto_umbral`, `si_deduce_ganancias`) + `dias_alerta_borrador` (default 7) + `dias_alerta_anticipo_oc` (default 15). Default activo: `gastos_comp_siempre=true`.

### Frontend
- `src/lib/supabase.ts`: nueva interface `CategoriaGasto`, `Gasto.categoria_id`, 7 campos `gastos_*` en `Tenant`.
- `GastosPage`: la lista hardcoded `CATEGORIAS_GASTO` ahora es `CATEGORIAS_GASTO_FALLBACK`; selector de categoría carga desde `categorias_gasto` (forma activa) con fallback.
- `GastosPage` tab Fijos: badges de estado por gasto fijo: 🟢 Dentro de fecha · 🟡 Pendiente este mes · 🔴 Atrasado (+Nd) · ✅ Generado este mes. Atraso usa `tenant.gastos_dias_alerta_borrador` como umbral. "Generado" se detecta matcheando `gastos.descripcion === fijo.descripcion` dentro del mes actual.
- `GastosPage` tab OC: badge **💰 Anticipo** cuando `monto_pagado > 0 && estado != recibida/recibida_parcial/cancelada`. Color naranja por default, **rojo** si pasaron más de `gastos_dias_alerta_anticipo_oc` días desde la OC sin recibir mercadería.
- `ConfigPage`: nueva tab **Gastos** (icono TrendingDown) con 3 secciones — Reglas de comprobante (4 toggles combinables OR + input monto umbral si "Si supera monto" está activo), Alertas (2 inputs: días borrador + días anticipo OC), Categorías (CRUD con tabla, agregar custom, toggles `requiere_sucursal` y `activo`, delete solo para custom).

### Estado al cierre
- DEV: v1.8.42 con migrations 130-131 aplicadas
- PROD: v1.8.40 (sin cambios en esta sesión)
- Pendiente deploy PROD: bloque DEV completo (v1.8.41 selector courier + v1.8.42 reglas gastos Fase 1)

---

## [2026-05-24] update | relevamiento reglas Gastos + plan implementación 5 fases

### Reglas de negocio relevadas (sesión con GO)

Decisiones clave del módulo **Gastos** documentadas en `wiki/development/reglas-negocio.md`:

- **Permisos por rol** con doble umbral por sucursal (`umbral_gasto_supervisor` + `umbral_gasto_cajero`)
- **CONTADOR**: ve todo, edita solo IVA del gasto
- **CAJERO**: solo en su caja abierta; editar/eliminar requiere autorización SUPERVISOR+
- **Cierre contable mensual**: feature transversal nueva (Gastos + Ventas + Caja + OC) → hito v1.9.0
- **Multi-sucursal por categoría**: `categorias_gasto.requiere_sucursal` define obligatoriedad
- **Borradores**: badge visual + alerta tras N días configurable (creador + DUEÑO + SUPERVISOR)
- **Comprobante**: 4 reglas combinables OR en Config → Gastos (default: siempre obligatorio)
- **Cuotas**: gasto madre + N `gasto_cuotas` (sin tocar caja); cada cuota genera egreso al pagarse
- **Gastos fijos**: manual con "Generar hoy" + indicadores visuales 🟢🟡🔴✅ + notificación + email diario
- **OC anticipo**: permitido; badge "💰 Anticipo" + alerta N días sin recibir (sin estado nuevo)
- **CC proveedor**: límite + vencimiento + bloqueo solo CC + override DUEÑO con auditoría
- **IVA**: auto según tipo (A/B/C) + selector alícuota (21/10.5/27/0/custom)
- **Categorías**: catálogo predefinido + custom; predefinidas se desactivan, no se eliminan
- **Sueldos**: NO migran a Gastos, se quedan en RRHH → Nómina. Integración via `vw_egresos_consolidados`
- **Recursos↔Gastos**: mantenimiento acumulado por default + checkbox capitalizar opt-in

### Plan de implementación (5 fases) en `sources/raw/project_pendientes.md`

| Release | Migrations | Resumen |
|---------|-----------|---------|
| v1.8.42 | 130, 131 | Categorías + config comprobante + indicadores fijos + OC anticipo |
| v1.8.43 | 132 | Umbrales + autorizaciones + RLS por rol + alerta borrador |
| v1.8.44 | 133 | IVA auto + selector alícuota + CC proveedor + multi-sucursal |
| v1.8.45 | 134 | Recursos↔Gastos + Dashboard consolidado + vista vw_egresos_consolidados |
| **v1.9.0** | 135 | **HITO**: Cierre contable mensual (transversal) + notas de corrección |

### Pendientes de relevar (próximas sesiones)

- RRHH (detalle completo) · Devoluciones · Ventas (límites/reapertura) · Clientes (límite deuda) · Compras (derivadas/over-receipt) · Envíos (reglas extra)

---

## [2026-05-23] update | PROD deploy v1.8.40 — modulo Envios completo

- PR #115 `dev → main` mergeado ✅
- Migrations 127-129 aplicadas en PROD ✅
- GitHub release v1.8.40 como latest ✅
- App version DEV y PROD = v1.8.40

## [2026-05-23] update | v1.8.40-dev — ISS-166/167/168/169 + fixes carrito/numeración/autocomplete

### ISS-166 — Botón cámara en modal POD
- Input file con `capture="environment"` para tomar foto con la cámara del dispositivo
- Upload a bucket `etiquetas-envios/pod/{id}/` con URL firmada 365 días como `pod_url`

### ISS-167 — QR codes en remito PDF
- QR número de venta + QR número de envío en esquina superior derecha
- Tabla incluye SKU, LPN y Ubicación de almacén

### ISS-168 — LPN y ubicación de mercadería en Envíos
- Panel expandido muestra LPN en badge + ubicación por producto de la venta

### ISS-169 — Pestaña Pagos Courier
- Tab con badge de pendientes · selección múltiple · marcar como pagados
- Migration 128: `costo_pagado + fecha_pago_courier + medio_pago_courier`

### Fixes sesión (2026-05-21 → 2026-05-23)
- Número venta coherente Ventas↔Envíos (prefijo sucursal opcional, fallback `#global`)
- Carrito restaurado: re-fetch lineas dentro del mismo effect (elimina race condition)
- Autocomplete: `AutocompleteSuggestion` API (misma que Google Maps) + `AutocompleteService` legacy
- Distancia: Haversine con coords pre-geocodificadas · alertas si dirección mala
- DashEnviosArea: `en_bodega` en funnel, tiempo medio desde POD, insight cancelados

## [2026-05-21] update | v1.8.39-dev — autocomplete direcciones con Nominatim fallback

### AddressAutocompleteInput — autocomplete robusto
- **Google Places (primario)**: funciona cuando Maps JS API está habilitada
- **Nominatim/OpenStreetMap (fallback)**: activa automáticamente cuando Maps falla (`gm_authFailure` o `ApiNotActivatedMapError`)
  - Busca desde 3 chars, debounce 450ms, límite 6 resultados, solo Argentina
  - No requiere API key, libre de uso
  - Verificado: "Av Triunvirato 2066 CABA" → retorna "Avenida Triunvirato, Villa Urquiza, Buenos Aires..."
- **Singleton `mapsErrorDetected`**: evita reintentos de Maps en la misma sesión
- **`gm_authFailure`**: hookeado para detectar error de key/dominio además del error de API

### VentasPage — autocompletar dirección con domicilios del cliente
- Query `domicilios-cliente-venta` carga `cliente_domicilios` cuando hay `clienteId`
- Al activar toggle envío: pre-llena destino con domicilio principal del cliente
- Dropdown al enfocar: muestra direcciones guardadas + sugerencias Nominatim unificadas

## [2026-05-21] update | v1.8.39-dev — POD + en_bodega + fix crítico envíos + corrección totales (testing completo ✅)

### Flujos verificados via DB (5 flujos end-to-end)
1. **Venta directa** #78 — POS, Efectivo $4200, sin envío → Caja OK
2. **Venta con envío** #79 — WhatsApp, Transferencia $7650 (6150+1500 envío), Av. Triunvirato 2066 → Envío #4 pendiente/despachado/en_camino/en_bodega/entregado con POD ✅
3. **Reserva → despachada** #80 — Instagram, Seña $1000 efectivo + saldo $4550 débito, envío #5 pendiente ✅
4. **Presupuesto → despachada** #81 — POS, $5000 efectivo + $3400 tarjeta crédito, multi-pago ✅
5. **POD completo** — todos los estados (pendiente→despachado→en_camino→en_bodega→entregado), pod_fecha/receptor/notas/url ✅

### Consistencia verificada
- `monto_pagado == total + costo_envio` en 4/4 ventas test: OK
- Caja: ingreso, ingreso_informativo, ingreso_reserva registrados por tipo de medio de pago: OK
- Dashboard canales: POS/WhatsApp/Instagram con totales reales incluyendo envío: OK
- Envíos: 1 pendiente + 4 entregados (2 con POD); canal hereda de la venta: OK

## [2026-05-21] update | v1.8.39-dev — POD + en_bodega + fix crítico envíos + corrección totales

### Migration 127 — POD y estado en_bodega
- `envios`: 4 nuevas columnas: `pod_url`, `pod_fecha`, `pod_receptor`, `pod_notas`
- CHECK constraint ampliado: `en_bodega` como nuevo estado entre `en_camino` y `entregado`
- Flujo de estados: pendiente → despachado → en_camino → **en_bodega** → entregado

### Fix crítico — BUG envíos auto-creados desde VentasPage
- `cliente_id` no existe en tabla `envios` → INSERT fallaba silenciosamente (sin registro de envío)
- Fix: eliminado `cliente_id` del INSERT; agregado `canal: canalPOS` y `fecha_entrega_acordada`
- Nuevo campo en form de VentasPage: "Fecha de entrega acordada" al activar toggle envío

### EnviosPage — POD completo
- Modal POD standalone: abre al hacer clic en "Registrar POD" desde panel expandido
- Al confirmar POD: guarda pod_fecha/pod_receptor/pod_notas/pod_url + cambia estado a `entregado`
- Display POD en panel expandido: muestra fecha, receptor, observaciones y link comprobante
- Sección POD en modal de edición de envío (cuando se edita uno existente)
- `en_bodega`: badge violeta + icono Warehouse; botón "Registrar entrega (POD)" desde ese estado

### Corrección de totales en ventas con envío
- Historial lista: muestra `total + costo_envio` (total real que pagó el cliente)
- Detalle de venta: línea separada "Envío" + total correcto incluyendo envío
- Ticket (modal post-venta): muestra "Envío" en breakdown + total correcto
- Saldo modal (reserva→despachada): calcula saldo correctamente incluyendo `costo_envio`
- Modal presupuesto→reservada: total correcto con envío para seña

## [2026-05-20] update | v1.8.38-dev — envíos en VentasPage + consolidación SucursalesPage

### ISS-162/163/164 — Envíos en VentasPage
- ISS-164: campo "Dirección de entrega" reemplazado por `AddressAutocompleteInput` → Google Places autocomplete mientras se escribe
- ISS-163: nuevo campo editable "Dirección de origen (sucursal)" también con autocomplete; pre-llenado con `sucursal.direccion` al activar el toggle. URL de Google Maps ahora usa este campo como origen (antes quedaba vacío cuando sucursalId=null)
- ISS-162: al activar envío, pre-llena `$/km` desde `sucursal.costo_km_envio` y activa modo "Por KM"; `onPlaceSelected` dispara `calcularDistanciaKm()` → setea km → calcula costo automáticamente

### Jerarquía global/sucursal para $/km
- `sucursal.costo_km_envio` (prioridad) → `tenant.costo_envio_por_km` (fallback global)
- Afecta EnviosPage, VentasPage; labels actualizados en ConfigPage y SucursalesPage

### Consolidación config por sucursal → SucursalesPage
- Movido desde Config/Mi negocio a SucursalesPage (modal de edición):
  `codigo_postal`, `email`, `horario_apertura`, `horario_cierre`, `punto_venta_afip`
- Eliminado bloque "Configuración por sucursal" y todo el estado de ConfigPage
- Config/Mi negocio queda con configuración puramente a nivel tenant

## [2026-05-20] update | v1.8.38-dev — scan ticket IA, fixes Dashboard, ISS-090 CC

### Nuevas features
- **scan-ticket** EF nueva (Claude Sonnet 4.6 vision): analiza foto de ticket de supermercado y extrae lista de productos con barcode, nombre, cantidad y precio_unitario
- **RecepcionesPage**: botón "Escanear ticket" → foto → matcheo contra DB → tabla editable → carga automática al formulario de recepción
- **ProductosPage**: botón "Escanear ticket" → foto → validación de catálogo: ✓ sin cambios / ⚠ precio diferente / + nuevo → actualiza precio_costo o crea producto

### Bugs críticos resueltos
- **Dashboard Productos/Inventario — todo en $0**: columna `categoria` fue migrada a FK `categoria_id` pero las queries del dashboard nunca se actualizaron → 400 de PostgREST → `data=null` → KPIs en 0. Fix: usar `categorias(nombre)` en el join
- **Dashboard rotación/runway = 0**: VentasPage no incluía `sucursal_id` al insertar en `movimientos_stock` → rebajes sin sucursal → filtro estricto los excluía. Fix: agrega `sucursal_id` al insert + filtro inclusivo `OR NULL` en Dash
- **ISS-090 — CC validación**: `validarMediosPago` con CC roto → full CC fallaba con "Ingresá un método de pago", CC+tarjeta fallaba. Fix: filter (no map) + validar resto contra `totalSinCC`

### UX
- Banner amber en tabs Inventario y Productos del Dashboard cuando hay sucursal seleccionada en el header (el selector no es visible en /dashboard). Botón "Ver todo" para DUEÑO/roles con puedeVerTodas
- APP_VERSION bumpeada a v1.8.38

## [2026-05-19] update | PROD deploy v1.8.37 — migrations 122-126, EFs MODO, ISS-136 completo

- PR #114 `dev → main` mergeado ✅
- Migrations 122-126 aplicadas en PROD ✅
- EFs `modo-webhook` y `modo-crear-pago` deployadas en PROD ✅
- GitHub release v1.8.37 como latest ✅

## [2026-05-19] update | fix: ISS-104/132/133/136/138 — Gastos y Caja (v1.8.36-dev)

- Migration 126: `monto_descuento` en `ordenes_compra`
- ISS-132: campo descuento en modal pago de OC (reduce saldo, se acumula en `monto_descuento`)
- ISS-133: métodos de pago en GastosPage se cargan desde tabla `metodos_pago` en vez de hardcodeados; OC agrega Cuenta Corriente automáticamente
- ISS-138: badge "Borrador" en gastos sin `medio_pago` (tabla y historial)
- ISS-136: OC registra `egreso_informativo` en caja para todos los medios no-efectivo; gastos form muestra selector de caja con cualquier medio de pago (no solo efectivo)
- ISS-104: selector de caja en CajaPage — eliminado select box, solo píldoras con botón ★ de predeterminar integrado por caja

## [2026-05-19] update | feat: MODO integración completa — webhook + polling + deploy (v1.8.35-dev)

- EF `modo-webhook` creada: recibe notificaciones de pago MODO, actualiza `ventas.id_pago_externo` e implementa idempotencia con `ventas_externas_logs`
- EF `modo-crear-pago` deployada en DEV (ya existía en repo, no estaba activa)
- VentasPage: polling cada 4s sobre `ventas.id_pago_externo` mientras el QR MODO está visible
- VentasPage: modal QR rediseñado — estado "Esperando..." con dot animado y estado "¡Pago recibido!" con checkmark al detectar confirmación
- Tests ejecutados: webhook 200 ✅, idempotencia ✅, venta actualizada ✅, JWT inválido 401 en crear-pago ✅
- Pendiente: verificar endpoints reales de MODO sandbox cuando lleguen las credenciales de merchant

## [2026-05-19] update | feat: ConfigPage Fases 2-3-4 — config extendida (v1.8.34-dev)

- Migrations 123-125: `tenants` (email_legal, precio_redondeo, cliente_*, descuento_max_*, clave_maestra, boveda_umbral_caja), `sucursales` (codigo_postal, email, horario_apertura/cierre, punto_venta_afip), `metodos_pago` (comision_pct, config)
- Mi negocio: email legal, redondeo de precios, config de sucursales (CP/email/horario/PV AFIP) por sucursal
- Ventas/Métodos: comisión % por método de pago (badge naranja display, editable inline)
- Ventas/Operativa: cliente obligatorio en POS, datos mínimos, consumidor final, creación inline
- Ventas/Descuentos: descuento máximo cajero/supervisor (% configurable)
- Caja: contraseña maestra para cierre de caja ajena + umbral bóveda
- VentasPage: validación descuento máximo por rol al confirmar venta + badge rojo si excede límite

## [2026-05-19] update | refactor: ConfigPage Fase 1 — nueva estructura de módulos (v1.8.33-dev)

- 11 tabs nuevas en lugar de 10 tabs planas: Negocio / Ventas / Caja / Clientes / Inventario / Envíos / Facturación / RRHH / Alertas / Notificaciones / Conectividad
- Sidebar con separadores de grupos (Negocio / Sistema) y badge "pronto" en placeholders
- Ventas absorbe: Métodos de pago (sub-tab), Combos y descuentos (sub-tab), Operativa (sub-tab)
- Inventario absorbe: Reglas de stock (sub-tab nuevo), Categorías, Ubicaciones, Estados, Motivos, Unidades de medida
- Conectividad absorbe: Integraciones, API
- Envíos: costo por km + plantilla WhatsApp (movidos de Mi negocio)
- Facturación: todo el bloque AFIP (movido de Mi negocio)
- Mi negocio queda con: nombre, tipo, timeout sesión, plan actual, marketplace
- Placeholders con "Próximamente": Caja, Clientes, RRHH, Alertas, Notificaciones

## [2026-05-18] update | fix: 6 issues — Recursos, Dashboard Gastos, Inventario, Ventas (v1.8.32-dev)

- ISS-110: migration 122 — `ventas_origen_check` extendida con Instagram/Facebook/WhatsApp/Otros
- ISS-111: migration 102 (`es_recurrente`/frecuencia/proximo_vencimiento) faltaba en DEV, aplicada
- ISS-112: checkbox "Registrar como gasto" en modal recurso activo (activado por default, desactivable)
- ISS-114: botón Agregar en tab Ubicaciones abre modal "Asignar ubicación" correcto (no el de crear recurso)
- ISS-129: pctFijos en DashGastosArea corregido (fijos/total_combinado); link → `/gastos?tab=fijos`; GastosPage lee `?tab=` de URL
- ISS-131: query `productosBusqueda` incluye `estado_id` y `proveedor_id` para respetar defaults del producto

## [2026-05-18] update | PROD deploy v1.8.31 — PR #113, migrations 111–121 aplicadas

- PR #113 `dev → main` mergeado ✅
- Migrations 111–121 + fix_motivos_tipo_constraint aplicadas en PROD ✅
- GitHub release v1.8.31 como latest ✅
- PROD y DEV en paridad completa: v1.8.31 / migrations 001–121

## [2026-05-18] update | v1.8.31 — bump versión + manuales de uso

- APP_VERSION bumpeada a v1.8.31 en brand.ts
- wiki/manuales/ — 3 manuales HTML nuevos (hogar, ferretería, tienda ropa)
- index.md — sección "Manuales" agregada

## [2026-05-18] update | Wiki — actualización completa v1.8.29–v1.8.31

- `productos.md`: página nueva — ProductoFormPage 6 cards, atributos variante, marca, UdM custom, ubicación por sucursal, grupos, inactivos, defaults al ingresar
- `inventario-stock.md`: filtros pill (v1.8.28), defaults producto (v1.8.30), modales inline results (v1.8.31)
- `reportes-metricas.md`: Dashboard nueva estructura de navegación — area tabs + sub-tabs + filtro pill (v1.8.31)
- `multi-sucursal.md`: ubicacion_sucursal (migration 121), filtros OC/Facturación (v1.8.28)
- `migraciones.md`: migrations 118–121, total DEV 122 archivos
- `project_pendientes.md`: DEV v1.8.31, migrations 001–121
- `index.md`: nueva página productos.md, conteos y versiones actualizados

## [2026-05-17] update | feat: grupos de variantes de producto (migration 120, v1.8.30-dev)

Cambios en esta sesión:
- **ProductoGrupoModal**: CRUD completo de grupos con atributos tipo tag-input (Enter/coma), producto cartesiano de combinaciones, generación de variantes automática, lista de variantes existentes con links.
- **ProductosPage**: botón "Grupos" (panel lateral), toggle "Agrupar variantes" (viewMode flat/grouped), vista agrupada con secciones colapsables por grupo + tabla de variantes con badges, badge de grupo en vista flat.
- **ProductoFormPage**: card "Grupo de variantes" — selector de grupo, inputs por atributo (select o text), badges de valores actuales, desvincular, guardado de grupo_id + variante_valores.
- Migration 120: tabla `producto_grupos` + columnas `grupo_id`/`variante_valores` en `productos`.
- DEV: `v1.8.30` | PROD: `v1.8.27`

## [2026-05-17] update | ISS-113/115/119/120/121/122/123/125/126 — atributos producto + UdM + inactivos + variantes (v1.8.29-dev)

Cambios en esta sesión:
- **ISS-115**: campo `marca` en ProductoFormPage (datos básicos, sin required)
- **ISS-119**: campo `shelf_life_dias` visible solo si `tiene_vencimiento` está activo
- **ISS-113/121**: 6 nuevos toggles de variante en Tracking: pais_origen, talle, color, encaje, formato, sabor_aroma
- **ISS-120**: CRUD de unidades de medida personalizadas en ConfigPage (nuevo tab "Unidades") + optgroup en ProductoFormPage
- **ISS-122**: ProductosPage sin filtro activo, toggle "Ver inactivos", badge Inactivo + opacity-60
- **ISS-123**: Bulk bar: botón único toggle Desactivar/Reactivar según mayoría seleccionada
- **ISS-125**: Campos de variante en LpnAccionesModal (tab Editar) e IngresarPage (modal ingreso)
- **ISS-126**: Campos de variante en RecepcionesPage (FormItem + insert inventario_lineas)
- Migrations aplicadas en DEV: 118 (campos producto variantes) + 119 (unidades_medida)
- DEV: `v1.8.29` | PROD: `v1.8.27`

## [2026-05-16] update | Wiki — actualización completa v1.8.28-dev (multi-sucursal + defaults)

Páginas actualizadas:
- `multi-sucursal.md` — sucursal por defecto, backfill 114–117, filtros estrictos, cajas por sucursal
- `caja.md` — cajas.sucursal_id, filtro CajaPage, Caja Principal en seed
- `autenticacion-onboarding.md` — defaults al registrar negocio, fix duplicados tenant, Sucursal 1
- `ventas-pos.md` — filtro historial estricto (eliminado OR IS NULL)
- `reportes-metricas.md` — Dashboard tab Todo filtro por sucursal
- `triggers.md` — trg_seed_tenant_defaults (Sucursal 1 + Caja Principal + motivos + estados)
- `rls-policies.md` — política DELETE en users (migration 113)
- `migraciones.md` — migrations 111–117
- `project_pendientes.md` — DEV v1.8.28, migrations 001–117, PROD pendientes 113–117

## [2026-05-15] update | Wiki — actualización completa v1.8.23 a v1.8.27

Páginas actualizadas:
- `inventario-stock.md` — conteos borrador (ISS-100), rebaje masivo FIFO fix (ISS-012), shortcuts ESC/ENTER
- `ventas-pos.md` — ISS-105 costo envío en validación, ISS-106 historial OR(sucursal/null) + badge CC ghost
- `clientes-proveedores.md` — ISS-107 cancelar deuda CC (DUEÑO/SUPERVISOR)
- `gastos.md` — ISS-044 OC expanded como ticket/recibo
- `autenticacion-onboarding.md` — roles renombrados (DUEÑO/SUPER_USUARIO), fix registro v1.8.27
- `reportes-metricas.md` — Dashboard 9 áreas, SQL Runner (migration 105), aging individual (migration 106)
- `triggers.md` — trg_crear_caja_fuerte SECURITY DEFINER + explicación RLS
- `migraciones.md` — migrations 109 y 110
- `roadmap-apis.md` — MODO payments framework (ISS-072, migration 109)
- `overview.md` — versión v1.8.27, 110 migraciones
- `index.md` — descripciones actualizadas, pie de página

## [2026-05-15] update | PROD deploy v1.8.27 — fix registro nuevo negocio

- Fix crítico: `fn_crear_caja_fuerte` SECURITY DEFINER — trigger bloqueaba RLS al registrar tenant nuevo
- Migration 109 (modo_credentials) y 110 (fix fn) aplicadas en PROD ✅
- PR #112 mergeado a main · GitHub release v1.8.27 ✅

## [2026-05-15] update | v1.8.26 DEV — ISS-072/044 + ISS-100/012/107 + ISS-105/106

- ISS-100: conteos borrador funcionales (continuar, eliminar, actualizar)
- ISS-012: rebaje masivo FIFO/FEFO corregido + preview LPNs + override
- ISS-107: cancelar deuda CC en clientes (DUEÑO/SUPERVISOR)
- ISS-105: costo envío incluido en validación de medios de pago
- ISS-106: historial ventas OR(sucursal, null) + badge ghost CC ventas
- ISS-072: framework MODO (migration 109 + Edge Function + ConfigPage + VentasPage)
- ISS-044: OC expanded view rediseñado como ticket/recibo (font mono, secciones, totales)

## [2026-05-15] update | v1.8.24 DEV — ISS-105/106 fixes

- ISS-105: validación medios de pago usa totalConEnvio; monto_pagado incluye envío
- ISS-106: historial OR(sucursal_id=X, null) para incluir ventas previas al multi-sucursal; badge ghost CC

## [2026-05-15] update | v1.8.23 DEV — ISS-100/012/107 fixes

- ISS-100: conteos borrador — continuar, eliminar y actualizar desde historial
- ISS-012: rebaje masivo FIFO/FEFO corregido — filtro sucursal + ubicacion + preview LPNs + override
- ISS-107: cancelación de deuda CC por venta (solo DUEÑO/SUPERVISOR)

## [2026-05-15] update | PROD deploy v1.8.22 — PR #111 mergeado, migration 108 aplicada

- PR #111 `dev → main` mergeado ✅
- Migration 108 aplicada en PROD (jjffnbrdjchquexdfgwq): sucursales.codigo, ventas.numero_sucursal, tenants.cuotas_bancos, ventas.cuotas_info, ordenes_compra.comprobante_url/titulo
- GitHub release v1.8.22 marcado como latest en main
- Wiki actualizado: caja.md, ventas-pos.md, gastos.md, envios.md, clientes-proveedores.md, migraciones.md, roadmap.md, index.md

## [2026-05-14] update | v1.8.22 DEV — ISS-085/086/090/095/096 batch features

### ISS-085: Número de ticket por sucursal con prefijo
- Migration 108: `sucursales.codigo` + `ventas.numero_sucursal` + trigger actualizado
- SucursalesPage: campo "Código ticket" en formulario
- VentasPage: `formatTicket()` → "S1-0001" cuando hay sucursal, "#N" global

### ISS-086: Cuotas tarjeta de crédito
- Migration 108: `tenants.cuotas_bancos` JSONB + `ventas.cuotas_info` JSONB
- ConfigPage: sección "Cuotas por banco" con add/edit bancos y planes de cuotas
- VentasPage: picker de cuotas al seleccionar "Tarjeta crédito" — banco, cuotas, interés, badge "Sin interés"

### ISS-090: CC como método de pago parcial en ventas
- Elimina toggle "Despachar a cuenta corriente" — CC es opción en medios de pago
- `modoCC` derivado de `mediosPago` (no estado). Pago mixto soportado.
- CC excluida de movimientos de caja; valida cliente y CC habilitada

### ISS-095: OC con CC como método de pago parcial
- Elimina toggle Pago/CC en OC — CC es un método más en `MEDIOS_OC`
- Pago mixto: ej 30% Transferencia + 70% Cuenta Corriente
- Días plazo CC aparecen solo cuando hay CC en medios

### ISS-096: Comprobante de pago en OC
- Migration 108: `ordenes_compra.comprobante_url` + `comprobante_titulo`
- GastosPage: botón adjuntar comprobante en expanded OC (Storage: comprobantes-gastos/oc/)

---

## [2026-05-14] update | v1.8.21 DEV — bugfixes batch ISS-081/082/084/087/088/089/091/092/093/094/097/102/103

### Caja
- ISS-087: ★ visual en caja predeterminada (localStorage pref)
- ISS-088: sugerir apertura usa monto_real_cierre (si > 0) ?? monto_cierre
- ISS-089: selector de caja origen en modal "Ingresar a Caja Fuerte" + validación saldo

### Ventas
- ISS-094: rollback automático de venta CC si falla stock (delete ventas en catch)
- ISS-081: total redondeado a 2 decimales + display maximumFractionDigits: 2
- ISS-082: committedAsignado — "Falta asignar" estático hasta blur/enter
- ISS-091: badge "Stock insuf." en items del carrito (desde lineas_disponibles)
- ISS-092: draft carrito guarda modoCC; restaura clienteCCEnabled desde DB
- ISS-093: tag CC en historial cuando es_cuenta_corriente = true
- ISS-103: selector canal de venta en POS (Presencial default, Instagram, Facebook, WhatsApp, Otros)

### Gastos
- ISS-084: efectivo requiere selección de caja; saldo validation; Caja Fuerte como opción (egreso_traspaso)

### Envíos
- ISS-097: fix crítico — useState en IIFE viola Rules of Hooks → usa domForm existente

### Clientes/Proveedores
- ISS-102: selector sucursal oculto en /clientes y /proveedores; sin applyFilter en query clientes

---

## [2026-05-14] update | v1.8.20 DEV — fix invite-user redirect dinámico

- `invite-user` EF: redirectTo hardcodeado a genesis360.pro → ahora el frontend pasa
  window.location.origin/dashboard (funciona en localhost, DEV y PROD sin tocar whitelists)
- UsuariosPage: extrae mensaje real del body del FunctionsHttpError para toast útil
- GROQ_API_KEY configurada en Supabase PROD secrets ✅
- Deployado invite-user en DEV y PROD

## [2026-05-14] update | PROD deploy v1.8.19 — PR #110 mergeado, migrations 093-107 aplicadas

- PR #110 mergeado dev → main
- Migrations 093-107 aplicadas en PROD (jjffnbrdjchquexdfgwq)
- Edge Functions PROD: invite-user + ai-assistant deployadas
- VITE_GOOGLE_MAPS_API_KEY configurada en Vercel Production
- GROQ_API_KEY: pendiente en Supabase PROD secrets
- Vercel PROD deployment: READY ✅

## [2026-05-14] update | v1.8.19 — SQL Runner + Envíos Google Maps + shortcuts + aging + Dashboard

### SQL Runner (ReportesPage)
- Migration 105: `tenant_sql_query` SECURITY INVOKER, solo SELECT/WITH, 500 filas
- Fix regex: `\b` → `([[:space:]]|$)` (no funciona en PG string literals)
- UI: editor monospace, Ctrl+Enter, tabla dinámica, export Excel/PDF, solo DUEÑO/SUPER_USUARIO

### Aging profiles individual
- Migration 106: `process_aging_profile_single(p_profile_id)`
- Botón "Procesar" por perfil en ConfigPage con spinner independiente

### Shortcuts ESC/ENTER en InventarioPage
- LpnAccionesModal: ESC=cierra, ENTER=guarda según tab activo
- Tab Agregar/Quitar Stock: ENTER=abre modal, ESC=limpia
- Tab Conteos: flujo 3 estados con ENTER, ESC=cancelar

### Envíos — Google Maps + tarifas (migration 107)
- `sucursales.costo_km_envio` + tabla `courier_tarifas`
- SucursalesPage: dirección obligatoria, costo_km_envio, panel couriers inline
- `useGoogleMaps.ts` + `AddressAutocompleteInput` component
- ISS-083: autocomplete Places, KM auto via Distance Matrix, costo = KM × rate
- ISS-098: canal auto desde venta (read-only), costo courier auto desde tarifas
- Tab Cotizador eliminado
- `VITE_GOOGLE_MAPS_API_KEY` configurada en .env.local y Vercel

### Wiki y docs
- index.md, multi-sucursal.md, inventario-stock.md, alertas.md, recursos.md actualizados
- Regla de cierre de sesión (wiki + GitHub releases) grabada en CLAUDE.md y memory

## [2026-05-13] update | Soporte DB: incidente pool saturado + manual de rescate

- Causa: AppLayout tenía query a `ventas_externas_logs.created_at` (columna inexistente, era `procesado_at`) corriendo cada 30s → saturó el pool de 60 conexiones
- Segunda causa: ReportesPage pedía `estados_inventario.es_default` (inexistente en esa tabla)
- Fix: columnas corregidas en el código, restart del proyecto DEV desde dashboard
- Creado: `G360.Wiki/wiki/support/supabase-db-rescue.md` con manual completo de diagnóstico y rescate

## [2026-05-13] update | Kits y Conteos: filtrado por sucursal activa (v1.8.18)

- Kits: `stockKitsSucursal` query suma `inventario_lineas` por sucursal; helper `kStock()` usado en maxKits, display, desarmar y modal armado
- Kits: `iniciarArmado` verifica y reserva solo componentes de la sucursal; `desarmarKit` filtra `lineasKit` por sucursal
- Conteos: `conteoHistorial` aplica `.eq('sucursal_id')` (queryKey ya lo tenía pero no la query); `cargarLineasParaConteo` idem

## [2026-05-13] update | Inventario: stock por sucursal en movimientos + display (fix integral)

- `getStockAntesSucursal` helper reemplaza `productos.stock_actual` global en todos los inserts de `movimientos_stock`
- Corregido en: ingreso, rebaje, masivo inline, conteo, autorizaciones, kitting, des-kitting
- `sucursal_id` agregado en kitting/des-kitting y autorizaciones (faltaba)
- `inventario_lineas` INSERT del masivo inline ahora incluye `sucursal_id`
- Display "Stock en sucursal: X" en formularios Agregar Stock y Quitar Stock cuando hay sucursal activa
- Query reactiva `stockEnSucursal` con `staleTime: 0`

## [2026-05-13] update | Recursos: tab Ubicaciones + recurrencia + GastosPage renovaciones

- Migration 102: columnas `es_recurrente`, `frecuencia_valor`, `frecuencia_unidad`, `proximo_vencimiento` en `recursos`
- RecursosPage: tab "Ubicaciones" con agrupación por ubicación e inline edit; lógica recurrente en modal (checkbox + frecuencia + fecha próxima calculable); badge visual en cards
- GastosPage tab Recursos: sección "Renovaciones pendientes" con recursos recurrentes vencidos o próximos (≤7 días) + botón "Registrar compra" que crea gasto y avanza la fecha
- LpnAccionesModal: sucursal_id en tab Editar (sesión anterior)

## [2026-05-13] update | v1.8.16 DEV — cierre sesión completo

Renombrado OWNER→DUEÑO (migration 100): constraint, data, RLS, is_rrhh(), caja_fuerte_roles, 21 archivos frontend.
Sucursales (migration 101): selector header limitado a 4 rutas solo para Dueño.
ubicaciones/combos filtran por sucursal. Ingreso bloqueado sin sucursal.
LPN traslado: cantMover default 1 → botón habilitado.
Deploy PROD pendiente con migrations 093-101.

---

## [2026-05-13] update | v1.8.14 DEV — cierre sesión + docs actualizados

Dashboard General completo (9 áreas: Ventas/Gastos/Productos/Inventario/Clientes/Proveedores/Facturación/Envíos/Marketing).
Fixes: DashInventarioArea Treemap→barras custom (recharts v3 bug), DashProductosArea devolucion_items query + periodo default.
Gotchas documentados: recharts v3 Treemap crash, Supabase JS !inner filter.
Pendientes: deploy PROD v1.8.14 (migrations 093-099, EFs, GROQ_API_KEY, GitHub release).

---

## [2026-05-12] update | v1.8.12 DEV — Dashboard General: área Inventario

- feat: DashInventarioArea.tsx — área Inventario & Recursos completa:
  - Toggle vista: Todo / Solo Mercadería / Solo Recursos
  - 8 KPIs: Capital de Trabajo, Patrimonio Operativo, Rotación, Runway, Kits posibles, Recursos en reparación, Reservas, Mermas
  - Gráfico 1: Dona Patrimonio (Mercadería turquesa/recursos violeta)
  - Gráfico 2: Gauge SVG semicircular "Salud del Depósito" (4 zonas crítico→óptimo)
  - Gráfico 3: Barras envejecimiento del capital (0-30/31-90/+90 días)
  - Gráfico 4: Barras apiladas horizontales "Recursos por categoría" (activo/en_reparacion/dado_de_baja)
  - Gráfico 5: Treemap "Cuello de Botella de Combos" (kits bloqueados sin componentes)
  - Insights: recursos en reparación, capital dormido +90 días, combos bloqueados, runway corto, stock crítico, mermas

---

## [2026-05-12] update | v1.8.11 DEV — Dashboard General: área Productos

- feat: DashProductosArea.tsx — área Productos completa:
  - 6 KPIs en 2×3: Margen Global, El Motor, La Mina de Oro, Capital Dormido, Tasa Devolución, Quiebre de Stock
  - Filtros: período + categoría + slider margen mín + ciclo de vida (Estrella/Perro/Nicho)
  - Gráfico 1: Scatter "Cuadrante Mágico" (cantidad vs margen) — 4 cuadrantes con colores verde/azul/amarillo/rojo
  - Gráfico 2: Pareto "Concentración de Ingresos" — barras + línea acumulada + referenceLine al 80%
  - Gráfico 3: Pie "Participación por Categoría"
  - Gráfico 4: "La Tijera de Precios" — doble línea (precio prom morado vs costo prom rojo) últimos 6 meses
  - Insights: margen bajo, producto con costo > precio, capital dormido, quiebre de stock, concentración Pareto, devoluciones, mina de oro oculta
- feat: sub-nav Dashboard General agrega área "Productos" (entre Gastos e Inventario)

---

## [2026-05-12] update | v1.8.10 DEV — Dashboard General: área Gastos

- feat: DashGastosArea.tsx — área Gastos completa:
  - Filtros propios en popover (período Mes/Trimestre/Año/Custom, ARS/USD, Categoría)
  - KPI 1: Total Salidas — badge invertido (subir=rojo, bajar=verde)
  - KPI 2: Velocidad de Gasto / Burn Rate ($X/día)
  - KPI 3: Peso de la Estructura (Ratio Gastos/Ventas %) con alerta >80%
  - KPI 4: Rigidez del Gasto — % fijos vs variables con barra bicolor (usa gastos_fijos)
  - Gráfico 1: Pie por categoría — colores bien diferenciados + leyenda inline
  - Gráfico 2: Barras mensuales últimos 6 meses + línea referencia (promedio) punteada accent; barras rojas si >15% del promedio
  - Gráfico 3: Top 5 destinos de gasto — barras horizontales por descripción
  - Insights: tendencia, cuotas vencidas, por vencer, sin comprobante, anomalía por categoría, ratio crítico, gastos fijos altos

---

## [2026-05-12] update | v1.8.9 DEV — Dashboard General: sub-nav áreas + área Ventas

- feat: DashboardPage — sub-navegación de área en pestaña General (Todo/Ventas/Gastos/Inventario/Clientes/Proveedores/Facturación/Envíos)
- feat: tab "Gráficos" agregado (placeholder "Próximamente")
- feat: DashVentasArea.tsx — área Ventas completa:
  - Filtros propios en popover (período Hoy/7D/15D/30D/Mes/Año/Custom, ARS/USD, c/IVA/s/IVA, Canal)
  - KPI 1: Total Vendido con badge vs período anterior
  - KPI 2: Gasto promedio por cliente
  - KPI 3: Efectividad de presupuestos (% conversión)
  - KPI 4: Clientes Nuevos vs Frecuentes (mini progress bar bicolor)
  - Gráfico 1: "El Camino de la Venta" — funnel horizontal 3 etapas (Presupuestado/Pendiente/Pagado)
  - Gráfico 2: "Tus mejores momentos" — heatmap días×horas con accent color opacity
  - Gráfico 3: "¿Por dónde compran?" — pie chart canales con recharts + leyenda inline
  - Insights automáticos: tendencia, pendiente cobro, efectividad, fidelidad, canal dominante, peak hours

---

## [2026-05-12] update | v1.8.8 DEV — fix multi-sucursal inventario

- fix: inventario_lineas INSERT en ingresoMutation omitía sucursal_id → LPNs quedaban sin sucursal → filtrar por sucursal mostraba 0 unidades
- fix: LpnAccionesModal selector sucursal — sucursalDestino con null en vez de '' para evitar confusión visual del browser; opción "Sin sucursal asignada" explícita; sucursalFinal usa ?? en vez de ||
- feat: selector de sucursal en form de ingreso para OWNER en vista global (resaltado en ámbar)

---

## [2026-05-12] update | v1.8.7 DEV — aprobación caja fuerte real + envíos + IA

- fix bug crítico: solicitudes CAJERO→CajaFuerte siempre fallaban (tipo inválido, sin user_id). Ahora notifica a OWNER/SUPER_USUARIO/SUPERVISOR con metadata JSONB.
- NotificacionesButton: botones Aprobar/Rechazar para `solicitud_caja_fuerte` — Aprobar ejecuta egreso+ingreso reales.
- EnviosPage: selector "Nuevo envío" excluye ventas que ya tienen envío asignado.
- ai-assistant: system prompt reescrito con 20 módulos en orden sidebar + botones exactos + roles actualizados.
- Migration 099: `notificaciones.metadata JSONB`.

---

## [2026-05-08] update | v1.8.6 DEV — bump versión + cierre sesión

Bump v1.8.6. Migrations DEV: 093–098. Todo pusheado, pendiente deploy a PROD.
Rol ADMIN renombrado a SUPER_USUARIO. EF invite-user y cancel-suscripcion deployados en DEV.
Ventas: panel envío completo (monto/$km/Maps). Gastos: tab Recursos + cuotas tarjeta.
Recursos: tabs renombrados + flujo gasto automático. Recepciones: bug detalle expandido fix.

---

## [2026-05-08] update | v1.8.5 DEV — mejoras Caja/Inventario/Envíos/Ventas/Recepciones

### Caja
- Historial excluye caja fuerte; historial propio en tab Caja Fuerte (ingresos + egresos)
- "Ingresar a Caja Fuerte": sin restricción de sesión activa para OWNER/SUPER
- "Enviar a Caja": selector de caja destino (antes fijado en la caja activa)
- CAJERO: botón "Caja Fuerte" → genera solicitud (notificación) para OWNER/SUPERVISOR

### Inventario
- Conteos: muestra usuario en historial
- Bulk actions en LPNs: barra desde 1 LPN con "Cambiar estado" y "Cambiar ubicación"; cross-producto habilitado

### Envíos
- Toggle Propio/Tercero; si propio: KM + precio/km → auto-calcula costo

### Ventas
- Toggle "Requiere envío" en POS → auto-crea envío 'pendiente' al confirmar

### Recepciones (bug fixes anteriores)
- Fix detalle expandido: carga recepcion_items lazy con tabla Esperado/Recibido/Diferencia
- Validaciones de atributos (lote, vencimiento, series) antes de confirmar; auto-expande ítem con error
- Modal de resultado post-confirmación con comparativa vs OC
- Botones "Crear OC derivada" y "Solicitar reembolso" para diferencias
- Sucursal predeterminada sincronizada con header

---

## [2026-05-08] update | v1.8.5 DEV — fixes y docs

- fix: rol ADMIN faltaba en mapa local de UsuariosPage — no aparecía en invitar ni cambiar rol
- docs: app-reference.md — revisión completa (Estructuras correcto, Inventario 7 tabs, tabla Kit/Combo/Estructura)

---

## [2026-05-08] update | Permisos de sucursal por usuario (migration 094)

- Migration 094: `users.sucursal_id` + `users.puede_ver_todas`; OWNER/ADMIN/SUPERVISOR/CONTADOR init en true
- authStore: `puedeVerTodas` en estado; usuarios restringidos quedan bloqueados a su sucursal (ignorar localStorage)
- AppLayout: selector visible solo para `puedeVerTodas`; usuarios restringidos ven nombre fijo o badge "Sin sucursal"
- UsuariosPage: toggle Globe + selector sucursal inline por usuario; `updateRol` auto-actualiza `puede_ver_todas`
- VentasPage/GastosPage (OC)/CajaPage: filtros multi-sucursal completados (migration 093 para `ordenes_compra.sucursal_id`)

---

## [2026-05-08] update | Multi-sucursal filtro — RecepcionesPage + ProductosPage

- RecepcionesPage: `useSucursalFilter` + `applyFilter` en query listado + `sucursalId` en queryKey
- ProductosPage: `useSucursalFilter` + `applyFilter` en query `inventario_lineas` (stock crítico badge) + `sucursalId` en queryKey
- EnviosPage y RecursosPage ya tenían el filtro correctamente implementado
- Todos los módulos operativos ahora filtran por sucursal ✅

---

## [2026-05-08] update | Cierre sesión — docs actualizados para mañana

**Estado al cierre:**
- PROD: v1.8.3 ✅ · DEV: v1.8.4 · Migrations: DEV 001–092 / PROD 001–092
- Asistente IA deployado en DEV, GROQ_API_KEY configurada en DEV ✅
- Pendiente para mañana: (1) deploy v1.8.4 a PROD + GROQ_API_KEY en PROD, (2) mejora system prompt asistente, (3) expandir filtro sucursal a RecepcionesPage, EnviosPage, RecursosPage, ProductosPage stock crítico

---

## [2026-05-08] update | v1.8.4 DEV — Asistente IA en header (Groq/Llama 3.1)

- EF `ai-assistant`: Groq API (llama-3.1-8b-instant), auth JWT, system prompt con todos los módulos G360
- `AiAssistant.tsx`: panel chat flotante en header. Acciones rápidas, flujo bug report guiado, botón "Enviar reporte" (aparece tras 4+ mensajes)
- `send-email`: template `bug_report` — envía conversación formateada a gaston.otranto@gmail.com
- Secret `GROQ_API_KEY` configurado en DEV ✅ (pendiente configurar en PROD al deployar)
- Free tier Groq: 14.400 req/día — sin costo

---

## [2026-05-07] update | Plan Roadmap APIs — documentado, pausado

Relevamiento completo de integraciones API actuales y plan de 6 fases para killer features.
Ver: `wiki/integrations/roadmap-apis.md`

**Resumen estado actual:**
- ✅ TiendaNube, MercadoLibre, MercadoPago, Resend, Data-API implementados (básico)
- ⚠️ AFIP parcial (schema listo, worker facturación pendiente)
- ❌ Logística directa, PagoNube, EnvíoNube, Ads (Meta/Google/MELI), WhatsApp, Email marketing

**Plan fases priorizadas (implementación futura a confirmar):**
- Fase 1: MELI rentabilidad neta + MP conciliación + TN BOM + AFIP CUIT + repricing
- Fase 2: PagoNube + EnvíoNube (para operaciones propias y checkout TN)
- Fase 3: Logística directa (Andreani/OCA) + rate shopping + RMA
- Fase 4: MELI Ads (auto-pausado por margen)
- Fase 5: Meta Ads + POAS + GA4 (posicionamiento futuro)
- Fase 6: WhatsApp Cloud API (espera WABA) + Brevo/Klaviyo RFM

---

## [2026-05-07] update | Deploy v1.8.3 a PROD — Precios mayoristas + mass update

- Migration 092 (`producto_precios_mayorista`) aplicada en PROD ✅
- PR #107 mergeado `dev → main` ✅
- GitHub release v1.8.3 ✅
- Migrations PROD: 001–092 ✅

### Features
- **Precios mayoristas**: tabla `producto_precios_mayorista`, toggle + tiers en ProductoFormPage
- **Mass update productos**: +Proveedor, +Precio (% o fijo), +Reactivar en barra bulk

---

## [2026-05-07] update | Deploy v1.8.2 a PROD

- Migrations 090+091 aplicadas en PROD ✅
- PR #106 mergeado `dev → main` ✅
- GitHub release v1.8.2 creado ✅
- Migrations PROD: 001–091 ✅
- pg_cron `notif-cc-vencidas` activo en PROD (09:00 AR diario) ✅

---

## [2026-05-07] update | v1.8.2 DEV — OC→Gasto automático + notif CC vencidas

**Cambios:**

### OC → Gasto automático (migration 090)
- `gastos.recepcion_id` (UUID nullable FK a `recepciones`) para trazabilidad
- `RecepcionesPage`: al confirmar recepción vinculada a OC, crea `gasto` con monto calculado desde ítems recibidos × precio_costo, categoría "Compras", notas con número de recepción
- Dedup natural: cada confirmación crea una recepción nueva → un gasto nuevo

### Notificaciones CC vencidas (migration 091)
- `fn_notificar_cc_vencidas()`: SECURITY DEFINER, notifica OWNER+ADMIN por tenant
  - CC clientes: ventas CC con saldo > 0 y vencidas (created_at + plazo_pago_dias < hoy)
  - OC vencidas: `fecha_vencimiento_pago < hoy AND estado_pago != 'pagada'`
  - Dedup por día: no genera duplicados si ya existe notificación del mismo día para el mismo objeto
- pg_cron `notif-cc-vencidas`: corre a las 12:00 UTC (09:00 AR) todos los días

**Estado al cierre:**
- PROD: v1.8.1 ✅ · DEV: v1.8.2 · Migrations DEV: 001–091 · PROD: 001–089

---

## [2026-05-07] update | Deploy v1.8.1 a PROD

- Migration 089 (`recursos`) aplicada en PROD ✅
- PR #105 mergeado `dev → main` ✅
- GitHub release v1.8.1 creado ✅
- Migrations PROD: 001–089 ✅

---

## [2026-05-07] update | Multi-sucursal: filtrado estricto implementado

**Cambios:**
- `useSucursalFilter.applyFilter`: `.or(eq+null)` → `.eq('sucursal_id', sucursalId)` estricto
- `authStore.setSucursal(null)`: guarda sentinel `'__global__'` en localStorage para distinguir "nunca configurado" de "vista global explícita"
- `AppLayout` auto-select: no sobreescribe preferencia `'__global__'` guardada
- `SucursalSelector`: nueva opción "Todas las sucursales" al inicio del select

**Comportamiento:**
- Sucursal activa → solo datos de esa sucursal (datos NULL históricos no se mezclan)
- Vista global → todo visible (incluye NULL)
- La preferencia persiste entre sesiones

---

## [2026-05-07] update | v1.8.1 — Recursos, estructuras ingreso, fixes, plan multi-sucursal

**Producido en esta sesión:**

### Features
- **Módulo Recursos** (migration 089): `RecursosPage` + tabla `recursos`. Patrimonio del negocio (no para vender). 2 tabs: Patrimonio / Por adquirir. Stats, alertas garantía, CTA proveedores.
- **Estructura en ingreso**: InventarioPage (modal ingreso) + RecepcionesPage (por ítem) — select de estructura que precarga la default del producto y guarda `estructura_id` en `inventario_lineas`.

### Fixes
- Banner DEV más fino (h-4) y sin overlap sobre header/sidebar.
- Badge estado_pago en cards de OC en ProveedoresPage.
- WhatsApp en EnviosPage: faltaba `telefono` en join de clientes.

### Housekeeping
- CLAUDE.md: reducido a ~120 líneas. Reglas de lectura/escritura wiki.
- Wiki: roadmap con v1.7.0, v1.8.0, v1.8.1. Plan multi-sucursal documentado.

### Plan aprobado — Multi-sucursal (pendiente implementar)
- Filtrado estricto: `.eq()` cuando sucursal activa, sin filtro para vista global.
- Agregar "Vista global" al SucursalSelector.
- Catálogo global, stock/movimientos/ventas/gastos/caja por sucursal, clientes globales.
- Datos NULL: solo visibles en vista global.
- Ver detalle en `wiki/features/multi-sucursal.md`.

**Estado al cierre:**
- PROD: v1.8.0 ✅ · DEV: v1.8.1 · Migrations DEV: 001–089 · PROD: 001–088
- Migration 089 (`recursos`): aplicar en PROD al deployar v1.8.1

---

## [2026-05-07] update | Limpieza CLAUDE.md + reglas wiki + roadmap v1.7.0/v1.8.0

**Cambios de sesión (2026-05-07):**

### CLAUDE.md — reescritura completa
- Reducido de ~1.500 líneas a ~120 líneas
- Eliminado: todo el historial de versiones (v0.26–v1.8.0), todas las secciones "Backlog pendiente" y "Decisiones de arquitectura" — ya están en el wiki
- Conservado: stack, git/deploy, Supabase IDs, estructura de proyecto, convenciones operacionales, planes, env vars, dominios, gotchas clave
- Agregado: sección "Wiki — Reglas de oro" con instrucciones de lectura al inicio y escritura al cierre de sesión. Unicidad de documentación en el wiki.

### Wiki roadmap.md actualizado
- Agregadas secciones v1.7.0 (API pull, migration 087) y v1.8.0 (NC electrónicas, email CAE, migration 088)
- Backlog actualizado: removidos ítems ya completados, agregados pendientes reales actuales
- Historial comprimido en tabla para versiones <v1.3.0

### Estado al cierre
- PROD: **v1.8.0** ✅ · DEV: **v1.8.0** ✅ (confirmado — era caché del browser)
- `main` branch: APP_VERSION = v1.6.0 (pero Vercel sirvió v1.8.0 correctamente)
- `dev` branch (código): **v1.8.0**

---

## [2026-05-06] update | Migración al SSD + consolidación docs — todo listo para compact

**Cambios de sesión (2026-05-06):**

### Migración de paths
- App movida: `E:\OneDrive\...\stockapp` → `D:\Dev\Genesis360` (SSD, fuera de OneDrive)
- Vault movido: `D:\Obsidian\boveda\Genesis360` → `D:\Dev\Genesis360\G360.Wiki` (dentro del repo)
- `npm install` ejecutado en nueva ubicación — build OK (`✓ built in 30.21s`)

### Consolidación de documentación
- `docs/` eliminado de la app — 8 archivos movidos a `G360.Wiki/sources/raw/`
- `G360.Wiki/CLAUDE.md` renombrado a `_schema.md` — evita confusión con CLAUDE.md de la app
- `Bienvenido.md` actualizado con nueva estructura y referencias
- `G360.Wiki/` commiteada en git (rama `dev`, commit `94b09930`)

### Paths actualizados
- `_schema.md`: código fuente apunta a `D:\Dev\Genesis360`
- Memory files: `project_genesis360.md` y `project_wiki_system.md` actualizados con nuevos paths y v1.6.0
- `index.md`: fuentes en raw/ documentadas

### Estado de cierre de sesión
- Versión PROD: v1.6.0 · 85 migraciones · 46 páginas wiki
- Sin pendientes en el wiki
- Listo para /clear o /compact

---

## [2026-05-06] update | Reestructura del vault — consolidación de fuentes

**Cambios estructurales:**
- `CLAUDE.md` renombrado a `_schema.md` — evita confusión con el CLAUDE.md de la app
- `Bienvenido.md` y `_schema.md` actualizados para reflejar el nuevo nombre y aclarar la diferencia
- `sources/raw/` poblado con los 8 archivos de `D:\Dev\Genesis360\docs/`:
  - `arquitectura_escalabilidad.md`
  - `reglas_negocio.md`
  - `uat.md`
  - `genesis360_overview.html`, `soporte_*.html` (×4)
- `index.md` actualizado con la tabla de fuentes
- `D:\Dev\Genesis360\docs/` se mantiene en la app (fuente original, no se borró)

**Regla de flujo confirmada:**
- Desarrollo → actualizar `CLAUDE.md` / `ROADMAP.md` en `D:\Dev\Genesis360\`
- Al terminar sesión → pedir "actualizá el wiki" → Claude sincroniza las páginas relevantes
- Consulta → abrir Obsidian en `G360.Wiki/`

Para ver las últimas 5 entradas: `grep "^## \[" log.md | tail -5`

---

## [2026-05-05] update | v1.5.0 + v1.6.0 — Notificaciones, Caja Fuerte, PDF AFIP, OC pagos, CC Proveedores

**Versiones detectadas como nuevas:** v1.5.0 (migration 084) y v1.6.0 (migration 085).  
**Fuentes leídas:** CLAUDE.md (líneas 1395-1441) + ROADMAP.md (encabezado + secciones v1.5.0/v1.6.0).

**Páginas actualizadas:**
- `wiki/features/facturacion-afip.md` — recreada (estaba en 0 bytes) + PDF con QR AFIP v1.5.0 ✅
- `wiki/features/caja.md` — diferencia apertura inline, Tab Caja Fuerte, Tab Configuración, getTipoDisplay, historial sesiones
- `wiki/features/alertas.md` — nuevas secciones OC vencidas (rojo) y próximas ≤3d (ámbar), badge actualizado
- `wiki/features/gastos.md` — Tab "Órdenes de Compra" con modal pago/CC, badges contextuales
- `wiki/features/clientes-proveedores.md` — pago CC inline FIFO + módulo CC Proveedores completo
- `wiki/business/roadmap.md` — v1.5.0 + v1.6.0 completos, versión actualizada a v1.6.0
- `wiki/database/migraciones.md` — migrations 084 + 085
- `wiki/overview/genesis360-overview.md` — v1.4.0 → v1.6.0, 83 → 85 migraciones, notificaciones en módulos

**Páginas nuevas:**
- `wiki/features/notificaciones.md` — módulo completamente nuevo: tabla, campana, email, diferencia caja

**Estado final:** 46 páginas · 85 migraciones documentadas · v1.6.0

---

## [2026-05-01] update | Wiki completo — sin pendientes

**Acción:** Finalización completa del wiki. Todas las páginas actualizadas, 6 páginas nuevas desde docs/.

**Páginas actualizadas (thin → completas):**
- `wiki/features/ventas-pos.md` — 3 modos, pago parcial, combos, CC, multi-LPN, scanner, carrito draft, QR MP
- `wiki/features/inventario-stock.md` — Sprints A/B/C/D, autorizaciones DEPOSITO, conteos, masivo inline, LPN madre
- `wiki/integrations/mercado-pago.md` — preapproval model, QR ventas, add-on, routing webhook, IDs PROD
- `wiki/overview/genesis360-overview.md` — v1.4.0, tabla módulos completa, arquitectura actualizada

**Páginas nuevas desde docs/:**
- `wiki/architecture/escalabilidad.md` — costos, capacidad escala, cola jobs, workers, Sentry, cloud
- `wiki/architecture/pwa-config.md` — Service Worker, WASM, SPA routing Vercel
- `wiki/development/reglas-negocio.md` — reglas relevadas con GO (caja, ventas, inventario) + UAT
- `wiki/business/mercado-objetivo.md` — SMB/mid-market LatAm, posicionamiento vs Blue Yonder
- `wiki/business/roadmap.md` — ya existía, sin cambios
- `wiki/integrations/resend-email.md` — ya existía, sin cambios

**Fuentes procesadas en total:**
- CLAUDE.md (1.461 líneas)
- ROADMAP.md (490 líneas)
- WORKFLOW.md (172 líneas)
- README.md (150 líneas)
- docs/arquitectura_escalabilidad.md (163 líneas)
- docs/reglas_negocio.md (335 líneas)
- docs/uat.md (196 líneas)

**Estado final:** 44 páginas wiki · 83 migraciones documentadas · v1.4.0 · sin pendientes

---

## [2026-05-01] update | Poblado completo desde CLAUDE.md + ROADMAP.md + WORKFLOW.md

**Acción:** Lectura completa de los 4 archivos de documentación de la app (1461 líneas CLAUDE.md, 490 ROADMAP.md, 172 WORKFLOW.md, 150 README.md) y creación masiva de páginas wiki.

**Páginas creadas/actualizadas:**
- `wiki/integrations/mercado-libre.md` — OAuth, mapeo, webhooks, sync worker, items OMNI
- `wiki/integrations/tienda-nube.md` — OAuth, webhooks, tn-stock-worker, BATCH_SIZE 200
- `wiki/features/facturacion-afip.md` — AfipSDK, tipos A/B/C, FacturacionPage 4 tabs, homologación confirmada
- `wiki/features/rrhh.md` — 5 fases completas con schema, funciones SQL, UI
- `wiki/features/caja.md` — sesiones, tipos de movimiento, multi-caja, traspasos, arqueos
- `wiki/features/gastos.md` — variables, fijos, IVA, comprobantes, múltiples medios
- `wiki/features/devoluciones.md` — serializado/no-serializado, NC, rollback, caja
- `wiki/features/wms.md` — fases 1-4, KITs, conteos, recepciones/ASN, mono-SKU
- `wiki/features/clientes-proveedores.md` — CRM, CC, domicilios, OC, servicios
- `wiki/features/envios.md` — estados, remito PDF, WhatsApp Click-to-Chat
- `wiki/features/autenticacion-onboarding.md` — OAuth, roles, session timeout, Mi Cuenta
- `wiki/features/marketplace.md` — API pública, webhook, rate limiting
- `wiki/architecture/estado-global.md` — authStore, useSucursalFilter, usePlanLimits, hooks
- `wiki/database/migraciones.md` — 83 migraciones con descripción (001-083)
- `wiki/development/testing.md` — 154+ unit tests, 14 archivos E2E, todos los roles
- `wiki/development/convenciones-codigo.md` — reglas, patterns, TypeScript, RLS
- `wiki/development/supabase-dev-vs-prod.md` — flujo completo, secrets, pg_cron
- `wiki/business/roadmap.md` — historial v0.26–v1.4.0, backlog detallado
- `index.md` — actualizado con todas las páginas y estados

**Estado del proyecto confirmado:** v1.4.0 en PROD · 83 migraciones · 154+ unit tests

---

## [2026-04-30] init | Wiki inicializado desde exploración del código fuente

**Acción:** Inicialización completa del wiki Genesis360.

**Qué se hizo:**
- Exploración del código fuente en `E:\OneDrive\Documentos\01_Gastón\04_Emprendimientos\04_StockApp\stockapp\stockapp`
- Creación de `CLAUDE.md` (schema y reglas del wiki)
- Creación de `index.md` (catálogo inicial de páginas)
- Creación de estructura de carpetas: `sources/`, `wiki/` y subcarpetas
- Creación de página de overview principal
- Creación de páginas de arquitectura, features y development

**Estado del proyecto al momento de la inicialización:**
- Versión activa en producción
- 83 migraciones de DB
- 26 Edge Functions
- ~80 archivos TypeScript/TSX
- Planes: Free / Basic ($4.900 ARS) / Pro ($9.900 ARS) / Enterprise

**Páginas creadas en este init:**
- `wiki/overview/genesis360-overview.md`
- `wiki/architecture/frontend-stack.md`
- `wiki/architecture/backend-supabase.md`
- `wiki/architecture/multi-tenant-rls.md`
- `wiki/architecture/edge-functions.md`
- `wiki/features/inventario-stock.md`
- `wiki/features/ventas-pos.md`
- `wiki/features/suscripciones-planes.md`
- `wiki/development/workflow-git.md`
- `wiki/development/deploy.md`
- `wiki/database/schema-overview.md`
- `wiki/integrations/mercado-pago.md`
