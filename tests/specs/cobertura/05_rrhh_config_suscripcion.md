# Cobertura — RRHH · Configuración · Suscripción/Plan · Roles/Permisos · Modo (básico/avanzado)

> Auditoría de cobertura (F1 de `uat-cobertura.plan.md`). 100% lectura. Enumera las lógicas del grupo,
> el comportamiento esperado CON/SIN cada flag, el mapa de ConfigPage tab→flags, y los gaps priorizados.
> Convención de cobertura: `✅e2e(NN)` · `✅unit(archivo)` · `✅UAT(§)` · `🟡parcial` · `🔴gap`.
> REGLA #0 = plata/stock/fiscal (cero errores tolerados).

Archivos núcleo leídos: `src/pages/RrhhPage.tsx` (4840 ln), `src/pages/ConfigPage.tsx` (6112 ln),
`src/pages/SuscripcionPage.tsx` (372 ln), `src/lib/rrhh*.ts`, `src/lib/liquidacionFinal.ts`,
`src/lib/navVisibility.ts`, `src/lib/permisosModulo.ts`, `src/lib/modoOperacion.ts`,
`src/hooks/usePlanLimits.ts`, `src/hooks/useInactivityTimeout.ts`, `src/components/AuthGuard.tsx`,
`src/App.tsx`.

---

## 1) Tabla de Lógicas

| # | Lógica | file:función | ¿REGLA #0? | Cobertura |
|---|--------|--------------|:---:|-----------|
| **RRHH — cálculo de nómina** | | | | |
| L01 | Monto de concepto (fijo / %/ sobre_bruto) | `rrhhNomina.ts:montoConcepto` | 💰 | ✅unit(rrhhNomina) |
| L02 | Monto de beneficio extra ($/%) | `rrhhNomina.ts:montoBeneficio` | 💰 | ✅unit(rrhhNomina) |
| L03 | Armar ítems de liquidación (básico+beneficios+aportes activos→haberes/desc/neto) | `rrhhNomina.ts:calcularItemsNomina` | 💰 | ✅unit(rrhhNomina) |
| L04 | Mejor sueldo del semestre (LCT) | `rrhhNomina.ts:mejorSueldoSemestre` | 💰 | ✅unit(rrhhNomina) |
| L05 | SAC = 50% mejor sueldo, prorrateado meses | `rrhhNomina.ts:sacMejorSueldo` | 💰 | ✅unit(rrhhNomina) |
| L06 | Prorrateo del básico por frecuencia (mensual/quincenal/semanal/X días) | `rrhhLiquidacion.ts:factorProrrateo`/`basicoProrrateado` | 💰 | ✅unit(rrhhLiquidacion) |
| L07 | Anticipos: total + cuánto descontar sin neto negativo | `rrhhLiquidacion.ts:totalAnticipos`/`anticiposADescontar` | 💰 | ✅unit(rrhhLiquidacion) |
| **RRHH — asistencia/tardanza/extras** | | | | |
| L08 | Sueldo por hora (bruto / horas base) | `rrhhAsistencia.ts:sueldoHora` | 💰 | ✅unit(rrhhAsistencia) |
| L09 | Descuento por tardanza (registrar/proporcional/umbral) | `rrhhAsistencia.ts:descuentoTardanza` | 💰 | ✅unit(rrhhAsistencia) |
| L10 | Minutos tarde facturables del período (primera fichada/día vs horario) | `rrhhAsistencia.ts:minutosTardeFacturables` | 💰 | ✅unit(rrhhAsistencia) |
| L11 | Monto de horas extra (h × $/h × (1+mult%)) | `rrhhAsistencia.ts:montoHorasExtra` | 💰 | ✅unit(rrhhAsistencia) |
| L12 | Monto de feriado trabajado (simple/doble/triple) | `rrhhAsistencia.ts:montoFeriadoTrabajado` | 💰 | ✅unit(rrhhAsistencia) |
| **RRHH — vacaciones** | | | | |
| L13 | Días por antigüedad LCT (14/21/28/35) | `rrhhVacaciones.ts:diasVacacionesLCT` | | ✅unit(rrhhVacaciones) |
| L14 | Antigüedad en años | `rrhhVacaciones.ts:antiguedadAnios` | | ✅unit(rrhhVacaciones) |
| L15 | Remanente que se arrastra (con tope) | `rrhhVacaciones.ts:remanenteSiguiente` | | ✅unit(rrhhVacaciones) |
| L16 | Solapamiento de períodos aprobados | `rrhhVacaciones.ts:rangosSolapan`/`solapamientos` | | ✅unit(rrhhVacaciones) |
| L17 | Evaluar plazo de aviso (sin/alerta/fijo) | `rrhhVacaciones.ts:evaluarAviso` | | ✅unit(rrhhVacaciones) |
| L18 | Validar partición (mín. bloque / máx. bloques) | `rrhhVacaciones.ts:validarParticion` | | ✅unit(rrhhVacaciones) |
| **RRHH — liquidación final (LCT)** | | | | |
| L19 | Indemnización antigüedad (art. 245) | `liquidacionFinal.ts:indemnizacionAntiguedad` | 💰 | ✅unit(liquidacionFinal) |
| L20 | SAC proporcional al egreso | `liquidacionFinal.ts:sacProporcionalEgreso` | 💰 | ✅unit(liquidacionFinal) |
| L21 | Vacaciones no gozadas (sueldo/25 × días) | `liquidacionFinal.ts:vacacionesNoGozadas` | 💰 | ✅unit(liquidacionFinal) |
| L22 | Liquidación final completa (con/sin indemnización) | `liquidacionFinal.ts:liquidacionFinal`/`generaIndemnizacion` | 💰 | ✅unit(liquidacionFinal) |
| **RRHH — documentos / reportes** | | | | |
| L23 | Documentos obligatorios faltantes | `rrhhDocumentos.ts:documentosFaltantes` | | ✅unit(rrhhDocumentos) |
| L24 | Documentos por vencer (umbral días) | `rrhhDocumentos.ts:documentosPorVencer` | | ✅unit(rrhhDocumentos) |
| L25 | Reportes G1 (costo×depto, asistencia, vacaciones, antigüedad, recibos) | `rrhhReportes.ts` (5 fns) | | ✅unit(rrhhReportes) |
| **RRHH — efectos I/O (mutaciones en RrhhPage)** | | | | |
| L26 | Crear liquidación (prorrateo + aportes + **tardanza descontada**) | `RrhhPage.tsx:crearLiquidacion` (869) | 💰 | 🔴gap (I/O; las piezas puras ✅unit) |
| L27 | Generar nómina del mes (liquidaciones faltantes de activos) | `RrhhPage.tsx:generarNominaMes` (961) | 💰 | 🟡e2e 37 (genera+gasto, no neto) |
| L28 | Generar gasto de nómina → Gastos (pendiente, deduce ganancias) | `RrhhPage.tsx:generarGastoNomina` (1035) | 💰 | ✅e2e 37 |
| L29 | Generar cargas sociales → Gastos por concepto | `RrhhPage.tsx:generarCargasSociales` (1063) | 💰 | 🔴gap |
| L30 | **Pagar nómina (RPC `pagar_nomina_empleado` → caja/CC)** | `RrhhPage.tsx:pagarNomina` (1005) | 💰 | 🔴gap (efectivo↔caja, REGLA #0 pto 4) |
| L31 | Gate doble validación (quién puede generar gasto / pagar) | `RrhhPage.tsx:puedeAprobarNomina` (1027) | 💰 | 🔴gap |
| L32 | Generar SAC (1°/2° sem) — UNIQUE período | `RrhhPage.tsx:generarSAC` (~930) | 💰 | 🔴gap |
| L33 | Registrar anticipo/préstamo (opc. gasto + doc al bucket) | `RrhhPage.tsx:registrarAnticipo` (1111) | 💰 | 🔴gap |
| L34 | Solicitar vacación + aprobar (RPC `aprobar_vacacion`, aviso/solapamiento) | `RrhhPage.tsx:registrarVacacion`/`aprobarVacacion` (1194/1215) | | 🔴gap (aviso `evaluarAviso` ✅unit) |
| L35 | Registrar/aprobar hora extra (auto-aprob si no requiere) | `RrhhPage.tsx:registrarHoraExtra`/`aprobarHoraExtra` (1334/1354) | | 🔴gap |
| L36 | Liquidación final (egreso) — formularios + persistencia | `RrhhPage.tsx:liqFinal` (276) | 💰 | 🔴gap (fórmulas ✅unit) |
| L37 | Baja de empleado con motivo + genera indemnización | `RrhhPage.tsx:bajaEmpleado` (273) | | 🔴gap (`generaIndemnizacion` ✅unit) |
| L38 | Generar/rotar token de fichado QR | `RrhhPage.tsx:generarFichadoToken` (267) | | 🔴gap |
| L39 | Check-in rápido / fichado | `RrhhPage.tsx:checkinRapido` (1363), `FicharPage` | | 🔴gap |
| L40 | Tabs visibles por rol (SUPERVISOR→4 tabs vs DUEÑO→12) | `RrhhPage.tsx` (1969-1971) | | 🟡e2e 15/16 (sidebar, no tabs internos) |
| L41 | Gate de plan: `/rrhh` exige `puede_rrhh` (UpgradePrompt) | `RrhhPage.tsx` (1943) | | ✅unit(planLimits/navVisibility) · 🔴e2e |
| **Roles / Permisos / Modo** | | | | |
| L42 | Visibilidad de nav por rol×modo (VIEWER allowlist, roles operativos, owner/supervisorOnly) | `navVisibility.ts:navItemVisible` | | ✅unit(navVisibility) |
| L43 | Item gris por plan (`navItemLocked`) | `navVisibility.ts:navItemLocked` | | ✅unit(navVisibility) |
| L44 | Solo-lectura por rol custom / LECTOR | `permisosModulo.ts` (3 fns) | | ✅unit(permisosModulo) |
| L45 | Modo avanzado efectivo (toggle + plan + kill-switch) | `modoOperacion.ts:esModoAvanzado` | | ✅unit(modoOperacion) |
| L46 | Motivo de básico (toggle_off / plan_insuficiente) | `modoOperacion.ts:motivoBasico` | | ✅unit(modoOperacion) |
| L47 | Producto con tracking sigue exigiéndolo en básico | `modoOperacion.ts:productoRequiereTracking` | 📦 | ✅unit(modoOperacion) |
| L48 | Sugerir avanzado por tipo de comercio | `modoOperacion.ts:sugiereModoAvanzado` | | ✅unit(modoOperacion) |
| L49 | Cambiar modo (confirm + conserva tracking) | `ConfigPage.tsx:ModoOperacionSection.cambiar` (416) | 📦 | 🔴e2e (lógica ✅unit) |
| **Suscripción / Plan / Límites** | | | | |
| L50 | Cálculo de límites del plan (usuarios/productos/movimientos + features) | `usePlanLimits.ts` | 💰* | ✅unit(planLimits) |
| L51 | Inferir plan desde `max_users` (no `plan_id`) | `usePlanLimits.ts` (63) | | ✅unit(planLimits) |
| L52 | Trial activo → features de Pro; trial vencido → plan real | `usePlanLimits.ts` (74-81) | | ✅unit(planLimits) |
| L53 | Add-on extiende `max_movimientos` | `usePlanLimits.ts` (66-68) | | ✅unit(planLimits) |
| L54 | SubscriptionGuard: redirige a /suscripcion si no activo/trial vigente | `AuthGuard.tsx:SubscriptionGuard` (25) | | 🟡e2e 09 (página accesible, no redirect) |
| L55 | Suscribir (init_point MP preapproval) | `SuscripcionPage.tsx:handleSuscribir` (35) | 💰 | 🔴gap |
| L56 | Verificar pago / activar (webhook o fallback preapproval_id) | `SuscripcionPage.tsx:handleVerificarPago` (43) | 💰 | 🔴gap |
| L57 | Comprar add-on (EF `mp-addon`) | `SuscripcionPage.tsx:handleComprarAddon` (73) | 💰 | 🔴gap |
| L58 | Tenant cancelado: registrar nuevo negocio / borrar users | `SuscripcionPage.tsx` (149-164) | | 🔴gap |
| **Config — plataforma** | | | | |
| L59 | Cierre por inactividad (`session_timeout_minutes`) | `useInactivityTimeout.ts` (AppLayout 92) | | 🔴gap |
| L60 | Clave maestra hasheada (RPC `set_clave_maestra`, confirmación, ≥6) | `ConfigPage.tsx:handleSaveBiz` (1028-1043) | 💰 | ✅e2e 41 |
| L61 | Edición de Config solo por DUEÑO (`canEdit`) | `ConfigPage.tsx` (314/394/503) | | 🔴gap (e2e) |
| L62 | Marketplace activar + webhook | `ConfigPage.tsx:MarketplaceSection` (315-323) | | 🔴gap |

\* L50/L60 tocan plata indirectamente (gating de creación + clave que gatea acciones patrimoniales).
📦 = stock.

---

## 2) Matriz de flags (CON / SIN o por valor del enum)

> Default = lo que aplica el código si la columna es null. `uso` = file:line donde se LEE para decidir.
> Solo se documenta el comportamiento de los flags **propios de este grupo** (RRHH / suscripción / roles /
> modo / plataforma). Los flags de otros módulos se listan en el §3 (mapa de ConfigPage) sin re-documentar.

### 🟡 RRHH (todos en `tenants`, se setean en RrhhPage, NO en ConfigPage)

| Flag | Default | Uso (file:line) | CON el flag | SIN / por valor | Cobertura |
|------|---------|-----------------|-------------|-----------------|-----------|
| `rrhh_nomina_doble_validacion` | false | `RrhhPage.tsx:1028` | Generar gasto / cargas / pagar nómina solo DUEÑO/ADMIN (o SUPERVISOR si el otro flag); resto → error "Requiere aprobación" | false: cualquiera con acceso a la pantalla genera/paga | 🔴gap |
| `rrhh_nomina_supervisor_aprueba` | false | `RrhhPage.tsx:1030` | Con doble validación ON, SUPERVISOR también puede aprobar | false: SUPERVISOR no puede aun con doble validación | 🔴gap |
| `rrhh_tardanza_modo` | `'registrar'` | `RrhhPage.tsx:879` | `proporcional`/`umbral` → calcula minutos tarde y agrega ítem DESCUENTO en la liquidación | `registrar`: no descuenta (solo registra). `umbral` aplica tolerancia | 🟡 (cálculo ✅unit rrhhAsistencia; efecto en liquidación 🔴e2e) |
| `rrhh_tardanza_tolerancia_min` | 0 | `RrhhPage.tsx:886` | En modo `umbral`, minutos tolerados por día antes de descontar | 0: descuenta desde el 1er minuto excedente | 🟡 (✅unit; e2e 🔴) |
| `rrhh_horas_mes_base` | 200 | `RrhhPage.tsx:888,3889` | Divisor para sueldo/hora (tardanza + valorizar horas extra) | usa 200 | 🟡 (✅unit sueldoHora; e2e 🔴) |
| `rrhh_horas_extra_requiere_aprobacion` | false | `RrhhPage.tsx:1338` | Hora extra nace `aprobada=false` (pendiente) | false: nace `aprobada=true` (auto) | 🔴gap |
| `rrhh_vacaciones_aviso` (jsonb `{modo,dias}`) | `{modo:'alerta',dias:30}` | `RrhhPage.tsx:1220` | `fijo`→bloquea aprobar si no cumple; `alerta`→confirma; `sin`→ok | default alerta | 🟡 (`evaluarAviso` ✅unit; bloqueo al aprobar 🔴e2e) |
| `rrhh_vacaciones_remanente_max` | 0 | `RrhhPage.tsx:3533,3685` | >0: tope al remanente arrastrado | 0: sin tope | 🟡 (`remanenteSiguiente` ✅unit; e2e 🔴) |
| `rrhh_portal_empleado` | false | `RrhhPage.tsx:2024`; `navVisibility.ts:63` | Activa portal `/mi-portal` (auto-servicio) + item de nav | false: portal oculto | 🟡 (gate de nav ✅unit navVisibility; portal en sí 🔴) |
| `rrhh_notif_config` (jsonb) | `{}` (= todo ON) | `RrhhPage.tsx:2033` | Por clave (cumpleaños/aniversario/vacaciones/doc/contrato), `!== false` = ON | clave false → no notifica ese evento | 🔴gap |
| `rrhh_doc_alerta_dias` | 30 | `RrhhPage.tsx:4252` | Ventana de "documentos por vencer" | usa 30 | 🟡 (`documentosPorVencer` ✅unit; UI 🔴) |
| `fichado_token` | null | `RrhhPage.tsx:259-270` | Construye link/QR público `/fichar/:token`; rotar genera UUID nuevo | null: sin QR de fichado | 🔴gap |

### 🟢 Modo de operación

| Flag | Default | Uso | CON / valor | SIN / otro valor | Cobertura |
|------|---------|-----|-------------|------------------|-----------|
| `modo_operacion` (`basico`/`avanzado`) | `basico` | `modoOperacion.ts:esModoAvanzado`; `ConfigPage.tsx:397,2267,2880`; `navVisibility.ts:57` | `avanzado` (+plan): expone WMS/OC/recepciones/envíos/trazabilidad; ConfigPage muestra tab Envíos + sub-tabs Inv avanzados | `basico`: nav reducido, oculta WMS; **el modo gatea UI, nunca datos** | ✅unit(modoOperacion, navVisibility) · 🟡e2e (rol×modo sidebar) · 🔴e2e flujos avanzados |
| (derivado) `puede_wms` | false | `usePlanLimits.ts:108`; `ConfigPage.tsx:398,418` | Avanzado solo efectivo si el plan lo permite; toggle a avanzado bloqueado sin plan | sin plan + toggle ON → cae a básico (`motivo='plan_insuficiente'`) | ✅unit(modoOperacion, planLimits) |
| `MODO_BASICO_ENABLED` (kill-switch, brand.ts) | true | `modoOperacion.ts:26`; `ConfigPage.tsx:414` | false → todo el SaaS opera avanzado (rollback global, sin tocar DB) | true → el modo del tenant manda | ✅unit(modoOperacion) |

### 🟢 Suscripción / Plan / Límites

| Flag | Default | Uso | CON / valor | SIN / otro valor | Cobertura |
|------|---------|-----|-------------|------------------|-----------|
| `subscription_status` (`trial`/`active`/`cancelled`/`past_due`...) | `trial` | `AuthGuard.tsx:36-40`; `SuscripcionPage.tsx`; `usePlanLimits.ts:76` | `active` o `trial` vigente → pasa el guard | otro / trial vencido → redirige a `/suscripcion`; `cancelled` → ofrece registrar nuevo negocio | 🟡e2e 09 (página) · 🔴 redirect/trial-vencido |
| `trial_ends_at` | +7d (onboarding) | `AuthGuard.tsx:34`; `usePlanLimits.ts:77` | vigente → trial activo (features Pro) | vencido → cae al plan real + bloquea guard | ✅unit(planLimits trial vencido) · 🔴e2e |
| `plan_id` (UUID FK) | free | `usePlanLimits.ts:55` | **No se usa para inferir features** (es UUID, no matchea brand.ts) | el plan se infiere de `max_users` | n/a (gap de diseño documentado, ver Gaps) |
| `max_users` | 1 | `usePlanLimits.ts:59,63` | Tope de usuarios activos; infiere plan (≥10 pro, ≥2 básico, else free) | 1 → free | ✅unit(planLimits) · 🔴e2e límite alcanzado |
| `max_productos` | 50 | `usePlanLimits.ts:60` | Tope de productos activos (bloquea alta) | 50 | ✅unit(planLimits) · 🔴e2e |
| `addon_movimientos` | 0 | `usePlanLimits.ts:64-68` | Suma al tope mensual de movimientos | 0 | ✅unit(planLimits) · 🔴e2e |
| `mp_subscription_id` | null | `SuscripcionPage.tsx:203`; `handleVerificarPago` | Marca el plan actual (incluye su id) + persiste tras pago | null → ningún plan marcado activo | 🔴gap |

### 🟢 Plataforma / integraciones (este grupo)

| Flag | Default | Uso | CON / valor | SIN | Cobertura |
|------|---------|-----|-------------|-----|-----------|
| `session_timeout_minutes` | null (nunca) | `AppLayout.tsx:92` → `useInactivityTimeout` | >0: cierra sesión tras inactividad, avisa 1 min antes | null/0: no expira | 🔴gap |
| `clave_maestra` (hash) | null | `ConfigPage.tsx:1028-1043` (setear); `verificar_clave_maestra` RPC en Caja/Clientes/Envíos/Gastos/Inventario/Ventas | con clave: gatea anular/incobrable/caja-ajena/diferencia/ajustes | null: acciones no piden clave | ✅e2e 41 (setear) · 🟡 gating en módulos (e2e 40 incobrable) |
| `marketplace_activo` | false | `ConfigPage.tsx:315-323` | Expone catálogo vía `marketplace-api`; requiere `puede_marketplace` (plan) | false: API cerrada | 🔴gap |
| `marketplace_webhook_url` | null | `ConfigPage.tsx:316,323` | URL de webhook de stock | null: sin webhook | 🔴gap |
| `whatsapp_plantilla` | null | `ConfigPage.tsx:627,957` | Plantilla de mensajes WhatsApp (CC/notif) | null: usa default | 🔴gap |
| `sitio_web` | null | `ConfigPage.tsx:615,862` | Sale en comprobantes (módulo facturación) | null: no aparece | (módulo facturación — otro agente) |
| `cumple_notif_cliente` / `cumple_notif_duenio` | false | `ConfigPage.tsx:597-598,955-956` | Notifica cumpleaños al cliente / al dueño | false: no notifica | 🔴gap |

---

## 3) Mapa de ConfigPage — tab → flags (referencia cruzada al módulo dueño)

`ConfigPage` (`canEdit = user?.rol === 'DUEÑO'`, líneas 314/394/503) tiene 12 tabs en 2 grupos
(`tabGroups`, 2257). **3 tabs son placeholders** (greyed "pronto", **sin contenido**): `rrhh`, `alertas`,
`notificaciones` (2270/2276/2277). Casi todo el guardado pasa por **un único** `handleSaveBiz` (912-1042)
que persiste un payload enorme y mixto (no se limita al tab activo), más `handleSaveFacturacion` (851) y
el RPC `set_clave_maestra` (1043).

| Tab (id) | Sub-tabs | Flags que setea | Módulo dueño |
|----------|----------|-----------------|--------------|
| **negocio** | — | `nombre`, `tipo_comercio`, **`session_timeout_minutes`**, `email_legal`, `precio_redondeo`, `moneda`; muestra `subscription_status`/`trial_ends_at` (read-only); **`ModoOperacionSection`** (`modo_operacion`); **`MarketplaceSection`** (`marketplace_activo`/`_webhook_url`); **clave maestra** (RPC) | **plataforma/este grupo** + facturación (email_legal/moneda) |
| **ventas** | metodos / descuentos / operativa | `descuento_max_cajero_pct`, `descuento_max_supervisor_pct`, `presupuesto_validez_dias`, reservas (`reserva_sena_*`, `reserva_vencimiento_dias`, `reserva_penalidad_pct`), métodos de pago, combos | Ventas (otro agente) — descuento_max_* es roles/caja |
| **caja** | — | `clave_maestra` (campo + confirm), `boveda_umbral_caja` | Caja (otro agente) + clave maestra (este grupo) |
| **clientes** | — | `cliente_obligatorio`, `cliente_datos_minimos`, `cliente_consumidor_final`, `cliente_creacion_inline`, `limite_cc_default`, `cc_enforcement_politica`, `cc_morosidad_politica`, `cc_dias_vencimiento`, `cc_interes_mensual_pct`, `cc_notif_*`, `alerta_devoluciones_n/_dias` | Clientes/CC (otro agente) |
| **inventario** | reglas / categorias / ubicaciones / estados / motivos / unidades / codigos | `regla_inventario`, `permite_over_receipt`, `trazabilidad_asignacion`, `conteo_modo`, `ajuste_autorizacion_roles`, `conteo_gate_*`, `conteo_reconteo_*`, `conteo_ciclico_dias_*`, `conteo_wall_to_wall_bloquea`, `alerta_margen_negativo` | Inventario/Conteos (otro agente) — `ajuste_autorizacion_roles` es roles |
| **envios** (solo avanzado) | — | `envio_*` (cobro/courier/POD/tramos/tokens/identidad/gratis/plazos/alertas/combustible) — ~30 flags | Envíos (otro agente) |
| **gastos** | — | `gastos_comp_*` (comprobante obligatorio) | Gastos (otro agente) |
| **facturacion** (solo `canEdit`) | — | `cuit`, `condicion_iva_emisor`, `razon_social_fiscal`, `domicilio_fiscal`, `umbral_factura_b`, `afipsdk_token`, `afip_produccion`, `facturacion_habilitada`, `ingresos_brutos`, `inicio_actividades`, `sitio_web`, `banco`, `cbu`, `alias_cbu`, `leyenda_comprobante` | Facturación/Fiscal (otro agente) |
| **rrhh** | — (placeholder "pronto") | **NINGUNO** — la config real de RRHH vive en **RrhhPage → tab Reportes** (portal/notif) y **tab Nómina** (doble validación) | RRHH (este grupo) |
| **alertas** | — (placeholder) | NINGUNO (informativo) | — |
| **notificaciones** | — (placeholder) | `cumple_notif_*`, `whatsapp_plantilla` se guardan vía handleSaveBiz aunque el tab esté vacío | varios |
| **conectividad** | integraciones / api | MODO (MercadoPago `mp_credentials`), API marketplace (avanzado) | Integraciones (otro agente) |

**Dónde se setea cada flag de RRHH (NO en ConfigPage):**
- `RrhhPage` tab **Nómina** (2818-2829): `rrhh_nomina_doble_validacion` (toggle, solo DUEÑO/ADMIN).
- `RrhhPage` tab **Reportes** (2019-2040): `rrhh_portal_empleado`, `rrhh_notif_config`.
- `RrhhPage` tab **Vacaciones** (3511-3535): `rrhh_vacaciones_aviso` (modo+días), `rrhh_vacaciones_remanente_max`.
- `RrhhPage` cabecera/asistencia: `fichado_token` (267), `rrhh_tardanza_modo`/`_tolerancia_min`/`rrhh_horas_mes_base`/`rrhh_horas_extra_requiere_aprobacion`, `rrhh_doc_alerta_dias` — **algunos solo se LEEN; faltó hallar setter UI** (ver Gap G7).

⚠️ **Hallazgo de diseño (no bug):** `handleSaveBiz` guarda ~100 columnas de golpe sin importar el tab
activo. Un test de "guardar tab X" puede sobreescribir/persistir flags de otros tabs con su estado de
formulario en memoria. No es REGLA #0 pero conviene documentarlo para los e2e de Config.

---

## ✅ CIERRE REGLA #0 — barrido 2026-06-23 (módulo CERRADO, DB-verificado)

Foco REGLA #0 del grupo = la **plata que toca caja** (pago de nómina). El resto crea **gastos pendientes**
con montos ✅unit (no tocan caja/CC/stock/fiscal hasta pagarse por Gastos, que ya es medio-aware y validado).

- **🛑 BUG REGLA #0 ENCONTRADO + ARREGLADO (mig 241) — G1/L30 `pagar_nomina_empleado`:** el RPC asentaba
  SIEMPRE `caja_movimientos` **`egreso`** (afecta arqueo de efectivo) sin importar el medio. La UI ofrece 3
  medios (efectivo/transferencia_banco/mp), así que pagar por **transferencia/MP descuadraba el efectivo**
  (restaba del cajón plata que nunca salió). **Fix mig 241:** efectivo → `egreso`; no-efectivo →
  `egreso_informativo` (no afecta efectivo) con concepto `[Transferencia]/[Mercado Pago] …`. **DB-validado**
  (impersonación + ROLLBACK, los 3 medios) + **spec 81** (regresión e2e) + spec 50 (efectivo, previo).
- **G2/L31 — Doble validación de nómina** (`puedeAprobarNomina`, flags `rrhh_nomina_doble_validacion` +
  `_supervisor_aprueba`): **gate client-side de autorización** (code-verified, `RrhhPage:1027-1037`). Consistente
  con la decisión de descuento-por-rol: **autorización que NO rompe integridad** (la plata se asienta correcta
  igual) queda client-side. *Decisión abierta para GO:* ¿hardening server-side del gate de nómina (como OC)?
- **G3/L26 — Tardanza descontada en la liquidación** ✅ code-verified (`crearLiquidacion`:879-893 lee
  `rrhh_tardanza_modo/_tolerancia_min/_horas_mes_base` + fichadas del período → `minutosTardeFacturables` +
  `sueldoHora` + `descuentoTardanza`, todos ✅unit; empuja ítem DESCUENTO y recomputa neto). Sin caja.
- **G4/G5 — Cargas sociales / SAC** ✅ montos ✅unit → gastos pendientes por concepto / liquidación UNIQUE período.
- **G6/L36 — Liquidación final** ✅ fórmulas ✅unit (`liquidacionFinal`) → gasto pendiente (cat. Sueldos). Sin caja.
- **Anticipos/préstamos (L33)** ✅ crea gasto pendiente (no caja).
- **G10 — Suscripción/plan límites** = gating **client-side** (`usePlanLimits` ✅unit + `PlanLimitModal`/`UpgradePrompt`),
  trial→redirect (`SubscriptionGuard`). Tier de facturación, **no integridad estricta** (excederlo no corrompe
  datos fiscales/contables). Cubierto por ✅unit + e2e 09.
- **G13 — `canEdit` de Config = DUEÑO** ✅ code-verified (`ConfigPage` `canEdit = rol==='DUEÑO'`). Clave maestra
  hash ✅ e2e 41. `session_timeout` = timer UI (capa manual).

**Conclusión:** RRHH/Config/Suscripción **cerrado REGLA #0** — el único hueco de integridad (plata en caja) era
el medio de pago de nómina, **encontrado y arreglado** (mig 241). El resto son montos ✅unit + gating/autorización.

---

## 4) Gaps priorizados

### 🔴 Tanda A — REGLA #0 (plata) sin e2e mutante

- **G1 — Pagar nómina (L30):** `pagarNomina` invoca RPC `pagar_nomina_empleado(salario, sesion, medio_pago)`
  → mueve plata a caja/CC. **Cero cobertura e2e/unit del efecto contable.** REGLA #0 pto 4 (efectivo↔caja):
  hay que verificar que el pago en efectivo asienta el egreso en caja (await + aviso si falla) y que el medio
  `mp`/`transferencia_banco` no toca caja efectivo. **Prioridad máxima.**
- **G2 — Doble validación de nómina (L31):** `rrhh_nomina_doble_validacion` CON/SIN + `rrhh_nomina_supervisor_aprueba`.
  Probar que SIN el flag cualquiera genera/paga; CON el flag un rol no-DUEÑO/ADMIN recibe el error y NO se
  crea el gasto (lo de hoy es solo el throw — el e2e 37 corre como DUEÑO, no valida el bloqueo).
- **G3 — Tardanza descontada en la liquidación (L26, flags `rrhh_tardanza_modo`/`_tolerancia`/`horas_mes_base`):**
  las piezas puras están ✅unit, pero el **ítem DESCUENTO real en `crearLiquidacion`** (con fichadas reales)
  no tiene e2e. Es plata sobre el sueldo. Validar `registrar` (0) vs `proporcional`/`umbral`.
- **G4 — Cargas sociales → Gastos (L29)** y **G5 — SAC (L32):** generan gastos/liquidaciones; sin cobertura del efecto.
- **G6 — Liquidación final (L36):** indemnización + SAC prop. + vacaciones no gozadas → egreso. Fórmulas ✅unit,
  pero el flujo completo (formularios → persistencia/gasto) sin e2e.

### 🟠 Tanda B — operativo importante

- **G7 — Setters de config RRHH faltantes/dispersos:** `rrhh_tardanza_modo`, `rrhh_tardanza_tolerancia_min`,
  `rrhh_horas_mes_base`, `rrhh_horas_extra_requiere_aprobacion`, `rrhh_doc_alerta_dias` se **leen** pero no se
  encontró un control de UI claro que los setee (¿se setean fuera de RrhhPage o son solo defaults DB?).
  **Verificar** si hay forma de configurarlos desde la app — si no, son flags "muertos" sin escenario CON.
- **G8 — Vacaciones (L34):** aviso `fijo` bloquea aprobar (CON/SIN), solapamiento (confirm), partición, remanente
  con tope. Sin e2e (aunque `evaluarAviso`/`remanenteSiguiente`/`validarParticion` están ✅unit).
- **G9 — Horas extra (L35):** `rrhh_horas_extra_requiere_aprobacion` CON→pendiente / SIN→auto-aprobada. Sin e2e.
- **G10 — Suscripción/plan (L50-58):** límites de plan **e2e** (alta de usuario/producto sobre el tope con
  `max_users`/`max_productos`), trial vencido → redirect del SubscriptionGuard (L54), flujo MP suscribir/add-on,
  tenant cancelado. Hoy solo planLimits ✅unit + e2e 09 (página accesible). REGLA #0 indirecta (cobro).
- **G11 — Modo básico↔avanzado e2e (L49):** cambiar de modo (confirm) + que en avanzado aparezcan los flujos
  WMS reales (no solo nav). navVisibility ✅unit cubre el nav, falta el flujo.

### 🟡 Tanda C — capa manual / menor

- **G12 — `session_timeout_minutes` (L59):** cierre por inactividad — difícil en e2e (timers), checklist manual.
- **G13 — `canEdit` de Config (L61):** un no-DUEÑO ve campos disabled / no puede guardar. e2e con rol no-DUEÑO.
- **G14 — Portal del empleado (`rrhh_portal_empleado`) + fichado QR (`fichado_token`) + check-in:** `/mi-portal`
  y `/fichar/:token` (público) sin cobertura.
- **G15 — Notificaciones RRHH (`rrhh_notif_config`), cumpleaños (`cumple_notif_*`), marketplace, WhatsApp:** capa
  de integración/notif, checklist manual.
- **G16 — Diseño:** `plan_id` (UUID) NO se usa para features (se infiere de `max_users`). Documentado como
  decisión, pero es un riesgo si algún día se desincronizan `max_users` y el plan real → vale un test de invariante.
