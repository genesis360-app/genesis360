---
name: relevamiento_conteos_respuestas
description: Respuestas de GO+socio al relevamiento de Conteos 2.0 (ISS-CONT) + diseño consolidado y plan por fases
type: project
---

# Relevamiento Conteos 2.0 (ISS-CONT) — respuestas + diseño

> Relevado con GO + socio el 2026-06-03 (HTML `relevamiento-conteos-reglas-negocio.html`, 34 preguntas).
> Este doc consolida las respuestas + las decisiones de diseño que GO delegó ("lo que te parezca mejor").
> Estado actual del módulo y debilidades: ver `project_pendientes.md` → sección ISS-CONT.

## Leyenda
- **Respuesta GO** = lo que eligió. **Diseño** = cómo se implementa / mi recomendación en los puntos abiertos.

---

## A — Scope del conteo

| # | Respuesta GO | Diseño |
|---|---|---|
| A1 | **D** | Tipos de conteo: `ubicacion` · `producto` · **`marca`** · **`categoria`** · **`sucursal` (wall-to-wall)** + **combinables** (ej. marca X en ubicación Y). Se modela con `inventario_conteos.filtros JSONB` (`{marca?, categoria_id?, ubicacion_id?, producto_id?}`) + un `tipo`/`alcance` legible. La carga de líneas arma el query dinámico cruzando `inventario_lineas` × `productos` por los filtros activos. |
| A2 | **D** | Wall-to-wall **bloquea ingresos/ventas** en la sucursal hasta cerrar el conteo, **con confirmación de DUEÑO** para iniciar. Implementación: flag `tenants`/sesión "conteo full en curso" que gate-ea POS y movimientos de esa sucursal. (Ver G1 para la reconciliación cuando NO se bloquea.) |
| A3 | **D** | Uso mixto (ubic / marca / todo según el día) → el scope debe ser flexible, ningún tipo es "el único". Confirma que vale la pena el selector de scope combinable de A1. |

## B — Modo ciego vs informado

| # | Respuesta GO | Diseño |
|---|---|---|
| B1 | **C** + matiz | Configurable por tenant (`tenants.conteo_modo`). **Regla de GO:** si el dueño decide que los operadores **NO ven** el nº del sistema → el conteo es **guiado (ciego)**; si decide que **sí lo ven** → conteo **informado**. O sea el toggle "ver/no ver esperada" ≡ informado/guiado. Ver I2: 3 opciones (Rápido / Guiado / Elegir al crear). |
| B2 | **B** | En modo ciego, **solo DUEÑO/SUPERVISOR** puede "revelar" la cantidad esperada de una fila (queda en el log del conteo). |
| B3 | **D + A** | Al finalizar, el sistema **avisa cuántas filas quedaron en blanco y pide confirmación**. **Regla:** blanco = **no contada → se omite** del ajuste (no toca ese LPN). **`0` = contado y sin unidades** → se compara contra el sistema (si el sistema no dice 0, genera ajuste a 0). Clave: distinguir `null` (no contó) de `0` (contó cero). |

## C — Doble conteo de discrepancias

| # | Respuesta GO | Diseño |
|---|---|---|
| C1 | **C** + (pidió sugerencia) | **Recomendación:** umbral configurable **combinado** — dispara reconteo si la diferencia de la línea supera **cualquiera** de: `X unidades` · `Y %` · **`$Z de valor`** (cantidad × costo). Motivo (kiosco vs óptica): un kiosco tiene volumen alto / valor bajo (importa unidades/%); una óptica tiene volumen bajo / valor alto (importa $, 1 lente caro). Un solo eje no sirve para ambos rubros → los tres ejes, el dueño setea los que use. Reutiliza el mismo concepto de umbral que el gate D. |
| C2 | **D** | El reconteo lo hace **idealmente otro operador** (si hay; si no, el mismo con aviso). |
| C3 | **C** | El reconteo es sobre la **fila marcada** (no todo el conteo). |
| C4 | **B** + matiz | El reconteo es **obligatorio** ante discrepancia sobre umbral; para **saltarlo** se requiere **clave maestra (SUPERVISOR/DUEÑO)**. |

## D — Gate de autorización de ajustes grandes

| # | Respuesta GO | Diseño |
|---|---|---|
| D1 | **C + D** + integración | El dueño **activa/desactiva** el gate y define umbral; **si no se activa, SIEMPRE pide autorización**. **Clave (pedido GO):** los ajustes de conteo se integran al **tab "Autorizaciones" existente** (`autorizaciones_inventario`, mig 056/103). Las diferencias quedan **pendientes de aprobación** con tipo nuevo **`ajuste_conteo`** (motivo "Diferencia Conteo") para distinguirlas del ajuste manual. Un SUPERVISOR/DUEÑO las aprueba ahí → recién entonces se aplica el movimiento de stock. |
| D2 | **D + E** | Umbral del gate: por **valor $** + configurable libre (mismo motor de umbral combinado u/%/$ de C1). |
| D3 | **C + D** | Quién aprueba: **SUPERVISOR y DUEÑO** (+ configurable qué rol; ver J2). |

## E — Scan-to-count

| # | Respuesta GO | Diseño |
|---|---|---|
| E1 | **B+C+D+E** (configurable) | Contar escaneando, **configurable por el dueño** según tipo de conteo: (B) el scan **suma 1** a la fila / (C) el scan **setea** la cantidad / (D) **siempre**: si el código es **GS1 con AIs**, carga todo lo que trae el barcode (cantidad, lote, vto, serie — reusa `gs1.ts`/`scanCompuesto.ts`). |
| E2 | **C** | El scan identifica la fila por **GTIN/SKU con fallback** (igual que el resto del sistema, `productos.gtin` → `codigo_barras`). |
| E3 | **C + B** | Si se escanea algo **fuera del scope** del conteo: se **cuenta igual pero con aviso** de que está fuera de lugar (no se descarta silenciosamente — sirve para detectar mercadería mal ubicada). |

## F — Conteo cíclico programado

| # | Respuesta GO | Diseño |
|---|---|---|
| F1 | **D** | **Nada automático** — solo **sugerencia + aviso** de qué conviene contar. **Pedido GO:** agregar al maestro de productos un campo de **rotación/velocidad** para alimentar el ABC del conteo. |
| F2 | **D** + (pidió opinión 1 vs 2 campos) | **Recomendación: UN solo campo `productos.clase_abc` (A/B/C)** para el ciclo de conteo, **auto-calculable** desde el valor de movimiento (no carga manual) + **override editable**. La "secuencia de picking/recorrido" NO va en el producto sino en **`ubicaciones.secuencia`** (ver I3), porque el recorrido es **físico (por ubicación)**, no por producto. Así evitamos dos campos confusos en el maestro. Si en el futuro quieren slotting por velocity de producto, se suma sin romper. Para kiosco/óptica, `clase_abc` (auto) + secuencia de ubicación cubre el caso. *(Revisable si preferís separar explícitamente velocidad de picking.)* |
| F3 | **D** | La sugerencia de qué contar se calcula **on-demand / sweep lazy** (pg_cron no habilitado), basada en `clase_abc` + última fecha de conteo del producto. |

## G — Reconciliación de movimientos

| # | Respuesta GO | Diseño |
|---|---|---|
| G1 | **C** + (pidió que revise) | **Recomendación (mejora sobre C):** no pisar `cantidad = contado` (bug actual). Guardar `esperada_snapshot` **al cargar cada línea** (con timestamp) y aplicar el ajuste como **delta**: `nuevo_stock = stock_vivo_al_aprobar + (contado − esperada_snapshot)`. Si no hubo movimientos intermedios = idéntico a hoy; si los hubo (ventas durante el conteo), **respeta esas ventas** en vez de revertirlas. Además, si `stock_vivo ≠ esperada_snapshot` al aprobar → marcar "stock cambió durante el conteo" y mandar a reconteo/aviso. Es más correcto que el snapshot global porque opera **por línea y como delta**. |
| G2 | **E** | Antigüedad del borrador: **configurable por dueño, default sin límite**; si configura límite y se supera → aplicar **C** (recalcular esperada / advertir que el borrador quedó viejo). |

## H — Reportes, exactitud y trazabilidad

| # | Respuesta GO | Diseño |
|---|---|---|
| H1 | **D + E** | Reporte de **exactitud de inventario (%)** + **valorización $ de la diferencia** (sobrante/faltante) por conteo y acumulado. |
| H2 | **D** | Export (Excel/CSV/PDF, consistente con el resto). |
| H3 | **B + C** | Trazabilidad: registrar **quién contó** cada ítem y **quién reconto**; visible en el detalle del conteo. |

## I — UX de dos velocidades

| # | Respuesta GO | Diseño |
|---|---|---|
| I1 | **A** | Mantener el **"conteo rápido"** actual como base (no romperlo). |
| I2 | **A + B** | En **Config** habrá **3 opciones, se elige una**: **Conteo Rápido** (informado, como hoy) · **Conteo Guiado** (ciego + doble conteo + gate) · **Elegir al crear** (el operador decide por conteo). `tenants.conteo_modo ∈ rapido|guiado|elegir`. |
| I3 | **E** (B+C+D) + pedido nuevo | El modo guiado: ordena por **secuencia de ubicación**, permite **pausar/continuar**, y **guía paso a paso**. **Pedido GO (importante):** agregar a `ubicaciones` un **campo numérico de secuencia** que define el **orden de recorrido** — el sistema usa ese nº para ordenar **tanto el conteo como el picking/surtido**. (Beneficia picking además de conteos.) |

## J — Permisos por rol

| # | Respuesta GO | Diseño |
|---|---|---|
| J1 | **D** | Crear/operar conteos: configurable / amplio (operador cuenta, pero ver J2 para aplicar). |
| J2 | **B** + opción | Aplicar ajustes: **DUEÑO/SUPERVISOR** por default, **+ configurable** — en la config de usuarios/roles el dueño define **qué rol puede aplicar ajustes** de conteo. |
| J3 | **C** | CONTADOR: **read-only** sobre conteos (ve, no opera) — consistente con J3 de Caja/Clientes. |

## K / L — Fases y prioridad

- **K1:** "lo que consideres mejor, sin apuro de tiempo" → plan de 4 fases abajo.
- **K2:** **E** (todas las mejoras entran, por fases).
- **L1:** Top 3 a criterio → ver abajo.

---

## Modelo de datos resultante (propuesto)

- **`inventario_conteos`**: `+ alcance TEXT` (`ubicacion|producto|marca|categoria|sucursal|mixto`), `+ filtros JSONB` (criterios combinables), `+ modo TEXT` (`rapido|guiado`), `+ requiere_aprobacion BOOLEAN`. (Ampliar el CHECK de `tipo` o reemplazarlo por `alcance`.)
- **`inventario_conteo_items`**: `+ esperada_snapshot DECIMAL` + `snapshot_at TIMESTAMPTZ`, `+ contado_por UUID`, `+ recontado BOOLEAN` + `reconteo_por UUID` + `cantidad_reconteo DECIMAL`, `+ fuera_de_scope BOOLEAN`. `cantidad_contada` pasa a **nullable** (distinguir null=no contada de 0).
- **`productos`**: `+ clase_abc TEXT` (`A|B|C`, nullable; auto-calculable + override).
- **`ubicaciones`**: `+ secuencia INT` (orden de recorrido conteo + picking).
- **`autorizaciones_inventario`**: ampliar CHECK `tipo` → `+ 'ajuste_conteo'`. `datos_cambio` lleva `{conteo_id, delta, esperada_snapshot, contado}`.
- **`tenants` (config conteos)**: `conteo_modo` (rapido|guiado|elegir) · `conteo_gate_activo BOOLEAN` · `conteo_gate_umbral_u/_pct/_valor` · `conteo_reconteo_umbral_u/_pct/_valor` · `conteo_scan_modo` · `conteo_borrador_dias_limite` · `conteo_rol_aplica_ajuste`.

---

## Plan por fases (propuesto — K1)

- **F1 — Scope + base (lo pedido por GO):** alcance por **Marca** + Categoría + Wall-to-wall + combinables (`alcance`/`filtros JSONB`). UI de selección de scope. Migración chica. *Cierra el pedido original.*
- **F2 — Anti-error núcleo:** Config 3 modos (Rápido/Guiado/Elegir) + **conteo a ciegas** (B1/B2) + manejo de filas en blanco (B3, `cantidad_contada` nullable) + **scan-to-count** (E, reusa GS1) + **`ubicaciones.secuencia`** (I3, ordena conteo y picking).
- **F3 — Control de ajustes (mayor anti-error de plata):** integración con tab **Autorizaciones** (`ajuste_conteo`, D1) + **gate configurable** por umbral u/%/$ (D) + **doble conteo** de discrepancias (C) con clave maestra para saltarlo (C4) + **reconciliación por delta** (G1).
- **F4 — Cíclico + gestión:** `productos.clase_abc` (auto + override) + **sugerencia de conteo cíclico** (no automático, F1=D) + **reportes de exactitud/valorización** (H) + **trazabilidad por operador** (H3/J).

### Top 3 (L1, mi recomendación)
1. **F1 (Marca/Categoría/Wall-to-wall)** — es el pedido explícito y desbloquea el resto.
2. **F3 (autorización de ajustes + gate)** — el mayor control de errores con impacto en plata (reusa el tab Autorizaciones que ya existe → relativamente barato y de alto valor).
3. **F2 (ciego + scan + secuencia de ubicación)** — el anti-error del día a día del operador.

> F4 (cíclico + reportes) queda 4º: es valioso pero depende de tener datos de varios conteos para que el ABC y la exactitud sean útiles.

---

## Pendientes de confirmación (menores, no bloquean F1)
- F2: ¿un solo campo `clase_abc` (recomendado) o separar velocidad-de-picking de rotación-de-conteo? (recomiendo uno; revisable).
- A2: alcance del bloqueo en wall-to-wall (¿bloquea toda la sucursal o solo los productos en scope?).
- C1/D2: valores default de los umbrales (u/%/$) por rubro.
