---
title: Consultas para el Contador
category: business
tags: [fiscal, contable, iva, afip, monotributo, ganancias, pendientes, consultas]
sources: [relevamiento USD/Caja C2, mig 414, cotizacionFiscal.ts, DashFacturacionArea.tsx, respuestas relevamiento Multimoneda 2026-09-20 (RG ARCA 5616/2024), sources/raw/respuestas_puntos_abiertos_2026-09-25.md]
updated: 2026-09-25
---

# Consultas para el Contador

**Qué es esto:** el registro **vivo** de todas las preguntas fiscales y contables que Genesis360
tiene abiertas, para entregárselas a un Contador Público Matriculado el día que lo tengamos y que
las responda de una vez.

**Cómo se usa:**

1. Cada vez que aparece una duda fiscal/contable durante el desarrollo, **se agrega acá** con su
   número (`C-NN`), en vez de quedar enterrada en un comentario del código o en el `log.md`.
2. Cuando haya contador, se genera el PDF/HTML imprimible con `npm run contador:doc` y se le
   entrega. El documento tiene espacio para que responda cada punto.
3. Con las respuestas en la mano, se vuelve acá: se pasa la pregunta a ✅, se escribe la respuesta
   textual, y **se ajusta el código y el wiki** donde el criterio provisorio haya quedado mal.

> [!WARNING]
> **Nada de lo que está implementado hoy sobre estos temas está validado por un profesional.**
> Donde hubo que decidir para poder seguir, se adoptó un **criterio provisorio** — está marcado en
> cada pregunta y también en el código (`src/lib/cotizacionFiscal.ts`, mig 414). Si el contador dice
> otra cosa, cambia el código.

---

## Estado

| Estado | Cantidad |
|---|---|
| 🟥 Abiertas | 18 |
| ✅ Respondidas por un matriculado | 0 |

⚠️ **Ninguna respondida todavía.** La C-01 y sus derivadas tienen una respuesta **de una IA que se
presentó como contador** (consulta de GO, 2026-09-13); GO la adoptó como criterio de trabajo, pero
**no cuenta como validada** y hay que repreguntarla igual.

---

## Bloque 1 — Gastos en moneda extranjera y el Libro IVA

Este bloque es el más grande y el que ya está implementado sobre un criterio sin validar. Es la
prioridad si el contador solo tiene tiempo para un bloque.

### C-01 · ¿Un gasto en moneda extranjera genera crédito fiscal computable, y a qué tipo de cambio?

- **Estado:** 🟥 Abierta (hay respuesta de una IA, no de un matriculado)
- **Área:** IVA — crédito fiscal
- **Impacta en:** `src/lib/cotizacionFiscal.ts`, mig 414, Libro IVA Compras, posición de IVA
- **Criterio provisorio implementado:** sí genera crédito fiscal computable (art. 12 Ley 23.349) si
  está vinculado a la actividad gravada y tiene comprobante válido con IVA discriminado; la DDJJ va
  en pesos (art. 96 Ley 11.683); se convierte al **BNA vendedor del día hábil anterior** a la fecha
  del comprobante.

**Pregunta:** ¿es correcto? ¿Es el tipo vendedor o el comprador? ¿Es el día hábil anterior al
comprobante, o el del comprobante mismo?

**Por qué importa:** de esto depende el número de crédito fiscal que el sistema declara. Si la tasa
está mal, la posición de IVA de todos los períodos con gastos en moneda extranjera está mal.

---

### C-02 · Importación de servicios (reverse charge): ¿la fecha es la del pago?

- **Estado:** 🟥 Abierta
- **Área:** IVA — importación de servicios
- **Impacta en:** hoy **no está implementado** — el sistema no distingue una importación de
  servicios de un gasto común en moneda extranjera.
- **Criterio provisorio:** en importación de servicios (art. 1° inc. d) la cotización sería la del
  día hábil anterior al **pago**, no al comprobante, y el crédito se computa en el período en que se
  verifica el pago (F.2002/F.2003).

**Pregunta:** ¿se confirma? Y sobre todo: **¿hace falta que el sistema lo distinga?** Es decir,
¿tiene sentido un checkbox "es importación de servicios" en el gasto que cambie qué fecha se usa?

**Por qué importa:** hoy un gasto de un servicio del exterior (hosting, software, publicidad) se
trata igual que cualquier otro. Si el tratamiento es distinto, lo estamos haciendo mal en silencio.

---

### C-03 · ¿Qué cotización se usa cuando el día hábil anterior fue feriado?

- **Estado:** 🟥 Abierta
- **Área:** IVA — tipo de cambio
- **Impacta en:** `diaHabilAnterior()` en `src/lib/cotizacionFiscal.ts`
- **Criterio provisorio:** la función retrocede un día y salta sábados y domingos, pero **no
  contempla feriados** (el sistema no tiene calendario de feriados cargado). Por eso la fecha que
  propone es **editable** y se guarda junto con la tasa, para poder auditar cuál se usó.

**Pregunta:** cuando el día hábil anterior cae feriado y el BNA no publicó cotización, ¿qué se usa?
¿El último día con publicación? ¿Y vale la pena que carguemos el calendario de feriados para
automatizarlo, o alcanza con que lo corrija a mano quien carga el gasto?

---

### C-04 · La nota de corrección de un gasto en moneda extranjera, ¿lleva la tasa del original o la suya?

- **Estado:** 🟥 Abierta
- **Área:** IVA — notas de crédito / correcciones
- **Impacta en:** `abrirCorreccion()` en `src/pages/GastosPage.tsx`
- **Criterio provisorio:** la nota **arrastra la cotización del gasto que corrige**.

**Pregunta:** ¿es correcto, o la nota de crédito del proveedor —siendo un comprobante propio con su
propia fecha— debe convertirse al BNA vendedor del día hábil anterior a **su** fecha?

**Por qué importa:** es una disyuntiva real, no una preferencia. Si la nota usara la tasa de su
propia fecha, **revertir un gasto no daría cero**: quedaría un resto de IVA crédito por la diferencia
de cambio entre las dos fechas. Elegimos arrastrar la tasa del original justamente para que la
reversión cierre en cero, pero puede ser que fiscalmente corresponda lo otro y esa diferencia tenga
que existir (y en ese caso, ¿dónde se imputa?).

---

### C-05 · Gastos fijos recurrentes en moneda extranjera: ¿una cotización por devengamiento?

- **Estado:** 🟥 Abierta
- **Área:** IVA — gastos recurrentes
- **Impacta en:** tabla `gastos_fijos` (hoy **no** tiene columnas de cotización fiscal)
- **Criterio provisorio:** ninguno. Hoy un gasto fijo en otra moneda se materializa **sin
  cotización** y queda fuera del Libro IVA, con aviso.

**Pregunta:** un servicio recurrente en dólares (ej. un software que se paga todos los meses),
¿lleva una cotización distinta cada mes según la fecha de cada comprobante? ¿O se puede fijar una?

**Por qué importa:** define si hay que agregar las columnas a `gastos_fijos` y pedir la cotización
en cada devengamiento, o si alcanza con lo que hay.

---

### C-06 · Gastos históricos sin cotización: ¿se pueden incorporar retroactivamente?

- **Estado:** 🟥 Abierta
- **Área:** IVA — períodos anteriores
- **Impacta en:** mig 414 se aplicó **sin backfill** a propósito
- **Criterio provisorio:** no se les inventó una tasa retroactiva. Los gastos en moneda extranjera
  anteriores a la mig 414 quedan sin cotización y **fuera** del Libro IVA, con aviso explícito de
  cuánto crédito quedó sin declarar.

**Pregunta:** si un negocio tiene gastos viejos en dólares que nunca se declararon por esto, ¿se
pueden incorporar ahora? ¿Con qué tipo de cambio — el que correspondía a la fecha del comprobante?
¿Se rectifica la DDJJ del período o entra en el período actual?

---

## Bloque 2 — Ventas cobradas en dólares

### C-07 · ¿Qué cotización se declara en un comprobante AFIP cuando la venta se cobró en USD?

- **Estado:** 🟥 Abierta desde 2026-08 (es el punto **C2** del relevamiento de USD/Caja — la única
  fase de ese proyecto que quedó sin cerrar, justamente esperando un contador)
- **Área:** IVA / facturación
- **Impacta en:** Edge Function `emitir-factura`, `ventas.cotizacion_usd`
- **Criterio provisorio:** la factura **siempre se emite en pesos** (no se usa `MonId='DOL'` de
  WSFE) y se guarda la cotización usada por venta. Pero **no está definido de qué fuente exacta debe
  salir esa cotización** a efectos fiscales.

**Pregunta:** cuando se cobra una venta en dólares y se factura en pesos, ¿qué cotización hay que
usar para el comprobante? ¿Banco Nación? ¿Comprador o vendedor? ¿De qué día — el de la operación o
el hábil anterior?

**Por qué importa:** hoy el sistema usa la cotización **comercial** que el dueño carga a mano (que
puede ser blue, MEP, oficial — la elige él). Para la operación interna está bien, pero si lo que va
al comprobante tiene que ser una fuente oficial específica, son dos números distintos y hay que
separarlos, igual que hicimos con los gastos.

---

### C-08 · Valuar en dólar comprador lo que el negocio tiene, ¿es correcto?

- **Estado:** 🟥 Abierta
- **Área:** Valuación / balance
- **Impacta en:** convención de todo el sistema (`reference_usd_ars_usa_dolar_compra`)
- **Criterio provisorio:** para convertir USD→ARS en reportes internos (cuánto vale la caja en
  dólares, cuánto valen las tenencias) el sistema usa el **dólar comprador**, con el razonamiento de
  que es lo que el negocio obtendría si vendiera esos dólares.

**Pregunta:** ¿es el criterio correcto para valuar tenencias en moneda extranjera? ¿Cambia si es
para un balance formal en vez de para gestión interna?

> [!NOTE] **Relacionada con C-16 (2026-09-25):** GO decidió reemplazar el dólar comprador por el
> vendedor divisa BNA del día hábil anterior en el resto del sistema (POS, ficha, importador, pagos en
> USD) incluyendo la Bóveda — ver C-16. Si aplica también acá (valuación de tenencias para reportes), lo
> resuelve la misma implementación (D-1). **Implementado el 2026-09-26 (fase 2, mig 440)**: la Bóveda
> y los dashboards ya valúan USD al vendedor divisa BNA del día hábil anterior.

---

## Bloque 3 — Ganancias y patrimonio

### C-09 · Gasto "del negocio" vs "personal": ¿qué criterio le damos al usuario?

- **Estado:** 🟥 Abierta
- **Área:** Impuesto a las Ganancias
- **Impacta en:** `gastos.deduce_ganancias` + `gastos.gasto_negocio` (el usuario marca cuál es)
- **Criterio provisorio:** el sistema le pregunta al usuario si el gasto pertenece al negocio o es
  personal, y le avisa que si pertenece al negocio y tiene la factura correspondiente "podría
  deducirse de Ganancias". No valida nada: es declarativo.

**Pregunta:** ¿ese texto es correcto y suficiente? ¿Hay categorías de gasto que conviene marcar
explícitamente como **no deducibles** para que el sistema no las ofrezca (ej. algún tipo de
comprobante, o gastos de un monotributista)?

---

### C-10 · Capitalización de recursos sin amortización: ¿falta algo?

- **Estado:** 🟥 Abierta
- **Área:** Ganancias / activo fijo
- **Impacta en:** `gastos.capitaliza_recurso`, módulo Recursos
- **Criterio provisorio:** un gasto vinculado a un recurso se puede marcar como "capitaliza" y
  **suma al valor patrimonial** del recurso. El sistema **no calcula amortización** de ningún tipo.

**Pregunta:** para el tipo de negocio al que apuntamos (comercio/depósito pyme), ¿la amortización de
bienes de uso es algo que el sistema debería calcular, o es trabajo del estudio contable y con
registrar el valor y las mejoras alcanza?

---

## Bloque 4 — Monotributo

### C-11 · 🐛 El indicador de tope de categoría mide el año calendario, ¿no deberían ser 12 meses móviles?

- **Estado:** 🟥 Abierta — el período ya se corrigió (ver abajo); quedan la base y la frecuencia
- **Área:** Monotributo — recategorización
- **Impacta en:** `src/components/DashFacturacionArea.tsx` (tarjeta "Últimos 12 meses vs Tope Cat." y
  las alertas de 75% / 90%)
- **Criterio provisorio:** desde el 2026-09-14 (decisión de GO) el sistema suma las ventas
  despachadas/facturadas de los **últimos 12 meses móviles** y lo compara contra el límite de la
  categoría. Antes sumaba **desde el 1° de enero**, y eso subestimaba sistemáticamente a principio de año:
  en febrero marcaba casi cero aunque el negocio viniera facturando al 95% del tope desde hacía meses.

**Pregunta:** ¿es correcto medir sobre los **últimos 12 meses móviles**, que es lo que mira ARCA en cada
recategorización? ¿La recategorización es **semestral** (enero y julio) o **cuatrimestral**? Este registro
decía cuatrimestral; creemos que es semestral desde 2017, pero no está validado.

**Por qué importa:** es un número rotulado como estimación que no emite nada ni mueve plata, pero sobre
el que alguien podría decidir no recategorizarse.

**Preguntar también:** ¿la base son las ventas facturadas (devengado) o lo efectivamente cobrado
(percibido)? Hoy el sistema suma el total de las ventas despachadas/facturadas.

---

## Bloque 5 — Liquidación y comprobantes

### C-12 · Retenciones y percepciones sufridas: ¿deberían descontarse solas de la posición?

- **Estado:** 🟥 Abierta
- **Área:** IVA — liquidación
- **Impacta en:** tabla `retenciones_sufridas`, tab Liquidación de Facturación
- **Criterio provisorio:** el sistema **las registra y las lista**, pero **no las resta** de la
  posición de IVA que muestra. La posición que exhibe es débito − crédito, a secas.

**Pregunta:** ¿la posición que se le muestra al usuario debería estar neta de retenciones y
percepciones sufridas? ¿O es correcto mostrarlas separadas, porque el saldo de libre disponibilidad
es otra cosa?

---

### C-13 · Percepciones aplicadas: ¿las necesita un comercio típico?

- **Estado:** 🟥 Abierta
- **Área:** IVA / IIBB
- **Impacta en:** hoy **no existen** en el sistema (solo se registran las *sufridas*)
- **Criterio provisorio:** ninguno — no está implementado.

**Pregunta:** un comercio pyme que vende a otros comercios, ¿necesita aplicar percepciones de IVA o
de IIBB en sus propias facturas? ¿O eso solo aplica a agentes de percepción designados, y la mayoría
de nuestros usuarios no lo son?

**Por qué importa:** define si esto es un agujero funcional o algo que correctamente no hacemos.

---

### C-14 · Cierre contable mensual: ¿el criterio de bloqueo es el correcto?

- **Estado:** 🟥 Abierta
- **Área:** Registros contables
- **Impacta en:** RPC `cerrar_periodo`, triggers de período cerrado en `gastos`/`ventas`/`caja_*`
- **Criterio provisorio:** al cerrar un mes, **todo registro con fecha igual o anterior al último día
  de ese mes queda bloqueado** contra UPDATE y DELETE. Para corregir algo hay que emitir una nota de
  corrección con fecha nueva.

**Pregunta:** ¿es el criterio correcto? ¿Hay algo que legítimamente debería poder editarse después
de cerrado el período (por ejemplo, datos no contables como una nota o una categoría)?

---

### C-15 · El disclaimer de la app, ¿dice lo que tiene que decir?

- **Estado:** 🟥 Abierta
- **Área:** Responsabilidad profesional
- **Impacta en:** `DISCLAIMER` en `src/pages/FacturacionPage.tsx` y los avisos de
  `DashFacturacionArea.tsx`
- **Criterio provisorio actual:**
  > "Los valores de IVA mostrados son de carácter estimado, basados en los datos ingresados por el
  > usuario. Genesis360 no reemplaza la labor de un profesional contable matriculado ni constituye
  > representación contable legal ante ARCA/AFIP."

**Pregunta:** desde el punto de vista de un matriculado, ¿ese texto alcanza? ¿Hay algo que la app
muestre hoy y que **no debería mostrar** sin la firma de un profesional?

---

### C-16 · Venta cobrada en dólares, factura emitida en pesos: ¿qué cotización se usa?

- **Estado:** 🟥 Abierta (sigue sin responder un matriculado — lo de abajo es una decisión de GO, no una
  respuesta profesional)
- **Área:** Facturación electrónica / tipo de cambio
- **Impacta en:** `src/lib/cotizacionFiscal.ts`, `supabase/functions/emitir-factura`, y toda la
  conversión USD → ARS del POS
- **Criterio vigente (desde 2026-09-26, D-1 fase 2):** la app convierte con el **vendedor divisa del
  BNA del día hábil anterior**, una sola tasa en todo el sistema (antes: dólar COMPRA de la cotización
  operativa que cargaba el negocio).

> [!NOTE] **✅ IMPLEMENTADO el 2026-09-26 (D-1 fase 2, mig 440).** Decidido el 2026-09-25: tras la revisión legal que sigue (RG ARCA 5616/2024, ninguna
> norma fija la tasa del POS para una venta facturada en pesos — es decisión de negocio, no obligación),
> GO decidió reemplazar el criterio de arriba: el POS va a convertir USD→ARS al **vendedor divisa del
> BNA del día hábil anterior**, una sola tasa en todos lados (POS, ficha, importador, tiers/combos USD,
> pagos recibidos en USD, Bóveda). Ver `sources/raw/respuestas_puntos_abiertos_2026-09-25.md`
> ("Decisiones posteriores"), [[wiki/features/ventas-pos]] "UNA sola tasa USD→ARS".

**Pregunta:** cuando la venta se cobra en dólares pero la factura se emite en **pesos** (que es la
decisión de producto), ¿qué cotización corresponde para pasar esos dólares a pesos: la que usó el
negocio en el mostrador, o la del BNA del día hábil anterior? ¿Y comprador o **vendedor divisa**?

**Por qué importa:** la RG ARCA 5616/2024 fija, para comprobantes **emitidos en moneda extranjera**,
el **tipo de cambio vendedor divisa del BNA al cierre del día hábil cambiario anterior**. No se
encontró norma que fije lo mismo para el caso inverso (factura en pesos de una venta cobrada en
dólares), que es justo el caso de Genesis360. **La app usa vendedor divisa (desde 26/09).** Si el criterio
está mal, quedan mal declarados los importes de todas las facturas de ventas cobradas en dólares.

---

### C-17 · Gasto en moneda extranjera con IVA: ¿crédito fiscal y a qué cotización?

- **Estado:** 🟥 Abierta
- **Área:** IVA Compras / crédito fiscal
- **Impacta en:** módulo Gastos, `gastos.cotizacion_fiscal`, Libro IVA Compras
- **Criterio provisorio actual:** el Libro IVA Compras **deja afuera** los gastos en moneda
  extranjera y lo avisa en pantalla (decisión F2 del relevamiento de Multimoneda: mantener lo actual).

**Pregunta:** un gasto en moneda extranjera con IVA discriminado, ¿genera crédito fiscal computable?
Y si genera, ¿a qué cotización se valúa: la de la **fecha de la factura del proveedor** o la de la
**fecha de pago**?

**Por qué importa:** si genera crédito y hoy lo estamos dejando afuera, el negocio está pagando IVA
de más. Ver también [[reference_iva_gasto_moneda_extranjera]]: el criterio que sostiene hoy este
bloque **lo dio una IA**, no un matriculado.

---

### C-18 · ¿Qué cotización oficial corresponde para lo fiscal, en general?

- **Estado:** 🟥 Abierta
- **Área:** Tipo de cambio fiscal
- **Impacta en:** `gastos.cotizacion_fiscal_fuente`, y el diseño del módulo de cotizaciones del
  rediseño Multimoneda (fuente, histórico por fecha)
- **Criterio provisorio actual:** cotización del **día hábil anterior**, tomada de la fuente que hoy
  usa la app para el dólar.

**Pregunta:** para lo fiscal en general, ¿qué cotización corresponde: qué **tipo** (comprador /
vendedor / divisa / billete), de qué **banco u organismo** (BNA, ARCA), y de qué **día**?

**Por qué importa:** define de dónde tiene que salir el dato y si necesitamos una fuente con
**histórico por fecha** (hoy la app solo guarda la cotización del momento). También define qué pasa
con las monedas que el BNA no cotiza: la RG 5616/2024 dice que ahí el emisor informa el tipo de
cambio que usó, y hay que decidir cuál y cómo se justifica.

---

## Cómo agregar una pregunta nueva

1. Sumarla al bloque que corresponda con el siguiente número `C-NN` (nunca reutilizar uno viejo).
2. Completar siempre **Estado · Área · Impacta en · Criterio provisorio**, y las dos preguntas de
   fondo: *qué* se pregunta y *por qué importa* (qué se rompe si el criterio provisorio está mal).
3. Actualizar el contador de la tabla **Estado** de arriba.
4. Si además se implementó algo sobre un criterio provisorio, dejar la marca en el código
   (`⚠️ CRITERIO CONTABLE PENDIENTE DE VALIDAR`) apuntando acá.

## Cuando lleguen las respuestas

1. Pegar la respuesta textual en la pregunta y pasarla a ✅ con la fecha y el nombre del profesional.
2. **Revisar el código y el wiki** donde el criterio provisorio haya quedado desmentido — no alcanza
   con anotar la respuesta acá. Los lugares marcados son los de "Impacta en".
3. Registrar el cambio en `log.md` y, si movió números fiscales, agregar el escenario al UAT
   (`tests/specs/uat-modo-basico.md`).

---

Ver también: [[wiki/features/gastos]], [[wiki/features/facturacion-afip]],
[[wiki/development/reglas-negocio]], [[wiki/development/cierre-contable]].
