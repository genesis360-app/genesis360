---
name: respuestas_puntos_abiertos_2026-09-25
description: Respuestas de GO (2026-09-25) a los 30 puntos abiertos de Multimoneda (A-1..A-11), Categorías de clientes (B-1..B-9), Precio programado (C-1..C-7) y hallazgos de A0 (D-1..D-3). Incluye la directiva de alcance de Multimoneda (estructura N monedas, oculta; hoy solo ARS+USD), la revisión legal pedida para A-2/A-3 y D-1, y la decisión posterior del mismo día que cierra D-1 (BNA vendedor divisa reemplaza "USD→ARS a compra", en curso).
type: project
---

# Respuestas de GO a los 30 puntos abiertos — 2026-09-25

Documento respondido: `puntos-abiertos-multimoneda-categorias-precio-programado.html` (raíz del repo,
entregado el 2026-09-23). GO respondió por chat, en el orden del documento. Donde dice "ok" se adopta
**la propuesta del documento tal cual**; la propuesta está copiada acá para que no dependa del HTML.

## 🧭 Directiva de alcance de Multimoneda (la más importante — ordena todo lo demás)

> *"Todo esto de multimoneda no es crítico ahora porque solo vamos a trabajar con clientes de Argentina
> con ARS y USD. El resto de monedas queremos que tengamos la estructura, la DB y todo armado, pero que
> funcione con cotización manual. [...] Debes dejarlo oculto por ahora porque solo trabajaremos con ARS
> (moneda principal) y USD (moneda secundaria). Todo este relevamiento es para anticiparnos a que en el
> futuro se trabaje así, pero por ahora vamos simple."*

- **Estructura**: modelo de N monedas por negocio (moneda explícita ISO, config, cotización por moneda +
  historial) — construida bien, como si fuera a usarse.
- **Visible hoy**: solo **ARS principal + USD secundaria**. Todo lo que sea "otras monedas" queda oculto.
- **Otras monedas**: cotización **manual** siempre (cuando se habiliten, dentro de años / otro país).

## A · Multimoneda

| # | Respuesta de GO | Qué queda definido |
|---|---|---|
| A-1 | Las monedas que dolarapi no tiene, **manual**. | = propuesta: nunca derivar vía USD (D5). PYG, BOB, PEN, MXN, COP → carga manual obligatoria. |
| A-2 | Se actualiza **al iniciar sesión**; si falla, **mantiene la anterior** (del día o de la sesión anterior). Pide revisar la ley. | ≈ propuesta (disparo por el primer usuario, no cron; si falla, última conocida + aviso). Ver **revisión legal** abajo: la tasa fiscal es la del día hábil anterior y **no cambia durante el día**. |
| A-3 | **Tipo de cambio vendedor divisa del Banco Nación.** | Confirmado. Ver revisión legal: fuente recomendada = **ARCA** (`FEParamGetCotizacion` con `FchCotiz`), no dolarapi. Se guarda un registro por día. |
| A-4 | Si cambia la moneda principal, **recalcula y recotiza** todo contra la nueva. Automática si hay fuente; si no, manual; si la manual no tiene valor, queda **vacía/en error** para que alguien la complete. | ⚠️ **Distinto de la propuesta** (que era "se intercambian solas"). Vale lo de GO. Coherente con D5: sin tasa = error, nunca inventada. |
| A-5 | Reportes por moneda: **para después**. | Diferido. |
| A-6 | El historial **se guarda con las acciones que se tomaron, tal cual**. | = propuesta: desactivar ≠ borrar; el histórico se sigue viendo. |
| A-7 | **No se puede pagar sin saldo.** | = propuesta: se bloquea. |
| A-8 | "Ni idea, dejémoslo para luego o sugerí algo." | Diferido. Sugerencia vigente (la del documento): el **medio** de pago pierde la moneda, la **caja/cuenta** la mantiene. No se ejecuta hasta que haga falta (con ARS+USD el modelo actual alcanza). |
| A-9 | Pestañas del Dashboard **solo ARS y USD** por ahora; estructura lista para más monedas. | Pestañas ARS/USD. El modo "Real" (ajuste por inflación) no se mencionó → se mantiene como hoy (la propuesta era separarlo como interruptor; **no se toca sin consultar**). |
| A-10 | Diferencia de cambio en CC: **revisar después con más detalle.** | Diferido. Va a la lista del contador. |
| A-11 | Orden: **indistinto**. | Se sigue el de la propuesta: 1 Cimiento → 2 Config → 3 Operación → 4 Reportes/fiscal, con la directiva de arriba (oculto, ARS+USD). |

## B · Categorías de clientes

Todas **ok con la propuesta**, salvo B-5.

| # | Definido |
|---|---|
| B-1 | **Un solo motor de precio, en SQL**; el POS lo consulta (precios del carrito en una sola ida). |
| B-2 | **Gana el mejor precio, no se apilan** (lista / categoría / tier / estado → se cobra el más bajo y se muestra cuál ganó). Manual y cupón se suman aparte, sujetos al tope. Clientes **sin** categoría: exactamente como hoy. |
| B-3 | Plantilla Excel, producto por **SKU**, vista previa, producto inexistente = error en su fila (no se crea), **actualiza solo lo que el archivo trae**. |
| B-4 | La IA **solo redacta**, al guardar la promoción (no en la venta). Fallback: plantilla fija. Se le manda nombre de producto, categoría y %; **nunca** datos del cliente, costos ni márgenes. |
| B-5 | ⚠️ **Distinto de la propuesta**: *"Para el dueño funciona el mismo tope. La regla aplica para todos."* → el tope se mide sobre el precio de lista y cuenta todo junto; se configura en Configuración → Ventas; **el DUEÑO también tiene tope y NO hay salteo** (la parte de la propuesta "el DUEÑO lo saltea dejando constancia" queda descartada). |
| B-6 | Asignación masiva: se guarda **al confirmar**, en una sola operación, con resumen previo. |
| B-7 | Override por cliente: **no se amplía** por ahora. |
| B-8 | Portal: el pedido sale con el cliente identificado (token) y pasa por el motor único. |
| B-9 | Diseñar para ~20 categorías y listas de hasta 10.000 productos por categoría. |

## C · Precio programado

Todas **ok con la propuesta**.

| # | Definido |
|---|---|
| C-1 | El precio cambia cuando **llegó la hora Y el repositor confirmó**. Sin tope de espera; aviso cuando pasan más de X horas. |
| C-2 | La tarea se crea **al programar** (default actual); configurable por negocio. |
| C-3 | Cambio inmediato sobre uno programado: la app **avisa y pregunta**; default = **cancelar el programado**. |
| C-4 | Venta en espera **mantiene su precio**; al retomarla avisa "cambió el precio de N productos" con opción de actualizar. |
| C-5 | Tramos mayoristas y combos programados: **después de B-1** (motor único). |
| C-6 | El precio programado guarda su moneda; depende de la fase 1 de Multimoneda. |
| C-7 | Cerrar C-1 a C-4 como ajustes chicos; C-5 y C-6 atados a sus dependencias. |

## D · Hallazgos de A0

| # | Respuesta de GO | Estado |
|---|---|---|
| D-1 | 🛑 *"Al final la corrección estaba mal: lo que está bien es que en el POS se cotice al dólar **venta** de la cotización del **día hábil previo** al de facturación. Revisá legalmente cómo debería ser."* | ✅ **CERRADO el mismo día — ver "Decisiones posteriores" al final de este documento.** Vendedor divisa BNA del día hábil anterior, una sola tasa en todos lados. Invierte el fix de v1.207.0 (Fede, 08/09) y la convención "USD→ARS a compra" que hoy rige en POS, ficha, importador, pagos en USD y Bóveda. **EN CURSO: F1 (captura + historial) hecha en DEV, mig 439; F2 pendiente.** |
| D-2 | ok | ✅ Ya hecho (mig 436, en DEV). |
| D-3 | ok con la propuesta, y: *"el archivo template para importar ya debería venir con los chips desplegables u opciones disponibles para los campos que necesitan datos ya creados, como categoría, moneda, proveedores, etc."* | La propuesta (actualizar solo las columnas que trae el archivo) **ya está hecha** (UAT §66.8). Las "2 o 3 opciones" que GO recordaba existen: *Solo crear nuevos · Solo actualizar · Crear y actualizar*. **Nuevo pendiente**: desplegables en la plantilla (categoría, moneda, proveedor, unidad, etc.). Hoy la plantilla trae solo una hoja "Referencia", sin desplegables; la versión CE de SheetJS no escribe validaciones de datos, así que requiere otra librería o ese límite hay que resolverlo. |

## ⚖️ Revisión legal pedida (A-2, A-3, D-1) — 2026-09-25

**Lo que dice la norma** (RG ARCA 5616/2024, B.O. 18/12/2024):
- Para comprobantes **emitidos en moneda extranjera y cancelados en esa misma moneda**, se consigna el
  **tipo de cambio vendedor divisa del BNA al cierre del día hábil cambiario anterior** a la emisión.
  En factura electrónica el sistema de ARCA lo toma solo.
- Monedas sin cotización del BNA: el emisor informa el tipo de cambio usado.
- **No aplica a comprobantes emitidos en pesos.**
- En el web service (WSFEv1): `FEParamGetCotizacion` acepta ahora una fecha opcional (`FchCotiz`), y el
  comprobante lleva el campo `CanMisMonExt` (S/N: se cancela en la misma moneda extranjera).

**Exhibición de precios** (Res. SIC 4/2025, B.O. 17/01/2025): el precio se exhibe **en pesos**
obligatoriamente y puede exhibirse **además** en dólares; el precio exhibido es el **importe total y
final** que paga el consumidor.

**Conclusiones:**
1. **A-2/A-3 — sí hay que guardar la cotización del día anterior.** La tasa fiscal es la del día hábil
   cambiario anterior, fija durante todo el día de emisión. Se guarda **un registro por día** (tabla propia)
   y cada comprobante en moneda extranjera guarda la tasa con la que salió. Fuente recomendada: el propio
   **ARCA** (`FEParamGetCotizacion` con `FchCotiz`) — es la tasa contra la que ARCA valida, y el motor
   propio ya tiene autenticación WSAA. dolarapi **no sirve** para esto: da el valor de hoy, sin histórico,
   y su "oficial" es el BNA **billete**, no **divisa**.
2. **D-1 — ninguna norma fija la tasa del POS para una venta facturada en pesos.** Convertir el precio de un
   producto en dólares a pesos es una decisión comercial del negocio. Lo que sí exige la ley es que el precio
   en pesos exhibido sea el que se cobra. Por lo tanto, cotizar el POS al vendedor divisa BNA del día hábil
   anterior es **legal y además coherente** con la tasa fiscal (y fija durante el día → la góndola no
   cambia de precio a media mañana). Pero es una **decisión de negocio**, no una obligación.

Fuentes: [RG 5616/2024 — Boletín Oficial](https://www.boletinoficial.gob.ar/detalleAviso/primera/318374/20241218) ·
[ARCA — Se facilita la emisión de facturas en moneda extranjera](https://www.argentina.gob.ar/noticias/se-facilita-la-emision-de-facturas-en-moneda-extranjera) ·
[Res. SIC 4/2025 — Boletín Oficial](https://www.boletinoficial.gob.ar/detalleAviso/primera/319787/20250117) ·
[Manual del desarrollador WSFEv1 (ARCA)](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf).
Sigue valiendo: toda duda fiscal va también a la lista del contador.

### 🛑 Lo que falta decidir en D-1 (consultado a GO el 2026-09-25)

1. **¿Venta billete o vendedor divisa?** Hoy la app usa dolarapi "oficial" = BNA **billete**. El día 25/09:
   billete compra **1.495** / venta **1.545**; mayorista (≈ divisa) **1.516,5 / 1.525,5**. Lo que dice la RG
   es **divisa**. Con billete venta, un producto de USD 10 sale $15.450; con divisa ~$15.255; hoy (compra) $14.950.
2. **Contradice a Fede** (08/09: "el POS convertía al dólar venta, así que le cobraba de más al cliente") —
   conviene que lo cierren juntos.
3. **Tiene que ser UNA sola tasa en todos lados** (regla de la casa, "vuelto fantasma"): precio en POS,
   ficha, importador, tiers y combos en USD, **valor de un pago recibido en dólares** y Bóveda. Cambiar
   solo el POS rompe la caja. Si se cambia, se cambian todos juntos.
4. **Pago en efectivo en dólares**: si el cliente paga USD 10 por un producto de USD 10 no hay problema;
   pero si paga en dólares un producto en pesos, tomarle los dólares a la tasa **vendedora** significa
   valuárselos más caro de lo que el banco se los compraría. Es otra decisión (hoy es "compra" por
   convención de casa de cambio).

## Decisiones posteriores (mismo día) — 2026-09-25

Después de escribir y entregar lo de arriba, GO respondió el punto que había quedado abierto en "Lo que
falta decidir en D-1".

### D-1 — CERRADO: el POS convierte USD→ARS al vendedor divisa BNA del día hábil anterior

**Reemplaza** la convención "USD→ARS a compra" (v1.207.0, 2026-09-08, Fede) vigente hoy en POS, ficha,
importador, tiers/combos en USD, pagos recibidos en USD y Bóveda.

- **Tasa**: tipo de cambio **vendedor divisa** del Banco Nación Argentina, del **día hábil anterior** (no
  billete, no compra) — la misma que exige la RG ARCA 5616/2024 para comprobantes en moneda extranjera,
  aunque acá se aplica a un caso que la norma no regula (venta cobrada en USD, facturada en pesos).
- **Una sola tasa en todos lados**, sin excepción: precio de producto en el POS, ficha, importador, tiers
  y combos en USD, valor de un pago recibido en dólares, y Bóveda. Cambiar solo una parte rompe la caja
  (mismo razonamiento que originó v1.207.0 cuando se detectó el problema con "venta").
- **Fuente elegida**: la tabla pública de divisas de **bna.com.ar** — el 25/09 marcaba compra 1516,50 /
  venta 1525,50, que coincide con el "mayorista" que ya expone dolarapi. **No se usa ARCA WS**
  (`FEParamGetCotizacion`) para esto porque exige certificado de producción, y ningún tenant de PROD está
  en producción todavía — cuando alguno lo esté, se puede reevaluar la fuente sin cambiar el criterio.
- **Exposición hoy**: medido en PROD, **0 productos en USD y 0 pagos en USD en los últimos 30 días** — el
  cambio no mueve ninguna plata real en este momento.
- **Implementación en 2 fases**: **F1** — captura diaria de la cotización + tabla de historial (sin
  ningún cambio visible para nadie mientras tanto); **F2** — migrar todos los caminos que hoy usan
  COMPRA (POS, ficha, importador, tiers/combos, pagos en USD, Bóveda) al nuevo criterio, todos juntos.
- **Estado: F2 HECHA en DEV (2026-09-26, mig 440 — ver [[wiki/features/ventas-pos]] "UNA sola tasa USD→ARS"); F1 EN PROD desde v1.233.1.** Historia: **F1 HECHA en DEV (mig 439, commit `bb2c20a6`)**: tabla `cotizaciones_bna` + `fn_cotizacion_bna_vigente` + EF `cotizacion-bna` (desplegada en DEV, probada con usuario real: capturó USD/EUR/GBP del 25/09; la anon key sola → 401) + paso nuevo en `sweeps.yml` a las 03:10 AR. **Falta llevarla a PROD** (mig 439 + deploy EF + merge, porque el workflow corre desde `main`) — consultado a GO como `v1.233.1`, sin cambio visible. F2 (migrar todos los caminos a esta tasa) pendiente.

Actualizado en el wiki: [[wiki/features/ventas-pos]] "Los precios en USD se cobran al dólar COMPRA",
[[wiki/features/caja]] (`cajaBoveda.ts`), [[wiki/features/productos]] (importador),
[[wiki/business/consultas-contador]] (C-16, C-08). El código y el criterio real **no cambiaron
todavía** — estas notas solo documentan que el cambio va a llegar.
