---
title: Planes y Pricing
category: business
tags: [planes, pricing, free, basic, pro, enterprise, limites, competencia]
sources: [xubio.com, contabilium.com, netegia.com, neuralsoft.com, aconpy.com]
updated: 2026-07-01
---

# Planes y Pricing

> ⚠️ **Los precios de la app (`brand.ts`) están DESACTUALIZADOS** ($4.900/$9.900, ~5-25x por debajo del mercado 2026). Pricing en definición — ver "Propuesta en discusión" abajo. Actualizar `src/config/brand.ts` (`PLANES`, `MAX_MOVIMIENTOS_POR_PLAN`, `FEATURES_POR_PLAN`) cuando GO cierre los números.

---

## 📊 Comparativa de competencia (jul-2026, todo con IVA 21%)

**Contexto:** Xubio, Contabilium, **Netegia** y **Ninox** **publican** precios; Neuralsoft, Aconpy y **Zeus ERP** los **esconden** ("contactanos" / débito obligatorio). Publicar precio transparente self-serve puede ser diferenciador para el segmento emprendedor/comercio chico.

### Precios publicados (con IVA salvo aclaración)
| Producto | Enfoque | Plan entrada | Plan medio | Plan alto |
|---|---|---|---|---|
| **Ninox** (indumentaria) | Gestión + factura, especialista **ropa/variantes** | Emprendedor **$24.000** · 2.000 artíc · 1 terminal | Comercio **$46.000** · 5.000 artíc · 3 term | Empresa **$94.000** · 10.000 artíc · 5 term (IVA no aclarado; +sucursal $25k, +integr $30k) |
| **Xubio** (Emprendedores) | Facturación + gestión liviana | Estándar débito **$27.951** (otros medios $72.842) · 1.000 comprob · 2 users | — | Ilimitado débito **$113.256** · ∞ |
| **Netegia** (ERP PyME) ⭐ | **Competidor más directo** (facturación+inventario+multi-suc+CRM+POS) | Pyme Lite **$96.182** · 4.000 comprob · 4.000 artíc · 2 suc · 2 CUIT · 4 users | Premium **$232.272** · 10.000 comprob · 10.000 artíc · 6 suc · 10 users | Premium+ **$389.537** · 15.000 comprob · 15.000 artíc · 10 suc · 15 users (20% off anual, trial 15d) |
| **Contabilium** | **Contable puro** (plan de cuentas, asientos, multi-CUIT) | Standard **$147.620** · 2.500 comprob · 5.000 SKU · 2 users | Pro **$216.590** · 5.000 comprob · 10.000 SKU · 10 users | Full **$296.450** · 10.000 comprob · 20.000 SKU · ∞ |

### Competidores sin precio público (perfil)
| Producto | Qué es | Relevancia |
|---|---|---|
| **Zeus ERP & POS** | Cloud POS-first + factura AFIP (QR), multi-razón-social, verticalizado (pinturerías/jugueterías/electrónica). **Débito obligatorio + permanencia 6 meses.** | Directo (POS+AFIP). Precio publicado mensual en subpágina, bloquea bots. |
| **Neuralsoft MyLogic** | ERP enterprise con IA: WMS, POS, producción, contabilidad, CRM. Cloud privada, "tarifa plana por usuario". | Ancla **alta** (Enterprise). |
| **Aconpy** | Contable + **liquidación de sueldos con +200 convenios**, libro IVA, facturación. Target contadores/estudios. | Su **RRHH/sueldos es más profundo** que el nuestro. |

### Metering de la competencia (qué dimensiones cobran)
- **Netegia:** comprobantes + artículos + **sucursales** + **CUITs** + proveedores + integraciones + usuarios (multi-dimensional, generoso: 4.000 artíc en el plan más barato).
- **Ninox:** artículos + **terminales POS** + sucursales (extra $25k/suc); artículos 2.000 en el más barato.
- **Contabilium:** comprobantes + SKU (5.000-20.000) + usuarios + CUITs.
- ⇒ **SKU/artículos SÍ es dimensión válida, pero a niveles de MILES**, no cientos. Sucursales y usuarios son palancas comunes.

### 🥊 Netegia head-to-head honesto (2026-07-04, fuentes: netegia.com)

Respuesta sin marketing a "¿por qué alguien elegiría Netegia?" (pedido GO):

> ⚠ Corrección misma sesión: la primera versión de esta sección decía que Genesis360 no tenía
> integraciones e-commerce — FALSO (ML+TN+MODO vivas en PROD: OAuth, stock bidireccional, precios,
> pedidos idempotentes vía `ventas_externas_logs`, workers cada 5 min). Corregido abajo.

**Por qué HOY un comercio racional podría elegir Netegia:** (1) **Trayectoria**: +1.500 empresas activas, años en el mercado, contadores que ya lo conocen — Genesis360 tiene ~1 cliente real y el riesgo percibido "¿y si desaparece?" es legítimo; (2) **circuito ML más profundo en lo fiscal**: facturación masiva de pedidos ML con subida del PDF, picking list y etiquetas desde el sistema (nosotros sincronizamos stock/precios e ingestamos pedidos, pero las ventas externas se registran en `ventas_externas_logs`, no como ventas facturables del circuito normal — ver roadmap-apis); (3) **multi-CUIT** (2-10 razones sociales — patrón muy común en PyME argentina); (4) **contabilidad formal + sueldos** (el contador puede vivir adentro); (5) integraciones bancarias; (6) soporte con consultor asignado (Premium+); (7) madurez: +300 funcionalidades pulidas por años de feedback real.

**Qué tiene Netegia que NO tenemos:** facturación masiva/picking/etiquetas de pedidos ML · WooCommerce y TornadoStore · multi-CUIT · contabilidad (plan de cuentas/asientos/balances; nuestra caja/CC/capital es operativa, no contable-formal) · sueldos · integraciones bancarias · **listas de precios múltiples** (4-10 por plan; nosotros: mayorista por cantidad, listas = roadmap VF2) · límites altos de clientes/proveedores · app/interfaz móvil dedicada (nosotros PWA).

**Qué tenemos que Netegia NO:** **WMS real** (LPN, ubicaciones, lotes/vencimiento, series, FIFO/FEFO, conteos cíclicos/ABC/doble conteo, trazabilidad ledger inmutable, kits — Netegia es stock multi-depósito plano) · **caja profunda** (sesiones/arqueos por cajero, bóveda con arqueo, cuentas de origen, diferencias por cajero, cadena de cierre con 2º usuario) · **envíos con reparto propio** (rutas, Google Maps, choferes) · **aislamiento por sucursal server-side** (RLS real, no solo filtro de UI) · **modo Básico/Avanzado** (crece sin migrar de sistema) · **comprobantes ilimitados** (Netegia corta a 4.000-15.000/mes) · **MODO** como medio de pago · reservas/señas con crédito · GS1/scan · **precio 1,6-2,3x menor** ($60k/$100k vs $96k/$232k) · soporte directo del equipo que construye el producto.

**Lectura estratégica:** en e-commerce estamos casi a la par (ML/TN stock+precios+pedidos ✓); el gap real ahí es el **circuito fiscal de los pedidos ML** (facturación masiva + etiquetas) — cerrable, está en `roadmap-apis.md`. Los gaps estructurales son **multi-CUIT** (candidato Enterprise) y la percepción de trayectoria. Contabilidad/sueldos NO es la pelea (integrarse al contador, no reemplazarlo). Nosotros ganamos PROFUNDIDAD operativa (depósito+caja+sucursales) y precio.

### Posicionamiento de Genesis360
- **Gana:** WMS real (LPN/lotes/series/FIFO-FEFO), POS+caja/bóveda, compras (OC+recep), envíos con reparto propio, multi-sucursal server-side. Nadie del segmento SMB junta todo (Netegia es el que más se acerca, y es 1,6-2,3x más caro).
- **Liviano:** contabilidad pura (sin plan de cuentas/asientos) y **multi-CUIT/multi-razón-social** (Netegia/Zeus/Contabilium sí lo tienen, 2-10 CUITs → candidato Enterprise) y sueldos con convenios. **No es la pelea** — competir contra "el comercio que quiere operar + facturar sin 3 sistemas", no contra el contador.

---

## 💵 Propuesta de pricing (EN DISCUSIÓN, 2026-07-01)

Propuesta de GO + ajustes recomendados. **No cerrada.**

| Plan | Precio propuesto GO (c/IVA) | Users | Movimientos/mes | SKU | Sucursales |
|---|---|---|---|---|---|
| **Free** | $0 — **30 días** (¿trial o permanente? definir) | — | — | — | — |
| **Básico** | **$60.000/mes** (débito −10%, anual −30%) | 5 | 5.000 | 2.000 | 1 |
| **Pro** | **$100.000/mes** (mismos desc.) | 15 | 20.000 | 8.000 | 4 |
| **Enterprise** | A consultar (según complejidad) | — | — | — | — |

> Límites base **actualizados con la propuesta de add-ons de GO (2026-07-01)** — el SKU 100/300 quedó descartado (subió a 2.000/6.000). Detalle de add-ons + revisión abajo (§ "Límites base + Add-ons").

**Veredicto (análisis 2026-07-01, actualizado con Netegia/Ninox reales):**
- ✅ **Los PRECIOS están MUY bien (incluso conservadores):** Básico $60k queda **por debajo de Netegia Pyme Lite ($96k, el competidor más directo)** y de Contabilium; arriba de Ninox Comercio (~$46-56k) y Xubio débito. Pro $100k ≈ Ninox Empresa ($94k) y Xubio Ilimitado ($113k), pero **menos de la mitad de Netegia Premium ($232k) y Contabilium Pro ($217k)** → wedge de valor agresivo. Se podría empujar Pro más arriba; $100k como "value vs Netegia" es buena historia. Riesgo de entrada (producto nuevo) mitigado con trial largo + descuentos + descuento fundador.
- 🚩 **Los SKU 100/300 son INUSABLES — CONFIRMADO por toda la competencia:** el plan más barato de **Ninox da 2.000 artículos ($24k)** y el de **Netegia 4.000 ($96k)**; Contabilium 5.000. Vos ibas a cobrar $60k por **100** (20-40x menos que cualquiera). Y **cada variante = un producto separado** (tienda de ropa 50×5×4 = 1.000 SKU). El SKU no cuesta nada (fila en Postgres). **Subir a 2.000-4.000 (Básico) / 15.000-∞ (Pro)** para estar a la par.
- **Descuentos:** débito −10% + anual −30% sanos (anual agresivo vs Contabilium 10%, pero costo marginal ~$0). **Definir si se acumulan** (¿40%?) o el anual es el tope.
- **Free "30 días":** definir si es trial (hoy la app tiene trial de **7 días**, `trial_ends_at NOW()+7`; pasar a 30 = cambio de default + texto onboarding) o un tier permanente limitado para lead-gen (recomendado tener AMBOS: trial de 30d de Pro + Free permanente acotado).

---

## 💠 Límites base + Add-ons (propuesta GO 2026-07-01)

Modelo multi-dimensional (como Netegia): 4 dimensiones metered (SKU · Movimientos · Sucursales · Usuarios), cada una con packs de add-on que se suman a la factura del plan base.

### Límites base por plan
| Dimensión | Básico ($60k) | Pro ($100k) |
|---|---|---|
| **SKU** (productos activos) | 2.000 | 8.000 |
| **Movimientos**/mes | 5.000 | 20.000 |
| **Sucursales** | 1 | 4 |
| **Usuarios** | 5 | 15 |

### Add-ons (ARS, se suman a la facturación mensual del plan)
| Dimensión | Pack A | Pack B | Pack C | Tipo | $/unidad |
|---|---|---|---|---|---|
| **SKU** | 500 × $5.000 | 2.000 × $10.000 | 8.000 × $25.000 | **Solo fijo** | 10 / 5 / 3,13 ✓ |
| **Sucursales** | 1 × $15.000 | 3 × $35.000 | 5 × $55.000 | **Solo fijo** | 15.000 / 11.667 / 11.000 ✓ |
| **Movimientos** | 1.000 × $5.000 | 5.000 × $10.000 | 20.000 × $15.000 | **Fijo o temporal** | 5 / 2 / 0,75 ✓ |
| **Usuarios** | 1 × $5.000 | 3 × $10.000 | 5 × $15.000 | **Solo fijo** | 5.000 / 3.333 / 3.000 ✓ |

**Tipos de add-on:**
- **Fijo (recurrente):** se suma a la factura mes a mes. Para bajarlo, el usuario debe **desactivar** recursos (SKU/sucursal/usuario) hasta la cantidad cubierta por el plan base (la app lo guía, ver Decisión #1). **SKU / sucursales / usuarios = SOLO fijo.**
- **Temporal (one-time):** pago en el momento, **vence a 30 días del día del pago**, independiente del ciclo de facturación mensual. **Solo para movimientos** (flujo mensual que se resetea).

**Ejemplo de factura:** Pro con 10.000 SKU (base 8.000 + add-on 2.000×$10k) = **$110.000/mes**. Básico + 2ª sucursal (add-on 1×$15k) = **$75.000/mes**.

### ✅ Decisiones GO (2026-07-01)
1. **Downgrade GUIADO (no borrado) — REGLA #0.** Al intentar bajar de un add-on fijo, la app le indica al usuario **cuántos recursos debe DESACTIVAR** (SKU/usuarios/sucursales) para poder bajarlo, y recién cuando los desactiva puede reducir el add-on. Para **SKU alerta explícitamente "DESACTIVAR, no ELIMINAR"** (preservar trazabilidad por si vuelve a necesitarlo). La app calcula el excedente y bloquea hasta resolverlo. Es requisito de producto (no lo resuelve el sistema solo — lo ejecuta el usuario, guiado).
2. **Sucursal — precios finales:** 1×**$15.000** / 3×**$35.000** / 5×**$55.000** (per-unit 15.000 / 11.667 / 11.000 → decreciente ✓, corregida la inversión).
3. **Temporal solo para movimientos**; SKU/sucursal/usuario = solo fijo. ✓
4. **Pro base SKU = 8.000** (subido de 6.000, para no quedar corto vs Netegia/Contabilium 10.000).
5. **UX = configurador** (plan base + selectores que actualizan el total), no planilla.

### 🔧 Pendiente de implementación (antes de lanzar el modelo)
- **Enforcement server-side** del límite efectivo (base + add-ons activos) vía trigger/RPC — hoy client-side (`usePlanLimits`), bypasseable por API → sin esto los add-ons no protegen ingresos.
- **Flujo de downgrade guiado** (Decisión #1): UI que calcula el excedente, bloquea y guía la desactivación; alerta especial "desactivar ≠ eliminar" en SKU.
- **Billing MP:** add-ons fijos → actualizar `transaction_amount` del preapproval al cambiar; temporales → pago único (patrón `addon_movimientos` ya existe).
- Actualizar `brand.ts` (`PLANES`/`MAX_MOVIMIENTOS_POR_PLAN`/`FEATURES_POR_PLAN` + límites de SKU/sucursal/usuario) + Landing.

### 🗺️ Plan de implementación por fases
| Fase | Qué | Riesgo | Notas |
|---|---|---|---|
| **0 — Modelo de datos + límites base** ✅ **HECHA EN DEV (2026-07-01, mig 251)** | `tenants.plan_tier` (desacopla tier de max_users) + tabla `tenant_addons` + `fn_plan_base_limite`/`fn_tenant_limite` (límite efectivo = base + Σ add-ons activos; trial→pro). `brand.ts`: precios $60k/$100k, `PLAN_BASE_LIMITS` (SKU 2.000/8.000, mov 5.000/20.000, suc 1/4, users 5/15), `ADDON_PACKS`, `PLAN_DESCUENTOS`. `usePlanLimits` reescrito (plan_tier + efectivo + sucursales). | Bajo | Aditivo, sin bloquear. typecheck+build+unit verdes. |
| **1 — Enforcement server-side (REGLA #0 de ingresos)** ✅ **HECHA EN DEV (2026-07-01, mig 252)** | Triggers `BEFORE INSERT OR UPDATE OF activo` en productos/users/sucursales → bloquean crear sobre `fn_tenant_limite`. **Movimientos DIFERIDO** (hot-path). Verificado por impersonación (seed entra, bajo-límite pasa, sobre-límite bloquea). | Medio | Límites base ≥ viejos → sin bloqueo a existentes. **Falta:** enforcement de movimientos (contador/RPC). |
| **2 — Add-on temporal de movimientos** ✅ **HECHA EN DEV (2026-07-02, mig 253)** | Lib `src/lib/addons.ts` (packs/ref/precio, unit-tested) + EF `mp-addon` parametrizado (packs 1.000/5.000/20.000, revalida precio server-side) + EF `mp-webhook` inserta `tenant_addons` temporal (vence 30d, **idempotente por `mp_payment_id`**, mig 253) + `SuscripcionPage` selector de 3 packs. | Bajo | El flujo legacy no era idempotente (re-notificación MP duplicaba) → mig 253. **No deployado** (espera OK GO). |
| **3 — Add-ons fijos (SKU/sucursal/usuario) + downgrade guiado + EFs tier-aware + MP preapproval** ✅ **CÓDIGO EN DEV (2026-07-02)** | **F3a:** `mp-webhook`/`mp-verificar` setean `plan_tier` (cierra medio RIESGO #1). **F3b:** enforcement movimientos = SOFT (decisión REGLA #0, no cortar ventas). **F3c:** lib `evaluarDowngrade`/`precioMensualAddonsFijos` (unit-tested) + EF `mp-addon-fijo` (alta/baja, `PUT transaction_amount` del preapproval por delta, fail-closed, downgrade guiado server-side) + configurador en `SuscripcionPage`. | Alto | **NO deployado / no e2e-testeable.** Requiere reconfigurar planes base MP a $60k/$100k + validar `PUT` en sandbox + OK GO. |
| **4 — Configurador de precios (Landing + Suscripción)** ✅ **HECHA (2026-07-02, v1.103.0)** · **🎨 REDISEÑO "Armá tu plan" (2026-07-04, v1.111.0 EN DEV)** | Suscripción ✅ (add-ons fijos en vivo, F3). Landing ✅ (`PricingConfigurator`: plan base Básico/Pro + selectores de add-ons fijos → total mensual en vivo; reusa `addons.ts`). Frontend-only. **Rediseño v1.111.0:** panel oscuro + grid de tarjetas seleccionables con degradé de marca violeta→cian (tokens `--color-accent`/`--color-accent-2`, nada hardcodeado), toggle Básico/Pro en píldora, sub-cards por dimensión (Productos/Sucursales/Usuarios) con ícono, barra de total en vivo + CTA, y fila de 4 beneficios. **In-app (`SuscripcionPage`) adaptado:** MISMO lenguaje visual PERO conserva su semántica (plan actual, add-ons activos = tarjeta seleccionada con botón quitar, sin toggle ni CTA de prueba) y **la lógica de compra MP (`agregarAddonFijo`/`quitarAddonFijo`) intacta** (REGLA #0). **🛑 kill-switch `ADDON_FIJO_ENABLED=false` (v1.111.0):** el configurador de add-ons FIJOS in-app queda OCULTO en PROD porque el cobro (`mp-addon-fijo` → `PUT transaction_amount` del preapproval) **nunca se validó e2e en sandbox** y ya estaba vivo/alcanzable en PROD desde v1.106 (riesgo de cambiar el cobro de un cliente real). Prender solo tras validar. El estimador público del Landing y el add-on temporal de movimientos NO dependen del flag. | Bajo (Landing) / **Alto (in-app, gateado OFF)** | Estimador público (marketing); no cobra. Soporte del Landing = **"Soporte dedicado"** (decisión GO). Movimientos sigue como flujo temporal aparte (no 4ª tarjeta). |
| **5 — Multi-CUIT / multi-razón-social** | Track aparte, grande (cert + numeración de comprobantes por CUIT). **Después del WSFE propio** (comparten capa de facturación). | Alto | Candidato Enterprise / add-on premium. Ver BACKLOG en `project_pendientes.md`. |

---

## 🎚️ Modelo de límites recomendado (cambio de fondo)

**Correr la monetización de "recursos artificiales" (SKU/movimientos) a VALOR real (módulos + usuarios + sucursales).**
- **SKU y comprobantes → generosos o ilimitados** (cuestan ~$0; sirven de marketing: "productos ilimitados", "facturación ilimitada").
- **Movimientos → límite suave** (opaco para el cliente; sin guard server-side hoy → se excede por API).
- **Palancas fuertes de precio:** módulos avanzados (WMS, RRHH, Compras, Envíos), cantidad de **usuarios** y **sucursales**, integraciones.

### Módulos por plan (sugerido — ya casi implementado en `FEATURES_POR_PLAN`)
| Módulo | Free | Básico | Pro | Enterprise |
|---|---|---|---|---|
| Inventario básico · Ventas/POS · Caja · Gastos · Clientes | ✓ | ✓ | ✓ | ✓ |
| **Facturación AFIP** (gancho vs Xubio, costo $0) | ✓ | ✓ | ✓ | ✓ |
| Reportes · Historial · Métricas | — | ✓ | ✓ | ✓ |
| **Modo Avanzado (WMS)** · RRHH · Recursos · Compras · Envíos | — | — | ✓ | ✓ |
| Importación masiva · Marketplace · Multi-sucursal | — | — | ✓ | ✓ |
| API · integraciones a medida · SLA · onboarding | — | — | — | ✓ |

---

## 🖥️ ¿Los límites aprietan la infra? (Supabase/Vercel/Resend)

**No, a 0-100 clientes los límites son 100% palanca comercial, no restricción de infra.**
- SKU/movimientos/usuarios = filas Postgres + auth → baratísimo (100k productos ≈ decenas de MB). NO es lo que limita.
- **Lo que escala el costo (en orden), recién con decenas-cientos de tenants activos:** (1) **Resend** (free 3.000 emails/mes → ~50-100 tenants activos lo rompen → US$20/mes 50k); (2) **Supabase storage/egress** (imágenes de producto); (3) **DB size** (movimientos_stock acumula, años a este ritmo).
- **Riesgo real = límites demasiado BAJOS** (los 100 SKU), no quedarse sin infra. El costo es función de #tenants activos + imágenes/emails, no de SKU por tenant.

## ❓ ¿Comprobantes como límite? Costo por comprobante = $0
AFIP/ARCA no cobra por CAE. Con AfipSDK el token es por-tenant (lo paga el cliente); con el **WSFE propio** (en construcción) → $0 marginal nuestro. **Recomendación: NO limitar como tope punitivo → usar "facturación ilimitada" como diferenciador** (Xubio capa 1.000/mes, Contabilium 2.500-10.000).

---

## Trial (actual en código)

- **Duración real:** **7 días** (`tenants.trial_ends_at DEFAULT NOW()+7`, texto onboarding "7 días gratis"). La propuesta de GO es 30 días → cambio pendiente.
- **Acceso:** equivalente al plan Pro · sin tarjeta al inicio.

---

## Tabla de planes (LEGACY en código — desactualizada)

| Plan | Usuarios | Productos | Sucursales | Precio |
|------|----------|-----------|------------|--------|
| **Free** | 1 | 50 | 1 | $0 ARS/mes |
| **Basic** | 2 | 500 | 1 | $4.900 ARS/mes |
| **Pro** | 10 | 5.000 | Múltiples | $9.900 ARS/mes |
| **Enterprise** | Ilimitado | Ilimitado | Ilimitado | A convenir |

---

## Límites técnicos

Los límites se verifican en el hook `src/hooks/usePlanLimits.ts`. El hook recibe el plan del tenant y retorna los límites aplicables.

El `SubscriptionGuard` en `src/components/AuthGuard.tsx` bloquea acceso a features no incluidas en el plan actual.

---

## Cómo se cuentan los límites (mecánica real, 2026-06-30)

- **Movimiento (`movimientos_mes`):** una fila en **`movimientos_stock`** = **solo movimiento de INVENTARIO** (venta/rebaja, ingreso, ajuste, traslado, devolución, kits). **NO cuentan** facturar ni agregar un gasto. Se cuenta **por tenant** (no por sucursal), del **mes calendario** en curso (se resetea el 1°). **Un ingreso masivo de N productos = N movimientos** (1 fila por SKU); una venta de N ítems ≈ N. Límites: Free **200** · Básico **2.000** · Pro/Enterprise **ilimitado** + `addon_movimientos`. ⚠ Enforce **solo client-side** (`usePlanLimits`) — sin guard server-side, se puede exceder por API (a endurecer si el pricing depende de esto).
- **Producto:** cada fila en `productos` (`activo=true`). **Cada variante (talla/color) cuenta como un producto separado** — "generar combinaciones" 3 talles × 2 colores crea **6 productos**. El grupo de variantes es solo agrupación visual.

## Costo para nosotros (para el margen)

- **Storage: despreciable.** Supabase ~US$0,021/GB/mes. Un tenant Pro al 100% ≈ 1,5-3 GB (imágenes de producto + comprobantes) → ~US$0,06/mes. Las facturas/presupuestos/remitos generados NO se guardan (regenerados on-demand). El costo real no es storage → es egress, Resend, comisión MP y el plan base compartido (Supabase/Vercel).
- **Facturación AFIP: $0 de AFIP/ARCA** (no cobra por CAE). La app usa **AfipSDK** (no WSFE directo — ver `facturacion-afip.md` "⚠ Cómo está implementado HOY"); el `afipsdk_token` es **por tenant** → si cada cliente trae su cuenta, el costo (si supera free tier) es del cliente. GO quiere migrar a WSFE propio ($0 terceros) — backlog.
- **Comisión MP:** ~4,3% de cada cobro de suscripción (4900→4689,16). **Cobro en ARS.**
- **GitHub — repo privado = GRATIS (NO hace falta pagar GitHub Pro).** El plan **Free** de GitHub incluye **repos privados ILIMITADOS con colaboradores ilimitados** (desde abr-2020) — pasar `genesis360-app/genesis360` de público a privado no tiene costo (Settings → General → Danger Zone → Change visibility). Lo ÚNICO que se paga (GitHub **Team**, ~US$4/usuario/mes) son extras sobre repos privados: **branch protection / required reviews / CODEOWNERS** y más minutos de Actions (Free da 2.000 min/mes). Recomendación: pasarlo a privado en Free ahora (gratis); evaluar Team solo si querés forzar reviews/branch-protection en `main`. (Verificar términos vigentes de GitHub al hacerlo.)
- **Snapshot (2026-06-30):** solo se paga Claude Code (US$23/mes) + dominio (~US$15/año); resto en free tier (incl. GitHub); 0 clientes PROD. Umbrales de escalado (sin $) en `sources/raw/reference_escalabilidad.md`.

> [!NOTE] La tabla de arriba (usuarios/productos/precios) y "Features por plan" pueden estar desactualizadas (trial dice 14d, la app usa 7d en el welcome; AFIP no está estrictamente gateada a Pro en el código). Revisar contra `src/config/brand.ts` (`PLANES`, `MAX_MOVIMIENTOS_POR_PLAN`, `FEATURES_POR_PLAN`) al definir el pricing final.

---

## Features por plan

> [!NOTE] Esta tabla debe actualizarse cada vez que se agreguen features gateadas por plan.

| Feature | Free | Basic | Pro | Enterprise |
|---------|------|-------|-----|-----------|
| Inventario | ✓ | ✓ | ✓ | ✓ |
| POS/Ventas | ✓ | ✓ | ✓ | ✓ |
| Caja | ✓ | ✓ | ✓ | ✓ |
| Reportes básicos | ✓ | ✓ | ✓ | ✓ |
| Exportación Excel/PDF | — | ✓ | ✓ | ✓ |
| RRHH | — | — | ✓ | ✓ |
| Marketplace (MeLi/TN) | — | — | ✓ | ✓ |
| Multi-sucursal | — | — | ✓ | ✓ |
| AFIP Facturación | — | — | ✓ | ✓ |
| Auto-reorder | — | — | ✓ | ✓ |
| API acceso | — | — | — | ✓ |

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/business/modelo-negocio]]
