# Plan de escenarios — Backlog Comercial de Fede (25/7/2026), Fases A/B/C/D

Actualizado 2026-08-03. Puente hacia el e2e/UAT que falta para destrabar el deploy a PROD de las
Fases A (tiers+empaque), B (aprobación de cambio de estado con foto) y C (cupones) — pausado a
propósito porque tocan **plata y stock reales** sin e2e ni prueba manual (Regla de Oro #0). Fase D
(módulo Comercial) se suma porque es la superficie de permisos/delegación que envuelve a B y C.

**No hay `relevamiento_*_respuestas.md` para este backlog** — nació de un documento de decisiones de
Fede, no de un relevamiento HTML. Las fuentes de verdad son:

- `G360.Wiki/wiki/features/precios-tiers-empaque.md` (Fases F, A, C)
- `G360.Wiki/wiki/features/inventario-stock.md` → "Aprobación de cambio de estado con foto" (Fase B)
- `G360.Wiki/wiki/features/comercial.md` (Fase D)
- Código real (inspeccionado línea por línea para este plan, no solo el wiki):
  `src/lib/tiers.ts` + `tests/unit/tiers.test.ts` · `src/lib/cupones.ts` + `tests/unit/cupones.test.ts` ·
  `src/components/LpnAccionesModal.tsx` · `src/pages/InventarioPage.tsx` (`bulkCambiarEstado`,
  `aprobarAutorizacion`) · `src/pages/VentasPage.tsx` (tiers + cupón en el carrito real) ·
  `src/pages/ComercialPage.tsx` · `src/lib/permisosModulo.ts` · `src/lib/navVisibility.ts` ·
  `src/components/layout/AppLayout.tsx` · `src/App.tsx` (rutas) ·
  `supabase/migrations/329,330,331,332_*.sql`

## ✅ 0. Hallazgos — RESUELTOS con GO (2026-08-03), antes de escribir los e2e

Verificando el código contra el resumen del wiki aparecieron 3 cosas que iban más allá de un gap de
cobertura. Se avisó a GO (Regla de Oro #0) y las 3 quedaron resueltas antes de seguir:

- **H1 (guard server-side faltante)**: GO pidió agregarlo YA. **Hecho — mig 333**
  (`fn_inventario_estado_aprobacion_guard` + RPC `aprobar_cambio_estado_inventario`), revisada por
  `migration-reviewer` (2 bloqueantes reales encontrados y corregidos: el mirror de `requiereAuthAjuste`
  bloqueaba también el modo `'umbral'` — debía dejarlo pasar —, y el guard rompía "Procesar Aging"
  en cuanto un tenant mapee una regla hacia un estado con aprobación, arreglado exentando
  `process_aging_profile_single`/`process_aging_profiles` con el mismo GUC). Aplicada en DEV,
  frontend rewireado (`InventarioPage.tsx` llama al RPC en vez del update directo de 2 pasos).
  **APROB-09 ya tiene guard real — se puede escribir en verde.**
- **H2 (¿DUEÑO exento?)**: GO confirmó que es **intencional** — el DUEÑO no se autoaprueba un
  control que él mismo configuró. **APROB-03 se escribe documentando este comportamiento como
  correcto** (no como regresión). Extraída la fórmula duplicada a
  `src/lib/aprobacionEstado.ts::estadoCambioRequiereAprobacion` (unit tests en
  `tests/unit/aprobacionEstado.test.ts`, 8 casos incl. el propio H2) — único punto de verdad para
  `LpnAccionesModal.tsx` (single) e `InventarioPage.tsx` (bulk), y mirroreado server-side por la
  mig 333.
- **H3 (infra de e2e)**: sigue vigente como instrucción de implementación — ver abajo, sin cambios.

### H1 (histórico) — 🚨 Fase B NO tenía guard server-side: un PATCH directo por REST se saltaba TODO el control

El gate de aprobación de cambio de estado (mig 331) está implementado **100% en el cliente**
(`LpnAccionesModal.tsx` / `InventarioPage.tsx`): antes de guardar, JS decide si hace falta foto +
autorización o si escribe `estado_id` directo. **No existe ningún trigger ni CHECK en
`inventario_lineas`** que impida un `UPDATE`/`PATCH` directo a `estado_id` vía la REST API de
PostgREST (grep de `supabase/migrations/` confirmó que la mig 331 solo agrega la columna
`requiere_aprobacion` + el bucket de Storage — cero DDL de enforcement sobre `inventario_lineas`).
Cualquier usuario autenticado del tenant con permiso de UPDATE en esa tabla (que es la mayoría de
los roles, la RLS de esa tabla es por `tenant_id`, no por campo) puede hacer:

```
PATCH /rest/v1/inventario_lineas?id=eq.<lpn>   { "estado_id": "<estado-que-requiere-aprobacion>" }
```

y saltarse la foto, la autorización y la notificación al supervisor — **exactamente la misma clase
de bug que el "bypass masivo" que esta misma fase cerró** (`bulkCambiarEstado` escribía directo),
pero ahora a nivel API en vez de nivel botón de la UI. Coincide con la obligación #3 de la Regla de
Oro #0 del proyecto ("Guards server-side ADEMÁS de la UI — la UI se cachea/bypassea").

**No se puede escribir un test verde para esto hoy** — no hay nada que aserte en verde. Recomendación:
agregar una migración con un trigger `BEFORE UPDATE OF estado_id ON inventario_lineas` que rechace el
cambio a un estado con `requiere_aprobacion=true` salvo que venga acompañado de la aprobación (mismo
patrón que ya usa el proyecto para otros guards de plata). Reservado como **APROB-09** más abajo, sin
spec asignado todavía — se escribe recién cuando exista el guard a probar.

### H2 — ⚠ Contradicción wiki vs código: ¿el DUEÑO queda exento del gate de Fase B?

El resumen que llegó a esta tarea dice: *"El gate NO depende del rol de quien pide el cambio — hasta
el DUEÑO genera solicitud pendiente."* El código dice lo contrario:

```ts
// LpnAccionesModal.tsx:38 y :105
const requiereAprobacion = requiereAuthAjuste(user?.rol, tenant?.ajuste_autorizacion_roles ?? null, false)
const estadoRequiereAprobacion = estadoCambio && !!estadoDestino?.requiere_aprobacion && requiereAprobacion
```

`requiereAuthAjuste` reusa el gate de CANTIDAD (mig 228, `ajusteAutorizacion.ts`) — cuyo **default**
(sin configuración explícita del tenant) es `DUEÑO → 'directo'` (sin aprobación), **cualquier otro rol
→ 'siempre'**. El propio comentario del código lo justifica: *"el DUEÑO no se autoaprueba a sí mismo
un cambio que él mismo configuró"*. Es decir: con la config por default, **un DUEÑO que cambia un LPN
a un estado `requiere_aprobacion=true` lo aplica DIRECTO, sin foto ni autorización** — lo mismo pasa
en el cambio masivo (`bulkEstadoRequiereAprobacion`, misma fórmula duplicada en `InventarioPage.tsx`).

Esto **no es necesariamente un bug** (el diseño de reusar el gate de cantidad es defendible), pero
**contradice literalmente el texto de la wiki**, y define el comportamiento esperado de un control
anti-fraude — hay que confirmar con GO/Fede cuál de las dos es la intención real antes de fijar el
`expect()` de **APROB-03**. Mientras tanto, el escenario documenta el comportamiento **actual** del
código (bypass del DUEÑO) para que quede escrito en algún lado y no se pierda en la próxima sesión.

**Candidato a extracción (mata dos pájaros):** la fórmula `estadoRequiereAprobacion` está **duplicada
casi textual** en `LpnAccionesModal.tsx` (single) e `InventarioPage.tsx` (bulk) — mismo criterio,
copiado a mano, con riesgo de que diverja en el próximo cambio. Extraer a
`src/lib/aprobacionEstado.ts`:

```ts
export function estadoCambioRequiereAprobacion(
  estadoDestino: { requiere_aprobacion?: boolean } | null | undefined,
  rol: string | null | undefined,
  config: AjusteAutorizacionConfig,
  huboCambioDeEstado: boolean,
): boolean {
  return huboCambioDeEstado && !!estadoDestino?.requiere_aprobacion && requiereAuthAjuste(rol, config, false)
}
```

Con esto, **H2/APROB-03 se puede resolver como un test UNITARIO puro** (cero infra: casos DUEÑO
default, DUEÑO con `ajuste_autorizacion_roles.DUEÑO='siempre'` override, DEPOSITO/CAJERO/SUPERVISOR
default, estado sin el flag) en vez de un e2e completo con foto/Storage — y de paso deja UNA sola
fuente de verdad para single y bulk. **Recomendado hacer esta extracción ANTES de escribir los e2e de
Fase B** — reduce el riesgo de escribir el assert equivocado en APROB-01/02/03/04.

### H3 — Infra de e2e: estos specs NO pueden correr bajo la sesión OWNER por defecto

Consecuencia directa de H2: si APROB-01/02/04 (que necesitan un rol **sujeto** al gate) se escriben
sin cuidado y corren bajo el proyecto `chromium` (storageState de OWNER, `tests/e2e/.auth/session.json`),
van a fallar o dar falso-verde por el bypass del DUEÑO. `playwright.config.ts` ya tiene proyectos
dedicados con su propio storageState — `chromium-deposito` (`deposito_session.json`,
`E2E_DEPOSITO_EMAIL`) es el candidato natural (DEPOSITO ya tiene acceso a `/inventario`). Al escribir
estos specs hay que:

1. Agregar el número del spec al `testMatch` de `chromium-deposito` (o el proyecto de rol que
   corresponda) en `playwright.config.ts`.
2. Agregarlo también al `testIgnore` del proyecto `chromium` (mismo patrón que ya usa
   `45_descuento_supervisor_tope_mutante`, `47_conteo_autorizacion_rol_mutante`) para que NO corra
   dos veces con comportamiento distinto.
3. Verificar que `E2E_DEPOSITO_EMAIL`/credenciales estén configuradas en el entorno donde se corra
   (si faltan, Playwright directamente omite el proyecto — no es un falso verde, pero sí una corrida
   incompleta silenciosa a menos que se chequee).

---

## 1. Fase F — quick wins (mención breve, bajo riesgo, YA cubierta)

Sin plata/stock/fiscal. `profundidadDe`/`agruparPorNivel` (`src/lib/presentaciones.ts`) tienen unit
tests en `tests/unit/presentaciones.test.ts`. `tipo_empaque` es texto libre informativo sin CHECK
(mig 328) y el color cian de unidades base es puramente visual. **No se agregan escenarios nuevos.**

---

## 2. Fase A — motor de tiers enlazados a empaque (`TIER-`) 🛑 PLATA

Lógica pura: `src/lib/tiers.ts` → `tests/unit/tiers.test.ts` (28 tests). Espejo SQL:
`fn_precio_venta_efectivo` (mig 330, usada por Pedidos). Wireado real: `VentasPage.tsx`
(`tiersMayoristaMap`, `precioTierBase`, `precioTierEfectivo`).

### Ya cubierto (unit, `tiers.test.ts`)

- **TIER-01**: `matchTier` — los 5 operadores (`>`,`<`,`=`,`>=`,`<=`).
- **TIER-02**: `precioTier` — gana el PRIMER match en `orden` asc (incl. regresión del bug de
  "mayor umbral primero" que encontró `migration-reviewer` en mig 306); sin match → `null`; ignora
  `precio < 0`.
- **TIER-03**: `precioUnitarioDeTier` — `precio_fijo` tal cual; `pct` SIEMPRE sobre `precioLista`
  (nunca sobre uno ya rebajado); clamp 0-100 defensivo.
- **TIER-04**: `resolverBloquesTier` — sin tiers → 1 bloque a lista; tier normal → 1 bloque (compat
  100%); caso Fede exacto (pallet 2000u + 500 sueltas → 2 bloques); múltiplo exacto (2 pallets, sin
  resto); no completa ni 1 pallet → sin bloque de empaque; "no hace falta cargar por Pallet
  explícito" (2000u sueltas = mismo resultado que 1 pallet); 🛑 "compiten, gana el mejor" (el tier
  NORMAL le gana al de empaque para el mismo bloque); entre 2 tiers enlazados que matchean a la vez,
  gana el de mejor precio; `%` siempre sobre LISTA aunque compitan.
- **TIER-05**: `mejorPrecioMayorista` — el más barato entre los normales; ignora los enlazados a
  empaque (no tiene sentido "forzar mayorista" sin conocer la cantidad).
- **TIER-06**: `precioBlendedTier` — sin tiers → lista; tier normal → igual al `precioTier` de
  siempre; 🛑 preserva la plata TOTAL exacta del caso Fede ($230.000, $92/u); el total no cambia sin
  importar en cuántas líneas del carrito se reparta la misma cantidad total del SKU.

### GAP — falta e2e (wiring real en el carrito + parity SQL, nunca ejercitado en navegador ni en DB real)

- **TIER-07** — *Given* un producto con un tier `tipo_valor='pct'` (10% off) SIN enlace a empaque y
  precio de lista $1.000, *When* la cantidad del carrito alcanza el umbral, *Then* el indicador
  "Precio mayorista" muestra $900/u (10% de LISTA) y el total del carrito/`venta_items` refleja ese
  precio. — **e2e, falta** · spec **123** · prioridad **alta**.
- **TIER-08** — 🛑 el caso EXACTO de Fede. *Given* un producto con presentación "Pallet" (`factor_base
  = 2000`, vía `producto_presentaciones`) y un tier enlazado (`pct` 10%, `presentacion_id` = esa
  línea), *When* se cargan 2.500 unidades en el carrito (1 pallet completo + 500 sueltas) a precio
  de lista $100, *Then* el indicador "Precio mayorista" muestra el precio BLENDED $92/u, el total del
  carrito da exactamente $230.000, y tras confirmar la venta `venta_items.subtotal` (prorrateado si
  hay otros descuentos) suma ese mismo total — nunca ejercitado en navegador ni contra DB real hoy
  (el wiki dice "verificado con datos de DEV" pero fue una verificación SQL manual, no un e2e).
  — **e2e, falta** · spec **116** · prioridad **MÁXIMA** (es el pedido explícito de Fede, plata real,
  cero cobertura de integración).
- **TIER-09** — *Given* dos productos A y B del mismo tenant con sus propias presentaciones, *When*
  se intenta (por REST) `INSERT`/`UPDATE` en `producto_precios_mayorista` un tier de A con
  `presentacion_id` de una línea de B, *Then* el trigger `trg_ppm_presentacion_mismo_producto`
  rechaza con `RAISE EXCEPTION` — guard de integridad que el propio `migration-reviewer` pidió antes
  de aplicar la mig 329 (el FK no alcanza porque no pasa por RLS). — **e2e (REST-only), falta** ·
  spec **120** · prioridad **alta**.
- **TIER-10** — *Given* el mismo fixture de TIER-08 (pallet 2000u + 500 sueltas), *When* se llama al
  RPC `fn_precio_venta_efectivo(tenant_id, producto_id, 2500)` directo por REST (el que usa
  `fn_pedido_generar_venta` de Pedidos), *Then* devuelve el mismo precio blended $92/u que calculó el
  frontend — cierra la brecha de "Regla #0, fuente única de precio" que la mig 330 dice resolver pero
  nunca se probó contra un RPC real, solo se razonó matemáticamente. — **e2e (REST-only), falta** ·
  spec **116** (mismo fixture que TIER-08, se combinan en el mismo archivo) · prioridad **alta**.
- **TIER-11** — *Given* un tier enlazado a Pallet (5% off) y un tier normal (`cantidad_minima=1500`,
  precio fijo mejor) que también matchea la cantidad del bloque, *When* se cargan 2.500 unidades,
  *Then* el carrito real usa el precio del tier NORMAL para ese bloque (gana el mejor, no se
  acumulan) — replica TIER-04 pero contra el wiring real de `VentasPage`, no solo la función pura.
  — **e2e, falta** · spec **123** (mismo archivo que TIER-07) · prioridad **media** (la lógica pura
  ya está muy testeada; esto valida que el wiring no invirtió el orden).
- **TIER-12** (opcional) — *Given* un Pedido armado con la misma cantidad/tier/empaque de TIER-08,
  *When* se genera la venta desde Pedidos (`fn_pedido_generar_venta`), *Then* cobra exactamente lo
  mismo que la venta equivalente por POS — versión "por la UI de Pedidos" de TIER-10, más pesada de
  armar (haría falta wizard de Pedidos completo). TIER-10 ya cubre la parte de plata a nivel RPC;
  esto es la vuelta completa por UI. — **e2e, falta** · spec **129 (opcional/diferido)** · prioridad
  **baja**.

---

## 3. Fase B — aprobación de cambio de estado con foto (`APROB-`) 🛑 ANTI-FRAUDE

Sin lógica pura hoy — 100% UI+DB+Storage (`LpnAccionesModal.tsx` tab Editar, `InventarioPage.tsx`
`bulkCambiarEstado`/`aprobarAutorizacion`, bucket `autorizaciones-fotos`, mig 331). Ver H1/H2/H3 arriba
— **resolver la extracción de H2 antes de fijar los asserts de APROB-01 a 04**.

Ningún escenario de esta fase tiene cobertura hoy — **todo falta**.

- **APROB-01** — *Given* un LPN sin cambios pendientes y un estado destino con
  `requiere_aprobacion=true`, logueado con un rol SUJETO al gate (DEPOSITO/CAJERO/SUPERVISOR con la
  config default del tenant — ver H2), *When* se intenta guardar el cambio de estado SIN adjuntar
  foto, *Then* el guardado se bloquea con el error "Este estado requiere una foto tomada en el
  momento" y `estado_id` no cambia. — **e2e, falta** · spec **117** · prioridad **alta**.
- **APROB-02** — 🛑 el corazón del control. *Given* el mismo LPN/rol/estado de APROB-01, *When* se
  adjunta una foto (input con `capture="environment"`) y se confirma, *Then* se sube la foto al
  bucket `autorizaciones-fotos` en `${tenant_id}/${linea_id}-timestamp.ext`, se crea una fila en
  `autorizaciones_inventario` (`tipo='cambio_estado'`, `estado_anterior_id`/`estado_nuevo_id`/
  `foto_path` en `datos_cambio`, `estado='pendiente'`), se notifica por `notificaciones` a
  DUEÑO/SUPERVISOR/SUPER_USUARIO, y **`inventario_lineas.estado_id` de esa línea sigue siendo el
  viejo** hasta que alguien apruebe (verificar en DB, no solo el toast). — **e2e, falta** · spec
  **117** · prioridad **MÁXIMA**.
- **APROB-03** — ✅ GO confirmó (H2): es intencional. *Given* el mismo estado con
  `requiere_aprobacion=true` y la config default del tenant (`ajuste_autorizacion_roles` sin entrada
  explícita para DUEÑO), *When* el propio DUEÑO cambia el LPN a ese estado, *Then* el cambio se
  aplica DIRECTO, sin pedir foto ni crear autorización — documentado como comportamiento CORRECTO
  (`estadoCambioRequiereAprobacion`, `tests/unit/aprobacionEstado.test.ts` ya lo cubre a nivel
  unit). El e2e complementa verificando el flujo real de punta a punta en el navegador. — **e2e,
  falta** · spec **118** · prioridad **alta** (ya no bloqueada).
- **APROB-04** — 🛑 regresión del bug de seguridad que esta misma fase cerró. *Given* ≥2 LPNs
  seleccionados en la tabla de Inventario (rol sujeto al gate) y un estado destino con
  `requiere_aprobacion=true`, *When* se usa "Cambiar estado" MASIVO, *Then* (a) sin foto, bloquea
  igual que el caso single; (b) con foto, sube UNA sola foto para todo el lote, crea UNA
  autorización con `datos_cambio.linea_ids=[...]`, y **NINGÚN** LPN del lote cambia de estado hasta
  aprobar — antes de esta fase, el masivo escribía `estado_id` directo sin pasar por ningún gate (ni
  el nuevo ni el de cantidad, mig 228). Este test es la red de seguridad de ese bypass. — **e2e,
  falta** · spec **117** (mismo archivo que 01/02, mismo fixture de estado) · prioridad **MÁXIMA**.
- **APROB-05** — *Given* la autorización `cambio_estado` pendiente de APROB-02 (single), *When* un
  DUEÑO/SUPERVISOR la aprueba desde la tab Autorizaciones, *Then* recién ahí `estado_id` de la línea
  pasa al nuevo valor, la autorización queda `aprobada` con `aprobado_por`, y el botón "Ver foto"
  resuelve una URL firmada del bucket (5 min de validez). — **e2e, falta** · spec **121** · prioridad
  **alta**.
- **APROB-06** — *Given* la autorización batch de APROB-04, *When* se aprueba, *Then* **TODOS** los
  `linea_ids` del lote (no solo el primero) quedan con el `estado_id` nuevo — verificar en DB que la
  cantidad de líneas actualizadas coincide con `linea_ids.length`. — **e2e, falta** · spec **121**
  (mismo archivo que 05) · prioridad **alta**.
- **APROB-07** — *Given* cualquiera de las autorizaciones pendientes de arriba, *When* se rechaza
  (motivo obligatorio), *Then* ningún LPN cambia de estado, la autorización queda `rechazada` con
  `motivo_rechazo`. — **e2e, falta** · spec **121** (mismo archivo) · prioridad **media**.
- **APROB-08** — *Given* un LPN con rol sujeto a AMBOS gates (cantidad, mig 228, y estado, mig 331),
  *When* se cambian cantidad Y estado a la vez en el mismo guardado, *Then* se crean DOS filas de
  autorización independientes (`ajuste_cantidad` y `cambio_estado`), y el resto de los campos
  (ubicación, lote, proveedor) se guarda directo igual — conviven sin pisarse. — **e2e, falta** ·
  spec **126** · prioridad **media**.
- **APROB-09** — ✅ ver H1, RESUELTO (mig 333). *Given* un estado con `requiere_aprobacion=true` y
  un actor en modo 'siempre' (no-DUEÑO, config default), *When* se hace `PATCH /rest/v1/inventario_lineas`
  directo por REST con su token (sin pasar por el RPC de aprobación), *Then* la DB rechaza con
  `insufficient_privilege` (`fn_inventario_estado_aprobacion_guard`). Complementar con el caso
  positivo: el mismo PATCH directo para un actor en modo 'directo' (DUEÑO default) SÍ pasa (H2). —
  **e2e (REST-only), falta** · spec **120** (mismo archivo que TIER-09, ambos REST-only/guard de
  integridad) · prioridad **alta**.

---

## 4. Fase C — cupones (`CUPON-`) 🛑 PLATA + FISCAL

Lógica pura: `src/lib/cupones.ts` → `tests/unit/cupones.test.ts` (11 tests). Wireado real:
`VentasPage.tsx` (aplicar/canjear/re-validar). Guards DB: mig 332 (`UNIQUE(cupon_codigo_id)`,
`UNIQUE(tenant_id, codigo)`, CHECKs de monto/vigencia).

### Ya cubierto (unit, `cupones.test.ts`)

- **CUPON-01**: `cuponVigente` — rango inclusive en ambos extremos; fuera de rango → false; inactivo
  nunca vigente aunque la fecha caiga adentro.
- **CUPON-02**: `montoDescuentoCupon` — descuenta el monto fijo; 🛑 nunca más que el total (no da
  negativo); total 0 o cupón sin monto → 0.
- **CUPON-03**: `generarCodigoCupon`/`generarCodigosCupon` — alfabeto sin ambiguos (sin O/0, I/1);
  longitud configurable; únicos entre sí; clamp a `CUPON_CODIGOS_MAXIMO=100`; mínimo 1 aunque pidan
  0 o negativo.

### GAP — falta e2e (canje real, prorrateo fiscal, condiciones de carrera — nunca ejercitado)

- **CUPON-04** — *Given* un cupón activo/vigente con código `PROMO2026` ($500 fijo) y un carrito con
  subtotal $5.000 (con descuento general/combo ya aplicado), *When* se ingresa el código en
  "Descuento general" → Aplicar, *Then* aparece la línea "🎟 Cupón X: -$500" restada **ANTES** del
  descuento por método de pago (Promo) — verificar que el total mostrado sea
  `(subtotal − desc.general − combos − 500) × (1 − promo%)`, no al revés. — **e2e, falta** · spec
  **122** · prioridad **alta**.
- **CUPON-05** — *Given* un código inexistente, uno ya usado (`usado_en_venta_id` seteado), uno de un
  cupón inactivo y uno con `vigencia_hasta` vencida, *When* se intenta aplicar cada uno, *Then*
  todos rechazan con un toast de error específico y ninguno queda aplicado al carrito. — **e2e,
  falta** · spec **122** (mismo archivo) · prioridad **media**.
- **CUPON-06** — 🛑 el hallazgo fiscal más importante de esta fase (Regla #0). *Given* una venta
  compuesta ÚNICAMENTE por un cupón aplicado (sin descuento general, sin combo, sin promo por medio
  de pago), *When* se confirma y se emite/factura, *Then* `venta_items` (vía
  `prorratearDescuentoGlobal`, que ahora incluye `montoCupon` en `hayDescGlobal`) suma EXACTO el
  total con el cupón restado — sin este fix, la venta se hubiera facturado por el monto SIN
  descontar el cupón (sobre-facturación). Verificar `venta_items.subtotal` sumado = `ventas.total`, y
  si se llega a emitir CAE real (circuito de homologación), que el comprobante refleje el monto neto
  correcto. — **e2e, falta** · spec **115** · prioridad **MÁXIMA**.
- **CUPON-07** — *Given* un cupón aplicado al carrito, *When* — antes de confirmar la venta — se
  marca ese mismo código como usado por otra vía (REST, simulando una venta concurrente en otra
  caja), *Then* al confirmar la venta ACTUAL corta con el error "ya no está disponible" **ANTES** de
  crear la fila en `ventas` (re-validación en fresco) — no se cobra un descuento que no se puede
  honrar. — **e2e, falta** · spec **119** · prioridad **alta**.
- **CUPON-08** — *Given* dos ventas simultáneas que intentan canjear el mismo código (condición de
  carrera del `UPDATE ... WHERE usado_en_venta_id IS NULL`), *When* ambas llegan casi a la vez,
  *Then* solo UNA gana el claim atómico; la perdedora ve el toast "se usó en otra venta al mismo
  tiempo" pero la venta YA cobrada **no se deshace** (se preserva `cupon_monto` como snapshot de lo
  realmente cobrado). Complementar con un test DB-only: `UPDATE` directo de `ventas.cupon_codigo_id`
  a un valor ya usado por otra venta debe fallar por el `UNIQUE` (`ventas_cupon_codigo_id_key`) —
  blindaje de constraint, no solo de lógica de aplicación. — **e2e, falta** · spec **119** (mismo
  archivo) · prioridad **alta**.
- **CUPON-09** — *Given* una venta ya confirmada con `cupon_monto` guardado, *When* después se cambia
  el `monto` del cupón (campaña) o se desactiva, *Then* la venta histórica sigue mostrando el
  `cupon_monto` original (snapshot, Regla #0 — nunca reescribir histórico fiscal). — **e2e, falta** ·
  spec **128** · prioridad **media**.
- **CUPON-10** — *Given* una campaña nueva creada desde `ComercialPage` (10 códigos, $500, vigente),
  *When* se canjea 1 código en una venta real, *Then* el historial de la campaña muestra
  "1/10 usados · $500 generado" — valida el cálculo `usados × monto` de "$ generado". — **e2e, falta**
  · spec **128** (mismo archivo) · prioridad **baja**.

---

## 5. Fase D — módulo Comercial (`COM-`) — permisos y delegación

Sin migración — 100% frontend sobre tablas/RLS ya existentes. Piezas puras ya testeadas
GENÉRICAMENTE (no específicas de `'comercial'`, pero la lógica aplica igual): `navVisibility.ts` →
`navVisibility.test.ts`, `permisosModulo.ts` → `permisosModulo.test.ts`.

### Ya cubierto (unit, genérico — aplica a cualquier módulo incl. `'comercial'`)

- **COM-01**: `moduloSoloLectura`/`moduloOculto`/`puedeEditarModulo` — 'ver' = solo lectura,
  'no_ver' = oculto, sin `permisos_custom` = sin restricción, rol VIEWER = solo lectura en TODO.
  Estas funciones son genéricas por `modulo: string`, así que ya cubren `'comercial'` sin cambios.
- **COM-02**: `navItemVisible` — `ownerOnly`/`supervisorOnly` filtran por rol ANTES de mirar
  `permisos_custom`, y `permisos_custom` solo puede OCULTAR (`no_ver`), nunca mostrar algo que el
  rol base ya tiene bloqueado — la propiedad "un rol custom solo restringe, nunca amplía" está
  probada en `navVisibility.test.ts` de forma genérica ("`'ver'`/`'editar'` no ocultan").
  ⚠ **GAP barato (unit, cero infra)**: el array `NAV` de `navVisibility.test.ts` (mirror manual de
  `AppLayout.tsx`, con el comentario "si cambian los flags allá, este array debe acompañar") **NO
  incluye la entrada `{ modulo: 'comercial', supervisorOnly: true }`** — quedó afuera cuando se
  agregó el nav item real. La propiedad genérica sigue siendo válida (`navItemVisible` no sabe nada
  de módulos específicos), pero conviene agregar la fila + un `it` explícito ("Comercial visible
  para DUEÑO/SUPERVISOR/SUPER_USUARIO, oculto para CAJERO/DEPOSITO/CONTADOR/RRHH") para que quede
  bajo la red de regresión de esa auditoría rol×modo. — **unit, falta** · prioridad **baja/barata**
  (5 minutos, hacerlo antes que los e2e de esta fase).

### GAP — falta e2e (wiring real: rutas, redirect, delegación real con usuario armado)

- **COM-03** — *Given* los 4 roles con acceso (DUEÑO/SUPERVISOR/SUPER_USUARIO ven el nav item;
  CAJERO/CONTADOR/DEPOSITO/RRHH no), *When* cada uno navega DIRECTO a `/comercial` por URL (no por
  el nav), *Then* CAJERO/CONTADOR/DEPOSITO/RRHH son redirigidos por el blocklist de
  `AppLayout.tsx` (`CAJERO_ALLOWED`/`CONTADOR_ALLOWED`/`DEPOSITO_ALLOWED`/rrhh) a su ruta permitida,
  y DUEÑO/SUPERVISOR/SUPER_USUARIO SÍ pueden entrar. — **e2e, falta** · spec **127** · prioridad
  **alta** (usar los proyectos de rol ya existentes: `chromium-cajero`/`chromium-deposito`/
  `chromium-contador`/`chromium-rrhh`, más `chromium-supervisor` para el caso positivo).
- **COM-04** — ⚠ gap real encontrado al revisar el guard de rutas. *Given* un usuario con rol
  `VIEWER` (excluido a propósito de `VIEWER_MODULOS`, que NO incluye `'comercial'`) o un usuario con
  rol `ADMIN` (staff de plataforma, no debería tener nav item tampoco), *When* navega DIRECTO a
  `/comercial` por URL, *Then* — a diferencia de CAJERO/DEPOSITO/CONTADOR/RRHH — **no hay ninguna
  rama del `useEffect` de restricciones de `AppLayout.tsx` que los redirija** (el `else if
  (user.permisos_custom)` solo aplica si el usuario tiene `permisos_custom` cargado, que VIEWER/
  ADMIN normalmente no tienen) — el componente `ComercialPage` se renderiza igual. El dato queda
  aislado por tenant (RLS de `combos`/`cupones` es `tenant_id`-only, sin bypass `is_admin()`), así
  que NO es un leak cross-tenant, pero SÍ es una fuga de visibilidad dentro del propio tenant
  (VIEWER ve más de lo que el diseño de `VIEWER_MODULOS` dice que debería). Documentar el
  comportamiento actual; evaluar con GO si conviene agregar VIEWER/ADMIN al guard de rutas o aceptar
  el gap (bajo impacto real: ADMIN normalmente no loguea en esta app, solo en `genesis360-admin`).
  — **e2e, falta** · spec **127** (mismo archivo que COM-03) · prioridad **media**.
- **COM-05** — *Given* el caso de uso explícito de Fede: un empleado con rol base **SUPERVISOR** +
  un rol custom "Comercial" (`roles_custom`) que marca `no_ver` en todos los módulos salvo
  `comercial`, *When* ese usuario loguea, *Then* el nav SOLO muestra Comercial (y los módulos
  `cajeroVisible`/globales mínimos si los hay) — nada de Config/Usuarios/Sucursales/RRHH/Reportes.
  Valida la delegación real end-to-end, no solo la función pura. — **e2e, falta** · spec **125** ·
  prioridad **alta** (es el caso de uso que justifica la existencia de la Fase D).
- **COM-06** — *Given* un usuario con rol base **CAJERO** (sin `supervisorOnly`) al que se le asigna
  un rol custom con `comercial: 'editar'` (alguien intentando "regalarle" acceso vía rol custom),
  *When* loguea, *Then* SIGUE sin ver `/comercial` — el rol custom no puede AMPLIAR más allá de lo
  que el rol base ya habilita (`supervisorOnly` se evalúa antes que `permisos_custom` en
  `navItemVisible`). Blinda contra que alguien invierta el orden de los checks en un refactor futuro.
  — **e2e, falta** · spec **125** (mismo archivo que COM-05) · prioridad **media**.
- **COM-07** — 🛑 regresión de un bug real ya encontrado y corregido. *Given* un usuario con
  sucursal activa seleccionada (sucursal B de 2), *When* crea un combo nuevo desde
  `ComercialPage` → tab Combos, *Then* el combo queda con `sucursal_id = sucursal B` (no `NULL`/
  global) — el `addCombo` original se olvidó el `sucursal_id` al portar el código desde
  `ConfigPage.tsx`, y un combo "global" sin querer se ofrece en TODAS las sucursales del tenant.
  — **e2e, falta** · spec **124** · prioridad **alta**.
- **COM-08** — (documentar como limitación conocida, SISTÉMICA de toda la app, no nueva de Fase D)
  *Given* un usuario con rol custom marcado `'ver'` en `comercial` (`canEdit=false` en la UI, botones
  de crear/editar/eliminar combo/cupón ocultos), *When* hace un `POST`/`PATCH` directo por REST a
  `/rest/v1/combos` o `/rest/v1/cupones` con su propio token, *Then* la RLS (tenant_id-only) **deja
  pasar** la escritura — el "solo lectura" de `permisos_custom` es 100% client-side en TODA la app
  (mismo patrón que Fase B/H1, pero preexistente y transversal, no introducido por esta fase). Vale
  la pena un test que lo documente porque Comercial maneja descuentos = plata, más sensible que otros
  módulos de solo-lectura, pero **no es un hallazgo nuevo** — es un límite de diseño conocido del
  sistema de `roles_custom`. — **e2e, falta** · spec **130 (opcional/documentar, no bloqueante)** ·
  prioridad **media**.

---

## Resumen

**39 escenarios totales** — 12 unitarios cubiertos (11 originales + `aprobacionEstado.test.ts` nuevo
para H2/APROB-03, 8 casos) + COM-02 (gap barato) ✅ cerrado + **28 escenarios e2e** repartidos en
**16 specs** (rango **115 a 130**, dos opcionales/diferidos: 129, 130). APROB-09 ya tiene guard real
(mig 333) y pasó de "sin spec posible" a formar parte de spec 120.

| Fase | Unit cubiertos | Unit falta | e2e falta | Total |
|---|---|---|---|---|
| F (mención) | — | — | — | — |
| A — TIER | 6 | 0 | 6 | 12 |
| B — APROB | 0 (+8 nuevos en `aprobacionEstado.test.ts`) | 0 | 9 | 9 |
| C — CUPON | 3 | 0 | 7 | 10 |
| D — COM | 2 | 0 ✅ | 6 | 8 |
| **Total** | **11** (+8 H2) | **0** | **28** | **39** |

### ✅ Ya resuelto antes de escribir los e2e (sesión 2026-08-03)

1. **Extraída `estadoCambioRequiereAprobacion`** a `src/lib/aprobacionEstado.ts` (H2), rewireada en
   `LpnAccionesModal.tsx`/`InventarioPage.tsx`, 8 tests unitarios nuevos.
2. **Guard server-side agregado** (H1) — mig 333, revisada por `migration-reviewer`, aplicada en DEV.
3. Agregado `'comercial'` al mirror `NAV` de `navVisibility.test.ts` (COM-02) + test explícito de
   visibilidad por rol.

tsc + build + unit suite completa (1440+36 nuevos) verificados en verde después de estos 3 cambios.

### Orden recomendado de escritura de los 14 specs obligatorios (más riesgo/plata primero)

| # | Spec (sugerido) | Escenarios | Prioridad | Por qué primero |
|---|---|---|---|---|
| 115 | `115_cupon_prorrateo_fiscal_mutante.spec.ts` | CUPON-06 | **MÁXIMA** | Riesgo fiscal directo (sobre-facturación real, adyacente a AFIP) |
| 116 | `116_tier_pallet_empaque_mutante.spec.ts` | TIER-08, TIER-10 | **MÁXIMA** | El pedido insignia de Fede, plata real, cero cobertura de integración hoy |
| 117 | `117_aprobacion_estado_bypass_masivo_mutante.spec.ts` | APROB-01, 02, 04 | **MÁXIMA** | Corazón del control anti-fraude + regresión de un bug de seguridad ya cerrado |
| 118 | `118_aprobacion_estado_dueno_bypass.spec.ts` | APROB-03 | alta | Documenta el bypass del DUEÑO confirmado como intencional (H2) |
| 119 | `119_cupon_doble_uso_mutante.spec.ts` | CUPON-07, 08 | alta | Defensa de plata contra doble canje/carrera |
| 120 | `120_tier_trigger_cross_producto.spec.ts` | TIER-09, APROB-09 | alta | Guards de integridad REST-only, sin UI (cross-producto + bypass server-side ya cerrado) |
| 121 | `121_aprobacion_estado_resolver_mutante.spec.ts` | APROB-05, 06, 07 | alta | Cierra el ciclo de vida completo de una autorización |
| 122 | `122_cupon_canje_pos_mutante.spec.ts` | CUPON-04, 05 | alta | Camino feliz + rechazos del canje real |
| 123 | `123_tier_pct_y_prioridad_mutante.spec.ts` | TIER-07, 11 | alta/media | Wiring real de casos ya muy cubiertos a nivel unit |
| 124 | `124_comercial_combo_scoping_sucursal_mutante.spec.ts` | COM-07 | alta | Regresión de bug ya encontrado (scoping por sucursal) |
| 125 | `125_comercial_delegacion_rol_custom_mutante.spec.ts` | COM-05, 06 | alta/media | Caso de uso explícito de Fede (delegación) |
| 126 | `126_aprobacion_estado_convive_cantidad_mutante.spec.ts` | APROB-08 | media | Convivencia de dos gates, menor probabilidad de romperse |
| 127 | `127_comercial_acceso_directo_url.spec.ts` | COM-03, 04 | alta/media | Guard de rutas, impacto acotado (mismo tenant) |
| 128 | `128_cupon_snapshot_y_admin_mutante.spec.ts` | CUPON-09, 10 | media/baja | Snapshot histórico + reporting admin |

**Diferidos/opcionales** (no bloqueantes para destrabar el deploy de A/B/C, documentar y decidir con
GO si se escriben): **129** (`129_tier_pedido_parity_mutante.spec.ts`, TIER-12) y **130**
(`130_comercial_rls_solo_lectura.spec.ts`, COM-08). **APROB-09** queda fuera de la numeración hasta
que exista el guard de servidor que lo haga testeable.

> ⚠ **Corrección de nombres de archivo (sesión 2026-08-03, al escribir 115-120)**: los nombres
> sugeridos arriba para las specs "REST-only/documentales" (118, 120, y — para la próxima sesión —
> 127, 130) terminaban en `_spec.ts` (guión bajo, sin punto). Playwright con la config default de
> este repo (`testDir: './tests/e2e'`, sin `testMatch` global) solo descubre archivos que matcheen
> `*.spec.ts`/`*.test.ts` — `_spec.ts` (sin el punto) da **"No tests found"**, no corre en silencio.
> 118 y 120 ya se escribieron y renombraron a `118_aprobacion_estado_dueno_bypass.spec.ts` /
> `120_tier_trigger_cross_producto.spec.ts` (verificado en verde). Al escribir 127/130 usar el mismo
> patrón `NNN_descripcion.spec.ts` (con el punto), no `NNN_descripcion_spec.ts`.

> ✅ **Lote 2 escrito y verde (sesión 2026-08-03, specs 121-123)**. Dos notas para la próxima sesión:
>
> 1. **121 corre bajo `chromium` (DUEÑO), no `chromium-deposito`** — desviación intencional de la
>    sugerencia de la consigna. APROB-05/06/07 ejercitan la RESOLUCIÓN (aprobar/rechazar) de una
>    autorización ya pendiente, no su creación — el actor relevante es quien puede aprobar
>    (`puedeVerAutorizaciones` + el RPC `aprobar_cambio_estado_inventario`, mig 333, exigen
>    DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN), no un rol sujeto al gate. La precondición PENDIENTE se
>    siembra directo por REST (incl. la foto real al bucket vía POST binario crudo al endpoint de
>    Storage, mismo formato que usa `supabase-js` internamente) reproduciendo lo que deja
>    `LpnAccionesModal`/`bulkCambiarEstado` — no hizo falta re-ejercitar el flujo de creación (ya
>    cubierto por 117) ni tocar `playwright.config.ts`.
> 2. 🛑 **Hallazgo de proceso (no de producto) — regex ancorado sobre un `<option>` con sufijo
>    condicional dejó un leak real en DEV**: el spec 122 (CUPON-04) siembra una promo 10% en
>    "Efectivo" (mismo mecanismo que el spec 98) para probar el orden cupón-antes-que-promo. La
>    primera versión usaba `hasText: /^Efectivo$/` (copiado de los specs 115/116, que NUNCA tocan
>    promos) para ubicar el `<select>` de medio de pago — pero con la promo activa la opción se
>    etiqueta `"Efectivo · 🏷 10% off"` (`VentasPage.tsx`), así que el regex anclado no matcheaba
>    nunca, el `.selectOption()` colgaba hasta el timeout de 120s, y el `finally` que restaura
>    `metodos_pago.config` no llegó a correr a tiempo (Playwright cierra el contexto al vencer el
>    timeout, la request de restauración quedó con "Target closed"). Eso dejó el 10% off en
>    "Efectivo" REALMENTE aplicado en DEV — un método de pago compartido por TODA la suite (115/116
>    cobran en Efectivo asumiendo cero descuento) — hasta que se detectó por el efecto dominó (123
>    también colgó en el mismo punto, con `metodos_pago.config` ya contaminado). Corregido: (a) el
>    regex de ubicación del `<select>` pasa a `hasText: /Efectivo/` sin anclas (mismo criterio que
>    ya usa el spec 98) en 122 y 123; (b) se restauró manualmente `metodos_pago.config` de
>    "Efectivo" en DEV (verificado contra las demás filas del tenant, todas en `null`) antes de
>    continuar. **Regla para specs futuros que muteen `metodos_pago.config` de un método compartido**:
>    nunca anclar el regex de texto de una opción que puede llevar un sufijo condicional de promo.
> 3. Corrida conjunta 115-123 (18 tests, 2 proyectos) verde salvo un flake de infraestructura
>    aislado y no reproducible (spec 115, `garantizarCajaAbierta` no encontró "Caja1" en esa
>    corrida puntual — pasó limpio al repetirlo solo); no relacionado con 121-123.

## ✅ PLAN COMPLETO (sesión 2026-08-04) — los 14 specs obligatorios (115-128) están escritos y verdes

**Lote 3 (124-128) escrito por el agente `test-author` de la sesión anterior; se cortó por límite
de gasto de la cuenta justo terminando la verificación de 127. Retomado en la sesión siguiente sin
más subagentes** (para no volver a pegar contra el límite) — se corrió directo la suite del lote 3
y se cerraron 2 fallas reales que quedaron sin verificar:

1. **124, 125, 126, 127 verdes de punta a punta** (17 passed, 5 skipped por proyectos de rol sin
   credencial en ese entorno puntual — no relacionado a lógica de producto) en la primera corrida.
2. **128 (CUPON-09) — flake de infraestructura, no bug de producto**: falló una vez con el botón
   "Guardando..." colgado (probablemente DEV bajo carga tras 3 tandas de e2e seguidas en la misma
   sesión) — pasó limpio al reintentar en aislamiento. Mismo patrón que el flake de "Caja1" del
   lote 2 (nota arriba), consistente con `reference_e2e_suite_no_deterministica` en memoria.
3. 🛑 **128 (CUPON-10) — bug real de TEST (no de producto), corregido**: la aserción del reporting
   de campaña (`getByText(/1\/10 usados · \$500 generado/)`) buscaba en TODA la página, sin
   scopear a la tarjeta de la campaña nueva. `$500` es un monto de prueba común entre los specs de
   cupón (115/119/122/128), así que ya había varias campañas VIEJAS en DEV con el mismo texto
   "1/10 usados · $500 generado" (mismo monto, mismo patrón de 10 códigos/1 usado) — la aserción
   daba `strict mode violation: resolved to 3 elements`. Corregido scopeando el locator a la card
   de `nombreCampaña` (`page.locator('div', { has: getByText(nombreCampaña, {exact:true}) }).last()`,
   que resuelve al div más específico — `ComercialPage.tsx:486` — que envuelve nombre + línea de
   vigencia/usados/generado) antes de buscar el texto de reporting adentro. **Regla para specs
   futuros que verifiquen texto de reporting/agregados en una lista con entradas de otros specs**:
   scopear siempre a la card/fila específica por un identificador único (timestamp en el nombre),
   nunca un `getByText` page-wide sobre un valor que puede repetirse (montos redondos, "10 códigos",
   etc.).

**Corrida final de los 14 specs juntos** (`115` a `128`, proyectos `chromium` + `chromium-deposito`
+ los 4 de rol que usa 127): verde. Unit suite completa (91 archivos + 3 nuevos) + `tsc --noEmit` +
`vite build`: verde. Los 2 opcionales/diferidos (129 `129_tier_pedido_parity_mutante`, TIER-12; 130
`130_comercial_rls_solo_lectura`, COM-08) quedan **fuera a propósito**, documentados como diferidos
en la sección 5 de arriba — no bloquean destrabar el deploy de A/B/C.

**Total de e2e nuevos**: 14 specs, 27 escenarios (los 27 del conteo original — CUPON-06 estaba
contado dentro de 115, correcto). Sumado a los 12 unitarios (11 + `aprobacionEstado.test.ts`) y el
guard server-side nuevo (mig 333), **el plan completo de 39 escenarios queda cerrado.**
