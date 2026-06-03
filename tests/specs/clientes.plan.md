# Plan de escenarios testeables — Módulo Clientes (CL1–CL6)

> Generado a partir de `G360.Wiki/sources/raw/relevamiento_clientes_respuestas.md` + código real
> (`src/lib/cobranzaCC.ts`, `src/lib/notificacionesCC.ts`, `src/components/CajaCobranzasCC.tsx`,
> `src/pages/VentasPage.tsx` enforcement CC, `src/pages/ClientesPage.tsx` aging/incobrables,
> migraciones 171–176). Cada escenario está ligado a un ítem del relevamiento y **confirmado
> contra el código** (no inventado).
>
> Estilo de molde: `tests/unit/ventasSaldo.test.ts` (Given/When/Then numéricos, lógica pura).
>
> **Estado actual de cobertura:** los tests existentes (`tests/unit/*.test.ts`,
> `tests/e2e/08_clientes.spec.ts`) NO cubren NINGUNA lógica de CC de clientes. El e2e de
> clientes solo valida render del listado, alta y mención de columna `dni` en import. Toda la
> lógica de plata de CC (FIFO, límite, morosidad, interés, aging) está **sin cubrir**.
>
> **Prioridad por riesgo:** 🔴 alta = mueve plata o afecta RLS/aislamiento de tenant ·
> 🟡 media = UX/notificación · 🟢 baja = cosmético/reporte secundario.

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Escenarios totales | 41 |
| `unit` | 33 |
| `e2e` | 8 |
| Ya cubiertos | 0 |
| Faltan | 41 |

### Candidatos a extracción a `src/lib/` (priorizados por ROI/riesgo)

| Prioridad | Lógica inline | Ubicación actual | Función pura sugerida | Ítem |
|---|---|---|---|---|
| 🔴 1 | Distribución FIFO de cobranza | `src/lib/cobranzaCC.ts` (mezclada con I/O Supabase) | `repartirCobranzaFIFO(ventas, monto)` → `{aplicado, ventasSaldadas, abonos[]}` | CL2-B5 |
| 🔴 2 | Enforcement de límite de CC | inline en `VentasPage.tsx` ~L1803-1812 | `evaluarLimiteCC({deudaTotal, montoCC, limite, politica})` → `'ok'\|'avisar'\|'bloquear'` | CL2-B1 |
| 🔴 3 | Política de morosidad | inline en `VentasPage.tsx` ~L1794-1801 | `evaluarMorosidad({deudaVencida, politica, modoCC})` → `'ok'\|'bloquea'` | CL2-B4 |
| 🔴 4 | Interés de mora mensual | RPC `recalcular_intereses_cc` (mig 172) + sin espejo TS | `calcularInteresMora({saldo, pctMensual, diasVencido})` → number | CL2-B3 |
| 🟡 5 | Aging por buckets | inline en `ClientesPage.tsx` ~L1065-1076 | `agruparAgingCC(ventas, hoy)` → `{'0-30','31-60','61-90','+90'}` | CL6-G1 |
| 🟡 6 | Estado CC agregado (deuda total/vencida) | RPC `cliente_cc_estado` (mig 172) + sin espejo TS | `calcularEstadoCC(ventas, hoy)` → `{deudaTotal, deudaVencida, interesTotal}` | CL2-B3/B4 |
| 🟢 7 | Saldo incobrable a condonar | inline `ClientesPage.tsx` ~L495 | `calcularSaldoCondonable(total, medios)` → number | CL3-B6 |

> Las funciones 1–4 mueven plata y hoy NO se pueden testear sin Supabase. Extraerlas a lógica
> pura es el mayor ROI de testing del módulo. La RPC `recalcular_intereses_cc` y
> `cliente_cc_estado` corren en Postgres: el espejo TS sirve para test unit + para que el
> frontend pueda validar antes de pegarle a la DB.

---

## Sección 1 — Cobranza FIFO (CL2-B5) 🔴

**Fuente:** `src/lib/cobranzaCC.ts::cobrarDeudaCCFIFO`. Reparte un monto sobre las ventas CC
pendientes (`despachada`/`facturada`) del cliente, **más antigua primero** (`created_at` asc).
Filtra ventas con saldo `> 0.5`. Abona `min(restante, saldo)` por venta. Corta cuando
`restante <= 0.5`. Una venta se cuenta saldada si `nuevoMontoPagado >= total - 0.5`.

> **Pre-requisito de testing:** extraer el reparto puro `repartirCobranzaFIFO(ventas, monto)`
> separado del UPDATE a Supabase (candidato 🔴 1).

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL2-B5-01 | Ventas CC: V1 `{total:1000, pagado:0, created:día1}`, V2 `{total:500, pagado:0, día2}` | Cobro $1000 | V1 queda saldada (pagado=1000), V2 intacta; aplicado=1000, ventasSaldadas=1 | unit | falta |
| CL2-B5-02 | Mismas V1, V2 | Cobro $1200 | V1 saldada (1000), V2 abona 200 (pagado=200, sigue pendiente); aplicado=1200, saldadas=1 | unit | falta |
| CL2-B5-03 | Mismas V1, V2 | Cobro $1500 | V1 y V2 saldadas; aplicado=1500, saldadas=2 | unit | falta |
| CL2-B5-04 | Mismas V1, V2 | Cobro $2000 (excede deuda total 1500) | aplicado=1500 (no sobre-aplica), saldadas=2, sobrante 500 no se asigna | unit | falta |
| CL2-B5-05 | V1 `{total:1000, pagado:600}` (saldo 400) | Cobro $400 | V1 saldada; aplicado=400 | unit | falta |
| CL2-B5-06 | V1 `{total:1000, pagado:999.7}` (saldo 0.3 < umbral) | Cobro $500 | V1 se ignora (saldo ≤ 0.5); aplicado=0, saldadas=0 | unit | falta |
| CL2-B5-07 | Ventas con saldo | Cobro $0 / $-100 | early-return: aplicado=0, saldadas=0, sin UPDATE | unit | falta |
| CL2-B5-08 | V1 con `medio_pago` previo `[{Efectivo,600}]` | Cobro $400 Transferencia | se hace **push** `{tipo:Transferencia,monto:400}` (no reemplaza), array queda con 2 medios | unit | falta |
| CL2-B5-09 | V1 con `medio_pago` corrupto (no parseable) | Cobro $400 | parse falla → `medios=[]`, se agrega el abono sin romper | unit | falta |
| CL2-B5-10 | Ordenadas V2(día2), V1(día1) en input desordenado | Cobro parcial $300 | abona la **más antigua** primero (orden por `created_at` asc lo garantiza la query; el reparto debe respetar el orden recibido) | unit | falta |
| CL2-B5-11 (e2e) | Cliente con 2 ventas CC pendientes, caja abierta | Cobranza masiva desde Caja → tab "Cobranzas CC", monto = deuda total | toast "Cobranza de $X registrada", cliente desaparece de la lista | e2e | falta |

> **Nota de no-duplicación:** `acumularMediosPago` (ya testeado en `ventasSaldo.test.ts`) NO es
> lo mismo que el push de FIFO — FIFO siempre hace push sin fusionar por tipo. No reescribir
> esos casos; CL2-B5-08 cubre el comportamiento propio de FIFO.

---

## Sección 2 — Enforcement de límite de CC (CL2-B1) 🔴

**Fuente:** `VentasPage.tsx::registrarVenta` ~L1803-1812. Precedencia de límite:
`cliente.limite_credito` > `tenant.limite_cc_default` > sin límite (null). Se evalúa solo sobre
la parte que va a CC (`montoCC > 0.5`). Dispara si `deudaTotal + montoCC > limite + 0.5`.
Política `tenant.cc_enforcement_politica`: `permitir` (no chequea) / `avisar` (confirm, default) /
`bloquear` (corta).

> **Extracción sugerida:** `evaluarLimiteCC({deudaTotal, montoCC, limite, politica})` →
> `'ok' | 'avisar' | 'bloquear'` (candidato 🔴 2).

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL2-B1-01 | límite=10000, deudaTotal=8000, política=bloquear | montoCC=1000 (total 9000 ≤ límite) | `'ok'` — no supera | unit | falta |
| CL2-B1-02 | límite=10000, deudaTotal=8000, política=bloquear | montoCC=3000 (total 11000 > 10000) | `'bloquear'` | unit | falta |
| CL2-B1-03 | límite=10000, deudaTotal=8000, política=avisar | montoCC=3000 | `'avisar'` (confirm, puede continuar) | unit | falta |
| CL2-B1-04 | límite=10000, deudaTotal=8000, política=permitir | montoCC=99999 | `'ok'` — política permitir nunca chequea | unit | falta |
| CL2-B1-05 | cliente.limite_credito=5000, tenant.limite_cc_default=20000 | montoCC tal que deudaTotal+montoCC=6000 | usa límite del **cliente** (5000) → dispara, no el del tenant | unit | falta |
| CL2-B1-06 | cliente.limite_credito=null, tenant.limite_cc_default=20000 | total 6000 | usa límite del **tenant** (20000) → `'ok'` | unit | falta |
| CL2-B1-07 | límite=null (ni cliente ni tenant) | montoCC=99999 | `'ok'` — sin límite no se chequea | unit | falta |
| CL2-B1-08 | límite=10000, deudaTotal=9999.6 | montoCC=0.5 (total 10000.1, dentro de tolerancia +0.5) | `'ok'` — tolerancia ±0.5 no dispara | unit | falta |
| CL2-B1-09 (e2e) | tenant política=bloquear, cliente con límite bajo y deuda cercana | POS: vender a CC un monto que excede el límite | toast de bloqueo, venta NO se registra | e2e | falta |

---

## Sección 3 — Morosidad (CL2-B4) 🔴

**Fuente:** `VentasPage.tsx::registrarVenta` ~L1788-1801. `tenant.cc_morosidad_politica`:
`permitir` / `bloqueo_cc` (default) / `bloqueo_total`. Solo se evalúa con `deudaVencida > 0.5`.
`bloqueo_total` bloquea cualquier venta (aún efectivo) y se chequea aunque `modoCC=false`.
`bloqueo_cc` solo bloquea si `modoCC=true` (deja pagar por otro medio). El chequeo solo corre
si `estado !== 'pendiente'` y `(modoCC || política===bloqueo_total)`.

> **Extracción sugerida:** `evaluarMorosidad({deudaVencida, politica, modoCC})` →
> `'ok' | 'bloquea'` (candidato 🔴 3).

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL2-B4-01 | deudaVencida=0, política=bloqueo_total | venta efectivo (modoCC=false) | `'ok'` — sin deuda vencida no bloquea | unit | falta |
| CL2-B4-02 | deudaVencida=5000, política=bloqueo_total | venta efectivo (modoCC=false) | `'bloquea'` — bloquea aún sin CC | unit | falta |
| CL2-B4-03 | deudaVencida=5000, política=bloqueo_cc, modoCC=true | nueva venta CC | `'bloquea'` — no puede sumar a CC | unit | falta |
| CL2-B4-04 | deudaVencida=5000, política=bloqueo_cc, modoCC=false | venta efectivo | `'ok'` — bloqueo_cc deja pagar por otro medio | unit | falta |
| CL2-B4-05 | deudaVencida=5000, política=permitir, modoCC=true | nueva venta CC | `'ok'` — política permitir nunca bloquea | unit | falta |
| CL2-B4-06 | deudaVencida=0.4 (≤ umbral), política=bloqueo_total | venta efectivo | `'ok'` — umbral 0.5 | unit | falta |
| CL2-B4-07 (e2e) | tenant política=bloqueo_cc, cliente con deuda vencida | POS: intentar vender a CC | toast "No puede sumar a cuenta corriente; cobrá por otro medio", venta CC bloqueada | e2e | falta |

---

## Sección 4 — Interés de mora (CL2-B3) 🔴

**Fuente:** RPC `recalcular_intereses_cc` (mig 172, L80-84). Fórmula:
`interes = round(saldoPendiente * (pctMensual/100) * (diasVencido/30), 2)`, donde
`saldoPendiente = max(total - pagado, 0)` y `diasVencido = max(0, hoy - fecha_vencimiento_cc)`.
Idempotente. Interés=0 si: pct≤0, saldo≤0.5, sin vencimiento, o no vencido (`venc >= hoy`).

> **Extracción sugerida:** espejo TS `calcularInteresMora({saldo, pctMensual, diasVencido})` →
> number (candidato 🔴 4). Permite test unit y validación frontend del valor que muestra la
> RPC en el tab CC.

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL2-B3-01 | saldo=10000, pct=5%/mes, diasVencido=30 | calcular | interés = 10000·0.05·(30/30) = **500** | unit | falta |
| CL2-B3-02 | saldo=10000, pct=5%, diasVencido=15 | calcular | interés = 10000·0.05·0.5 = **250** | unit | falta |
| CL2-B3-03 | saldo=10000, pct=5%, diasVencido=45 | calcular | interés = 10000·0.05·1.5 = **750** | unit | falta |
| CL2-B3-04 | saldo=10000, pct=0%, diasVencido=30 | calcular | interés = **0** (sin interés configurado) | unit | falta |
| CL2-B3-05 | saldo=10000, pct=5%, diasVencido=0 (no vencida) | calcular | interés = **0** (`max(0, ...)` corta) | unit | falta |
| CL2-B3-06 | saldo=10000, pct=5%, diasVencido=-5 (venc futuro) | calcular | interés = **0** (`max(0, dias)`) | unit | falta |
| CL2-B3-07 | saldo=0.3 (≤0.5), pct=5%, diasVencido=30 | calcular | interés = **0** (saldo bajo umbral, lo limpia el sweep) | unit | falta |
| CL2-B3-08 | saldo=12345.67, pct=3.5%, diasVencido=20 | calcular | interés = round(12345.67·0.035·(20/30),2) = **288.07** (corregido: el plan tenía 287.40 mal calculado; el código es correcto — lo detectó test-author) | unit | cubierto |
| CL2-B3-09 | mismo input | correr el cálculo 2 veces | idempotente: mismo resultado (la RPC recomputa desde el saldo, no acumula) | unit | falta |

---

## Sección 5 — Estado de CC agregado (CL2-B3/B4) 🔴

**Fuente:** RPC `cliente_cc_estado` (mig 172, L37-52). Agrega ventas CC del cliente
(no canceladas, saldo `> 0.5`): `deuda_total = Σ(max(total-pagado,0) + interes_cc)`;
`deuda_vencida` = misma suma pero solo de ventas con `fecha_vencimiento_cc < hoy`;
`interes_total = Σ interes_cc`. **Tenant-scoped** (subquery `tenant_id IN users where id=auth.uid()`).

> **Extracción sugerida:** espejo TS `calcularEstadoCC(ventas, hoy)` (candidato 🟡 6).
> El alcance tenant es RLS server-side; no testeable en unit (cubrir en e2e/RLS).

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL2-B3-10 | V1 `{total:1000,pagado:0,interes:50,venc:ayer}`, V2 `{total:500,pagado:500,...}` | calcular estado | deuda_total=1050, deuda_vencida=1050, V2 excluida (saldo≤0.5) | unit | falta |
| CL2-B3-11 | V1 `{total:1000,pagado:0,interes:0,venc:mañana}`, V2 `{total:2000,pagado:0,interes:100,venc:ayer}` | calcular | deuda_total=3100, deuda_vencida=2100 (solo V2 vencida) | unit | falta |
| CL2-B3-12 | venta `estado='cancelada'` con saldo | calcular | excluida (no suma) | unit | falta |
| CL2-B3-13 | sin ventas CC | calcular | deuda_total=0, deuda_vencida=0, interes_total=0 (COALESCE) | unit | falta |
| CL2-B3-14 (e2e/RLS) 🔴 | usuario tenant A, cliente del tenant B | `cliente_cc_estado(clienteB)` | devuelve 0 / vacío — aislamiento de tenant garantizado por el subquery | e2e | falta |

---

## Sección 6 — Aging de deuda CC (CL6-G1) 🟡

**Fuente:** `ClientesPage.tsx` tab Reportes ~L1065-1076. Por cada venta CC no condonada con
`saldo = total - pagado + interes_cc > 0.5`: `ref = fecha_vencimiento_cc (12:00) ?? created_at`;
`dias = floor((hoy - ref)/día)`. Buckets: `dias<=30` → `0-30`; `<=60` → `31-60`;
`<=90` → `61-90`; resto → `+90`. Suma el saldo en su bucket.

> **Extracción sugerida:** `agruparAgingCC(ventas, hoy)` → `{'0-30','31-60','61-90','+90'}`
> (candidato 🟡 5).

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL6-G1-01 | venta saldo 1000, venc hace 10 días | agrupar | bucket `0-30` = 1000 | unit | falta |
| CL6-G1-02 | venta saldo 1000, venc hace 45 días | agrupar | bucket `31-60` = 1000 | unit | falta |
| CL6-G1-03 | venta saldo 1000, venc hace 75 días | agrupar | bucket `61-90` = 1000 | unit | falta |
| CL6-G1-04 | venta saldo 1000, venc hace 120 días | agrupar | bucket `+90` = 1000 | unit | falta |
| CL6-G1-05 | venta venc hace exactamente 30 días | agrupar | `0-30` (límite inclusivo `<=30`) | unit | falta |
| CL6-G1-06 | venta venc hace exactamente 31 días | agrupar | `31-60` | unit | falta |
| CL6-G1-07 | venta condonada con saldo | agrupar | NO suma (se saltea `v.condonada`) | unit | falta |
| CL6-G1-08 | venta saldo 0.3 (≤0.5) | agrupar | NO suma | unit | falta |
| CL6-G1-09 | venta sin `fecha_vencimiento_cc`, `created_at` hace 100 días | agrupar | usa `created_at` como ref → `+90` | unit | falta |
| CL6-G1-10 | venta saldo incluye interés: total 1000, pagado 0, interes 200 | agrupar | suma **1200** (saldo incluye interes_cc) | unit | falta |
| CL6-G1-11 | 3 ventas en buckets distintos | agrupar | cada bucket acumula su saldo, total = Σ | unit | falta |

---

## Sección 7 — Incobrables / condonación (CL3-B6) 🟢/🔴

**Fuente:** `ClientesPage.tsx::condonarDeudaCC` ~L487-506 y baja incobrable ~L534-571.
Saldo condonable de una venta = `total - Σ(medios.tipo != 'Cuenta Corriente').monto`. Si saldo>0
se hace push `{tipo:'Condonación CC'/'Incobrable', monto:saldo,...}` y `monto_pagado=total`.
Baja incobrable: requiere clave maestra (si el tenant la tiene), tag `Incobrable` (excluido de
ingresos), crea gasto auto categoría "Deudores incobrables" por el total, `logActividad`.

> **Extracción sugerida:** `calcularSaldoCondonable(total, medios)` → number (candidato 🟢 7).

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL3-B6-01 | total=1000, medios `[{Cuenta Corriente,1000}]` | calcular saldo condonable | saldo = 1000 (CC no cuenta como pago real) | unit | falta |
| CL3-B6-02 | total=1000, medios `[{Efectivo,400},{Cuenta Corriente,600}]` | calcular | saldo = 600 (solo el pago real descuenta) | unit | falta |
| CL3-B6-03 | total=1000, medios `[{Efectivo,1000}]` | calcular | saldo = 0 → no hay nada que condonar (no push) | unit | falta |
| CL3-B6-04 | suma de saldos pendientes de N ventas del cliente | dar de baja incobrable | gasto auto = Σ saldos (total incobrable) — validar agregación | unit | falta |
| CL3-B6-05 (e2e) 🔴 | tenant con clave maestra, cliente con deuda CC | baja incobrable sin clave / clave errónea | toast error, deuda NO se condona | e2e | falta |
| CL3-B6-06 (e2e) | tenant sin clave maestra, DUEÑO, cliente con deuda | baja incobrable con motivo | deuda saldada (tag Incobrable), gasto "Deudores incobrables" creado, entrada en historial | e2e | falta |

---

## Sección 8 — Notificaciones CC (CL4) 🟡

**Fuente:** `src/lib/notificacionesCC.ts`. `emailHabilitado(tenant)` = `cc_notif_canales`
incluye `'email'`. `notificarRegistroDeudaCC` dispara si `clienteId && cc_notif_registro_deuda
&& emailHabilitado && monto>0.5 && cliente tiene email`. `notificarPagoCC` análogo con
`cc_notif_pago`. Fire-and-forget (nunca lanza). La decisión de enviar es lógica pura testeable
si se extrae el guard.

> **Extracción sugerida:** `debeNotificar(tenant, {flag, monto})` → boolean — separar el guard
> del `supabase.functions.invoke`. Bajo ROI (no mueve plata) pero barato.

| ID | Given | When | Then | Tipo | Estado |
|---|---|---|---|---|---|
| CL4-C1-01 | tenant `cc_notif_canales=['email']`, `cc_notif_registro_deuda=true`, monto=1000 | evaluar guard registro deuda | true (debe notificar) | unit | falta |
| CL4-C1-02 | tenant `cc_notif_canales=['whatsapp']` (sin email) | evaluar | false (email no habilitado; WA no auto-envía) | unit | falta |
| CL4-C1-03 | `cc_notif_registro_deuda=false` | evaluar | false (flag apagado, default OFF opt-in) | unit | falta |
| CL4-C1-04 | monto=0.4 (≤0.5) | evaluar | false (umbral) | unit | falta |
| CL4-C1-05 | clienteId=null | evaluar | false (sin cliente no se notifica) | unit | falta |
| CL4-C4-01 | `cc_notif_pago=true`, email habilitado, monto pago=500 | evaluar guard pago | true | unit | falta |

---

## Notas de implementación / no-duplicación

- **No reescribir** lo ya cubierto en `tests/unit/ventasSaldo.test.ts`
  (`calcularSaldoPendiente`, `validarSaldoMediosPago`, `validarDespacho`, `acumularMediosPago`).
  El FIFO de cobranza es lógica distinta (push sin fusión, orden por antigüedad).
- **Umbral $0.50** es transversal a todo el módulo (FIFO, límite, morosidad, interés, aging).
  Cada sección incluye un caso de borde de tolerancia.
- **RPCs en Postgres** (`cliente_cc_estado`, `recalcular_intereses_cc`): el test unit valida el
  **espejo TS** de la fórmula; el aislamiento por tenant (RLS/SECURITY DEFINER) solo se puede
  probar en e2e con dos tenants (CL2-B3-14, alta prioridad por seguridad).
- **e2e con datos**: requieren cliente con CC y caja abierta. Reusar helpers de
  `tests/e2e/helpers/navigation.ts`. El e2e actual de clientes no setea CC; estos son nuevos.
