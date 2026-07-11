# Plan de escenarios — Facturación electrónica AFIP/ARCA (proceso completo + reportes + plataforma)

Actualizado 2026-07-10 (gap-analysis de la sesión de validación integral de facturación).

**Fuentes de verdad:**
- Lógica fiscal pura (espejo de la EF): `src/lib/facturacionLogic.ts` → `tests/unit/facturacion.test.ts`
- Transporte WSFE propio (SIN espejo, la EF importa el mismo módulo): `supabase/functions/emitir-factura/wsfe-core.ts` → `tests/unit/wsfePropio.test.ts`
- Libro IVA / débito neto con NC: `src/lib/libroIva.ts` → `tests/unit/libroIva.test.ts`
- Pago manual de plataforma: `src/lib/facturacionManual.ts` → `tests/unit/facturacionManual.test.ts`
- EF `emitir-factura` (guards + orquestación): e2e 21 / 42 / 56 + UAT §11, §29, §32
- Reportes/dashboards fiscales: e2e 84 (áreas del Dashboard) + e2e 86 (FacturacionPage) + UAT §13

## 1. Auto-detección del tipo de comprobante — `detectarTipoComprobante` (FAC-TIPO) ✅

- FAC-TIPO-01: emisor Monotributista → **C** (sin importar el receptor).
- FAC-TIPO-02: emisor RI + receptor RI → **A** (discrimina IVA).
- FAC-TIPO-03: emisor RI + receptor CF → **B**.
- FAC-TIPO-04: emisor RI + receptor Monotributista → **B**.
- FAC-TIPO-05: emisor RI + receptor sin dato → **B**.
- FAC-TIPO-06: emisor sin dato → **B** (default seguro).
- FAC-TIPO-07: emisor Exento → **C** (igual que Monotributista).
- `tiposComprobantePermitidos`: Mono/Exento → `['C']`; RI/desconocido → `['A','B']` (nunca C).

## 2. Desglose de IVA por alícuota — `calcularIvaDesglose` / `calcularImportes` (FAC-IVA / FAC-C) ✅

El precio de venta YA incluye IVA → el neto se obtiene desarmando la tasa.

- FAC-IVA-01: 1 ítem 21% (subtotal 1210) → neto 1000, IVA 210, impTotal 1210, `[{Id:5,BaseImp:1000,Importe:210}]`.
- FAC-IVA-02: multi-alícuota (21% 1210 + 10.5% 1105) → neto 2000, IVA 315, impTotal 2315.
- FAC-IVA-03: exento → IVA 0, neto = subtotal, Id 3.
- FAC-IVA-04: 0% → IVA 0, Id 3.
- FAC-IVA-05: sin subtotal → usa precio_unitario × cantidad.
- FAC-IVA-06: alícuota numérica (21) equivalente al string '21'.
- FAC-IVA-07: impTotal SIEMPRE = neto + IVA (invariante anti error AFIP 10048).
- FAC-IVA-08/09/10: **numeric de PG** ("10.50"/"21.00"/"27.00"/"0.00") normalizado → Id correcto (regresión bug 10051).
- FAC-C-01/02/03: `esComprobanteSinIVA` solo C/NC-C; Factura C → ImpNeto=ImpTotal, ImpIVA 0, sin array Iva; B discrimina.
- FAC-DESC-01→06: `prorratearDescuentoGlobal` (G0.6) — la factura/NC se emite por lo REALMENTE pagado; redondeo al último ítem; multi-alícuota proporcional; no-op sin descuento.

## 3. Documento del receptor — `determinarReceptor` (FAC-DOC) ✅

- FAC-DOC-01: Factura B bajo umbral, CF → DocTipo 99 / DocNro 0 / condId 5.
- FAC-DOC-02: Factura B ≥ umbral con DNI → DocTipo 96 / DNI sin puntos.
- FAC-DOC-03: Factura B ≥ umbral sin DNI → cae a 99/0 (la EF además bloquea: FAC-27).
- FAC-DOC-04: Factura A con CUIT → DocTipo 80 / CUIT sin guiones.
- FAC-DOC-05: Factura A sin CUIT → lanza error.
- FAC-DOC-06: condicionIvaReceptorId mapea RI→1, CF→5, Mono→4, Exento→2.
- FAC-DOC-07: umbral configurable por tenant respetado.

## 4. QR fiscal RG 4291 — `buildQrAfipUrl` (FAC-QR) ✅

- FAC-QR-01: URL `https://www.afip.gob.ar/fe/qr/?p=` + payload base64 decodable.
- FAC-QR-02: campos del payload (ver=1, fecha 10 chars, cuit/codAut numéricos, tipoCmp).
- FAC-QR-03: receptor CUIT (11 díg) → tipoDocRec 80.
- FAC-QR-04: receptor DNI (7-10 díg) → tipoDocRec 96.
- FAC-QR-05: receptor vacío → tipoDocRec 99, nroDocRec 0.

## 5. Transporte WSFE propio — `wsfe-core.ts` (FAC-WSFE) ✅ (`wsfePropio.test.ts`)

REGLA #0: el orden de los elementos del det sale del XSD real; si se rompe, AFIP rechaza
TODA emisión del circuito propio.

- WSAA: TRA (ventana ±20min, uniqueId epoch), envelope LoginCms, parser del TA, fault
  `coe.alreadyAuthenticated` (flag), otros faults, `taVigente` (margen 5 min, formato −03:00).
- FECAEDetRequest: **ImpTrib ANTES que ImpIVA** (payload los declara al revés); secuencia
  completa del XSD (B); C sin array `Iva` ni `FchServ*`; NC-C con `CbtesAsoc`
  (CondIVARecep < CbtesAsoc < Iva); Concepto 3 → `FchServ*` entre ImpIVA y MonId; ausentes
  no emiten elemento.
- **NC-B (RI): CbtesAsoc E Iva conviven en orden XSD** *(agregado 2026-07-10)*.
- **Factura C de plataforma: Concepto 2 + FchServ*, CF 99/0, sin Iva** *(agregado 2026-07-10)*.
- Envelopes FECAESolicitar (Auth+FeCabReq+FeDetReq) / FECompUltimoAutorizado; endpoints y
  SOAPAction por ambiente.
- Parsers: aprobada (A + CAE + vto), rechazada (R + Observaciones parseadas), Errors (600…),
  último autorizado (CbteNro / Errors sin inventar número), SOAP Fault lanza, `fmtWsfeErrs`.

## 6. Libro IVA Ventas con NC — `libroIva.ts` (FAC-LIBRO) ✅ *(nuevo 2026-07-10, hallazgo H1)*

**Hallazgo:** hasta v1.125.0 las NC electrónicas emitidas NO restaban débito en Libro IVA
Ventas, KPIs de Facturación, liquidación 12 meses, Posición IVA (Dashboard) ni el área
Facturación del Dashboard → débito fiscal sobre-declarado tras cualquier devolución
facturada. La NC se imputa por `nc_fecha` (fecha de emisión, mig 266), no por la fecha de
la devolución.

- FAC-LIBRO-01: mapeo crudo devoluciones → ítems (precio×cantidad, alícuota del producto,
  numeric strings).
- FAC-LIBRO-02/03: fecha del libro = `nc_fecha`; fallback `created_at` (NC pre-mig 266).
- FAC-LIBRO-04: NC-C → una fila, neto negativo total, IVA 0, alícuota '—'.
- FAC-LIBRO-05: NC-B 21% → resta neto Y débito (desglose idéntico al comprobante).
- FAC-LIBRO-06: NC multi-alícuota → una fila por alícuota, normalización numeric.
- FAC-LIBRO-07: nc_tipo null cae a NC-C (no resta débito de más).
- FAC-LIBRO-08/09/10: `ivaNcTotal` / `netoNcTotal` / `debitoNeto` (puede dar negativo).
- FAC-LIBRO-11: redondeo 2 decimales.
- Superficies integradas: FacturacionPage (KPIs, libro ventas + export Excel, liquidación),
  DashboardPage (Posición IVA), DashFacturacionArea (débito/neto del mes + evolución 6m).

## 7. Guards server-side de la EF `emitir-factura` (FAC-EF) — e2e 56 + UAT §11/§29

- FAC-EF-01: **identidad** *(nuevo 2026-07-10, hallazgo H2)* — anon key pelado → **401**;
  usuario válido de OTRO tenant → **403**; service_role → pasa (flujos internos). Antes la
  EF era invocable con el anon key (público) para cualquier tenant.
- FAC-EF-02: emisor Mono/Exento fuerza A/B → **400** (e2e 56, con usuario del tenant).
- FAC-EF-03: emisor RI fuerza C → **400** (validado por flip reversible, no en spec).
- FAC-EF-04: Factura A sin CUIT → throw (UAT FAC-04).
- FAC-EF-05: Factura B ≥ umbral sin DNI/CUIT → **400** (FAC-27).
- FAC-EF-06: venta ya con CAE → throw (anti doble emisión); NC sin CAE original → throw;
  devolución con NC ya emitida → throw.
- FAC-EF-07: persistencia post-CAE con reintentos ×3; si falla, error CON el CAE (nunca
  perder un CAE autorizado) — UAT/registro v1.89.0.
- FAC-EF-08: circuito 'propio' sin cert activo → **400** claro ANTES de tocar AFIP; SIN
  fallback automático de provider en la emisión (REGLA #0).
- FAC-EF-09: NC persiste `nc_fecha` (mig 266) + `afip_provider_usado`.

## 8. Facturación de PLATAFORMA (FAC-PLAT) — `emitir-factura-plataforma` + sweeps

Unit: payload C de plataforma via wsfe-core (§5). Decisiones del pago manual:
`facturacionManual.test.ts` (recordatorios 5d/1d dedupe, gracia 5 días, suspensión, reset
tras pago — espejo de `billing-manual-sweep`). El resto es runtime/DB:

- FAC-PLAT-01: solo service_role puede invocarla (401 con cualquier otro token). ✅ diseño +
  validable con curl (sin exponer nada).
- FAC-PLAT-02: idempotencia por `payment_ref` — claim UNIQUE ANTES de tocar AFIP; reintento
  → `ya_procesado` sin re-emisión. Validación: constraint UNIQUE en DEV y PROD + claims sin
  factura correspondiente (query de reconciliación).
- FAC-PLAT-03: **fail-OPEN deliberado** (distinto del resto de REGLA #0): el cobro ya está
  confirmado; si AFIP/el biller falla → alerta a soporte@ + facturar a mano. ⚠ El claim
  queda tomado en los caminos de error (sin_biller/sin_token/sin_cert/afip_*): el sweep NO
  reintenta solo — el circuito de recuperación es la alerta por email (Resend). Escenario
  UAT manual, no automatizable sin biller real.
- FAC-PLAT-04: `platform-facturacion-sweep` — sin biller activo → skip limpio (0 queries a
  MP); pagos aprobados de MP → 1 factura C por payment_ref; `ya_procesado` no cuenta como
  error.
- FAC-PLAT-05: persistencia post-CAE falla → alerta con el CAE (nunca perderlo) +
  `persistido:false`.
- FAC-PLAT-06: monto ≤ 0 / sin concepto / sin payment_ref / origen_pago inválido → 400.
- ⛔ Bloqueado por terceros: emisión real de plataforma (falta `platform_billers` de Fede —
  3 pasos operativos + carga por SQL).

## 9. E2E / runtime (DEV, homologación real) + validaciones por SQL

- e2e 21 (mutante): venta → Factura → **CAE real de homologación** (hoy vía circuito PROPIO,
  default desde mig 265).
- e2e 42 (mutante): devolución de venta facturada → **NC-C real** con CbtesAsoc. ⚠ Fixture:
  una devolución `origen='facturada'` sin `nc_cae` sobre una venta con CAE — re-sembrar por
  SQL antes de correr (se agota con cada corrida).
- e2e 56 (API): guards identidad (401/403) + emisor↔letra (400). Actualizado 2026-07-10.
- e2e 84: las áreas del Dashboard (incl. Facturación) renderizan sin crash.
- e2e 86 *(nuevo 2026-07-10)*: FacturacionPage read-only — KPIs del panel, Libro IVA
  Ventas/Compras con totales (+ filas NC en negativo si hay), liquidación 12 meses.
- SQL (DEV y PROD): duplicados de `numero_comprobante` por (tenant, tipo, pto_venta);
  `facturada` sin CAE; NC con `nc_cae` sin venta con CAE; claims de plataforma huérfanos;
  `afip_wsaa_ta` (cache TA) con expiración coherente.
- PROD: smoke de emisión en el tenant piloto (homologación) + verificación 401 anon
  post-hardening.

## Fuera de alcance unit (e2e / manual con ARCA)

- WSAA login + CAE real (cubierto por e2e 21/42 contra homologación + integración Node).
- Numeración correlativa real y su condición de carrera (mitigada: SIEMPRE
  FECompUltimoAutorizado+1, nunca contador local).
- Render del PDF (jsPDF) y lectura del QR por la app de AFIP (UAT capa C: FAC-06/07/19).
- Matriz §29 con CAE real para emisor RI→A y Exento (falta CUIT RI de homologación distinto
  — bloqueado por GO).
