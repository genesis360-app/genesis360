---
name: relevamiento_rrhh_respuestas
description: Respuestas de GO al relevamiento de RRHH + diseño consolidado, sugerencias, modelo de datos y plan por fases (RH1-RH8)
type: project
---

# Relevamiento RRHH (empleados / nómina / vacaciones / asistencia / documentos) — respuestas + diseño

> **✅ ESTADO (2026-06-09): RH1-RH8 COMPLETO en PROD** (v1.46.0-v1.48.0, mig 195-202, suite 613). Detalle de implementación por fase en `project_pendientes.md` (sección RRHH) y `wiki/features/rrhh.md`. **Solo quedan diferidos** (mejoras futuras): fichado por QR público (`/fichar/:token`), auto-descuento de tardanza en nómina (lib `descuentoTardanza` lista, falta el sweep), y la UI completa del portal del empleado (F2; flag configurable ya está). Este documento queda como **referencia de diseño** del relevamiento original.
>
> Fuente: HTML `relevamiento-rrhh-reglas-negocio.html` (secciones A-H, v1.10.0 base).
> Respondido por GO + socio. Acá: respuesta elegida + **diseño consolidado**, **sugerencias**, **modelo de datos**
> y el **plan por fases (RH1-RH8)**. Filosofía del proyecto: **simple para el PyME por fuera, robusto por dentro**.
> **pg_cron NO disponible** → cualquier disparo por tiempo va por **sweep lazy** vía RPC (patrón `liberar_reservas_vencidas`).

## Estado actual del módulo (código real, antes de RH1-RH8)
Módulo RRHH ya maduro: 11 migraciones (014/017/018/019/022/023/026/036/145/147/151), 13 tablas, `RrhhPage.tsx` (~3700 líneas) con tabs **dashboard / empleados / puestos / departamentos / cumpleaños / nómina / vacaciones / asistencia / documentos / capacitaciones / equipo (supervisor)**.
- **`empleados`**: nombre, apellido, `dni_rut` (UNIQUE por tenant), tipo_doc, tel/email personal, género, dirección, `fecha_nacimiento`, **`fecha_ingreso NOT NULL`** (A1-c ya cumplido), **`fecha_egreso`** (col ya existe), `puesto_id`, `departamento_id`, **`supervisor_id`** (mig 147), **`tipo_contrato`** CHECK (INDEFINIDO/PLAZO_FIJO/FREELANCE/TEMPORAL), `salario_bruto`, `activo` (soft delete), **`user_id`** (mig 151, UNIQUE por tenant → **A5-b ya cumplido**).
- **`rrhh_conceptos`** (HABER/DESCUENTO, `activo`) · **`rrhh_salarios`** (`periodo DATE`, basico, total_haberes/descuentos, neto, `pagado`, `fecha_pago`, `caja_movimiento_id`, `medio_pago` efectivo/transferencia_banco/mp) · **`rrhh_salario_items`** (concepto_id, descripción, tipo, monto).
- **`rrhh_vacaciones_solicitud`** + **`rrhh_vacaciones_saldo`** (`dias_totales`, `remanente_anterior` manual).
- **`rrhh_asistencia`** (estado presente/ausente/tardanza/licencia + hora, manual).
- **`rrhh_documentos`** (bucket privado 10MB) · **`rrhh_capacitaciones`** (planificada/en_curso/completada/cancelada + certificado) · **`rrhh_feriados`** (campo nacional/provincial/personalizado + bulk AR).
- Self-service SUPERVISOR (tab "Mi Equipo"): ve asistencia/vacaciones/cumpleaños, aprueba vacaciones del equipo. Notificación de cumpleaños via EF + cron diario.

> **Ya cumplido por código (no re-implementar):** A1-c (fecha_ingreso obligatoria), A5-b (`empleados.user_id`), parte de A2 (`fecha_egreso` col existe), supervisor_id (jerarquía). A3 tiene `tipo_contrato` pero con enum distinto al catálogo pedido → migrar a configurable.

---

## A — Empleados

| # | Resp GO | Diseño |
|---|---|---|
| A1 | **a + b + c + d** | **Obligatorios al alta**: nombre, DNI/CUIL, salario_bruto (ya) **+ email + teléfono + fecha de ingreso (ya NOT NULL) + puesto + departamento**. Validación en el form (frontend) + `NOT NULL`/required donde corresponda. (a "mantener mínimos" se interpreta como "además de los actuales".) |
| A2 | **b + c + d** | **Baja robusta**: `fecha_egreso` (ya) + **`motivo_egreso`** (renuncia / despido con causa / despido sin causa / fin de contrato) · **liquidación final automática** (vacaciones no gozadas + SAC proporcional + indemnización por antigüedad) → depende de B4/B5, va a **RH8** · **reactivar** empleado dado de baja (mismo registro: `activo=true`, limpia `fecha_egreso/motivo`). |
| A3 | **A (configurable)** | **Catálogo de tipo de contrato configurable por tenant** (`rrhh_tipos_contrato`): base = relación de dependencia / monotributista / pasantía / plazo fijo / temporada; **agregar/editar/desactivar otros**. Hoy `empleados.tipo_contrato` es CHECK rígida → **dropear la CHECK** (la validación pasa a la app, patrón `ventas_origen_check` mig 174). Distingue "relación de dependencia" para auto-aportes (B4). |
| A4 | **D, opcional** | **Datos bancarios completos opcionales**: `empleados` += `cbu`, `alias_cbu`, `banco`, `tipo_cuenta`, `titular_cuenta`. Todos nullable; se usan para el pago por transferencia (informativo). |
| A5 | **B** | **`empleados.user_id` ✅ YA EXISTE** (mig 151, UNIQUE por tenant). Solo falta exponerlo claro en la UI (vincular ficha de empleado ↔ user del sistema cuando aplica). |

---

## B — Nómina y liquidaciones

| # | Resp GO | Diseño |
|---|---|---|
| B1 | **D** | **Frecuencia configurable libremente** (mensual / quincenal / semanal / cada X días), **por empleado** (`empleados.frecuencia_liquidacion`). La nómina se genera por período según la frecuencia de cada uno. |
| B2 | **D** | **Generación automática + asistencia integrada**: al generar la nómina del período, inyecta **descuentos por ausencia** y plus/descuentos derivados de Asistencia (D3/D4). Auto = **sweep lazy** (no pg_cron) o botón "Generar" que ya trae los ajustes calculados. |
| B3 | **C + D** | **Catálogo base por país** (según `tenants.moneda`/país) **+ editable** (agregar/desactivar/custom). Seed AR: Sueldo básico, Antigüedad, Presentismo, Jubilación 11%, Obra Social 3%, Ley 19.032 3%, Sindicato. `rrhh_conceptos` += `pais`, `default_pct`, `predefinido`, `tipo_calculo` (fijo/%/sobre_bruto). |
| B4 | **c + d, configurable POR EMPLEADO** | **Auto-calcular aportes** (Jubilación 11%, Obra Social 3%, Ley 19.032 3% sobre bruto) **+ override por liquidación + SAC auto**. **Clave (pedido GO):** por cada empleado hay **checkboxes** (jubilación / obra social / ley 19.032 / beneficios extra) que **incluyen o excluyen** ese aporte de su nómina; los **% y montos se configuran SOLO desde Configuración** (togglear el checkbox del empleado NO modifica el %/monto, solo lo activa/desactiva). Empleados "en negro" → se les **sacan los checkboxes** (sin aportes). **Beneficios extra** configurables en **$ o %** (se pueden agregar varios). Tabla `empleado_aportes` (empleado_id, concepto_id, activo) o JSONB en `empleados.config_aportes`. |
| B5 | **A + cálculo ley AR (mejor sueldo semestre)** | **Aguinaldo / SAC**: botón aparte para generar la nómina de SAC en **junio y diciembre**; el monto = **50% del mejor sueldo del semestre** (LCT). **Opcional** (no obligatorio si hay empleados en negro). Función pura `mejorSueldoSemestre(empleado, semestre)`. |
| B6 | **configurable + comprobante firmado (opcional)** | **Recibo de sueldo PDF** (imprimible). **Pedido GO:** poder **guardar un archivo/imagen** con la **firma del empleado y del empleador** confirmando que se recibió el pago (campo `rrhh_salarios.comprobante_firmado_url`, bucket privado, **opcional**). Configurable (PDF básico / + email / + comprobante firmado). |
| B7 | **= métodos de gastos (cuentas de origen) + integración Gastos** | **Pedido GO (clave contable):** los medios de pago de nómina son los **mismos que en Gastos (cuentas de origen)**. Al **"Pagar nómina"** se **genera el gasto en el módulo Gastos** → pestaña **"Gastos variables"** con **tag/estado `pendiente`** hasta que se pague. Se genera **un gasto por el sueldo** + **gastos acumulados por aporte** (Jubilación, Obra Social, Ley 19.032, etc.), **cada uno con su categoría**. La nómina se **arma en RRHH** pero **el gasto y la salida de dinero se gestionan en Gastos** (decoupling método↔destino contable, [[feedback_cuentas_origen_decoupling]]). |
| B8 | **D, configurable** | **Doble validación**: RRHH **prepara** la liquidación → **DUEÑO firma** el pago. **Configurable**: que firme **DUEÑO** o un **SUPERVISOR con permiso en su rol**. Gate por umbral opcional (clave maestra, patrón Compras D5). |
| B9 | **A** | **Solo moneda local** (la del tenant). Multi-moneda/USD diferido. |
| B10 | **A** | **Anticipo simple**: egreso en caja (o gasto) + **descuento automático en la próxima liquidación** (`rrhh_anticipos`: empleado_id, monto, fecha, descontado_en_salario_id). Préstamos en cuotas **NO** por ahora. |

---

## C — Vacaciones

| # | Resp GO | Diseño |
|---|---|---|
| C1 | **auto (sugerencia) + manual** | **Auto-calcular días según antigüedad** (LCT 20.744: 14/21/28/35 según años) **como sugerencia**, **permitir override manual** por empleado/año. Función pura `diasVacacionesLCT(antiguedadAnios)`. |
| C2 | **B default, configurable por rol** | **SUPERVISOR pre-aprueba → DUEÑO/RRHH confirma** (default). **Configurable**: para cada rol (RRHH, SUPERVISOR) elegir **pre-aprueba / sin acción / aprueba directo**. `tenants.rrhh_vacaciones_flujo` JSONB. |
| C3 | **configurable (A-D)** | **Plazo mínimo de aviso configurable**: sin plazo / **plazo fijo** (ej. 30 días) / **solo alerta visual** sin bloqueo / **por puesto-departamento**. `tenants.rrhh_vacaciones_aviso` (modo + días + scope). |
| C4 | **B + D** | **Alerta visual al aprobar** si hay otros aprobados en el mismo período **+ calendario visual** con superposiciones marcadas. (Bloqueo por N simultáneos = opción futura.) |
| C5 | **A default, configurable** | **Vacaciones partidas sin restricción** por default; **configurable** mínimo de días por bloque y/o máximo de bloques por año. |
| C6 | **B + C** | **Auto-calcular remanente** (totales del año − usados = remanente para el año siguiente) **+ límite configurable** de días arrastrables (ej. máx 5). Reemplaza la carga manual de `remanente_anterior`. |
| C7 | **A** | **Vacaciones pagas dentro del sueldo normal del mes** (no concepto especial, no recibo aparte). |

---

## D — Asistencia

| # | Resp GO | Diseño |
|---|---|---|
| D1 | **a + b + d (c a futuro)** | **Registro manual (ya) + fichado clock-in/out desde el celular del empleado + fichado por QR del local** (escanea el código de la sucursal). **Foto + geolocalización (c) marcada como mejora futura.** Tabla `rrhh_fichadas` (empleado_id, sucursal_id, tipo in/out, ts, origen manual/celular/qr). |
| D2 | **configurable, B default** | **Horario por empleado** (entrada/salida/días) por default; **configurable** a horarios rotativos (turnos) y plantillas de horario asignables. `rrhh_horarios` + asignación a empleado. |
| D3 | **configurable, A default** | **Tardanza: solo registrar (sin descuento)** por default; **configurable**: descuento proporcional (min × sueldo/hora) / umbral de tolerancia + % / progresivo (1ra aviso, 2da descuento). Alimenta B2. |
| D4 | **b + c + d** | **Subdividir licencias** (médica / paga / no paga / paternidad-maternidad / familiar enfermo / exámenes) **+ adjuntar comprobante** (certificado, opcional/obligatorio por tipo) **+ conectar con descuentos automáticos en la nómina** (vinculado a D3/B2). |
| D5 | **b + d (aprobación configurable)** | **Horas extra con multiplicador** (50% / 100% según día/horario) **+ aprobación previa por SUPERVISOR**, **configurable** si requiere o no aprobación. Se calculan como concepto separado en la nómina. |
| D6 | **D** | **Feriados nacional / provincial / personalizado** (campo ya existe) **+ reglas de pago** (doble, triple). Alimenta el cálculo de la nómina cuando se trabaja un feriado. |

---

## E — Documentos y capacitaciones

| # | Resp GO | Diseño |
|---|---|---|
| E1 | **A default + B configurable** | **Documentos obligatorios configurables**: catálogo de "documentos requeridos" (contrato, DNI, CV, libreta sanitaria) **CRUD** (agregar/editar/eliminar, marcar obligatorio u opcional) + **alerta si faltan**. **No bloquea el pago** de nómina (descarta C). `rrhh_documentos_catalogo`. |
| E2 | **B** | **Vencimiento de documentos**: `rrhh_documentos.fecha_vencimiento` + **alerta N días antes** (sweep lazy). Para libretas sanitarias, ART, contratos a plazo, registros. |
| E3 | **A + algunas B** | **Capacitaciones voluntarias (ya)** + poder **marcar algunas como "obligatorias por puesto"** → alerta al alta si falta. |
| E4 | **A** | **No registrar costo** de capacitaciones. |

---

## F — Supervisor y self-service

| # | Resp GO | Diseño |
|---|---|---|
| F1 | **a + b + c** | SUPERVISOR en "Mi Equipo": mantener (ya) **+ registrar asistencia de su equipo + evaluación de desempeño** (F4) por empleado. |
| F2 | **A default + activable (B/C/D)** | **Portal del empleado configurable (on/off por tenant)**: cuando se activa, el empleado (vía su `user_id`) puede **solicitar vacaciones + descargar recibos (b)**, **cargar sus propios documentos (c)** y **ver/firmar recibos electrónicos (d)**. Por default OFF (todo lo hace RRHH). |
| F3 | **C** | **Notificaciones del ciclo completo**: alta / cumpleaños (ya) / aniversario / vacaciones próximas / **documento o contrato a vencer**. Sweep lazy + EF de email. Configurable por tenant qué se envía (toma D de paso). |
| F4 | **B (escala 1-10) + C opcional** | **Evaluación de desempeño**: formulario periódico (trimestral/semestral) con **escala 1-10** + comentarios; **360° (auto + supervisor + pares) opcional**. `rrhh_evaluaciones`. |

---

## G — Reportes y alertas

| # | Resp GO | Diseño |
|---|---|---|
| G1 | **a + b + c + d + e + f (todos)** | Reportes: **costo laboral mensual por departamento/sucursal** · **asistencia consolidada** (presentes/tardanzas/ausencias) por período+empleado · **vacaciones gozadas/pendientes** por empleado y año · **antigüedad y rotación** (altas/bajas, permanencia promedio) · **cumpleaños y aniversarios del mes** · **recibos pendientes/pagados del mes**. Tab/sección Reportes RRHH (patrón `ComprasReportesPanel`). |
| G2 | **B** | Export **Excel + PDF + CSV** (consistente con Caja/Compras/Envíos). |

---

## H — Prioridades
- **H1:** GO **delega el Top 3** ("me da igual") → ver recomendación abajo. **H2:** sin comentarios libres.

---

## Resumen de sugerencias / observaciones
1. **B7 es el corazón contable:** la nómina se **arma** en RRHH pero **el dinero sale por Gastos** (cuentas de origen, pestaña gastos variables, estado pendiente). Un gasto por el sueldo + un gasto acumulado por cada aporte, **cada uno con su categoría** → la contabilidad y la caja quedan consistentes con el resto del sistema. Es la pieza que más valor da y la que más hay que cuidar.
2. **B4 configurable por empleado con % centralizado:** el checkbox por empleado **solo activa/desactiva**; los porcentajes viven en **Configuración** (cambiar el % ahí impacta a todos los que lo tienen activo). Soporta el caso "en negro" (sacar checkboxes) sin tocar la config global.
3. **A3 / tipo de contrato:** hoy es CHECK rígida → pasarla a **catálogo configurable** (dropear CHECK, validar en app). "Relación de dependencia" es el flag que dispara los auto-aportes de B4.
4. **Liquidación final (A2-c)** depende de SAC (B5) e indemnización (antigüedad) → va al final (RH8), después de tener el motor de conceptos/aportes.
5. **pg_cron NO disponible** → B2 (auto), E2/F3 (alertas por vencimiento), B5 (SAC en junio/dic) van por **sweep lazy** (RPC al entrar) o botón con sugerencia, nunca cron real.
6. **Reusos directos:** export (patrón `ComprasReportesPanel`), PDF (`jsPDF`+`autotable` como recibo/etiquetas), fichado por QR (stack `qrcode`/BarcodeDetector ya existe), bucket privado de documentos (ya existe `rrhh_documentos`).

---

## Modelo de datos (propuesto)
- **`empleados`** (ampliar): `motivo_egreso` (A2) · `cbu/alias_cbu/banco/tipo_cuenta/titular_cuenta` (A4) · `frecuencia_liquidacion` (B1) · `config_aportes JSONB` o tabla `empleado_aportes` (B4). **Dropear** la CHECK de `tipo_contrato` (A3).
- **`rrhh_tipos_contrato`** (A3): `id, tenant_id, nombre, es_relacion_dependencia BOOL, activo`. Seed base.
- **`rrhh_conceptos`** (ampliar, B3/B4): `pais`, `predefinido`, `tipo_calculo` (fijo/porcentaje/sobre_bruto), `default_pct`, `default_monto`. Seed base por país.
- **`rrhh_anticipos`** (B10): `empleado_id, monto, fecha, motivo, descontado_en_salario_id, gasto_id`.
- **`rrhh_salarios`** (ampliar): `comprobante_firmado_url` (B6) · `frecuencia`/`periodo_desde/hasta` (B1) · link a gastos generados (B7, `gasto_id` o tabla puente).
- **`rrhh_horarios`** + asignación (D2) · **`rrhh_fichadas`** (D1) · **`rrhh_licencias_tipo`** (D4) + `rrhh_asistencia` ampliada (tipo licencia, comprobante_url) · **`rrhh_horas_extra`** (D5).
- **`rrhh_documentos_catalogo`** (E1) · `rrhh_documentos` += `fecha_vencimiento` (E2) · `rrhh_capacitaciones` += `obligatoria_puesto_id` (E3).
- **`rrhh_evaluaciones`** (F4): `empleado_id, periodo, evaluador_id, tipo (auto/supervisor/par), puntaje_1_10, comentarios`.
- **`tenants`** (config): `rrhh_vacaciones_flujo` (C2), `rrhh_vacaciones_aviso` (C3), `rrhh_remanente_max` (C6), `rrhh_portal_empleado` (F2), `rrhh_notif_config` (F3), umbrales/flags de aportes y doble firma (B4/B8).

---

## Plan por fases (RH1-RH8) — propuesto
Cada fase deployable a PROD con su versión (patrón del proyecto). Orden por dependencia/valor.

- **RH1 — Empleados 2.0 (A1-A5):** obligatorios en el form (A1) · motivo de egreso + reactivar (A2 parcial) · tipo de contrato configurable, dropear CHECK (A3) · datos bancarios (A4) · exponer vínculo user_id en UI (A5, col ya existe). *Base liviana, habilita lo demás.*
- **RH2 — Conceptos + aportes AR + SAC (B3, B4, B5):** catálogo base por país + custom (B3) · auto-aportes (jubilación/OS/ley 19.032) **configurables por empleado con % en Config** + override + beneficios extra $/% (B4) · aguinaldo/SAC por mejor sueldo del semestre, botón junio/dic (B5). *El motor de cálculo.*
- **RH3 — Nómina contable + recibo + integración Gastos (B6, B7, B8):** medios de pago = cuentas de origen · "Pagar nómina" genera gasto(s) en **Gastos → variables (pendiente)**, un gasto por sueldo + acumulados de aportes por categoría (B7) · recibo PDF + comprobante firmado opcional (B6) · doble validación configurable (B8). *La pieza contable de mayor valor.*
- **RH4 — Frecuencia + anticipos (B1, B10):** frecuencia de liquidación configurable por empleado (B1) · anticipos con descuento automático en la próxima liquidación (B10).
- **RH5 — Vacaciones 2.0 (C1-C7):** días por antigüedad LCT (sugerencia) + override (C1) · aprobación configurable por rol (C2) · plazo de aviso (C3) · alerta de solapamiento + calendario (C4) · partidas configurables (C5) · remanente auto + límite (C6) · pago dentro del sueldo (C7).
- **RH6 — Asistencia 2.0 (D1-D6):** fichado celular + QR del local (D1) · horarios configurables (D2) · tardanza configurable (D3) · licencias subdivididas + comprobante + descuento en nómina (D4) · horas extra con multiplicador + aprobación (D5) · feriados con reglas de pago doble/triple (D6). *Alimenta a RH2/RH3 vía B2.*
- **RH7 — Documentos + capacitaciones + supervisor + portal (E1-E4, F1-F4):** catálogo de documentos obligatorios + vencimiento + alertas (E1/E2) · capacitaciones obligatorias por puesto (E3) · supervisor registra asistencia del equipo + evaluación (F1) · portal del empleado configurable (F2) · notificaciones del ciclo completo (F3) · evaluación de desempeño 1-10 + 360° opcional (F4).
- **RH8 — Reportes + export + liquidación final (G1, G2, A2-c):** todos los reportes (costo laboral, asistencia, vacaciones, antigüedad/rotación, cumpleaños/aniversarios, recibos) + export Excel/PDF/CSV (G1/G2) · **liquidación final** automática al egreso (vacaciones no gozadas + SAC proporcional + indemnización por antigüedad) (A2-c).

### Top 3 (H1 — recomendación, GO delegó)
1. **RH2 — Aportes AR + SAC** (cálculo automático que GO detalló en profundidad; corazón de la liquidación AR).
2. **RH3 — Nómina contable + recibo PDF + integración Gastos** (la pieza contable que GO marcó explícito en B7; conecta RRHH con Caja/Gastos).
3. **RH6 — Asistencia 2.0 / fichado celular+QR** (alto valor operativo diario; habilita los descuentos por ausencia de B2).

> RH1 (Empleados 2.0) es prerequisito liviano y conviene hacerlo primero aunque no esté en el Top 3. RH5 (Vacaciones) es el siguiente candidato fuerte si se prefiere sobre asistencia.

## Pendientes de confirmar antes de implementar
- **% de aportes AR** (Jubilación 11% / Obra Social 3% / Ley 19.032 3%): ¿se dejan esos defaults editables en Config? (asumido sí).
- **Indemnización (A2-c):** fórmula exacta (1 sueldo por año + fracción > 3 meses, tope) — confirmar al llegar a RH8.
- **B7:** ¿el gasto de nómina usa una **categoría "Sueldos"** nueva predefinida + categorías por aporte ("Cargas sociales", "Obra social", etc.)? (asumido sí, idempotente como Combustible/Flete).
- **Frecuencia (B1):** ¿el básico se prorratea por período (quincenal = ½) automáticamente? (asumido sí).
