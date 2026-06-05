---
name: pendientes_proxima_sesion
description: Tareas pendientes y contexto para retomar en la próxima sesión de desarrollo
type: project
---

Último release en PROD: **v1.30.0** ✅ (**Conteos 2.0 · cierre 100% — F2b-ref + F3b + A2**, mig 181). **F2b-ref (E3):** escanear durante el conteo un producto fuera de alcance con stock → lo agrega como fila "fuera de alcance" (mercadería mal ubicada); sin stock → aviso hacia Ingreso. **F3b:** snapshot de costo por ítem (`costo_snapshot`, valorización estable al continuar borradores) + **doble conteo formal** (filas sobre umbral exigen re-ingreso vía columna "Recontar"; saltable con **clave maestra** SUPERVISOR/DUEÑO; persiste `cantidad_reconteo`+`reconteo_por`; el ajuste usa el valor recontado). **A2:** toggle `tenants.conteo_wall_to_wall_bloquea` (default OFF) — conteo de sucursal completa con confirmación de DUEÑO bloquea ventas (reserva/despacho) y movimientos hasta cerrarlo (hook `useConteoBloqueante`, badge "Bloqueante", se libera al finalizar/eliminar). **Conteos 2.0 cerrado (F1-F4 + refinamientos).** Antes: v1.29.0 (**Conteos 2.0 · F2b + F4 — cierre del módulo**. **F2b scan-to-count**: botón "Escanear para contar" = cámara persistente que suma a la fila del producto (cantidad del AI GS1 si viene, si no +1; reusa `resolverScanCompuesto`). **F4**: clase **ABC** (`productos.clase_abc` auto Pareto 80/95 por valor de movimiento 12m + override manual `clase_abc_manual`), **conteo cíclico sugerido** (`tenants.conteo_ciclico_dias_a/b/c`, panel "Conviene contar"), **reportes de exactitud + valorización** ($ faltante/sobrante/neto) por conteo y acumulado + export Excel, **trazabilidad por operador** (`inventario_conteo_items.contado_por` + `productos.ultimo_conteo_at`). Lógica pura en `conteoAbc.ts` (+16 tests → suite **362**). Mig **180** (aditiva). Antes: v1.27.0 (Conteos F3 gate+autorizaciones+delta, mig 179). v1.26.0 (F2a modos+ciego+unidad+secuencia, mig 178). v1.25.0 (F1 scope, mig 177). v1.24.0 (Clientes C6+D4).

**Historial Clientes:** v1.19.0 (CL1+CL2), v1.20.0 (CL3 + bugfix origen), v1.23.0 (CL4+CL5+CL6), v1.23.1 (QA/tests CC + agentes).

**Subagentes** (`.claude/agents/`): relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper. Ver `G360.Wiki/wiki/development/agentes-claude-code.md`.

**Testing — estado (v1.23.2):** pipeline de QA extendido a **Caja** (`cajaArqueo.ts` + matriz `cajaPermisos`, 57 tests), **Inventario** (`unidades.ts`, 17 tests) y **Ventas** (descuento combo + `puedeVerCosto` G4 + `umbralGasto`, 27 tests). Planes en `tests/specs/{caja,inventario,ventas}.plan.md`. **Suite total: 329 unit tests verdes.** Pendiente futuro: convertir los planes e2e a tests Playwright reales (los `.plan.md` listan escenarios e2e fuera del alcance unit: apertura de caja ajena A2, multi-sesión CAJERO B2, validación de clave maestra real, propagación de traspaso end-to-end).

**Backlog diferido Clientes:** ~~C6 segmentación+export~~ ✅ y ~~D4 UI de NC manual~~ ✅ (v1.24.0). Quedan: B7 tope deuda global (vos: "no necesario aún, revisar en 3-6 meses"), F2 fidelización puntos (feature grande, requiere relevamiento), C3 envío background (bloqueado: pg_cron no habilitado), cobranza CC con impacto en arqueo.

**Versionado:** Semántico — Major=breaking/hito grande · Minor=feature · Patch=bugfix.

---

## Estado actual DEV / PROD — cierre sesión 2026-06-05

| | DEV | PROD |
|---|---|---|
| APP_VERSION | `v1.30.0` | `v1.30.0` |
| Migrations | 001–**181** ✅ | 001–**181** ✅ |
| Branch | `dev` (alineado con `main`) | `main` (release v1.30.0) |
| Vercel | preview auto desde `dev` | PROD deploy v1.30.0 |

**Migrations DEV pendientes de aplicar en PROD:** ninguna (181 ya en PROD).

**ISS-174 — cotización/generación de envíos por API (v1.14.0, PROD):**
- **F1 (fundación)** — servicio = select dependiente en POS; catálogo `src/lib/couriers/catalogo.ts`; mig 162 (`courier_credenciales` + `tenants.envio_peso_fuente`), 163 (CP idempotente), 164 (productos peso/dim); Config → Envíos (toggle peso-fuente + `CourierCredencialesPanel` owner-only); peso/dim en form de producto.
- **F2-F5 (integración API)** — Edge Function `courier-api` (cotizar/generar/tracking) con adapters **Andreani / Correo Argentino / OCA**; mig 165 (`envios.cotizacion_json/courier_orden_id/cotizado_api`); cliente `src/lib/couriers/api.ts`; cotizar en POS + Envíos, "Generar con courier" + etiqueta + "Actualizar tracking" en Envíos.
- **⚠ PENDIENTE crítico:** los adapters están escritos según docs públicas de cada courier pero **NO probados con cuentas B2B reales** (GO aún no las tiene). Al cargar credenciales reales, validar/ajustar endpoints y mapeos de cada adapter (`supabase/functions/courier-api/{andreani,correo,oca}.ts`). Fail-safe: sin credenciales la cotización muestra error claro y el alta manual sigue funcionando.

**Relevamiento Ventas E/F/G — ✅ deployado a PROD (v1.12.0/v1.13.0, histórico):**
- **G4** — costo/margen ocultos para CAJERO/DEPOSITO (`permisosCosto.ts`). Sin migración.
- **F1** — botón "Actualizar presupuesto" on-demand (la config de validez ya existía).
- **F5** (mig 159) — correlativo independiente de presupuestos `PRES-NNNN` por sucursal.
- **E6+E1** (mig 160) — seña obligatoria/mínima %, vencimiento configurable + liberación automática de stock (sweep lazy `liberar_reservas_vencidas`), config en ConfigPage → Ventas → Reservas.
- **E2 completo** (mig 160) — cancelación de reserva con penalidad % + destino devolución/crédito (`cliente_creditos`) + gate E4. **Redención**: medio de pago "Crédito a favor" en el POS (cuenta como pagado, no entra a caja, consumo negativo) + saldo a favor en ficha del cliente.
- Detalle completo y estado por ítem: `relevamiento_ventas_respuestas.md`.

- **G1/G2 completo** — POS aplica precios mayoristas por cantidad (`producto_precios_mayorista`): `precioTierEfectivo`, indicador en carrito, persiste en `venta_items`. Sin migración.
- **E3 completo** — catálogo de motivo de cancelación de reserva + observación opcional (en `ventas.notas`). Sin migración.

**Relevamiento Ventas E/F/G — COMPLETO (v1.13.0):** E1, E2, E3, E6, F1, F5, G1, G2, G3, G4, G5. Único pendiente menor: **venta física en USD / caja USD** (G5 cubre precio-en-USD cobrado en pesos; el cobro físico en dólares queda para una fase futura).

**Deployado en v1.11.2 (2026-05-30):**
- **Trazabilidad-extendida (mig 155)**: `/historial` consolida por transacción + filtro de recall por LPN/serie + export completo. Ver `reportes-metricas.md`.
- Rótulo explícito "Stock total (todas las sucursales)" en Agregar Stock/Rebaje (vista global).
- **Guard de `setSucursal`**: usuario sin `puedeVerTodas` no puede cambiar de sucursal (3ª capa de aislamiento). Ver `multi-sucursal.md` → "Aislamiento por sucursal — enforcement".

**Recalc global de `stock_actual`** ya corrido en DEV (113 prod.) y PROD (21 prod.) — 0 desfasados.

---

## Backlog — pendientes próxima sesión

### Relevamiento Clientes — plan por fases CL1-CL6 (relevado 2026-06-01, GO + socio) — ✅ COMPLETO

**🎉 Las 6 fases implementadas y deployadas a PROD** (v1.19.0 → v1.23.0). Detalle de implementación por ítem en `relevamiento_clientes_respuestas.md`. Tabla original del plan abajo (referencia histórica).

Respuestas completas y cruce con Ventas en `relevamiento_clientes_respuestas.md`. **GO pidió implementar TODO (sin Top 3).** Varios ítems de CC clientes comparten definición con Ventas sección D (respondida, sin implementar — se implementa acá). **Transversal:** `pg_cron` NO habilitado → disparos por tiempo van por sweep lazy vía RPC.

| Fase | Versión | Alcance | Migrations clave |
|---|---|---|---|
| **CL1 — Fundación datos + permisos** | `v1.18.0` | A2 alerta duplicado (vs rechazo duro) · A6 soft delete + razón de baja · A5 import 3 modos + etiquetas CSV · F1 catálogo etiquetas predefinidas+libres · B2 gate habilitar CC (DUEÑO/SUPERVISOR) · H1/H2 permisos (CONTADOR read-only = Ventas J3) | `clientes.activo/motivo_baja`, catálogo etiquetas |
| **CL2 — CC: límite + vencimiento + morosidad** | `v1.19.0` | B1 enforcement configurable (enforce/avisar/permitir, default avisar) · B3 vencimiento + interés mora (sweep lazy) = Ventas D2 · B4 morosidad configurable = Ventas D6 · B5 cobranza ficha+POS+caja masiva = Ventas D5 | `clientes.limite_cc`, `tenants.limite_cc_default/cc_dias_vencimiento/cc_interes_mensual_pct/cc_morosidad_politica/cc_enforcement_politica`, `ventas.fecha_vencimiento_cc` |
| **CL3 — Incobrables + estado de cuenta** | `v1.20.0` | B6 incobrables (gasto auto "Deudores incobrables" + clave maestra DUEÑO + motivo + audit) = Ventas D7 · B8 PDF estado de cuenta + portal público con token (SECURITY DEFINER anon) | token público, categoría gasto reservada |
| **CL4 — Notificaciones al cliente** | `v1.21.0` | C1 registro deuda · C2 recordatorio pre-venc (N días + canal preferido + plantilla) · C3 aviso al vencer + cada 7d + escalado DUEÑO · C4 confirmación pago · C5 cumpleaños (saludo+cupón default ON, lista al dueño opcional). Configurable por canal, sweep lazy | `tenants.cc_notificacion_canales`, plantillas, config cumpleaños |
| **CL5 — CC proveedores** | `v1.22.0` | D2 notif venc + bloqueo · D3 PDF + reporte consolidado vencimientos · D4 NC auto al devolver + correlativo + adjunto · D5 pago parcial FIFO/manual · D6 múltiples cuentas bancarias por proveedor | `proveedor_cuentas_bancarias`, correlativo NC |
| **CL6 — Reportes, alertas, export** | `v1.23.0` | G1 top clientes + inactivos + aging 0-30/31-60/61-90/+90 + cohort + top proveedores · G2 alertas (deuda vencida, DNI sospechoso, prov CC vencida) · G3 export Excel+PDF+CSV · F4 audit log cambios cliente | — |

**Backlog diferido (no en CL1-CL6):** B7 tope deuda global (= Ventas D8) · C6 marketing bulk (solo segmentación+export) · F2 fidelización puntos · F3 descartado (precio solo por cantidad, Ventas G2) · E1-E4 "mantener como está" (E1b proveedor principal = mejora opcional barata).

> Las versiones CL son tentativas; pueden correrse por releases de bugfix intermedios. Confirmar el número real en cada deploy contra `brand.ts`.

### Features grandes (requieren relevamiento o diseño antes de implementar)

| ID | Módulo | Descripción | Complejidad |
|---|---|---|---|
| ISS-073 | TiendaNube + Ventas + Envíos + Clientes | Sincronización completa de flujo TN: la orden TN crea automáticamente venta Genesis (con `numero` = número TN para trazabilidad) + cliente nuevo con datos y domicilio si no existe + envío en estado `pendiente` con datos del comprador. Estados sincronizados bidireccional: pendiente_pago → pagada → empaquetada → despachada → entregada / devuelta. Hoy: solo rebaja stock. | Alta — webhook + estado-machine + creación multi-entidad transaccional |
| ~~ISS-127~~ | Config + Inventario + Ventas + Recepciones | ✅ **Cerrado v1.11.6** — Códigos compuestos GS1 (GS1-128 + DataMatrix + QR) leer/escribir con múltiples AIs. Ver `escaneo-barcode.md` y diseño/fases abajo. | ✅ Hecho |
| ISS-130 | Inventario + Ventas | Comandos por voz: hablarle a la app para rebajar/ingresar (SKU, cantidad, estado, ubicación, lote, fecha) y consultar ("¿qué hay en ubicación X?"). Web Speech API + parseo intenciones | Alta — UX nueva, requiere prototipo |
| ISS-137 | Config | Evaluación: integración con Google Drive como almacenamiento propio del cliente para documentos/imágenes | Requiere evaluación primero |
| ISS-CONT | Inventario → Conteos | **Conteos 2.0** — conteo cíclico / wall-to-wall **por Marca** (pedido GO 2026-06-03) + ampliar scope (categoría, toda la sucursal) + endurecer contra errores del operador (conteo a ciegas, doble conteo de discrepancias, gate de ajustes grandes, scan-to-count) manteniendo el flujo rápido actual. Detalle + fases abajo. | Media-Alta — requiere relevamiento (umbrales, autorizaciones, blind por default) |
| ~~ISS-174~~ | Ventas + Envíos | ✅ **Cerrado v1.14.0** (F1-F5) — servicio select en POS + cotización/generación por API directa (Andreani/Correo/OCA) vía Edge Function `courier-api`. Ver sección ISS-174 abajo. **Único pendiente:** validar adapters con cuentas B2B reales. | ✅ Hecho |

### ISS-CONT — Conteos 2.0 (pedido GO 2026-06-03, SIN relevar todavía)

**Pedido explícito de GO:** poder hacer un **conteo cíclico o wall-to-wall por Marca** del producto (el maestro ya tiene `productos.marca TEXT`, mig 118). Y, en general: revisar el submódulo de Conteos para que sea **fácil y rápido como hoy** pero que también ofrezca un modo **más potente y a prueba de errores del operador**.

**Cómo está hoy (código real):**
- Modelo: `inventario_conteos` (`tipo` ∈ `'ubicacion'|'producto'`, `ubicacion_id`/`producto_id`, `estado` ∈ `'borrador'|'finalizado'`, `ajuste_aplicado`, `sucursal_id`, `created_by`, `notas`) + `inventario_conteo_items` (`producto_id`, `lpn`, `cantidad_esperada`, `cantidad_contada`). Mig 050.
- Flujo (InventarioPage → tab Conteo): elegir tipo (ubicación **o** producto único) → `cargarLineasParaConteo` trae las líneas de la sucursal → editar cantidades → guardar borrador (continuable, ISS-100) o **finalizar y aplicar**: por cada fila con diferencia, pisa `inventario_lineas.cantidad` y registra `movimientos_stock` (`ajuste_ingreso`/`ajuste_rebaje`).

**Debilidades detectadas (oportunidades de mejora):**
1. 🔴 **El conteo NO es a ciegas**: la `cantidad_contada` se **precarga con la esperada** (`String(cantEsperada)`). El operador ve el número del sistema → tiende a confirmarlo sin contar de verdad (sesgo de confirmación). Es el anti-patrón clásico de conteo.
2. 🔴 **Sin reconciliación de movimientos durante el conteo**: al finalizar pisa `cantidad` con lo contado sin contemplar ventas/movimientos ocurridos entre que se cargó el esperado y se cerró (sobre todo en borradores que duran). Puede revertir ventas.
3. 🟡 **Sin filtro por Marca / Categoría / wall-to-wall**: solo ubicación o producto único. (Lo que pide GO.)
4. 🟡 **Sin doble conteo de discrepancias**: cualquier diferencia se ajusta directo; no hay reconteo (idealmente por otro operador) ante diferencias grandes.
5. 🟡 **Sin gate de autorización para ajustes grandes**: un ajuste que borra mucho stock (o mucho **$**) se aplica sin aprobación. Otros módulos (caja, incobrables) ya usan clave maestra.
6. 🟢 **Sin scan-to-count**: se cuenta tipeando (riesgo de fila/tipeo equivocado). El stack de escaneo GS1 (`gs1.ts`, `scanCompuesto.ts`, BarcodeDetector) ya existe y es reutilizable.
7. 🟢 **Sin reporte de exactitud ni valorización**: no se mide el % de exactitud del inventario ni el valor $ de la diferencia (sobrante/faltante).
8. 🟢 **Trazabilidad por operador limitada**: solo `created_by` del conteo, no quién contó/reconto cada ítem.

**Mejoras propuestas (a confirmar en relevamiento):**
- **Scope ampliado** (incluye lo pedido): `tipo` ∈ `marca` | `categoria` | `ubicacion` | `producto` | `sucursal_completa` (wall-to-wall), combinables (ej. marca X en ubicación Y). Snapshot del criterio en el conteo (`marca TEXT`, `categoria_id`).
- **Conteo a ciegas configurable**: opción de NO mostrar la esperada (arranca vacío; el sistema compara al cerrar). Toggle por tenant/por conteo. Se conserva el modo rápido actual (informed) para velocidad.
- **Doble conteo de discrepancias**: filas que superen un umbral (u o %) se marcan para **recontar** antes de aplicar; idealmente segundo operador.
- **Gate de ajuste**: ajustes que superen umbral (unidades / % / **valorización $**) requieren clave maestra o aprobación SUPERVISOR/DUEÑO.
- **Scan-to-count**: contar escaneando (reusa GS1/BarcodeDetector); el scan suma a la fila correcta → menos errores; encaja natural con el modo a ciegas.
- **Conteo cíclico programado**: plan rotativo (por marca/categoría/clase ABC — los de mayor valor más seguido); el sistema sugiere qué contar cada día (sweep lazy o lista on-demand, `pg_cron` no disponible).
- **Reconciliación de movimientos** (freeze/snapshot con timestamp) al aplicar el ajuste → no pisar ventas hechas durante el conteo.
- **Reporte de exactitud + valorización** (% exactitud, ítems con diferencia, $ sobrante/faltante) por conteo y acumulado + export. **Trazabilidad por operador** (quién contó/reconto cada ítem).
- **UX de dos velocidades** (lo que pide GO): mantener "conteo rápido" como default (elegí → contá → listo) y un "conteo guiado/avanzado" que active a ciegas + doble conteo + gate paso a paso. Que lo potente no estorbe a lo simple.

**Fases tentativas:** F1 scope por Marca/Categoría/wall-to-wall (lo pedido; migración chica: `tipo` nuevo + columnas snapshot) · F2 conteo a ciegas + scan-to-count (anti-error, alto impacto) · F3 doble conteo + gate de autorización por umbral/$ · F4 cíclico programado + reporte de exactitud/valorización + reconciliación de movimientos + trazabilidad por operador.

**✅ RELEVADO (2026-06-03, GO+socio).** Respuestas + diseño consolidado + modelo de datos + plan por fases en **`relevamiento_conteos_respuestas.md`**. Decisiones clave: scope combinable (marca/categoría/wall-to-wall) · modo configurable Rápido/Guiado(ciego)/Elegir · doble conteo con umbral combinado u/%/$ · ajustes de conteo van al **tab Autorizaciones existente** (tipo `ajuste_conteo`) · reconciliación por **delta** (no pisar `cantidad`) · nuevos campos `productos.clase_abc` (ABC auto) y `ubicaciones.secuencia` (recorrido conteo+picking) · cíclico solo sugerencia (sin cron).

**Plan por fases:** **F1 ✅ DEPLOYADO PROD (v1.25.0, mig 177)** — scope Marca/Categoría/Wall-to-wall (`inventario_conteos.tipo` ampliado + `filtros JSONB`; UI con toggle de 5 alcances + carga dinámica `productos!inner`; marcas/categorías derivadas del stock de la sucursal; scopes amplios exigen sucursal específica por aislamiento). · **F2a ✅ DEPLOYADO PROD (v1.26.0, mig 178)** — modo configurable `tenants.conteo_modo` (rapido/guiado/elegir) + conteo a ciegas (B1: input vacío, oculta esperado/diferencia; B2: revelar fila DUEÑO/SUPERVISOR) + filas en blanco (B3: `cantidad_contada` nullable, null=no contada se omite, 0=contó cero) + **input "Contado" respeta unidad** (enteros vs decimales según `esDecimal`) + `ubicaciones.secuencia` (orden recorrido conteo+picking, editable en Config). · **F2b ✅ DEPLOYADO PROD (v1.28.0→v1.29.0)** — scan-to-count: botón "Escanear para contar" abre `BarcodeScanner` persistente (nuevo prop `persistentCloseLabel`) que resuelve el código (GS1 vía `resolverScanCompuesto` con fallback barcode/SKU) y suma a la fila del producto (cantidad del AI GS1 o +1), respeta unidad entera/decimal, ref espejo `conteoRowsRef` para scans rápidos. · **F3 ✅ DEPLOYADO PROD (v1.27.0, mig 179)** — gate de aprobación (`tenants.conteo_gate_*`; gate off → todo a aprobación, on → solo > umbral u/%/$); diferencias van al tab **Autorizaciones** (`autorizaciones_inventario` tipo `ajuste_conteo`, motivo "Diferencia Conteo"); al aprobar se aplica con **reconciliación por delta** (`reconciliarDelta`); doble conteo = aviso `window.confirm` sobre umbral (`conteo_reconteo_*`). Lógica pura testeada en `src/lib/conteoAjuste.ts`. · **F4 ✅ DEPLOYADO PROD (v1.29.0, mig 180)** — **clase ABC** (`productos.clase_abc` A/B/C + `clase_abc_manual` + `ultimo_conteo_at`; recálculo client-side Pareto 80/95 por valor de movimiento 12m, respeta override; 3 updates agrupados por clase) + **conteo cíclico sugerido** (`tenants.conteo_ciclico_dias_a/b/c` default 30/90/180 editables en Config; panel "Conviene contar" con vencidos por clase + atajo "Contar") + **reportes de exactitud/valorización** (`reporteExactitud`: % exactitud + $ faltante/sobrante/neto, por conteo y acumulado + export Excel) + **trazabilidad por operador** (`contado_por` por ítem, columna en detalle). Lógica pura `src/lib/conteoAbc.ts` (`clasificarABC`, `sugerirConteoCiclico`, `reporteExactitud`) + 16 tests. · **Cierre 100% ✅ DEPLOYADO PROD (v1.30.0, mig 181):** **F2b-ref** (escanear fuera de alcance con stock → fila "fuera de alcance"; sin stock → aviso) · **F3b** (snapshot `costo_snapshot` + doble conteo formal con columna "Recontar" + clave maestra para saltar, `cantidad_reconteo`/`reconteo_por`) · **A2** (toggle `conteo_wall_to_wall_bloquea` default OFF; wall-to-wall con confirmación de DUEÑO bloquea POS reserva/despacho + ingreso/rebaje vía `useConteoBloqueante`, `inventario_conteos.bloquea_movimientos`). **🎉 Conteos 2.0 (ISS-CONT) CERRADO al 100% — F1-F4 + refinamientos en PROD.**

### ISS-127 — Códigos compuestos GS1 (diseño relevado con GO 2026-05-30)

**Objetivo:** leer y escribir códigos de barra/QR que codifican varios campos a la vez (estándar **GS1**), grado WMS. Reemplaza el scan de valor único actual (`sku`/`codigo_barras`).

**Decisiones relevadas:**
- **Estándar:** GS1 (GS1-128 1D + GS1 DataMatrix 2D), con **override no-GS1** por perfil (separador+campos propios) para proveedores que no usan GS1.
- **AIs soportados:** GTIN `(01)`, Lote `(10)`, Vencimiento `(17)`, Cantidad `(37/30)`, Serie `(21)`, Producción `(11)`, Precio `(392x)`.
- **Dirección:** leer + escribir.
- **Integración:** Ingreso de stock, Rebaje, Ventas/POS, Recepciones.
- **Lectura en ingreso:** comportamiento **configurable por perfil** (autocompletar+confirmar vs crear LPN directo).
- **Match del GTIN→producto:** `productos.gtin` dedicado **con fallback** a `codigo_barras` (ambos normalizados, ceros a la izq.).
- **Perfiles:** múltiples, **ligados a `proveedor_id`** (opcional) + override no-GS1. Como GS1 es autodescriptivo, el perfil gobierna sobre todo la **generación** (qué AIs + simbología + modo de lectura), no el parseo.
- **DataMatrix lectura:** sumar **`@zxing/library`** como fallback (zbar no decodifica DataMatrix). GS1-128 1D ya lo lee el stack actual (BarcodeDetector + zbar).
- **Generación:** desde el LPN (extiende `LpnQR`) **+ generación masiva** (ej: N etiquetas de una recepción). Requiere **`bwip-js`** (genera GS1-128 y GS1-DataMatrix con FNC1 correcto).

**Modelo de datos (propuesto):**
- **Migration A:** `codigo_perfiles` (`id, tenant_id, nombre, proveedor_id NULL, simbologia 'gs1_128'|'datamatrix', tipo 'gs1'|'custom', ais JSONB [lista de AIs a generar], custom_format JSONB {separador, campos}, lectura_modo 'autocompletar'|'directo', activo, created_at`). RLS por tenant.
- **Migration B:** `productos.gtin TEXT` (+ índice `(tenant_id, gtin)`).

**Librería `src/lib/gs1.ts` (sin deps para parse; usa la app):**
- `parseGS1(raw): { gtin?, lote?, vencimiento?, cantidad?, serie?, produccion?, precio?, _raw }` — maneja FNC1 (`\x1d`), AIs de longitud fija y variable, fecha `YYMMDD`.
- `encodeGS1(fields, ais): string` — arma el element string con AIs en orden + FNC1 donde corresponde.
- `parseCustom(raw, perfil)` / `encodeCustom(...)` para el override no-GS1.

**Fases de entrega:**
- **F1 — Fundación ✅ (en DEV, build OK):** migrations 157+158 (perfiles + `productos.gtin`) + `gs1.ts` (parse/encode testeado) + Config UI de perfiles (`CodigoPerfilesPanel` en Config → Inventario → Códigos) + generación GS1-128/DataMatrix desde LPN (`CodigoCompuestoModal` en `LpnAccionesModal`, render `bwip-js`). Pendiente deploy a PROD.
- **F2 — Lectura ingreso ✅ (PROD v1.11.5):** `looksLikeGS1` + `resolverScanCompuesto` (match GTIN→producto con fallback). Ingreso individual + masivo.
- **F3 — Cobertura completa ✅ (PROD v1.11.5):** DataMatrix lectura (`@zxing/library`) + Ventas/POS + Recepciones (scanner nuevo) + Rebaje (auto-selección lote→LPN vía `pendingRebaje`) + modo `directo` (auto-crear LPN, `directoFiredRef`) + generación masiva (`CodigoMasivoModal`).

**ISS-127 cerrado** en v1.11.5. Fixes de QA aplicados: AI cantidad 37→30, validación de GTIN con dígito sugerido, DataMatrix sin `height:undefined`, mensajes GS1 accionables.

**GS1 QR Code ✅ (v1.11.6):** agregada la 3ª simbología `qr` (`bcid: gs1qrcode`) en perfiles, generación individual y masiva. Ahora los perfiles soportan **GS1-128 + DataMatrix + QR**. (El QR simple del LPN sigue existiendo aparte vía `LpnQR`.)

**Riesgos/notas:** verificar que `bwip-js` y `@zxing/library` no reintroduzcan vulnerabilidades (correr `npm audit` post-install). DataMatrix solo lee en BarcodeDetector hasta que entre ZXing (F3). El parseo GS1 de variable-length depende de FNC1: muchos lectores 1D lo emiten como carácter GS (`\x1d`); contemplar lectores que lo omiten.

### ISS-174 — Cotización + generación de envíos por API de courier (relevado con GO 2026-05-31)

**Objetivo:** reemplazar el costo de envío manual/KM por **cotización en tiempo real** contra la API de cada courier (precio + plazo + disponibilidad por servicio, según origen/destino/peso/fecha) y, además, **generar la orden de envío** en el courier para traer **número de tracking + etiqueta PDF** automáticamente. Dos partes:
- **Parte 1 (chica, sin API):** en el POS el campo *Servicio* hoy es texto libre (`VentasPage.tsx` ~3537). Pasarlo a **select dependiente del courier** igual que en Envíos (`SERVICIOS_POR_COURIER`). Requiere extraer `COURIERS` + `SERVICIOS_POR_COURIER` de `EnviosPage.tsx` a un módulo compartido.
- **Parte 2 (grande):** integración real con APIs de courier.

**Decisiones relevadas con GO:**
- **Integración: APIs directas por courier** (no agregador). Orden por trabajo/prolijidad: **Andreani** (REST, la más limpia) → **Correo Argentino** (Mi Correo Empresas / Paq.ar, REST) → **OCA ePak** (SOAP, la más compleja). DHL fuera de alcance (solo si hacen exterior).
- **Alcance completo:** cotizar **+ generar orden/admisión + etiqueta PDF + tracking** automático.
- **Peso/dimensiones: configurable por tenant** (`tenants.envio_peso_fuente 'manual'|'producto'`). El negocio elige: peso/medidas del **bulto cargados a mano por envío** (campos `envios.peso_kg/largo/ancho/alto` ya existen) **o** tomados del **dato maestro del producto** (sumando el carrito). Config → Envíos.
- **Credenciales: por tenant.** Cada negocio carga sus credenciales de cada courier en Config. Por seguridad (secretos + CORS + SOAP) **todas las llamadas a couriers van por Edge Function** con `service_role`; el front nunca ve los secretos.
- **Dónde: ambos.** Cotizar en el **POS** (para cobrar el envío en la venta) y cotizar/generar orden+etiqueta+tracking en el módulo **Envíos**.
- **Código postal: campo estructurado nuevo** en `sucursales.codigo_postal` y `cliente_domicilios.codigo_postal` (autocompletar desde `postal_code` de Google Places cuando venga, editable). Las direcciones de texto libre no alcanzan para las APIs.
- **Tarifa:** la API devuelve lista (servicio + precio + plazo); el operador **elige uno**, ese precio se carga como costo de envío de la venta y es **editable** (override manual permitido).

**Modelo de datos (propuesto):**
- **Migration A — credenciales + config:** `courier_credenciales(id, tenant_id, courier, credenciales JSONB, activo, created_at, updated_at)` UNIQUE(tenant_id, courier). RLS: el dueño hace upsert vía RPC; **los secretos NO se devuelven al front** (solo estado "configurado" + máscara). El Edge Function los lee con service_role. `tenants.envio_peso_fuente TEXT DEFAULT 'manual'` CHECK('manual'|'producto'). Opcional `tenants.envio_cotizacion_activa BOOLEAN`.
- **Migration B — CP estructurado:** `sucursales.codigo_postal TEXT`, `cliente_domicilios.codigo_postal TEXT`.
- **Migration C — dato maestro producto:** `productos.peso_kg`, `largo_cm`, `ancho_cm`, `alto_cm DECIMAL` (nullable).
- **Migration D — metadata API en envíos:** `envios.cotizacion_json JSONB` (snapshot de la opción elegida / todas), `envios.courier_orden_id TEXT` (ID de la orden en el courier), `envios.cotizado_api BOOLEAN`. `tracking_number`, `tracking_url`, `etiqueta_url`, `costo_cotizado/real` ya existen.

**Edge Functions (Deno, router por courier):**
- `courier-cotizar` — input `{courier, origen_cp, destino_cp, peso_kg, dims, valor_declarado?}` → lee credenciales del tenant → devuelve lista normalizada `[{servicio, precio, plazo_dias, disponible}]`.
- `courier-generar` — input `{envio_id}` → crea la orden en el courier → devuelve `{tracking_number, tracking_url, etiqueta_url, courier_orden_id, costo_real}`.
- `courier-tracking` (fase posterior) — refresco de estado del envío desde el courier.
- Adapters por courier dentro del Edge Function: `andreani.ts`, `correo.ts`, `oca.ts` (este último SOAP). Capa de normalización común.

**Fases de entrega:**
- **F1 — Fundación (datos + config, sin API) ✅ (en DEV, build OK):** Parte 1 (servicio como select dependiente en POS + catálogo compartido `src/lib/couriers/catalogo.ts`). Migrations 162 (`courier_credenciales` + `envio_peso_fuente`) + 163 (CP, idempotente: ya existía) + 164 (productos peso/dim). Config → Envíos: toggle peso-fuente (manual/producto, default manual) + `CourierCredencialesPanel` (owner-only). Campos peso/dim en form de producto. `AddressAutocompleteInput` pasa `postcode` best-effort. Pendiente deploy a PROD.
- **F2-F5 — Integración API ✅ (DEV, build OK · v1.14.0):** Edge Function único **`courier-api`** (`action` = cotizar | generar | tracking) con adapters **Andreani** (F2), **Correo Argentino** (F3, Paq.ar) y **OCA** (F4, SOAP); tracking en los tres (F5). Migration **165** (`envios.cotizacion_json/courier_orden_id/cotizado_api`). Cliente front `src/lib/couriers/api.ts`. **POS**: botón "Cotizar {courier}" (CP destino + peso) → lista servicio+precio+plazo → elegir setea servicio+costo (editable). **Envíos**: "Cotizar" en el modal + "Generar con courier" / "Etiqueta" / "Actualizar tracking" en el panel del envío. Credenciales leídas SOLO server-side (service_role). **⚠ Adapters según docs públicas — pendientes de validar con credenciales B2B reales; fail-safe: sin credenciales → error claro, no rompe el alta manual.**

**Riesgos/notas:** cada API requiere contrato B2B propio del negocio (sin cuenta → no hay cotización; fallback a tarifa manual `courier_tarifas`/KM como hoy). OCA es SOAP (parseo XML en Deno). Guardar secretos por tenant exige cuidado: no exponerlos al front, considerar Supabase Vault/pgsodium o columnas con RLS de solo-escritura. El peso volumétrico (dims) suele definir la tarifa: si `envio_peso_fuente='producto'` y faltan medidas, advertir/caer a manual.

### Relevamiento Ventas H-K — plan de implementación (relevado completo 2026-06-01)

Respuestas finales en `relevamiento_ventas_respuestas.md` → sección H-K. Plan por fases (cada una deployable a PROD con su versión). Orden por dependencia/valor; **L1 (Top 3) pendiente** → reordenable.

**Estado: VF1-VF5 ✅ TODAS en PROD (2026-06-01).** VF1-VF3 v1.15.0 (mig 167-169), VF4 v1.16.0 (mig 170), VF5 v1.17.0 (sin migración). **Relevamiento Ventas A-K COMPLETO.** Pendientes futuros (fuera del relevamiento): NC electrónica AFIP (L1), venta física en USD/caja USD (G5). **L1 (Top 3) sin responder.**

**VF1 — POS operativo (H2, H3, H4, H5)** ✅ · bajo riesgo, valor diario:
- **H4** — caja: `presupuesto` se puede crear **sin caja abierta**; `reserva` y venta directa (incl. 100% CC) **exigen caja**. Revertir la excepción actual de venta 100% CC sin caja (revisar `useCierreContable`/`validarDespacho` y el gate de caja en `registrarVenta`). Posible flag config si quieren permitir presupuesto-sin-caja on/off.
- **H5** — flag **"Consumidor final" vs "Cliente registrado"** al iniciar la venta (estado del carrito). Si `facturacion activa` + no consumidor final → cliente obligatorio. Integra con Config "Cliente en el punto de venta". Sin migración (o flag en `ventas` si se quiere persistir el tipo).
- **H2** — imprimir ticket **opcional**: botones "Imprimir" + "Enviar por email" (reusar `send-email` + `formatTicket`). Config tenant para default (siempre/opcional). 
- **H3** — **reimprimir** desde el historial de Ventas (cualquier rol con acceso). Botón en el detalle de venta.

**VF2 — Canales configurables + reglas online/presencial (I1, I2)** ✅ · modelo de datos nuevo, foundational:
- **I1** — tabla `canales_venta` por tenant (CRUD en Config) con `clasificacion ('online'|'presencial')`. **Quitar "MP"** del catálogo (migrar ventas con `origen='MP'`: mantener histórico, sacar de selects). Reemplaza el array hardcodeado `CANALES`.
- **I2** — reglas por clasificación online/presencial (config): **plazo de devolución**, **descuento máximo**, **lista de precios por defecto**, **requisito de cliente/factura**. Tabla/JSON `reglas_canal` por tenant {online:{...}, presencial:{...}}. El POS/devoluciones aplican la regla según la clasificación del canal de la venta.

**VF3 — Auditoría y permisos (J1, J2, J3)** ✅ · governance:
- **J1** — **audit log detallado por venta** (diff de ítems/precio/cliente). Tabla `venta_auditoria` (o reusar `actividad_log` con payload diff) accesible desde el modal de la venta.
- **J2** — clave maestra DUEÑO para **anular venta despachada** + **cambiar cliente** + **override descuento** (extiende `tenants.clave_maestra`).
- **J3** — **CONTADOR read-only** en Ventas: nav + ruta + guard que permite ver historial/detalle/export pero bloquea crear/editar.

**VF4 — Reportes y alertas de Ventas (K1, K2, K3)** ✅ · depende de VF2 (comparativa por canal):
- **K1** — reportes: baja rotación, más devoluciones, anuladas/devueltas con motivo, comparativa por canal, **margen real por venta**. Página/sección Reportes de Ventas.
- **K2** — alertas automáticas: **margen negativo**, **cliente con >N devoluciones en M días**, **producto con >N devoluciones en M días** (umbrales config). Sweep lazy o al registrar venta/devolución → `notificaciones`.
- **K3** — export **Excel + PDF + CSV** en cada reporte (consistente con Caja).

**VF5 — Edición post-venta + NC interna (H1)** ✅ · el más delicado, toca facturación/devoluciones:
- **H1** — quitar/editar ítem libre **antes de cobrar**; **post-cobro** requiere autorización SUPERVISOR/DUEÑO; si la venta **se facturó** → **NC interna/manual** (registro + motivo + ajuste contable, sin AFIP). Integra con devoluciones y el modelo de NC. La **NC electrónica AFIP** queda como feature separada (L1).

**Dependencias clave:** VF4 (comparativa por canal) usa el modelo de VF2. VF5 se apoya en el flujo de devoluciones existente. VF1/VF3 son independientes y pueden ir primero.

### Bugs / mejoras UX puntuales

| ID | Módulo | Descripción | Estado |
|---|---|---|---|
| ISS-075 | Historial | Trazabilidad de despacho y movimientos. **✅ v1.11.0 (mig 153+154)**: (1) tabla `venta_item_despachos` con desglose por LPN/ubicación/serie de cada ítem vendido + campo `origen` (`manual`/`auto`); (2) detalle de venta (VentasPage), detalle de movimiento (MovimientosPage) y **/historial** (HistorialPage) muestran el desglose completo por LPN; (3) ingreso/rebaje manual se vuelcan al `actividad_log` (`ingreso_stock`/`rebaje_stock`); (4) traslado con ubicación origen→destino; (5) toggle `tenants.trazabilidad_asignacion` en Config → Inventario. **Pendiente futuro**: consolidar aún más el /historial (ver nota Trazabilidad-extendida abajo) | ✅ v1.11.0 |
| ISS-080 | Alertas | Filtrar por sucursal todas las queries de AlertasPage | ✅ Resuelto 2026-05-28 — cruce client-side con `inventario_lineas`+`PSMSS` para stock; cruce con `inventario_lineas` para productos sin categoría |
| ISS-108 | Header / Mobile | Selector de sucursal invisible en celular | ✅ Resuelto 2026-05-28 — bloque mobile con ícono Building2 + nombre + `<select>` transparente superpuesto |
| ISS-148 | Recursos | Input texto libre para ubicación | ✅ Resuelto 2026-05-28 — componente `UbicacionPicker` (select con opciones del histórico de la sucursal + opción "+ Nueva ubicación") en form crear/editar, modal asignar y edit inline |
| ISS-151 | Dashboard + CC | Dashboard sumaba "Cancelación CC" como método de pago → distorsionaba la ganancia. **🔄 Implementado en DEV:** (1) `MixCajaChart` + `MetricasPage` excluyen pseudo-métodos (`Cuenta Corriente`, `Cancelación CC`, `Condonación CC`); (2) `ClientesPage` reemplaza el botón único por **Condonar** (write-off, tag `Condonación CC`) y **Revertir** (restaura la deuda), ambos solo DUEÑO/SUPERVISOR/ADMIN; las condonadas quedan visibles con badge para poder revertir. Ambas acciones mantienen la venta **despachada** (no tocan stock ni estado de entrega — P4). Sin migración. Ver modelo abajo. | 🔄 DEV |

### ISS-151 — modelo alineado (relevado con GO + socio, 2026-05-29)

Decisiones para implementar (no implementado aún):

1. **Dos acciones separadas en una venta con deuda CC** (ambas solo DUEÑO / SUPERVISOR / ADMIN):
   - **Condonar**: la deuda se da por perdida (incobrable). No es un cobro ni un ingreso.
   - **Revertir a pendiente**: la venta vuelve a estado de pago "falta pagar" para re-cobrarla por otro medio o anularla.
   - Reemplaza al actual botón único `cancelarDeudaCC` (`ClientesPage.tsx:405`) que hoy marca `monto_pagado = total` con un medio falso `"Cancelación CC"`.
2. **El cobro posterior de una CC NO suma a la ganancia del día**: la utilidad ya se contabilizó cuando la venta se despachó. Cobrar la deuda después es solo movimiento de caja (pasa de "por cobrar" a efectivo/medio real), no nueva utilidad.
3. **Dashboard**: `"Cancelación CC"` deja de contarse como medio de pago. Cuando la deuda se cobra por un medio real, recién ahí aparece en el gráfico bajo ese método de pago.
4. **Al revertir a pendiente, la venta sigue entregada** (solo cambia el estado de pago). Si hay que devolver mercadería, se usa el flujo de **Devolución** aparte (no se reintegra stock automáticamente).

### BUG-LPN (encontrado + corregido 2026-05-29, en DEV)

**Síntoma:** en venta directa, la selección manual de LPN en el carrito (override de `lpn_fuentes`) se ignoraba en el rebaje real — la Fase 2 de `registrarVenta` re-consultaba y ordenaba por el sort automático, rebajando de un LPN distinto al elegido. El desglose de ISS-075 lo destapó.

**Fix:** rebaje en 2 fases ([VentasPage.tsx Fase 2](src/pages/VentasPage.tsx)) — **Fase A** honra `item.lpn_fuentes` con cantidades exactas por LPN y en orden; **Fase B** completa por sort solo si quedó faltante (stock cambiado). Ahora el rebaje siempre coincide con los badges de LPN del carrito.

**BUG-RACE (mismo producto en varias líneas del carrito):** además del sort, había una **race condition**. La Fase 2 y Fase 3 de `registrarVenta` corrían en `Promise.all` (paralelo). Con el mismo producto en 2 líneas del carrito, ambas leían el mismo stock inicial y se pisaban → distribución de rebaje por LPN incorrecta y `stock_actual` desfasado. Detectado en Venta #198 (2 movimientos leyeron `stock_antes=35` ambos).

**Causa de fondo:** el trigger `lineas_recalcular_stock` → `recalcular_stock(producto_id)` ya setea `stock_actual = SUM(cantidad de líneas activas)` (o COUNT de series activas). El update **manual** de `stock_actual` en Fase 3 de `registrarVenta` peleaba contra el trigger y lo pisaba con un valor racy.

**Fix (en DEV):**
1. Fase 2 ahora es **secuencial** (`for` en vez de `Promise.all`) → sin race entre líneas del mismo producto.
2. Fase 3 **ya no actualiza `stock_actual` manualmente** (lo hace el trigger); solo registra movimientos, **agregados por producto** (un movimiento por producto con la cantidad total). `stock_antes` se reconstruye desde el `stock_actual` post-trigger.
3. Esto además **auto-corrige** desfases históricos: al dejar el trigger como única fuente, `stock_actual` converge a la suma real de líneas.

**Limitación conocida — ✅ RESUELTA (2026-05-30):**
- (b) **`stock_actual` manual en reserva→despacho**: ya estaba resuelto desde v1.11.0 (`cambiarEstado` NO toca `stock_actual`, lo deja al trigger y reconstruye `stock_antes/despues` con `stockVendibleSucursal`). El rótulo de "pendiente" estaba desactualizado.
- (a) **Selección manual de LPN no persistía en reservas**: resuelto con **mig 156** (`venta_items.lpn_plan JSONB`). `registrarVenta` persiste el plan del carrito `[{linea_id,lpn,cantidad,manual}]`; `cambiarEstado` (reservar + despachar) honra el plan (Fase A) y autocompleta por sort si cambió el stock (Fase B), con `origen` manual/auto. Antes el despacho de una reserva re-ordenaba por sort, ignorando el LPN elegido. Sin impacto en cantidades (solo trazabilidad fina del LPN).

**Datos de prueba con stock desfasado:** Ventas #196 y #198 (Almacén Jorgito) quedaron con distribución por LPN incorrecta y/o `stock_actual` −1. **Recalc global corrido en DEV** (113 productos, 0 desfasados). En PROD correr el recalc post-deploy.

### Trazabilidad-extendida — ✅ implementado en DEV (mig 155, 2026-05-30)

Visión (pedido GO 2026-05-30): `/historial` (HistorialPage) como **hub único de trazabilidad grado WMS** (Manhattan / Blue Yonder) para recall / auditoría / análisis. **Implementado en DEV** (mig 155, pendiente deploy PROD):

- ✅ **Consolidar por transacción**: `actividad_log` pasa a ledger con `transaccion_id` (+ `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id`). Las N filas de una acción (ej: editar LPN con 4 campos) comparten id → 1 tarjeta en `/historial` ("Editó LPN X — 4 cambios"), expandible campo por campo. Filas legacy (`transaccion_id` NULL) siguen como evento único. Helper `nuevaTransaccion()` en `actividadLog.ts`.
- ✅ **Filtro por LPN/serie (recall)**: panel "Trazá una unidad" reconstruye la historia completa de una unidad cruzando `actividad_log` + `venta_item_despachos`, sin paginar.
- ✅ **Export completo**: Excel del set filtrado completo (no solo la página, hasta 10k filas) con columnas del ledger.

**Decisión de diseño** (GO preguntó cómo igualar/superar un WMS tier-1): se eligió `transaccion_id` write-time (ledger inmutable, auditable), **no** heurística read-time por minuto (frágil, no auditable para recall). Snapshots de LPN/lote/serie desde el día 1.

**✅ Cerrado en v1.11.3 (2026-05-30)**: devoluciones ahora se loguean en `/historial` (`tipo_transaccion='devolucion'`, agrupadas por transacción, con producto_id + LPN); reserva→despacho y venta→devuelta clasificadas; filtro de recall por **producto** (nombre/SKU → producto_id) además de LPN/serie. Trazabilidad-extendida **completa**.

### Deuda técnica / pendientes abiertos

| Área | Descripción |
|---|---|
| **Aislamiento por sucursal a nivel RLS** | **Pedido GO 2026-05-30.** Hoy el aislamiento por sucursal es **solo cliente** (triple blindaje: fijado al cargar + selector oculto + guard de `setSucursal`). La RLS de la DB es por `tenant_id`, no por `sucursal_id` → un usuario técnico con credenciales podría leer otra sucursal vía API directa. Para que sea **imposible a nivel servidor**: RLS por sucursal en tablas operativas (`inventario_lineas`, `movimientos_stock`, `ventas`, `gastos`, `caja_sesiones`, …) cruzando `auth.uid()` → `users.sucursal_id` cuando `puede_ver_todas = false`. Cambio grande (políticas en N tablas) — diseñar antes. Detalle en `multi-sucursal.md`. |
| Gastos | Crash en GastosPage — pendiente stack trace Sentry del ErrorBoundary instrumentado |
| Relevamientos | 7 HTMLs generados (Ventas / RRHH / Clientes / Compras / Envíos / Caja / **Conteos** ✨). Ventas y Clientes ya respondidos + implementados. **`relevamiento-conteos-reglas-negocio.html`** (ISS-CONT, generado 2026-06-03, subagente `relevamiento`): 34 preguntas en 12 secciones (scope/marca, ciego vs informado, doble conteo, gate de ajustes, scan-to-count, cíclico, reconciliación, reportes, UX 2 velocidades, permisos, fases, Top 3) — **esperando respuestas de GO + socio**. RRHH / Compras / Envíos / Caja sin responder |

---

## Historial de lotes 2026-05-28

### Lote 3 — RRHH-A5 vinculación empleado ↔ usuario

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| RRHH-A5 | RRHH | Selector "Usuario del sistema" en form empleado + columna "Usuario" en tabla + validación duplicados client-side. Habilita "Mi Equipo" del SUPERVISOR sin tocar la BD a mano | 151 |

### Lote 6 — C3 + A7 (relevamiento Ventas A-D)

Implementación de 2 puntos cerrados del relevamiento Ventas (ver `relevamiento_ventas_respuestas.md`).

| ID | Módulo | Fix |
|---|---|---|
| C3 (parcial) | Ventas / POS | CAJERO ya no puede editar/colocar descuento por ítem ni descuento general en VentasPage. Inputs `disabled` con tooltip "Bloqueado para CAJERO. Pedile al SUPERVISOR/DUEÑO". Constante `descuentoBloqueadoCajero`. **Pendiente del mismo C3** (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR |
| A7 | Devoluciones | Radio "Dejar en DEV para revisión" / "Reintegrar a stock vendible" en modal de devolución, default DEV. Vendible: línea sin ubicación + `estado_id = primer es_disponible_venta`. No aplica a items serializados (siempre re-activan a su línea) |

### Lote 5 — ISS-178 rangos horarios entrega

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| ISS-178 | Ventas + Envíos + Config | `tenants.envio_rangos_horarios JSONB` con defaults 8-13/13-18/18-22 + `envios.rango_horario_desde/hasta TIME` (snapshot). CRUD en Config → Envíos, selector en modal envío de VentasPage y form de EnviosPage. Tabla de Envíos muestra el rango como badge accent | 152 |

### Lote 4 — 3 bugs UX (ISS-080, ISS-108, ISS-148)

| ID | Módulo | Fix |
|---|---|---|
| ISS-080 | Alertas | AlertasPage filtra por sucursal activa. Queries con `sucursal_id` ya filtraban; nuevo cruce client-side para `alertas` (vs PSMSS + inventario_lineas en la sucursal) y `productos sin categoría` (productos con stock en la sucursal). Sin schema change |
| ISS-108 | Header / Mobile | Bloque nuevo `sm:hidden` con ícono `Building2` + nombre truncado + `<select>` transparente superpuesto (solo si `puedeVerTodas`). Antes el selector desaparecía en < 640px |
| ISS-148 | Recursos | Componente `UbicacionPicker` (select con opciones del histórico filtradas por sucursal + opción "+ Nueva ubicación"). Aplicado en form crear/editar, modal "Asignar ubicación" y edit inline del tab Ubicaciones. Reemplaza al `<input>` libre |

### Lote 1 — commit `f96fd4d1` · release `dev-2026-05-28-lote-iss`

| ID | Módulo | Fix |
|---|---|---|
| ISS-140/141 | Config | Scrollbar oculto en sub-tabs Ventas e Inventario |
| ISS-149 | Gastos | Descuento OC acepta $ o % con toggle |
| ISS-152 | Gastos | `cajasAbiertasOC` filtra por sucursal activa (client-side) |
| ISS-172 | Envíos | KM haversine redondeado a entero |
| ISS-173 | Ventas | "Ya cobrado" → "Seña cobrada" cuando saldo > 0 |
| ISS-177 | Ventas | $/km modal envío es read-only |
| ISS-179 | Config | Form crear ubicación incluye sucursal, Mono-SKU y dims WMS |
| ISS-181 | Config | Comprobantes: reglas mutuamente excluyentes + texto más claro |
| ISS-194 | Caja | ~~Confirmado ya implementado~~ **REFIX**: default `caja_fuerte_roles=['DUEÑO']`; SUPERVISOR/SUPER_USUARIO como toggles habilitables |

### Lote 2 — commits `07d306c5` + `9ba1e3f9` · release `dev-2026-05-28-lote2-iss`

| ID | Módulo | Fix | Migration |
|---|---|---|---|
| ISS-135 | Config | `metodos_pago`: toggles POS/Gastos; VentasPage y GastosPage filtran por flag | 149 |
| ISS-142 | Config + Ventas | `cliente_obligatorio`/`creacion_inline`/`datos_minimos` conectados al POS | — |
| ISS-180 | Config | Unidades predefinidas no eliminables (lock) + validación duplicados | 148 |
| ISS-190 | Gastos | Badges "Sin pagar"/"Pago parcial" + modal pago parcial con movimiento en caja | 150 |

---

## Para el próximo deploy a PROD

Checklist obligatorio:
1. Bump `APP_VERSION` en `src/config/brand.ts` a `v1.10.5` (o v1.11.0 si se agrega feature)
2. PR `dev → main` con título `vX.Y.Z — descripción`
3. GitHub release `vX.Y.Z` sobre `main` como `--latest`
4. Actualizar este archivo + `log.md` + `roadmap.md`

**Nota para tenants existentes (ISS-194):** al deployar, avisar que deben ir a Config → Caja → Acceso a Caja Fuerte y desactivar SUPERVISOR/SUPER_USUARIO si no los quieren habilitados (el valor viejo queda guardado en DB).
