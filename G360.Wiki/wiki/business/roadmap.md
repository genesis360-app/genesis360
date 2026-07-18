---
title: Roadmap y Versiones
category: business
tags: [roadmap, versiones, releases, pendiente, prod]
sources: [CLAUDE.md, ROADMAP.md, WORKFLOW.md, project_pendientes.md]
updated: 2026-05-29
---

# Roadmap y Versiones

**Versión en PROD:** ver `G360.Wiki/sources/raw/project_pendientes.md` (fuente de verdad)  
**Última actualización:** 18 de Julio, 2026

---

## v1.134.0 — 🧵🚚 Atributos de variante FUNCIONALES + F3b (ARCA→resumen) + traslado real desde LpnAccionesModal — ✅ PROD (2026-07-18)

**Bundle de 2 sesiones** (F3b+variantes del 2026-07-17 + testing cross-sucursal con usuarios reales
del 2026-07-18), deployado junto tras confirmación de GO. Migs **273-276** en DEV y PROD.

- **F3b** — la tarjeta "Facturación Electrónica (ARCA)" de `ConfigPage` deja de ser 2º editor de
  identidad fiscal: resumen readonly + botón "Editar en Emisores fiscales" cuando el tenant ya
  tiene CUIT.
- **Atributos de variante** (talle/color/encaje/formato/sabor·aroma) pasan de "toggles que no
  hacían nada" a funcionales de punta a punta: catálogo configurable (mig 273), obligatorios en
  TODO movimiento de stock (ingreso/rebaje simple y masivo, mover/partir LPN, traslados), guard
  server-side contra combinarlos con "Grupo de variantes" (mig 274, CHECK constraint), columnas de
  snapshot en `traslado_items` (mig 275). Detalle: [[wiki/features/atributos-variante]].
- **🚚 "Mover" un LPN hacia otra sucursal ahora genera un traslado real** (en tránsito +
  confirmación), no reubica el stock directo como antes — cerraba un riesgo real de REGLA #0
  (stock apareciendo en otra sucursal sin confirmación física de que llegó). Mig **276** nueva
  (`traslado_items.ubicacion_sugerida_id`, precarga la ubicación al confirmar recepción). Validado
  con DOS usuarios reales de sucursales distintas, no el owner simulando ambos lados. Detalle:
  [[wiki/features/multi-sucursal]] · `tests/specs/uat-modo-basico.md` §36.
- **3 bugs más** encontrados probando con usuarios reales de una 2da sucursal: `estado_id` del
  producto no se guardaba (payload incompleto en `ProductoFormPage`), `ProductosPage` no mostraba
  categoría/estado/ubicación a simple vista, ubicaciones GLOBALES ausentes en "Confirmar recepción"
  de Traslados (`.eq()` vs `.or()`). UAT §34-§35.
- **Validación RLS por sucursal** con usuarios reales (no solo impersonación SQL) — confirma que
  `inventario_lineas`/`caja_sesiones` aíslan bien; confirma (documentado desde v1.75.0, no es nuevo)
  que `traslados` es tenant-wide a propósito. UAT §37.

Verde: tsc · build · unit 1080+5 · e2e 69/69 (sweep de regresión) + 4 specs nuevos dedicados
(90/92/93/94).

## v1.133.0 — 🏛️ Identidad fiscal con FUENTE ÚNICA de verdad + búsqueda historial server-side — ✅ PROD (2026-07-17, PR #292)

**El cutover de raíz (pedido GO):** `emisores_fiscales` pasa a ser LA fuente de verdad de toda
identidad fiscal; `tenants.*` fiscal queda como espejo de solo lectura legacy (trigger invertido,
mig 271) hasta el drop final (Fase 4). Era la causa raíz de los dos bugs fiscales de la semana.

- **Migs 271+272** (DEV+PROD, aplicadas PEGADAS al merge — breaking p/ frontend viejo): espejo
  invertido + guards P0001 (el default no se borra/desactiva) + REVOKE de las fn de trigger.
- **`camposEmisorPDF`**: único armador de los `emisor_*` de los PDFs; identidad por
  `ventas.emisor_id`; NC por su factura original; **PV impreso POR emisor**; documento fiscal sin
  identidad completa NO se imprime. ConfigPage escribe en emisores; panel edita también al principal.
- **🛑 Fix búsqueda del historial**: era client-side sobre las últimas 50 → una venta más vieja "no
  existía". Ahora server-side (número→exacto · texto→cliente).
- Contexto: el deploy se retuvo una noche por la caída de AFIP homologación (ORA-12514); gate spec
  21 verde con **CAE real** antes de mergear.

**Pendiente del plan:** F3b (ARCA → resumen, GO decide UX) · F4 (drop de columnas fiscales de tenants).

## v1.132.0 — 🎚️ Componente `<Toggle>` estándar (el bug del knob, imposible por construcción) — ✅ PROD (2026-07-16, PR #291)

Pedido de GO tras el bug de los toggles de v1.131.0: *"mejor hacer uno estandar y q se aplique en
todas las paginas... y si queremos cambiar algo aplica a todas"*. Es la **causa raíz**: había ~26
toggles a mano con 5 geometrías distintas, y el knob se salía del óvalo **precisamente porque cada
uno se escribió por separado**.

- **`src/components/Toggle.tsx`** — el knob **ya no es `absolute`** (es flex item de un `inline-flex
  items-center`): sin posición estática de la cual depender, el bug es **imposible por construcción**,
  no "menos probable". Desplazamiento ON = px exacto (`track − knob − 2`), no `translate-x-N` a ojo.
  Bonus a11y: `role="switch"` + `aria-checked` + focus ring (ninguno de los 26 los tenía). Tamaños
  sm/md/lg del inventario real.
- **Migrados:** los 3 que estaban rotos (ARCA habilitada, **AFIP producción**, emisor activo — los 3
  de UI fiscal) + 3 de ConfigPage. Quedan ~20, ninguno roto (deuda de consistencia).
- **Verificado:** 0 toggles con el patrón roto (`absolute` + `top-*` sin `left-*`) en toda la app.

**Sin migraciones · sin Edge Functions.** Verde: tsc · build · unit 1045+5 todo · e2e 11/11.

## v1.131.0 — 🛑 Fix fiscal: comprobantes con el CUIT VACÍO (REGLA #0) + toggles + feedback POS — ✅ PROD (2026-07-16, PR #290)

**El release lo motiva un bug fiscal que estuvo EN PROD un mes** (desde el 2026-06-14, v1.62.0,
commit `c35450e8` *"factura completa + remito + datos del emisor"* — el commit que agregó los datos
del emisor los rompió todos). **Lo reportó GO usando la app, NO la suite.**

- **🛑 Comprobantes con la identidad fiscal vacía.** TODOS (factura, ticket, remito, presupuesto —
  5 call sites) salían sin CUIT, sin razón social y sin domicilio; y `condicion_iva_emisor ??
  'responsable_inscripto'` hacía que **el comprobante de un Monotributista declarara ser RI**.
  **Causa** (probada con curl): la `.select()` pedía `telefono, email`, **columnas que no existen en
  `tenants`** → PostgREST **400** → el código **descartaba el `error`** → `cfgTenant = null` → los
  `?? ''` inventaban los datos. **El CAE nunca estuvo mal** (la EF resuelve el emisor server-side) →
  el registro en AFIP siempre estuvo bien; lo roto era **el papel**. Sin clientes reales → daño
  acotado. **Fix:** selects corregidas (antes 400 → ahora 200, verificado contra la API real) +
  **`exigirCfgFiscal()`**, guard que LANZA en vez de dejar que los defaults inventen.
- **🧪 Guard nuevo — spec `87_datos_emisor_comprobante`**: corre las selects reales contra la DB.
  **Verificado por mutación**: con la select rota falla con el mensaje exacto.
- **🎚️ 3 toggles con el knob fuera del track** (los 3 de UI fiscal: ARCA habilitada, **AFIP
  producción**, emisor activo). Sin `left`, un `absolute` toma su posición estática y el `<button>`
  trae `text-align: center` del UA → el knob terminaba 8px afuera.
- **🛒 Feedback al agregar en la galería del POS**: badge permanente con la cantidad + micro-pulso
  + borde accent (antes, en mobile, tocar un producto no daba NINGUNA señal). Quitado "auto (combos)".
- **🧪 e2e**: capa de fixtures nueva (`helpers/fixtures.ts`) que **garantiza** precondiciones en vez
  de skipearlas; specs 28/37/85 arreglados (el 37 era one-shot: se comía su propia precondición).

**Sin migraciones.** Verde: tsc · build · unit 1045+5 todo · e2e fiscales 8/8 (spec 21 con **CAE real**).

## v1.130.0 — 📱 Mobile responsive + 🛑 guard cert AFIP + ⚖️ blindaje legal — ✅ PROD (2026-07-15, PR #289)

**📱 Mobile responsive (primera cobertura responsive en e2e).** Síntoma de GO: "en el celular se sale
contenido del marco". Causa de fondo: `AppLayout` clippea con `overflow-hidden` en la raíz → el overflow
**no scrollea la página, se corta**. Barrido **`88_mobile_responsive`** (project `chromium-mobile`,
375/360px) + helper `detectarOverflowHorizontal` (mide `<main>` Y `<header>`, elemento y overflow de
texto, ignorando scroll intencional) — **11/11 verde**, queda de guard permanente. Fixes: Dashboard
(grid de cards sin `grid-cols-1` base → columna implícita de max-content; chart scatter con label
`ReferenceLine position:right` fuera del plot), Métricas (selector de rango sin `flex-wrap`; card
"Resultado del período" `grid-cols-3` con números grandes), y **header** (medía 461px → el **avatar
(mi cuenta/logout) quedaba clippeado fuera de pantalla** en ≤375px; ahora oculta Refresh/Config en
mobile + sucursal más corta + `px-3 sm:px-4` → ~348px).

**🛑 Guard crt↔clave del wizard de certificado (REGLA #0).** Un `.crt` que no correspondía al CSR se
aceptaba y fallaba **recién al emitir** con `WSAA cms.sign.invalid` (incidente real en homologación).
Nueva **EF `finalizar-certificado`** (DEV+PROD): valida el par RSA server-side con `certKeyMatch` antes
de activar; si no aparea → 400 claro. La `.key` nunca viaja al browser → el guard tiene que ser del server.

**⚖️ Blindaje legal.** T&C / Privacidad / Cookies + EULA/reembolsos + `LEGAL_TITULAR` + Sentry sin
Session Replay. **Deploy autorizado por GO** pese al hold de "abogado + AAIP" (todavía sin clientes reales).

**🐛 Fixes:** alta de emisor mostraba error genérico (`PostgrestError` no es `instanceof Error`);
`schema_full.sql` regenerado + `npm run schema:dump`.

Sin migraciones nuevas (264-270 ya en PROD, verificado).

---

## v1.129.0 — 🔐 Multi-CUIT F4-F6 frontend + wizard de certificado (incl. emisor PRINCIPAL) — ✅ PROD (2026-07-13, PR #288)

**A PROD fueron 3 releases juntos** (PR #287 solo había llevado v1.126.0 = Fases 2+3; el frontend de
v1.127/128 nunca había ido a PROD): **v1.127.0** (selector de emisor en la emisión + reportes por CUIT
+ add-on CUIT adicional), **v1.128.0** (wizard de cert self-service), **v1.129.0** (wizard también para
el emisor principal — hallazgo de GO). Migs 267-270 ya estaban en PROD; sin migraciones nuevas; EFs sin
cambios. Vercel PROD READY (`app.genesis360.pro`). Detalle del fix de v1.129.0 abajo ↓.

GO reportó que no había forma de generar el CSR desde el **certificado principal**. El wizard
self-service (v1.128.0) estaba SÓLO en emisores adicionales → el que recién arranca no podía generar
su cert. Fix: `src/lib/csrCert.ts` (lógica pura: subject espejo de la EF + máquina de pasos
`pasoWizardCert`), el emisor principal (⭐) ahora usa el asistente en `EmisoresFiscalesPanel`
(mismo pipeline por-emisor), cerrado el hueco cross-sesión (retomar el `.crt` sin regenerar), pointer
en `ConfigPage`. Tests: unit `csrCert.test.ts` (14) + e2e `61_generar_csr_ef.spec.ts` (5/5 en DEV,
happy path CSR PKCS#10 real) + UAT §11.b (CERT-01→10) + plan `facturacion.plan.md §11`. Sin migraciones
(usa la 270). Detalle: `wiki/features/multi-cuit.md`. **Nota:** v1.126-1.128 (multi-CUIT F1-F6 +
wizard v1.128.0) están deployadas en DEV+PROD — ver `multi-cuit.md` y el log 2026-07-13.

---

## v1.125.0 — 🧪 Validación integral de FACTURACIÓN — 3 hallazgos REGLA #0 arreglados (2026-07-10, PR dev→main esperando merge)

Gap-analysis de los planes de test de facturación contra el código real + ejecución completa en
DEV y PROD. **H1 🔴:** las NC electrónicas no restaban débito fiscal en NINGÚN reporte (Libro IVA
Ventas ni las listaba, KPIs, liquidación 12m, Posición IVA, dashboard) → `src/lib/libroIva.ts`
(11 unit) + mig 266 (`devoluciones.nc_fecha`, imputación por fecha de emisión) + filas NC negativas
en libro y Excel. **H2 🔴:** la EF `emitir-factura` era invocable con el anon key pelado → guard de
identidad (401/403/service_role), EF DEV v21 + PROD v15 (bundle idéntico), verificado anon→401 en
PROD. **H3 🟡:** libros IVA ahora por CUIT completo (Compras filtraba por sucursal, Ventas no).
Suite: unit 997/997 · e2e facturación 16/16 (incl. spec 86 nuevo de FacturacionPage y spec 56
reescrito) · smoke PROD Factura B №31 CAE `86280549332712` (piloto, homologación, circuito propio).
Plan `facturacion.plan.md` reescrito (incluye plataforma) + UAT FAC-28/29/30. Migs 001-266 DEV+PROD.

## v1.124.0 — 🧾 Motor WSFE PROPIO (dual-provider fase 3) — piloto 100% funcionando en PROD (2026-07-09/10, sesión cerrada)

`WsfePropioProvider` real: TRA + firma CMS/PKCS#7 local (node-forge) → WSAA LoginCms → TA cacheado
en DB (mig 264 `afip_wsaa_ta`) → WSFEv1 SOAP directo (`FECompUltimoAutorizado`/`FECAESolicitar`).
Lógica fiscal compartida intacta (mismo payload que AfipSDK). Validación completa contra
homologación REAL: 26 unit nuevos (984/984 suite) + integración Node (B/C/NC-C con CAE) + runtime
vía EF en DEV (B №26 y C №35 por 'propio' + regresión afipsdk №27; alternancia de numeración
25→26→27 sin saltos). EFs `emitir-factura` v19 y `emitir-factura-plataforma` v2 en DEV. UAT §32.
**2026-07-10:** mig 264 en PROD + EFs deployadas; PR #282 mergeado, Vercel `READY`. **Tenant piloto
"Familia Otranto De Porto" flipeado a 'propio' en PROD — CAE real emitido (`86280549105220`),
circuito 100% operativo.** Incidente de seguridad menor (EF temporal sin auth, sin explotación) +
merge indebido a `main` (autorizado post-facto) — ambos documentados en log.md. **Fix de seguridad
real:** node-forge 1.3.1→1.4.0 en el código que corre en Deno (el bump de Dependabot solo cubría la
devDependency) — revalidado con CAE real, deployado a DEV+PROD, **PR #284 mergeado, Vercel `READY`**,
0 alertas de Dependabot abiertas. **Mismo día — extendido a TODOS los tenants:** mig 265
(`afip_provider` DEFAULT → 'propio' en DEV+PROD) + los 17 tenants existentes (10 DEV + 7 PROD)
flipeados a 'propio' — sin clientes reales todavía (todos de GO/Fede), ventana ideal para
dogfoodear. Solo 3 tienen certificado (mismo cert de homologación reusado); el resto se configura
orgánicamente cuando lo necesite. Ver [[wiki/features/facturacion-afip]].

## v1.123.0 — 🚀 Deploy a PROD: Fase 2 batch + arrepentimiento + facturación de plataforma + pago manual + perf DB (✅ PROD, cerrado 2026-07-09)

Consolida a PROD toda la cadena v1.121.0→v1.122.0: **Fase 2 batch** (cambio de PLAN Básico↔Pro,
E1 inmediato/E2 programado) + **arrepentimiento legal** (Ley 24.240, mig 260); **facturación
automática de plataforma** para Fede (mig 261); **motor de pago manual** (mig 262); + **mig 263**
(performance RLS/índices); WH-SIG log-only; fix de `EnviosPage` (courier propio, REGLA #0); y
eliminación de la EF huérfana `crear-suscripcion` (solo en DEV).

**Infra de Supabase — 100% en PROD y verificada:** migraciones 260-263 aplicadas a
`jjffnbrdjchquexdfgwq` (0 policies `auth.uid()` sin envolver, 4 tablas nuevas confirmadas,
aislamiento multi-tenant reverificado por impersonación) + 10 Edge Functions deployadas con smoke
OK (nuevas `mp-batch-sweep`/`emitir-factura-plataforma`/`platform-facturacion-sweep`/
`billing-manual-pagar`/`billing-manual-avisar-pago`/`billing-manual-sweep`; modificadas
`mp-webhook`/`admin-api`/`cancel-suscripcion`/`mp-verificar-suscripcion`). `crear-suscripcion`
sigue viva en PROD (autorización de GO para borrarla fue solo para DEV) pero inofensiva.

**Código:** PR genesis360 **#278** MERGEADO a `main` (commit `471912fd`). **Gotcha de
versionado:** el tag `v1.122.0` ya existía (sesión previa, apuntando al commit viejo `94c9e01c`
"EN DEV", con release de GitHub ya publicado) → se bumpeó `APP_VERSION` a **v1.123.0** (commit
`42d02a79`) — ese es el número real de esta release de PROD. PR **genesis360 #279** (bump de
versión) y PR **genesis360-admin #3** ("Pagos manuales + facturación de plataforma en Billing")
también MERGEADOS.

**✅ Release cerrada (2026-07-09):** tag **v1.123.0** creado sobre el commit de merge `4a930bc6` +
GitHub release publicada: https://github.com/genesis360-app/genesis360/releases/tag/v1.123.0.
Vercel verificado `READY` en `production` en ambos proyectos (`genesis360.pro`/
`app.genesis360.pro`/`www.genesis360.pro` y `admin.genesis360.pro`). PROD queda en v1.123.0, migs
001-263, código y Supabase 100% sincronizados. Bloqueante real de fondo sin cambios: Fede
completando sus 3 pasos en AfipSDK (afipsdk.com → punto de venta → token) para que la facturación
de plataforma empiece a emitir de verdad.

**🔒 Incidente de seguridad cerrado en la misma sesión (fuera de alcance del release):** GitHub
Secret Scanning detectó una Google Maps API Key hardcodeada en `public/test-maps.html`, expuesta
en vivo desde el 21 de mayo de 2026, con 33 APIs habilitadas cuando la app solo usa 3. GO restringió
las APIs a las 3 reales, confirmó la restricción por referrer de sitios web y rotó la key en Google
Cloud Console + Vercel; el archivo se eliminó del repo (PR #280, merge commit `4ced7ae8`). Detalle
completo en `G360.Wiki/log.md` (entrada del 2026-07-09).

---

## v1.122.0 — 🧾 Facturación automática de plataforma (Fede) + motor de pago manual + precio dual (infra en PROD desde v1.123.0, código consolidado ahí — ver arriba)

Fede (monotributista, CUIT `20-42237416-8`) factura automáticamente los cobros de suscripción
que le entran a su cuenta MP/banco: `platform_billers` (config AFIP, no es un `tenants`) +
`emitir-factura-plataforma` (Factura C ad-hoc, AfipSDK) + sweep `platform-facturacion-sweep`
(reconcilia cobros recurrentes de MP, cuyo webhook viene sin `external_reference`). Motor de
**pago manual** (`billing_mode`): alternativa a la suscripción automática a precio de lista, mes
a mes, por transferencia/efectivo/MP pago único — 3 caminos, todos disparan la factura de Fede;
sweep de recordatorio+gracia+suspensión (`billing-manual-sweep`). Precio dual visible en toda la
app (Landing/Suscripción/estimador: -10% auto vs lista manual). 970 unit (+12).

## v1.121.0 — 🏗 Fase 2 batch: cambio de PLAN (E1/E2) + Arrepentimiento legal (infra en PROD desde v1.123.0, código consolidado ahí — ver arriba)

Cambio de plan Básico→Pro por el batch: **E1 inmediato** (paga hoy el delta de plan — precios reales de los planes MP, delta relativo que preserva descuentos — mismo circuito `|addonbatch|` fail-closed, fecha de cobro intacta) + **E2 programado** (mig 260 + EF nueva `mp-batch-sweep` horaria: PUT 36h antes del cobro, tier habilitado solo con el cobro nuevo aprobado). Las 3 EFs de activación dejan de pisar `plan_tier`. **Arrepentimiento (Ley 24.240 art. 34):** ventana de 10 días desde `tenants.primera_compra_at` → refund TOTAL idempotente fail-closed + revocación inmediata; cancelación estándar con modal y fecha exacta; log legal `billing_cancelaciones`. 945 unit · UAT §10.c/§10.d.

## v1.120.0 — 🧪 Temporal de comprobantes integrado al panel + barra de comprobantes en Inventario (PROD ✅)

Toggle "Mensual / 30 días" en la tarjeta de Comprobantes del configurador (el temporal deja de ser sección suelta) + barra de uso integrada; Inventario agregar/quitar muestra comprobantes del mes en vez de movimientos ilimitados. Mismo release en que se validó el BATCH e2e con plata real (suba delta $5.000 aplicada por webhook en 22s + baja sin cobro) y se descubrió el límite duro `fn_enforce_limite()` en DB.

## v1.119.0 — 💳 Cambio de cuenta MP (planes $54.000/$90.000) + dependencias a 0 vulnerabilidades (PROD ✅)

Cobros de la plataforma migrados a la cuenta MP nueva (Fede Messina, user 478332282): planes nuevos creados por API con el −10% de débito automático incluido, `MP_PLAN_IDS` + secrets en DEV y PROD, smoke de reconciliación verde. Pendiente GO: webhook en el panel + cierre de la cuenta vieja + test de checkout (no puede hacerlo Fede: pagador=cobrador). Además: 18 vulnerabilidades Dependabot → 0 (Vite 5→7, PWA plugin 1.x, sin top-level-await).

## v1.118.0 — 🤖 Asistente IA Fases 3+4: fallback de modelo + batería de preguntas doradas (PROD ✅)

Fase 3: fallback 70B→8B ante 429/5xx (cupos separados en Groq free), boost por título, aviso estructural en secciones de módulos que el usuario no ve, anti prompt-injection. Fase 4: `tests/specs/asistente-ia.plan.md` (AI-G1..G9) + `npm run ai:smoke` — la primera corrida cazó 2 bugs reales (injection + fuga de menú), corregidos y re-validados en DEV. 939 unit.

## v1.117.0 — 🤖 Asistente IA: conocimiento desde el wiki + contexto real del usuario (Fases 1+2; PROD ✅)

Reescritura del Asistente IA del header (antes: prompt estático desactualizado que inventaba botones y desconocía modo básico/roles). Ahora: conocimiento **generado desde `app-reference.md`** (`npm run ai:knowledge` → 44 secciones, commiteado) + **contexto real del usuario** (rol, modo, plan, ruta, menú visible calculado con `navVisibility`) + guardrails anti-alucinación + Llama 3.3 70B. Espejo `src/lib/aiAssistant.ts` (11 tests). Validado e2e en DEV con CAJERO modo básico. Detalle: `wiki/features/asistente-ia.md`. Paso 5 nuevo en el checklist de deploy.

## v1.116.0 — 🎨 UI polish: íconos de página + tab Historial de Gastos + Recurrentes condicional (PROD ✅, frontend-only)

Sin migraciones ni EFs. PR #273 + release v1.116.0.

- **Íconos de módulo en los títulos de página** (los mismos del menú lateral, `text-accent`): Dashboard, Productos, Inventario, Ventas, Gastos, Caja, Clientes, Alertas, Reportes, Usuarios y Configuración. Color unificado en Historial (estaba sin color) y Sucursales (estaba en azul).
- **Gastos**: tab Historial reubicado entre Cheques y Reportes.
- **Ventas**: botón "Recurrentes" de la toolbar visible solo si el tenant tiene plantillas (decisión GO: la feature queda, se limpia la toolbar); toast de creación indica dónde encontrarlas.
- Limpieza: borrado `src/pages/AppLayout.tsx` huérfano (el real es `components/layout/AppLayout.tsx`).

## v1.115.0 — 🧩 Batch de add-ons con cobro por delta + pricing v2 COMPROBANTES (PROD ✅, migs 258-259 + 3 EFs)

**Contexto:** el add-on fijo "un click = un cobro" (`mp-addon-fijo`, v1.106-v1.114) se validó e2e con Fede el 2026-07-05 pero GO **descartó esa lógica** y pidió un rediseño BATCH (diseño cerrado con decisiones Q1-Q4 en `wiki/features/configurador-addons-batch.md`).

**Panel único "Armá tu plan" en `/suscripcion`:** se elimina el segundo panel "Ampliá tu plan con add-ons"; al entrar, el toggle queda preseleccionado en el plan actual + add-ons activos tildados + total = lo que viene pagando. El usuario arma el cambio libremente (un pack por dimensión) y **nada se aplica hasta "Confirmar"** (batch). Al confirmar: **suba del recurrente → paga SOLO la diferencia HOY** (preference de pago único; el webhook aplica el cambio recién cuando MP confirma el pago, fail-closed) y el recurrente pasa al total nuevo desde el próximo ciclo; **baja o neutro → sin cobro**, `PUT` inmediato del recurrente + aviso "tu próxima factura del DD/MM llega por $X". **Guard de baja a nivel batch:** antes de confirmar se compara el uso activo real (SKU/usuarios/sucursales) contra el límite resultante del batch objetivo — si excede, bloquea con el detalle de cuánto desactivar (para SKU: "desactivar ≠ eliminar").

**Pricing v2 — COMPROBANTES reemplaza a movimientos:** toda venta finalizada del mes (ticket o factura AFIP, presupuestos y canceladas NO cuentan) = 1 comprobante. Básico **6.000/mes** · Pro **14.000/mes** · packs **+1.000=$10.000 · +5.000=$30.000 · +10.000=$50.000** (fijo Y temporal — el add-on temporal pasa de movimientos a comprobantes). Enforcement **SOFT** (banner de upsell al 80%, aviso fuerte+email al 100%, la venta SIEMPRE sale — coherente con la decisión F3b de nunca frenar un cobro en el mostrador). Movimientos pasa a **-1 (ilimitado/telemetría)**.

**Implementación:** **mig 258** (`addon_batch_changes` + `fn_aplicar_addon_batch` atómica + un-pack-fijo-por-dimensión + dimensión comprobantes) + **mig 259** (`fn_plan_base_limite` v2) + EF nueva **`mp-addon-batch`** (preview/confirmar, revalida todo server-side, cálculo de delta preservando descuentos del preapproval) + rama `|addonbatch|` en `mp-webhook` (claim idempotente; pagado-sin-aplicar → `fallido` + alerta a soporte) + `mp-addon` ahora vende el temporal de comprobantes + catálogo v2 en `brand.ts`/`addons.ts` + `usePlanLimits` con comprobantes + `SuscripcionPage` panel único + `PricingConfigurator` modo `app` (retorno `type=addonbatch` con poll) + espejo `mpAddonBatch.ts` + tests. `mp-addon-fijo` queda **DEPRECADO** (la UI ya no lo llama; se borra en una limpieza futura).

**Deploy:** migs 258-259 (DEV+PROD) + EFs `mp-addon-batch`/`mp-addon`/`mp-webhook` (DEV+PROD) + frontend (Vercel main) + release v1.115.0. PR #272. **924 unit verdes.** UAT §10.b nuevo (MP-B1..B8). **🟠 Pendiente:** test e2e GO+Fede del batch (suba con delta + baja + guard); deprecar `mp-addon-fijo`; Fase 2 = cambio de PLAN por el toggle.

---

## v1.113.0 — 🎯 Trial 30 días + estimador "Armá tu plan" en /suscripcion + UAT §31.b contraste (PROD ✅, mig 257 + EF send-email)

**Trial 7→30 días** (decisión GO): **mig 257** `trial_ends_at DEFAULT now()+30d` (solo tenants nuevos) + textos en Landing (badge hero/FAQ/CTAs), `OnboardingPage`, `SuscripcionPage`, `PricingConfigurator` y el email de bienvenida. Resuelve la duda "Free 30 días ¿trial o permanente?" de `wiki/business/planes-pricing.md` — es trial de 30 días, sin conflicto con los T&C (no fijan duración numérica).

**Estimador también en `/suscripcion`** (pedido GO): `PricingConfigurator` gana props `ctaLabel`/`onCta`/`ctaLoading` — en el Landing sigue igual, en `SuscripcionPage` se embebe full-bleed (94vw/80vw, máx 1600px) y visible para todos (suscriptos o no); sigue siendo estimación pura (`ADDON_FIJO_ENABLED` intacto, no cobra add-ons).

**UAT §31.b nuevo** (`tests/specs/uat-modo-basico.md`): escenarios formales C1-C8 de contraste claro+oscuro. Corrida sobre el Landing a pedido de GO: **4 bugs de contraste encontrados y arreglados** (hover ilegible en 3 CTAs blancos del Landing sobre fondo oscuro + `dark:bg` sin `dark:text` en el CTA no-destacado de `SuscripcionPage`). Deuda anotada: `text-[#7DB9E8]` hardcodeado en el H1 del hero.

**Deploy:** mig 257 (DEV+PROD) + EF `send-email` (DEV+PROD) + frontend (Vercel main) + release v1.113.0. PR #270.

---

## v1.112.0 — 🛑 Sweep de reconciliación billing MP + SW update forzado + grace period completo + H8 resuelto (PROD ✅, mig 256 + 4 EFs)

Cierra los 3 huecos que expuso el test e2e real con Fede (v1.111.0, ver `log.md`). **(1)** EF nueva `mp-reconciliacion` + **mig 256** `mp_billing_alertas` + workflow `.github/workflows/mp-reconciliacion.yml` (cron horario + manual) — detecta huérfanas/drift_mp_cobra/drift_acceso_gratis y alerta a `soporte@` una vez por hallazgo; **SOLO alerta, nunca activa/linkea sola** (REGLA #0). **(2)** `registerSW` explícito en `main.tsx` (chequeo cada 30 min + al volver el foco) — mata el vector "PWA cacheada" que complicó el diagnóstico con Fede. **(3)** `mp-webhook` ahora setea `subscription_period_end` también cuando la cancelación viene DESDE EL PANEL DE MP (antes solo cubría cancelar desde la app/soporte); la activación limpia `period_end` en los 3 caminos. **(4) H8 resuelto:** `admin-api.cancelarSubMP` ganó el fallback por `payer_email`, unificado con `cancel-suscripcion`.

**Deploy:** mig 256 (DEV+PROD) + EFs `mp-reconciliacion`/`mp-verificar-suscripcion`/`admin-api`/`mp-webhook` (DEV+PROD) + frontend + release v1.112.0. PR #268. **912 unit verdes** (antes 904). UAT §11 de `mp-suscripciones-pagos.plan.md` actualizado con "RESUELTO v1.112.0".

---

## v1.111.0 — 🎨 Rediseño configurador add-ons "Armá tu plan" + 🛑 kill-switch add-on fijo (REGLA #0) — **PROD ✅** (frontend-only)

Port de un diseño de referencia al configurador de add-ons (Pricing Fase 4), **respetando la paleta de marca** (degradé violeta→cian, tokens `--color-accent`/`--color-accent-2`; nada hardcodeado del mockup). **Landing (`PricingConfigurator`):** rediseño completo — panel oscuro con glow, toggle Básico/Pro, grid de tarjetas seleccionables por dimensión con badge ✓, barra de total en vivo + CTA, fila de beneficios; ocupa ~80% del viewport; beneficio de soporte = "Soporte dedicado". **In-app (`SuscripcionPage`):** mismo lenguaje visual (add-ons activos como tarjeta seleccionada + botón quitar); **lógica de compra MP intacta**. **🐞 Fix contraste:** badge "✓ Plan actual" del plan no destacado era `bg-white text-white` (invisible) → tinte de marca. **UAT §31** = auditoría reusable de contraste de botones. **🛑 REGLA #0:** al testear, clickear un add-on fijo daba error — el flujo `mp-addon-fijo` (`PUT` que cambia el monto que MP cobra al cliente) **estaba vivo en PROD desde v1.106 sin validar e2e** → **kill-switch `ADDON_FIJO_ENABLED=false`** oculta el configurador de add-ons fijos hasta validar el cobro en sandbox (quita de PROD un cobro sin validar) + helper `mensajeErrorEF` (muestra el error real del EF, no el críptico). Sin migraciones, sin deploy de EFs. typecheck+build verdes. **🟠 Pendiente GO:** validar el cobro en sandbox → prender el flag. Ver `wiki/business/planes-pricing.md` (Fase 4) + `log.md`.

---

## v1.110.0 — 🛑 Fix REGLA #0 eliminar-cuenta + ⏳ MP-C9 grace period + Fase 4 tests (PROD ✅, mig 255 + 2 EFs)

**Bug REGLA #0 (money):** `MiCuentaPage.handleDeleteAccount` marcaba el tenant `cancelled` con un UPDATE directo pero **NO cancelaba el preapproval en MP** → eliminar la cuenta con sub activa dejaba a MP cobrando para siempre (fail-open, como v1.104.0 pero en delete; además el UPDATE post-borrado-de-users fallaba por RLS). **Fix:** cancelar en MP (`cancel-suscripcion`, fail-closed) ANTES de borrar; abortar si MP no confirma; reordenado. `AdminPage` ya OK (EF), `SuscripcionPage` solo lectura.

**MP-C9 — grace period al cancelar (pedido GO, REGLA #0 fairness):** el cliente que pagó conserva el acceso hasta el fin del período abonado (antes el guard cortaba al instante). **mig 255** `tenants.subscription_period_end`; `cancel-suscripcion` + `admin-api` guardan el `next_payment_date` de MP (fallback `now()+30d`) al cancelar; `SubscriptionGuard` permite `cancelled && now < period_end`; `MiCuentaPage` muestra "acceso hasta DD/MM". **T&C sección 4** ya lo prometía (sin reembolsos por período iniciado) — se explicitó "conservás el acceso hasta el fin del período abonado". El código ahora CUMPLE el contrato.

**Fase 4 (test-only, patrón ccLogic):** `suscripcionActivacion.ts` (usado por `SuscripcionPage`) + `mpPertenencia.ts` (espejo pertenencia, crux `payer_email` vacío) + `mpCancelacion.ts` (espejo fail-closed) + 34 tests. typecheck + build + 873 unit verdes. **🟠 e2e del grace lo valida GO con una cancelación real.**

---

## v1.109.0 — 🔧 Soporte: linkear suscripción MP huérfana por preapproval_id (PROD ✅, EF admin-api + panel)

Sale del caso Fede: una suscripción puede quedar **activa en MP pero sin linkear** en la app (checkout-return falló / pestaña cerrada) y **no se puede autorrecuperar** — MP manda `payer_email`/`external_reference` **vacíos** en checkout por plan → la app no tiene por dónde encontrarla salvo el `preapproval_id`. **Backend (EF `admin-api`):** acción **`billing.link_subscription`** (módulo `billing`) que **verifica contra MP** (`authorized` + plan nuestro + **no reclamada** por otro tenant) y **cancela una anterior distinta y viva** (anti doble-cobro) antes de activar (`active` + `mp_subscription_id` + `plan_tier`); audita. **Panel (`genesis360-admin`):** botón "Linkear suscripción" en `CustomerDetailPage` (rol `billing`) → pegar `preapproval_id` + confirm. EF DEV+PROD (CLI); panel a su Vercel. Frontend de la app sin cambios (bump de versión por convención). **🟠 e2e real** lo hace GO desde el panel (no testeable en DEV). Ver `wiki/integrations/mercado-pago.md` §3.f.

---

## v1.108.0 — 🔁 Fase 2 billing MP: rework del flujo de activación (PROD ✅, frontend-only)

**Contexto (REGLA #0, revenue):** tras el test real con Fede (v1.107.0) se confirmó que **la activación por UI no funcionaba** — un cliente pagaba y no se activaba solo. Tres causas en `SuscripcionPage`: (1) el retorno del checkout invocaba la EF con el **JWT posiblemente sin restaurar** (el redirect recarga la app de cero) → 401; el `handleVerificarPago` hacía `if (!tenant) return` y el `useEffect` (deps `[status]`) **no reintentaba nunca**; (2) la pantalla de resultado era **estática y mentía** ("tu suscripción se activó") sin verificar nada; (3) el botón email-search no podía andar porque MP manda `payer_email` **vacío** en checkout por plan.

**Fix (todo en `src/pages/SuscripcionPage.tsx`, sin tocar el EF):** se espera `supabase.auth.getSession()` **antes** de invocar (mata el 401) y ya **no se depende del `tenant` del store** (la EF `mp-verificar-suscripcion` deriva el tenant del JWT). Nuevo estado real `verifState: verificando|ok|pendiente|error` con **reintentos** (4× cada 2,5s, porque MP/webhook tarda en confirmar) y clasificación de la respuesta de la EF (`activated:true`→ok · `200 activated:false`→pendiente · `4xx/5xx`→error con mensaje por `reason`). **Pantalla honesta** por estado (spinner "verificando", éxito+redirect, "estamos confirmando / no pagues de nuevo", error+reintentar/soporte). Al activar, `loadUserData(uid)` **antes** de navegar → refresca `tenant` a `active` y el `SubscriptionGuard` no rebota a `/suscripcion`. Se **quitó** el botón "¿Ya pagaste?" (email-search inútil). **Sin migraciones.** typecheck+build+**839 unit** verdes. **🟠 Pendiente:** validación e2e del pago real en PROD (GO/Fede) — no testeable en DEV (token MP de otra cuenta).

---

## v1.107.0 — 🔗 Fase 1 billing MP: linkeo por payer_email + fail-closed (PROD ✅)

**Causa raíz (REGLA #0):** MP **no persiste `external_reference`** en checkout por plan (`preapproval_plan_id`) → ningún tenant se linkeaba (`mp_subscription_id` NULL en toda la plataforma) y la cancelación **fail-abría** (marcaba cancelled sin cancelar en MP). **Fix (4 EFs):** `mp-verificar-suscripcion` (pertenencia por `payer_email` + guarda `mp_subscription_id`), `cancel-suscripcion` (cancela por id guardado + fail-closed real + MP-C7), `mp-webhook` (resuelve tenant por `mp_subscription_id`), `admin-api`/`cancelarSubMP` (mismo bug duplicado). Botón "Ya pagué / Verificar" en `SuscripcionPage`. UAT 43 escenarios (`tests/specs/mp-suscripciones-pagos.plan.md`). **Sin migraciones.** **✅ CANCELACIÓN validada e2e en PROD con Fede** (el bug original probado muerto). **❌ ACTIVACIÓN por UI ROTA** — confirmado con datos reales que MP tampoco manda `payer_email` en checkout por plan (10/10 vacíos) → email-search inútil; y el retorno del checkout falla (401 de sesión / `tenant` no cargado + `useEffect` sin reintento / pantalla "activó" estática que miente) → **Fase 2 = rework del flujo de activación (prioridad, revenue)**. Seguridad: removido rol ADMIN god-access a Fede → 0 ADMINs en PROD.

---

## v1.106.0 — 🛟 Cancelar suscripción desde el panel interno (admin.genesis360.pro) (PROD ✅, EF admin-api + repo genesis360-admin)

Cierra el follow-up de v1.104.0. EF `admin-api` (repo principal): acción `billing.cancel_subscription` (módulo billing) que cancela el preapproval del tenant en MP (helper `cancelarSubMP`, fail-closed, mismo circuito que `cancel-suscripcion`) + marca `subscription_status='cancelled'` + audita; `customers.get` devuelve `subscription_status`. Panel `genesis360-admin`: botón "Cancelar suscripción" en `CustomerDetailPage` (gateado por rol billing/admin). EF DEV+PROD; panel buildea. Ahora se puede cancelar clientes desde `admin.genesis360.pro`.

---

## v1.105.0 — 🔴 Seguridad REGLA #0: bloquear escalada a rol ADMIN (aislamiento multi-tenant) (PROD ✅, mig 254 + EF invite-user)

Hallazgo (auditando el guard de `/admin`): un DUEÑO podía auto-asignarse `rol='ADMIN'` (staff, `is_admin()` → ve TODOS los tenants) vía el EF `invite-user` (rol sin whitelist) o un `UPDATE users SET rol` directo (`UsuariosPage.updateRol`). Fix defensa en profundidad: `invite-user` valida `rol` contra `ROLES_ASIGNABLES` (sin ADMIN) + **mig 254** trigger `trg_guard_rol_admin` que rechaza setear `rol='ADMIN'` desde contexto de usuario JWT no-admin (permite service_role/SQL + ADMIN existente). Verificado por impersonación. El guard de la ruta `/admin` ya existía (`AuthGuard requireRole="ADMIN"` + check in-page).

---

## v1.104.0 — 🔴 Fix REGLA #0: cancelación de suscripción no cancelaba en MP (EF `cancel-suscripcion`) (PROD ✅)

Bug reportado por GO (Fede Messina cancelado pero seguía cobrándose en MP). **Causa:** el EF `cancel-suscripcion` que llamaba `MiCuentaPage` no existía, y el tenant tenía `mp_subscription_id=NULL` pese a una suscripción viva en MP (drift DB↔MP) → la cancelación nunca tocaba MP. **Fix:** EF nuevo `cancel-suscripcion` que cancela el/los preapproval(s) en MP (`PUT status:'cancelled'`, verifica `external_reference===tenant`), **robusto al drift** (si falta el id, busca por `external_reference` en `/preapproval/search`), **fail-closed** (solo marca la cuenta cancelada si MP confirmó); `MiCuentaPage` siempre pasa por el EF. typecheck + build verdes; EF en DEV. **Pendiente:** deploy EF a PROD + release + reconciliar fila de Fede (OK de GO). Follow-up: cancelación desde AdminPage/admin-platform no propaga a MP.

---

## v1.103.0 — 💠 Pricing 2026 FASE 4 — configurador de precios en la Landing (PROD ✅, frontend-only)

`PricingConfigurator` (`src/components/PricingConfigurator.tsx`) en la sección Precios del Landing: estimador público que combina **plan base (Básico/Pro) + add-ons fijos (SKU/sucursales/usuarios)** y calcula el **total mensual en vivo** (reusa `packsDe`/`precioMensualAddonsFijos` de `src/lib/addons.ts` → mismo precio que cobra el server). Nota de que los movimientos extra se compran puntuales desde la app (add-on temporal). CTA → onboarding. No cobra nada (marketing/comercial). typecheck + build + unit verdes. Sin migración ni EF. **Pendiente:** F5 (multi-CUIT — track grande, requiere relevamiento, va después del WSFE propio).

---

## v1.102.0 — 💠 Pricing 2026 FASE 2 (add-on temporal) + FASE 3 (add-ons fijos + EFs tier-aware + downgrade guiado) (PROD ✅, mig 253 + 4 EFs)

Continuación del pricing (F0/F1 en v1.101.0). **F2 — Add-on TEMPORAL de movimientos:** lib `src/lib/addons.ts` (packs/ref/downgrade, fuente de verdad UI↔webhook, unit-tested) + EF `mp-addon` parametrizado (packs 1.000/5.000/20.000, **revalida el precio server-side**, ref `${tenant}|addon|movimientos|${cant}|temporal`) + EF `mp-webhook` inserta `tenant_addons` temporal (vence 30d, **idempotente por `mp_payment_id`** — el flujo legacy no lo era y una re-notificación de MP duplicaba movimientos, REGLA #0) + `SuscripcionPage` selector de 3 packs + **mig 253** (uq index parcial). **F3a — EFs tier-aware:** `mp-webhook`/`mp-verificar-suscripcion` setean **`plan_tier`** (mapeo `preapproval_plan_id`→tier) en vez de los `max_users/max_productos` viejos (bug: `usePlanLimits` ya no los lee) → cierra el lado servidor de RIESGO #1. **F3b — enforcement movimientos = SOFT** (decisión REGLA #0: no cortar ventas/operaciones; un movimiento no es comprobante fiscal; el gate client-side de Inventario ya usa el límite efectivo). **F3c — add-ons FIJOS + downgrade guiado:** lib `evaluarDowngrade`/`precioMensualAddonsFijos` (unit) + EF nueva `mp-addon-fijo` (alta/baja, `PUT transaction_amount` del preapproval por **delta** preservando descuento base, **fail-closed** si MP falla, downgrade guiado revalidado server-side) + configurador en `SuscripcionPage` (packs sku/sucursales/usuarios + total en vivo + modal "desactivá N; SKU no eliminar"). typecheck + build + **839 unit**. Verificación DB por impersonación (ROLLBACK). ⚠ **RIESGO #1 sigue vivo:** los **planes base de MP siguen a precio viejo** → reconfigurar a $60k/$100k antes de habilitar suscripciones/add-ons reales; **el cobro MP no está e2e-testeado** (sin sandbox/seller) — GO deployó asumiendo el riesgo. **Pendiente:** F4 (configurador en Landing), F5 (multi-CUIT).

---

## v1.101.0 — 📄 T&C/Privacidad + 🧾 dual-provider AFIP (adapter) + 💠 Pricing 2026 F0+F1 (PROD ✅, migs 249-252)

Release triple. **(1) T&C + Privacidad + consentimiento de marketing (mig 249):** páginas públicas `/terminos` y `/privacidad` (`LegalLayout`) + 2 checkboxes en el onboarding (T&C **requerido** + marketing **opt-in** separado, Ley 25.326); el consentimiento viaja por el metadata del `signUp` (path confirm-email) → `tenants.terminos_aceptados_at`/`terminos_version`/`marketing_consent`. Links en el footer del Landing. ⚠ **Texto legal EN VIVO pero pendiente de revisión de abogado** (GO decidió publicar igual) + falta razón social/CUIT del responsable. **(2) Dual-provider AFIP — Fase 1 adapter (mig 250):** `emitir-factura` refactorizado a patrón adapter (`AfipSdkProvider` + `WsfePropioProvider` stub), selector por-tenant `tenants.afip_provider` (default `'afipsdk'`, comportamiento idéntico; rollback por flag), lógica fiscal compartida + `ventas/devoluciones.afip_provider_usado`. **La EF NO se deployó** (refactor sin probar en runtime → PROD sigue con la EF actual). **(3) Pricing 2026 — Fase 0 modelo + Fase 1 enforcement (migs 251-252):** `tenants.plan_tier` (desacopla el tier de `max_users`) + tabla `tenant_addons` + `fn_plan_base_limite`/`fn_tenant_limite` (límite efectivo = base + Σ add-ons activos; trial→pro); `brand.ts` con **precios nuevos $60k/$100k**, `PLAN_BASE_LIMITS`, `ADDON_PACKS`, `PLAN_DESCUENTOS`; `usePlanLimits` reescrito (efectivo + sucursales); **enforcement server-side** (triggers en productos/users/sucursales; movimientos diferido por hot-path). ⚠ **Mismatch precio↔MP EN VIVO** (los planes de MP siguen a precio viejo → reconfigurar antes de suscripciones reales, Fase 3). typecheck + build + **826 unit** verdes. Enforcement verificado por impersonación; PROD 5 tenants, 0 sobre-límite. **Pendiente:** F2 (add-on temporal movimientos), F3 (add-ons fijos + downgrade guiado + reconfig MP + EFs), F4 (configurador), F5 (multi-CUIT).

---

## v1.100.0 — 🛟 Soporte server-side (tickets a soporte@) + 📧 email rebrandeado + 🌐 fix link Landing (PROD ✅, frontend + EF send-email, sin migración)

Validación tipo-UAT de soporte/correos + branding de emails (pedido GO). **(1) Tickets de soporte server-side:** el "Reportar un problema" del **Centro de Ayuda** (`AyudaModal`) usaba `mailto:` (dependía del cliente de correo local del usuario → poco confiable) → ahora invoca la EF `send-email` (`type:'bug_report'`) a **`soporte@genesis360.pro`** (botón "Enviando…", aviso si falla). + **fix del Asistente IA** (`AiAssistant`): mandaba el campo `tipo` cuando la EF espera `type` → la EF tiraba 500 y el mail **nunca se enviaba** (el UI igual decía "enviado", falla silenciosa); ahora `type` + a soporte@. **(2) Email rebrandeado:** la plantilla de `send-email` usaba navy `#1E3A5F` + tagline vieja ("El cerebro de tu negocio") → ahora **degradé de marca violeta→cian** (`#7B00FF`→`#06B6D4`, fallback violeta sólido para Outlook) + **logo** + tagline correcta ("El inventario inteligente para tu negocio") + botones/acentos/totales en violeta. Encoding verificado (UTF-8 OK; acentos/emojis se leen bien). **(3) Fix Landing:** el botón "A consultar" del plan Enterprise usaba `<Link to="mailto:…">` de React Router → lo resolvía como ruta interna (rebote al home, no abría el correo) → pasado a `<a href="mailto:…">`. + **guard `tests/unit/landingLinks.test.ts`** (valida que todo anchor tenga sección, las rutas existan y ningún mailto use `<Link>`). **Correos del proyecto:** `noreply@genesis360.pro` (FROM, Resend) · `soporte@genesis360.pro` (soporte, reenvía al Google Group `genesis360-soporte@googlegroups.com` → GO + socio) · `hola@genesis360.pro` (`BRAND.email`, contacto landing). typecheck + build + **823 unit**. EF `send-email` en DEV+PROD. Sin migración.

---

## v1.99.0 — 🔐 Hardening de billing (activación verificada) + least-privilege anon en RPCs de plata (PROD ✅, migs 247-248 + EF)

Dos hardenings de seguridad (REGLA #0). **(1) Activación de suscripción verificada server-side:** el fallback de `SuscripcionPage` activaba la suscripción con un `UPDATE tenants SET subscription_status='active'` **directo desde el navegador** a partir del redirect de MP (`?status=approved&preapproval_id=X`), **sin verificar el pago** → cualquiera podía auto-activarse (o bypassear la UI con un PATCH directo a PostgREST). Fix: nueva **EF `mp-verificar-suscripcion`** que consulta el preapproval contra la API de MP con el token de la plataforma y solo activa si `status==='authorized'` Y `external_reference===tenant del usuario`; además cancela la suscripción anterior en MP si cambió de plan (evita doble cobro = el sub-ítem de prorrateo). El cliente ahora llama a esa EF en vez de hacer el UPDATE. **Guard server-side (mig 247):** trigger `BEFORE UPDATE ON tenants` que bloquea pasar `subscription_status` a `'active'` salvo `service_role` (webhook/EF) o rol `ADMIN` (staff Genesis360; los tenants no pueden auto-asignarse ADMIN). Verificado por impersonación DB (DUEÑO→active BLOQUEADO, service_role→active OK, DUEÑO→cancelled OK). **(2) Least-privilege anon (mig 248):** por los default-privileges de Supabase, varias funciones SECURITY DEFINER de plata quedaban con EXECUTE para `anon`. Se revoca `anon` de `marcar_incobrable`, `registrar_pago_oc`, `marcar_envios_pagados`, `set_clave_maestra` (mantienen authenticated+service_role) y de los sweeps cross-tenant `liberar_reservas_vencidas_all`/`recalcular_intereses_cc_all` (solo service_role; los llama el cron). NO se tocan las funciones públicas a propósito (token/QR de envíos, fichado) ni los helpers de RLS (revocarles anon rompería el RLS). typecheck + build + 819 unit. Migs 247-248 + EF en DEV+PROD.

---

## v1.98.0 — 🎁 POS auto-sugiere crédito a favor + 🎨 fondo de marca unificado (PROD ✅, frontend-only, sin migración)

Dos pedidos de GO, frontend-only sin migración. **(1) POS — crédito a favor por defecto:** al seleccionar en una venta (despacho/reserva, no presupuesto) un cliente **con saldo a favor** (`cliente_creditos > 0`), el medio **"🎁 Crédito a favor" se auto-aplica** por `min(saldo, total)` + toast 🎁. Si gasta menos que el crédito, el resto queda a favor (el ledger solo consume lo aplicado); si gasta más, el faltante se pide por otro medio. **No pisa al usuario:** solo actúa si los medios están vírgenes o si la única línea es la que auto-aplicó (re-clampa al cambiar el total); si el usuario cargó pagos a mano, no interviene. **🛑 REGLA #0 intacta y verificada:** la sugerencia nunca supera el saldo (`montoSugeridoCredito`, respeta el guard server-aware de `registrarVenta` L2454) ni el total (no genera vuelto falso); el consumo está gateado por `estado !== 'pendiente'` (un presupuesto nunca consume crédito). Lib `saldoFavor.ts` + función pura `montoSugeridoCredito()` + 6 unit (819 total). **(2) Fondo de marca unificado:** nueva utilidad `.bg-brand-gradient-dark` (negro→violeta, 135°, "el fondo del login") en `index.css`; GO unificó TODO el branding oscuro full-screen en ese token: **Login** (canónica), **Suscripción** (era negro→violeta→cian), **Landing** (hero + CTA final, el hero era violeta→cian) y **Onboarding** (era violeta→cian). typecheck + build + 819 unit. Sin migraciones.

---

## v1.97.0 — 🎨 Ajustes visuales (píldoras Usuarios, ancho Recursos/Usuarios, botones Sucursales, submenu Config) (PROD ✅, frontend-only, sin migración)

Pedidos de consistencia visual de GO (cero lógica): **Usuarios** — píldoras de filtro por rol con el formato de las del Dashboard; **Recursos + Usuarios** a ancho completo (saco `max-w`/`mx-auto` del contenedor raíz); **Sucursales** — botones primarios `bg-primary`→`bg-accent` (degradé violeta→cian); **Configuración** submenu lateral — seleccionado = estilo activo del sidebar (`bg-accent text-white` = degradé), hover = el color que antes tenía el seleccionado (`hover:bg-accent/10 hover:text-accent`). 💡 Nota: en `index.css` `.bg-accent` está redefinida como el degradé violeta→cian (= `bg-brand-gradient`). typecheck + build + 813 unit. PR #253.

---

## v1.96.0 — 💵 Cash-out de saldo a favor en efectivo + marco legal devoluciones (PROD ✅, mig 246)

Cierra el gap de `cliente_creditos`: hasta ahora un saldo a favor SOLO se consumía aplicándolo a una venta; ahora se puede **devolver en efectivo de forma asentada**. **🛑 REGLA #0 (caja + cliente_creditos):** mig 246 RPC `devolver_saldo_a_favor` SECURITY INVOKER, atómico + guards server-side (monto ≤ saldo a favor SUM, sesión de caja abierta+tenant, **no caja en negativo CAJ-18**); egreso de efectivo en caja + `cliente_creditos` negativo (origen `retiro_efectivo`). Verificado en DB DEV+PROD (happy + 2 guards, ROLLBACK). Frontend: badge "Saldo a favor" → botón "💵 Devolver" en `ClientesPage` + modal. Lib `saldoFavor.ts` + 6 unit (813 total). 🔐 Hallazgo: Supabase default-privileges dan EXECUTE a anon directo → `REVOKE FROM anon` explícito (no alcanza FROM PUBLIC); follow-up de hardening para los otros RPC de plata. **+ Marco legal AR de devoluciones documentado** (Ley 24.240 + CABA 3281): fallado/garantía 6m + arrepentimiento online 10d = derecho a dinero; cambio de opinión presencial = crédito/vale OK. mig en DEV+PROD. PR #252.

---

## v1.95.0 — 🔎 Auditoría report-panels + RRHH costo laboral bruto + "Ver más" en Detalle por venta (PROD ✅, frontend-only, sin migración)

Auditoría de display (misma clase que v1.91.0) sobre los 3 report-panels que muestran plata: **Compras** (`comprasReportes`), **Envíos** (`enviosReportes`), **RRHH** (`rrhhReportes`). **Conclusión: sin bugs fiscales REGLA #0** (math sólida, `Number()` coerciona el numeric de PG, totales aditivos, excluyen cancelados). Único hallazgo de exactitud → **RRHH "Costo laboral por departamento" pasó de NETO → BRUTO** (`total_haberes`): el neto (take-home) subestimaba el costo real para la empresa; ahora suma el bruto liquidado + nota de que las cargas patronales se ven en Gastos (`recibosResumen` sigue con neto). + **UX:** "Detalle por venta" (Dashboard › Todo › Rentabilidad) ahora pagina con **"Ver más"** (50 + incremental) en vez de dibujar todas las ventas del período de un saque. **🛑 Solo display — REGLA #0 intacta.** typecheck + build + 807 unit. Sin migraciones. PR #251. **Backlog (pedidos GO):** POS auto-sugerir crédito a favor; cash-out de saldo a favor; exports PDF/ConfigPage.

---

## v1.94.0 — 📊 Dashboard: filtro unificado (un solo Período/Moneda global) (PROD ✅, frontend-only, sin migración)

Cierra el follow-up de la barra de filtros por área (GO la marcó de uso poco claro → eligió unificar). Ahora **un solo control Período/Moneda** (arriba) gobierna las áreas con período; fuera las barras por módulo. El filtro global se muestra en Gráficos/Insights/Métricas de `Todo/Ventas/Gastos/Productos` (`AREAS_CON_PERIODO`); no aparece en las de período fijo ni en Rentabilidad/Recomendaciones (evita el filtro inerte). Ventas/Gastos/Productos embebidos toman el período/moneda global (props `gPeriodo/gMoneda/gCustom*` → helpers `getFechasDashboard`/`getFechasAnteriores`); su barra propia oculta. Hallazgo: solo esas 3 tienen período real; las otras 6 (Inventario/Clientes/Proveedores/Facturación/Envíos/Marketing) son snapshots de período fijo por diseño → no se embeben en standalone (conservan sus controles propios, ej. toggle Vista de Inventario/Proveedores); en el agregado de Gráficos sí. **🛑 Solo display/filtrado — REGLA #0 intacta.** typecheck + build + 806 unit + e2e spec 84 (7/7). Sin migraciones. PR #250.

---

## v1.93.0 — 📊 Dashboard: Gráficos primero (landing) + "Todo › Gráficos" = todos los gráficos por sección (PROD ✅, frontend-only, sin migración)

Dos ajustes de GO sobre el Dashboard v1.92.0: (1) **Gráficos** pasa a ser la **primera** sub-pestaña y el **landing por defecto** ("adelanto de todo"), Insights queda segunda; (2) **"Todo › Gráficos"** ahora muestra **TODOS los gráficos del negocio** separados por secciones (General + una por cada módulo), en vez de solo La Balanza + El Mix de Caja. Implementación: los 9 `Dash*Area` reciben una prop `embedded` que oculta su barra de filtros/banners → embebidos en el agregado se ven solo los charts; `Todo › Gráficos` compone la sección General + una `<section>` por módulo (`AreaModulo section="graficos" embedded`, orden en `MODULE_AREAS`, Envíos solo en modo avanzado). **🛑 Solo display — REGLA #0 intacta** (ningún cálculo tocado). Validado: typecheck + build + 806 unit + **e2e spec 84 (6/6)**. Sin migraciones. PR #249. **Follow-up abierto:** revisar con GO si se mantiene la barra de filtros por área de los módulos standalone (la marcó como de uso poco claro).

---

## v1.92.0 — 📊 Dashboard completo: 5 sub-pestañas uniformes por área (PROD ✅, frontend-only, sin migración)

El Dashboard estaba "a medio hacer": solo la pestaña **Todo** tenía las sub-pestañas funcionando; las 9 áreas de módulo (Ventas/Gastos/Productos/Inventario/Clientes/Proveedores/Facturación/Envíos/Marketing) mostraban "Próximamente". Ahora **cada pestaña de área expone las 5 sub-pestañas** — **Insights · Métricas · Rentabilidad · Recomendaciones · Gráficos** — con datos de ese módulo. **🛑 REGLA #0 intacta: no se tocó ningún cálculo de plata/fiscal**, solo se reorganizó *qué bloque ya calculado se muestra* (sobre la base ya auditada en v1.91.0). **Cómo:** los 9 `Dash*Area` reciben una prop `section` que gatea sus 3 bloques existentes (KPIs/charts/insights); para Rentabilidad/Recomendaciones por módulo se **reusan las vistas globales scopeadas** (`RentabilidadPage` con nota "consolidada" salvo Ventas/Productos; `RecomendacionesPage` filtrada por categoría según `AREA_RECO_CAT`) — **sin fabricar números** (coherente con difererir las estimaciones sintéticas). "Todo" distribuye su antiguo overview en las 5 sub-pestañas (KPIs+Fugas+Top→Métricas; Balanza/MixCaja→Gráficos; score+alertas+sugerencias+proyección→Insights); landing = Insights. `RecomendacionesPage` gana prop `categoria`. typecheck + build + 806 unit verdes. Sin migraciones. PR #248. **Follow-up menor (no REGLA #0):** desglose propio de Rentabilidad/Recomendaciones por módulo = construir cálculos nuevos.

---

## v1.91.0 — 🔎 Auditoría display REGLA #0: Dashboard + Métricas/Rentabilidad + Caja + Billing + Libro IVA (PROD ✅, frontend-only, sin migración)

Auditoría tipo UAT de toda la superficie de **reportería/display de plata** (cada card/tablero: lo que informa vs lo que debería declarar), verificada contra DB real (Jorgito + Buildi). Hilo conductor: las read-models de plata/fiscal usaban bases equivocadas. **Dashboard (overview + 9 áreas):** Posición IVA contaba canceladas/devueltas; "Margen Contribución" era markup sobre bruto pre-descuento; charts ignoraban sucursal y período Custom; toggle s/IVA cosmético (removido). **Métricas + Rentabilidad:** P&L/margen sobre bruto c/IVA (contaba el IVA débito como ingreso), RentabilidadPage excluía `facturada` (ocultaba >50% de las ventas de Buildi), costo actual vs histórico. **Marketing + Envíos:** POAS con "neto" dimensionalmente roto, ganancia de envíos sobre bruto. **Caja:** core sano (arqueo efectivo, vistas consistentes); fix footer "Totales" no aditivo en CajaReportes. **Billing:** badge "Plan actual" nunca matcheaba; `usePlanLimits` no manejaba `-1` (Enterprise) → rompía crear usuarios/productos. **Libro IVA correcto (CAE)** → alineé Posición IVA/Débito del Dashboard a `cae IS NOT NULL` (antes base estado mostraba hasta 2x el Libro IVA). **Criterio unificado:** margen = `(neto−costo)/neto` con `subtotal`; débito fiscal = `cae IS NOT NULL`. + UI: fondo SuscripciónPage negro→violeta→cian. typecheck+build+806 unit verdes. Sin migraciones. **Pendiente GO (MP, no productivo):** self-activate por URL + sin prorrateo de plan.

## v1.90.1 — 🏁 cierre UAT/auditoría REGLA #0 + 4 decisiones de producto resueltas (PROD ✅, migs 243/244/245)

Cierre formal del barrido UAT (`tests/specs/cobertura/00_cierre_uat.md`) + verificación contable real (DEV+PROD: los cierres de caja cuadran, faltantes/sobrantes en `diferencia_cierre`, CC clientes ≥0). Resueltas las 4 decisiones de producto que destapó la auditoría: **#1 (mig 243)** el sweep de reservas vencidas respeta `reserva_penalidad_pct` y acredita la seña−penalidad a `cliente_creditos` (consistente con la cancelación manual); **#3 (mig 244)** armado de KITs ATÓMICO vía RPC (`iniciar/confirmar/cancelar_armado_kit`, INVOKER → RLS por tenant) — antes varios writes sueltos podían dejar componentes consumidos sin KIT; **#2** fusión de LPN asienta el par espejo ingreso+rebaje (ledger neto 0); **#4 (mig 245)** `recepcion_alerta_faltante_dias` re-agregada (la dropeó mig 240) + badge 📦 en lista de OC + input configurable en Config→Compras. Todo DB-validado por impersonación+ROLLBACK. typecheck+build+806 unit verdes.

## v1.90.0 — 🛑 fix REGLA #0: conciliación de cobro Mercado Pago (QR/link → webhook → saldo + caja) (PROD ✅, frontend + EF mp-webhook/mp-ipn)

Módulo (B) del barrido UAT: **Integraciones de cobro**. Code-audit + fix de la conciliación cobro MP, que estaba **rota end-to-end pero latente** (PROD: 0 credenciales MP/MODO conectadas, 0 ventas con `id_pago_externo` → nunca se ejerció). **H1 (💰):** `mp-webhook` insertaba en columna inexistente `payload` (la tabla tiene `payload_raw`) → el pago pre-venta no se aplicaba a `monto_pagado`. **H2 (💰):** el cobro por webhook no asentaba `ingreso_informativo` en caja → ahora el webhook (autoritativo para ventas existentes) lo asienta contra una sesión operativa abierta de la sucursal; pre-venta lo asienta `registrarVenta` (sin doble conteo). **H3/H4:** `mp-webhook` y `mp-ipn` espejadas + `payload_raw` normalizado (toast global revive). **H5:** wiki HMAC corregido. **H6:** MODO = stub no-production-ready. Validación: DB (DEV) + EF compiladas; e2e del cobro real bloqueado por terceros (seller MP OAuth + pago sandbox). Detalle: `tests/specs/cobertura/06_integraciones_cobro.md`.

## v1.89.0 — Devolución/NC al precio efectivo + EF hardening post-CAE + validación todos los medios de pago (PROD ✅, frontend + EF)

Continuación de la auditoría fiscal de Facturación. **#1** la devolución (reembolso a caja) y la NC usaban `precio_unitario` de **lista** → devolver un ítem con descuento (combo o general) reembolsaba/acreditaba de más; ahora usan el precio **efectivo** pagado (`subtotal/cantidad`). **#2** la EF `emitir-factura` ahora **chequea la persistencia del CAE** (`persistirCAE()` reintenta 3× + error con el CAE si falla, anti doble-factura; EF en DEV+PROD). **✅ Validación de TODOS los medios de pago** (spec 83): 7 medios (Efectivo/Transferencia/Tarjeta déb-créd/MP/Cheque/Wallet USD) crean venta + caja correcta. + spec 82.

## v1.88.0 — 🛑 fix REGLA #0 fiscal G0.6: descuento general prorrateado en venta_items (PROD ✅, frontend-only)

El "Descuento general" / multi-combo reducía `venta.total` pero **no** se prorrateaba en `venta_items` → la factura (suma `subtotal`) y la NC (usa `precio_unitario × cantidad`) salían por el monto **sin** descuento → sobre-facturaban. Fix: con descuento global los `venta_items` se guardan con el precio **efectivo** (prorrateado a `venta.total`, `descuento=0`); factura, NC, caja y Libro IVA consistentes. NO-OP sin descuento. 6 unit tests Factura B + smoke real (spec 82, venta #247). AFIP: Kiosco Buildi (RI) emite B con CAE real de homologación.

## v1.87.0 — 🧪 Barrido UAT Compras/OC/Envíos + RRHH/Config/Suscripción 100% REGLA #0 + fixes mig 241/242 (PROD ✅)

Cierre de los 2 módulos restantes del barrido UAT REGLA #0 (`cobertura/04` y `cobertura/05`), todo DB-verificado. **🛑 Encontrado + arreglado un bug REGLA #0 real (mig 241):** `pagar_nomina_empleado` asentaba `egreso` (afecta arqueo de efectivo) para CUALQUIER medio → pagar nómina por transferencia/MP descuadraba el efectivo de la caja; ahora no-efectivo→`egreso_informativo`. **Compras/OC/Envíos:** pago OC contable + doble firma (RPC mig237), pago courier + doble firma (RPC mig238), over/under-receipt (52/74 + 79), devolución efectivo/reposición (77/78), rechazo cheque brazo OC (80), todo por impersonación SQL + ROLLBACK. **RRHH:** pago nómina caja (50+mig241+81), tardanza/cargas/SAC/liq-final (✅unit + gastos pending). **5 specs e2e nuevos (77-81, env-gated).** **Hallazgos a GO:** devolución efectivo sin caja no asienta el reembolso; doble validación de nómina es gate client-side. **Deploy a PROD recomendado por el fix REGLA #0.**

## v1.86.0 — 🧪 Barrido UAT — Clientes/CC 100% + Inventario residual (specs 69-76) (PROD ✅, sin migración, test-only)

**Test-only + wiki (sin cambio de comportamiento de la app; PROD = DEV = migs 001-240).** Continuación del barrido UAT REGLA #0, todo DB-verificado con fixtures en los 2 tenants DEV (Jorgito + Familia Otranto). **Clientes/CC cerrado 100%:** spec **69** revertir condonación, **72** vencimiento CC (`fecha_vencimiento_cc=hoy+N`), **73** crédito a favor positivo (consume `cliente_creditos`), **incobrable SIN clave** (DB-validated en Familia Otranto: DUEÑO procede / SUPERVISOR rechazado por rol). **Productos:** spec **70** alícuota Exento persiste 0 (no 21). **Inventario/Conteos:** spec **71** rebaje no-negativo, **74** over-receipt CON tope (+10% acepta, stock↑), **75** kit desarmar (componentes↑), **76** wall-to-wall bloqueante (POS bloqueado). Convención: las transacciones de prueba quedan como evidencia UAT.

## v1.85.0 — 🐛 fix REGLA #0 picker de cuotas + barrido UAT (Caja/Bóveda, Gastos, Clientes/CC, Productos) (PROD ✅, sin migración)

**Frontend-only** (sin migración; PROD = DEV = migs 001-240). **🐛 Fix REGLA #0 (plata):** el picker de cuotas con interés del POS (`VentasPage`, ISS-086) se gatillaba con `mp.tipo === 'Tarjeta crédito'` (sin "de"), pero el método canónico de Config/fallback/`metodos_pago` es **"Tarjeta de crédito"** → con la config estándar **el picker nunca aparecía** y no se podía aplicar el interés de financiación en el POS. Fix: helper `esTarjetaCredito` que detecta la tarjeta de crédito por normalización (reusa `normalizarNombreMetodo`). **+13 specs e2e del barrido UAT** (todos REGLA #0, DB-verificados, fixtures reversibles): Ventas Tanda B (58-63), Caja/Bóveda (64-67: cierre c/diferencia, cierre ajeno+clave, extracción no-negativo, doble validación B7), Gastos (68 comprobante obligatorio + guards fiscales server-side IVA/período-cerrado DB-validados), Clientes/CC (69 revertir condonación), Productos (70 alícuota Exento persiste 0 no 21). Hallado por el spec 62.

## v1.84.0 — 🔒 Descuento por-ítem read-only (solo combos) + estado "sin clave" visible (H3) + 🐛 fix label Autorizaciones (PROD ✅, sin migración)

**Frontend-only** (sin migración; PROD = DEV = migs 001-240). **(a) Descuento por-ítem read-only** (`VentasPage`, decisión GO): el descuento por ítem lo escriben SOLO los combos (`aplicarCombo`/auto-combo); el descuento manual del operador va por "Descuento general". Cierra la inconsistencia de tenants sin combos. La matemática de subtotal/IVA no cambia. **(b) Estado "sin clave" VISIBLE (H3):** en las acciones rol-only sin clave maestra configurada se muestra el estado (toast 🔓 en VentasPage, nota en CajaPage cierre ajeno, aclaración en InventarioPage reconteo, badge en ConfigPage) — rol-only by-design, sin forzar a configurarla. **🐛 Fix:** la lista de Autorizaciones de inventario rotulaba `ajuste_conteo`/`bulk_edit` como "Eliminar LPN" (engañoso) → "Diferencia de conteo"/"Edición masiva" + detalle. **+3 specs e2e** (50 pagar nómina, 51 aprobación 2-actores, 52 over-receipt) que validan residual Tanda A (REGLA #0).

## v1.83.0 — 🏦 Caja preferida server-side + origen traspaso/depósito + 🧹 limpieza columnas inertes (PROD ✅, migs 239-240)

**Punto 6 de GO:** la caja predeterminada se persiste **por usuario en DB** (mig 239 `users.caja_preferida_id`) en vez de localStorage → auto-selecciona **siempre** en POS + Caja, en cualquier dispositivo. Depósito a Caja Fuerte desde una caja pre-selecciona la caja activa como origen; traspaso caja→caja ya asumía la activa. Convertir presupuesto con 2+ cajas resuelve con la preferida. **Punto 4:** mig 240 dropea 3 columnas inertes de `tenants` (`descuento_max_cajero_pct`, `email_legal`, `recepcion_alerta_faltante_dias`). **PROD = DEV = migs 001-240.**

## v1.82.0 — 🔢 precio_redondeo (H4 cerrado) + descuento máx hueco $ + H4 flags huérfanos (PROD ✅, sin migración)

Cierra el backlog de **flags huérfanos (H4)**. **`precio_redondeo`** (REGLA #0, plata/fiscal): helper puro `redondearPrecio` (10/50/100/500/1000, round-half-up, fail-safe, default `none`) aplicado en el punto canónico `precioTierEfectivo` del POS → subtotal/IVA/`venta_items.precio_unitario`/factura derivan del mismo valor redondeado; también en `actualizarPrecios` (refresh de presupuesto). Sin migración (la columna ya existía). También sube a PROD lo acumulado en `dev` desde el 21/06: descuento máx por rol (cierre del hueco del descuento por $ que esquivaba el tope %), H3 (matriz clave CON/SIN documentada + validada server-side), H4 flags huérfanos (quitados `descuento_max_cajero_pct` y `email_legal`; alerta `boveda_umbral_caja`; tab RRHH de Config). **PROD = DEV = v1.82.0, migs 001-238.** Frontend-only.

## v1.81.0 — 🔐 Guards server-side de plata: RPCs clave-gated (incobrable / pago OC / pago courier) + reorder comprobante (PROD ✅, PR #236, migs 234-238)

Hardening server-side de los controles financieros (REGLA #0 obligación #3), cierra H1/H2 de `uat-app.md`. Migs **234** (cc_guard límite+morosidad) + **235** (rol write-off) — ya en DEV, ahora también en PROD — + **236** `marcar_incobrable()` (rol+clave server-side+write-off atómico) + **237** `registrar_pago_oc()` (doble firma server-side+pago atómico, cierra el hueco "se omite si no hay clave") + **238** `marcar_envios_pagados()` (ídem courier). Frontend: ClientesPage/GastosPage/EnviosPage llaman a los RPCs; comprobante de gasto se sube antes del INSERT (atómico). **PROD = DEV = migs 001-238.**

## v1.80.2 — 🔐 Clave maestra hasheada (mig 233) + 🧪 validación e2e #6/#10/#11 (PROD ✅, PR #235)

**EN PROD** (2026-06-21, PR #235, release v1.80.2). **Seguridad (mig 233):** `tenants.clave_maestra` deja de guardarse en TEXTO PLANO → **bcrypt** (`extensions.crypt`/`gen_salt('bf')`); `verificar_clave_maestra` compara por hash (fallback compat); nuevo RPC `set_clave_maestra` (SECURITY DEFINER, solo DUEÑO, mín 6); `ConfigPage` con campo de confirmación + guarda vía el RPC. Backfill hasheó la única clave plaintext de PROD (preserva el valor). El merge también incorporó a `main` los archivos de migs **231/232/233** que no habían llegado (drift de branch). **PROD = DEV = migs 001-233.** **Validación e2e por click-through con efecto en DB:** #6 NC fiscal (NC electrónica con CbtesAsoc → CAE real homologación, spec 42), #10 Productos (alícuota 10,5% persiste sin convertir a 21%, spec 43), #11 Presupuestos (crear sin tocar stock/caja → convertir a venta con rebaje real PRES-08, spec 44). **Gotcha UX anotado:** convertir presupuesto desde historial con 2+ cajas abiertas no expone selector de caja (no bloqueante).

---

## v1.80.1 — 🔴 Onboarding "Confirm email" ON + drift CHECK/columnas DEV↔PROD (PROD ✅, PR #233/#234, migs 229-232)

**EN PROD.** Disparado por una mala experiencia real de un usuario nuevo en PROD. **Onboarding:** soporta "Confirm email" ON (los datos del negocio van en el metadata + `emailRedirectTo=/onboarding`; el tenant se crea al confirmar). SMTP de Auth → Resend; Site URL = `app.genesis360.pro`. **Reconciliación de drift DEV↔PROD (REGLA #0):** mig 229 (`caja_movimientos_tipo_check` por prefijo), mig 230 (5 CHECKs, incl. `ventas_estado` con 'devuelta' + `notificaciones_tipo`), mig 231 (3 columnas que faltaban en PROD: `ventas.costo_envio`/`clientes.notas`/`movimientos_stock.linea_id`), mig 232 (fix regresión del seed de alta: Sucursal 1 + Caja Principal + 6 unidades). Plan `tests/specs/uat-primer-uso.plan.md` (correr antes de cada alta de cliente).

---

## v1.80.0 — 🎨 Branding single-source (ícono+degradé+hover) + 🔐 autorización de ajustes por rol + 🧾 guards fiscales (PROD ✅, mig 228, EF emitir-factura)

**EN PROD** (PR dev→main, mig 228 en DEV+PROD, EF `emitir-factura` deployada en PROD). **Branding:** ícono nuevo single-source (`brand/logo-source.png` → `BRAND.logo`) en tab/sidebar/landing/suscripción/login/onboarding; componente `PageTabs` (subrayado + degradé violeta→cian + drag-scroll + badge + iconos en Inventario/Proveedores); hover de marca en tabs/sidebar (texto+ícono al degradé, mantiene fondo violeta translúcido); fondos de landing/suscripción/onboarding al degradé (`bg-brand-gradient-hero`); Caja con capital **por moneda** + tab "Caja actual" centrado. **🔐 Autorización de ajustes de inventario POR ROL (mig 228):** DUEÑO directo, resto requiere aprobación, configurable por rol (Directo/Por umbral/Siempre) en Config → Inventario; aplica a Conteo + LPN + edición masiva; `ajusteAutorizacion.ts` +9 tests; tab Autorizaciones de vuelta en básico. **Fiscal:** FAC-27 (EF: Factura B ≥ umbral sin DNI/CUIT → 400), GAS-17 (default Ganancias por condición), PRD-11 (precio ≥ 0), GAS-16 by-design. **CLAUDE.md:** REGLA DE ORO #0 (integridad fiscal/contable/inventario). **UAT:** code-audit finalizado + §29 matriz fiscal por condición para runtime.

---

## v1.79.0 — 🧾 Gastos: automatización fiscal por condición del tenant (PROD ✅, PR #231, mig 227)

El módulo de Gastos cruza el **tipo de comprobante** con la **condición frente al IVA del tenant** (`condicion_iva_emisor`, default Monotributista). **Monotributista/Exento:** comprobante B/C/Ticket, el monto es el total, sin crédito de IVA ni deducción de Ganancias. **RI:** A/B/C/Ticket; **Factura A** discrimina crédito de IVA (alícuota default 21%, 10.5/27/custom) con Neto + IVA automáticos; B/C/Ticket → IVA crédito 0; Ganancias marcable (default on). Columna `tipo_comprobante` (gastos + gastos_fijos) + trigger `fn_gastos_iva_guard` server-side (sanea el crédito salvo RI+Factura A). Aplica a gastos variables y fijos. mig 227 en DEV y PROD.

---

## v1.78.2 — 💵 Efectivo por default + 💰 fix capital bóveda + 🏦 Caja Fuerte UI + 🎨 logo nuevo + 🖥️ Caja full-width + 🟣 degradé de marca (PROD ✅, PR #226, migs 225-226)

Lote de UX + datos. **Efectivo por default (mig 225):** cada tenant nuevo nace con la cuenta de origen Efectivo (en su moneda) + métodos default con Efectivo vinculado (+ backfill). **Fix capital bóveda (mig 226):** `vw_boveda_cuentas` atribuye el efectivo sin cuenta (ventas/gastos) a la cuenta Efectivo → el capital lo refleja. **Caja Fuerte:** 2 tarjetas (saldo bóveda + capital total), selector de cuenta destino en el ingreso, lock de caja-origen en básico. **Logo/iconos nuevos** (favicon + PWA + maskable + sidebar + login). **Caja a pantalla completa** (2 columnas). **Degradé de marca violeta→cian** con lugar único de configuración (vars de `src/index.css`; `bg-accent`→degradé en todos los botones/barras). migs 225-226 en DEV y PROD. typecheck + build verdes.

---

## v1.78.1 — 🧾 Fix alícuota AFIP ≠21% + guard tipo server-side + Exento/select producto + PV Facturación + ✨ tarjeta Capital Caja Fuerte (PROD ✅, PR #225)

Cuatro bugs de facturación, uno **grave y latente**: la alícuota llega de un `numeric` de Postgres como `"10.50"/"0.00"/"27.00"` y no matcheaba `ALICUOTA_ID` → caía a `Id:5` (21%) → **AFIP rechazaba (error 10051)** toda Factura A/B con alícuota ≠ 21 (solo 21% funcionaba, por casualidad; los monotributistas emiten C sin IVA, por eso no se había visto). Fix: normalizar con `String(parseFloat())` en la EF + espejo. Además: **guard fiscal server-side** (Monotributista/Exento→solo C; RI→nunca C; 400 si no), **Exento (0%) ya no se guarda como 21%**, el **select de alícuota refleja el valor guardado**, y **auto-set del punto de venta** al emitir desde Facturación. **✨ UX:** tarjeta de **Capital total** en Caja Fuerte (degradé violeta→cian, estilo Dashboard). EF `emitir-factura` deployada en DEV y PROD. UAT +12 escenarios. 753 unit + build verdes.

---

## v1.78.0 — 🚚 Costo de envío en la factura AFIP + envío en básico solo-costo + restricción tipos A/B/C (PROD ✅, PR #224)

El `costo_envio` cobrado al cliente ahora entra como ítem "Costo de Envío" en la factura (A/B/C) y suma al total (antes quedaba afuera). En Factura A el flete sigue la alícuota del producto; en C va a neto. **Concepto=3 + FchServDesde/Hasta/VtoPago** cuando hay envío (AFIP los exige). Courier pagado directo por el cliente queda afuera. PDF de factura con la línea de envío. **Modo básico:** el envío pasa a ser **solo un campo de costo** (sale en ticket y factura) — sin courier/reparto/dirección y **sin crear registro en Envíos**. **PROD ✅** (EF `emitir-factura` deployada en PROD; frontend `dev→main` PR #224; validado en homologación: Factura C con envío → CAE OK). **+ Restricción de tipos A/B/C por emisor** (Monotributista/Exento → solo C; RI → A/B). También: **🛟 panel interno de soporte desplegado en `admin.genesis360.pro`** (repo `genesis360-admin`, migs 221-224 + EF `admin-api`).

---

## v1.77.0 — 🔔 Fix RLS notificaciones: el INSERT cross-user estaba bloqueado (PROD ✅, mig 219, PR #221)

Pase 3 de la auditoría UAT modo básico (§25-28). La RLS de `notificaciones` bloqueaba el INSERT cross-user → **todas** las notificaciones in-app estaban rotas (solicitud de Caja Fuerte —que además abortaba el pedido del cajero—, diferencia de apertura/cierre de caja, alertas de venta). Apareció además **config drift**: PROD seguía el repo (`notif_user FOR ALL`), DEV tenía policies aplicadas con SQL crudo fuera de migración. La **mig 219** normaliza ambos: SELECT/UPDATE/DELETE solo propias (aislamiento intacto) + INSERT mismo tenant. Sin cambios de frontend. Resto §25-28 verde por código.

---

## v1.76.0 — 🧪 Auditoría UAT modo básico: 7 bugfixes de plata/stock (PROD ✅, sin migración)

UAT exhaustivo de modo básico (`tests/specs/uat-modo-basico.md`, ~300 escenarios) + auditoría por código → 7 fixes: DEV-07 (tope re-devolución), DEV-04 (devolución vs deuda CC / crédito a favor), GAS-01/05 (egreso efectivo robusto), VEN-22 (anti doble-submit), CONTADOR (ve Facturación), PRES-08 (convert re-valida stock), CAJ-18 (no caja negativa, lib `cajaSaldo.ts`). Sin migración.

## v1.75.0 — 🔒 RLS por sucursal a nivel servidor (PROD ✅, migs 216-217-218)

Cierra la deuda técnica #8. El aislamiento por sucursal pasa del cliente al servidor: 23 tablas filtran por sucursal en la DB (antes solo `tenant_id` + blindaje client-side). Helpers `auth_ve_todas_sucursales()`/`auth_user_sucursal()` que espejan `authStore.puedeVerTodas`. Tablas globales/config/finanzas y las que cruzan sucursales por diseño se dejan tenant-only. Sin cambios de frontend. Ver [[wiki/features/multi-sucursal]].

## v1.74.1 — Fix alerta fantasma "sin categoría" en básico (PROD ✅, sin migración)

El badge de Alertas mostraba "1" con la página vacía: `AlertasPage` scopeaba los "productos sin categoría" por sucursal con `ubicaciones!inner`, que en básico (sin ubicaciones) borra todo el stock. Fix mode-aware (básico filtra por `inventario_lineas.sucursal_id`). + reconciliación DEV de 1 línea de devolución con sucursal NULL (Productos "11/12"). Suite 739 verde.

---

## v1.74.0 — Auditoría efectivo↔caja: el efectivo de devolución/venta siempre se asienta (PROD ✅, sin migración)

Bug raíz (venta #26): devolución en efectivo no asentaba el egreso en caja (egreso `void` que fallaba en silencio + sin fallback a la caja única). Fix + auditoría completa de los flujos de efectivo en Ventas (despacho/reserva/saldo/devolución/cancelación): caja = elegida ∥ activa ∥ única abierta, insert awaited, aviso si falla. Cobranza CC y gastos→caja ya estaban cubiertos (v1.69.0). Suite 739 verde.

---

## v1.73.0 — Sucursales en básico (Opción B) + roles + cron sweeps + consolidación de reingreso (PROD ✅, mig 215 + EF cron-sweeps)

**Mig 215** (wrappers all-tenants) + **EF `cron-sweeps`** + workflow `sweeps.yml`. (1) **Issue #10 — sucursal default oculta**: en básico con 1 sucursal se fija como contexto y se oculta el selector (fin del bug "stock devuelto solo en Todas") + origen del ingreso visible en Inventario. (2) **#10b — consolidar líneas de reingreso** en básico (Devolver/Anular suman a la línea existente; bump manual de stock). (3) **#7 — cron sweeps externos**: intereses CC + reservas vencidas para todos los tenants vía EF + GitHub Actions diario (servicios recurrentes quedan asistidos). (4) **Roles**: Super Usuario oculto en básico (una PyME no necesita dos "administrador"). Suite 739 verde.

---

## v1.72.0 — NC fiscal PDF + rol Lector + roles custom Pro + fixes fiscales (PROD ✅, mig 214)

**Mig 214** (`users.rol` CHECK + `VIEWER`). (1) **NC fiscal — Descargar/Imprimir/Email** del PDF de la nota de crédito AFIP (lo que se entrega al cliente; el ticket interno NO es fiscal). `facturasPDF.ts` parametrizado con `clase:'nota_credito'`. (2) **Rol fijo LECTOR (Viewer)** solo-lectura en todos los planes (operación + reportes, sin administración). (3) **Roles personalizados → Pro** (gateados a modo avanzado). (4) **🔴 Fix NC tipo (AFIP 10040)**: la letra de la NC se deriva de la factura original y queda fija (Factura C→NC-C). (5) **🔴 Fix sucursal en reingreso** Devolver/Anular (heredan `sucursal_id` de la venta; antes NULL → invisibles por sucursal) + backfill. (6) **Auto-A/B/C contempla emisor Exento** (→ C). (7) **3 guards fiscales**: no habilitar facturación sin condición IVA emisor + CUIT; Factura B ≥ umbral a CF exige DNI/CUIT; cliente nuevo defaultea CF. (8) Fix ESC del ticket de NC interna. Suite 739 verde + build verde.

---

## v1.71.0 — NC CbtesAsoc + ocultar Anular/Cambiar-cliente con CAE + drag-scroll de tabs (PROD ✅, PR #212)

Sin migración (redeploy EF `emitir-factura`). (1) **🔴 NC fallaba con AFIP 10197**: la NC exige `CbtesAsoc` (referencia a la factura original) → fix EF `CbtesAsoc:[{Tipo,PtoVta,Nro}]`. (2) Con CAE se **ocultan** "Anular" y "Cambiar cliente" (la factura ya está en AFIP a un cliente fijo) → solo "Devolver". (3) **Feature drag-scroll** (`useDragScroll`): las barras de tabs largas (RRHH/Gastos/Inventario) se arrastran con el mouse. Suite 734 verde.

---

## v1.70.0 — Click-through básico (tanda 2): NC electrónica, ESC stack, anular factura con CAE (PROD ✅, PR #211)

Sin migración (redeploy EF `emitir-factura`). (1) **🔴 Emitir NC fallaba siempre** ("sin CAE original") porque la EF no traía `cae` en el SELECT de la venta → la emisión de NC nunca funcionó end-to-end. Fix: `+cae, tipo_comprobante, numero_comprobante`. (2) **🔴 ESC cerraba el modal de atrás** (devolución/NC/cancelar/cambiar-cliente no entraban al stack de `useModalKeyboard`) → ahora ESC cierra el modal visible, uno por uno. (3) **⚠️ Anular venta con CAE** la pasaba a cancelada sin reversar la factura AFIP (libros descuadrados) → bloquea y dirige a Devolver→NC. Suite 734 verde.

---

## v1.69.0 — Auditoría de costuras + click-through básico: 4 bugs (PROD ✅, PR #210)

Sin migración. (1) **Anular venta despachada no restauraba stock** (reembolsaba seña pero no reingresaba, ambos modos) → reingreso al anular espejando Devolver. (2) **🔴 Cobranza CC en efectivo sin caja perdía el pago** (saldaba deuda sin asentar el efectivo) → exige caja ANTES de saldar (raíz `cobranzaCC.ts` + 3 callers). (3) Devolución en básico mostraba "ubicación DEV" → sección WMS oculta. (4) Rebaje/ingreso masivo mostraba LPN/lote en básico → UI WMS de `MasivoModal` gateada por modo. Costuras gasto→caja y servicio-recurrente→gasto auditadas OK. Suite 734 verde.

---

## v1.68.0 — Auditoría modo Básico: 4 bugs de mode-awareness del stock (PROD ✅, PR #209)

Pase de auditoría del modo básico end-to-end (sin migración). En básico el stock tiene `ubicacion_id` Y `estado_id` en NULL; 4 queries filtraban por esas columnas WMS sin gatear por modo. **Reparados:** (1) `VentasPage` reserva→despachada guardaba `stock_antes/despues=0`; (2) **`ProductosPage` mostraba "0 disponible" en todos los productos**; (3) `MasivoModal` rebaje masivo no encontraba stock; (4) **devolución totalmente bloqueada en básico** (exigía ubicación/estado `es_devolucion` inexistentes). Plan de auditoría en `tests/specs/auditoria-basico.plan.md` + e2e `22_devolucion`/`23_inventario_ingreso`. Suite 734 verde.

---

## v1.67.0 — UX: scrollbar tabs + badge Alertas mode-aware + layout RRHH + guardado Config (PROD ✅, PR #208)

Paquete de mejoras de UX (sin migración). **(1) Gastos:** la barra de tabs ya no muestra scrollbar (scroll oculto). **(2) Alertas:** el badge del sidebar (`useAlertas`) y la página se hicieron **mode-aware** — en básico no se cuentan ni muestran las alertas de WMS/compras (LPN vencidos, OC vencidas/próximas), que generaban un "1" fantasma sin nada visible. **(3) RRHH:** layout a **ancho completo** (como Gastos) + los ~12 tabs pasaron de amontonarse (flex-wrap) a **una sola fila scrolleable con iconos**. **(4) Configuración:** se consolidaron los botones "Guardar" repetidos por card en **un solo botón por tab** (Envíos 11→1, Ventas→operativa 5→1).

---

## v1.66.0 — UX: "⋯ Acciones" (ActionMenu) en Proveedores + Inventario (PROD ✅, PR #207)

Continuación del patrón de toolbar mobile-friendly (acción principal visible + secundarias colapsadas en "⋯ Acciones", click no hover). Sin migración. **Proveedores:** se mató el bug de hover-dropdown (`group-hover:block`, no abría en touch) — "Exportar JSON/CSV" → `ActionMenu`; el sub-toolbar de la tab Servicios (Servicios generales / Comparar presupuestos) también se colapsó. **Inventario:** la tab "Agregar stock" pasó de 3 botones (Ingreso / Masivo / ASN) a Ingreso + `ActionMenu[Masivo, ASN]`. Barrido del resto de páginas: no requieren ActionMenu (headers de 1 botón o toolbars de filtros/formatos; Reportes deja sus 3 botones de formato Excel/PDF/CSV).

---

## v1.65.0 — Facturas/ventas recurrentes (PROD ✅, PR #205, mig 213)

Plantillas de venta que se repiten (abono/mantenimiento). Tabla `ventas_recurrentes` (snapshot de ítems + frecuencia + próxima fecha). Generación **asistida y segura**: al vencer, crea un presupuesto ('pendiente', no toca stock/caja) para revisar y facturar. "Convertir en recurrente" desde una venta + panel "Recurrentes" con badge de vencidas, pausar/activar/eliminar y "Generar presupuesto ahora".

---

## v1.64.0 — % Dto. por línea en el presupuesto (PROD ✅, PR #204)

Muestra el descuento por línea (ya guardado en `venta_items.descuento`) en el PDF de presupuesto, con columnas dinámicas. Sin migración.

---

## v1.63.0 — QR de pago MercadoPago en la factura (PROD ✅, PR #203)

**Cierra la paridad con Xubio** con un extra que Xubio no tiene. Sin migración (reusa la EF `mp-crear-link-pago` + `mercadopago_credentials`). Si la factura tiene **saldo pendiente** y el tenant tiene **MercadoPago conectado**, el PDF embebe un **QR "Pagá con MercadoPago — saldo $X"** en el pie; `external_reference = venta_id` → `mp-webhook` concilia el pago automáticamente. Si no hay MP conectado o la factura ya está paga, sale sin QR (graceful). 🎉 **Plan de paridad Xubio completo** (logo · factura completa · presupuesto A4 · remito · datos bancarios/leyenda · Ley 27.743 · pago MP).

---

## v1.62.0 — Comprobantes: presupuesto A4 + factura completa + remito (PROD ✅, PR #201, mig 212)

**Paridad de comprobantes con Xubio + extras de cobro** (cliente Responsable Inscripto que migra). **Mig 212**: datos del emisor en `tenants` (IIBB, inicio actividades, CBU/alias/banco, leyenda, sitio web). (1) **Presupuesto PDF A4 nuevo** (`presupuestoPDF.ts`) — antes solo se imprimía como ticket térmico. (2) **Factura completa**: Ing. Brutos + Inicio Act + contacto, N° con letra, moneda, forma de pago, domicilio del receptor, columna Cód. (SKU), **Régimen de Transparencia Fiscal Ley 27.743 (Factura B)**, "Comprobante Autorizado" + datos para transferencia (CBU/Alias/Banco) + leyenda en el pie. (3) **Remito nuevo** (`remitoPDF.ts`) — nota de entrega no fiscal con "Recibí conforme". (4) Config → Facturación: sección "Datos para los comprobantes". **Único pendiente del backlog Xubio: link/QR de pago MercadoPago** (integración de pagos, deploy dedicado).

---

## v1.61.0 — Logo del negocio en la factura + filename con cliente (PROD ✅, PR #200, mig 211)

**Fase 1 de paridad con Xubio** (cliente Responsable Inscripto que migra). **Mig 211**: bucket `logos` (público, scopeado por tenant). Config → Facturación permite subir/cambiar/quitar el logo (→ `tenants.logo_url`); la **factura lo embebe arriba a la izquierda** (conserva aspecto; si no carga, sale sin logo). El **filename del PDF** ahora incluye el nombre del cliente. Próximas fases: v1.62.0 (datos fiscales emisor + Ley 27.743 + moneda/forma de pago/fecha vto + SKU), v1.63.0 (presupuesto PDF A4), v1.64.0 (detalle por línea).

---

## v1.60.2 — Menú "Acciones" en toolbars + bloqueo Factura A sin CUIT (PROD ✅, PR #199)

**Solo frontend, sin migraciones.** (1) **`ActionMenu`** — componente reutilizable que colapsa las acciones secundarias del header en un botón "⋯ Acciones" (abre con click, no hover → arregla el dropdown de Exportar en mobile/touch; descongestiona el toolbar). Aplicado en **Productos** y **Clientes** (piloto); la acción principal queda visible aparte. (2) **Bloqueo de Factura A** en el POS cuando la venta no tiene cliente con CUIT (Responsable Inscripto). (3) **Mensaje de error real al emitir** (POS/NC/Facturación) en vez de "Edge Function returned a non-2xx status code".

---

## v1.60.1 — Autocompletar email de factura + layout PDF (PROD ✅, PR #198)

**Mejoras de UX sobre la facturación (solo frontend, sin migraciones).** (1) **Enviar factura por email**: reemplaza el `window.prompt` por un modal con el correo del cliente (`clientes.email`) **precargado y editable**, en Ventas (modal post-emisión + detalle/historial) y en el módulo Facturación. (2) **PDF de factura**: el bloque "FACTURA / N° / Fecha" pasa a estar **alineado al margen derecho** (antes pegado al recuadro central del tipo de comprobante).

---

## v1.60.0 — Facturación AFIP production-ready + cert propio + UX/bugfixes (PROD ✅, PR #197)

**"AFIP a PROD" — de preparar el camino a validar la facturación emitiendo CAE real (homologación) de punta a punta.** El módulo operaba contra homologación; esta versión deja el pase a producción listo y seguro, conecta el certificado propio del tenant, y corrige una tanda de bugs/UX. Verificado emitiendo **Factura C real** en homologación ×3 (test Node + app + e2e mutante).

- **Modo de emisión por-tenant** (mig **210**): `tenants.afip_produccion` (default false → homologación). La EF decide homologación↔producción **por-tenant** (reemplaza la env var GLOBAL `AFIP_PRODUCTION`); `AFIP_FORCE_HOMOLOGACION` = freno global. Toggle owner-only en Config con confirmación + guards.
- **Certificado propio por-tenant CABLEADO:** la EF lee `.crt`/`.key` del bucket `certificados-afip` (`tenant_certificates`) y los pasa a AfipSDK por constructor. Modelo final = **AfipSDK cloud + certificado del tenant**. El uploader de Config dejó de ser código muerto.
- **Factura C (Monotributista):** EF no discrimina IVA (`ImpNeto=ImpTotal`, `ImpIVA=0`, sin array `Iva`) + PDF de la C sin columnas de IVA. Fix `tipo_comprobante` "Factura C"→"C" (COD + branch). Fix **ImpTotal = ImpNeto+ImpIVA** (anti error 10048).
- **Auto-facturada:** al emitir el CAE, la venta `despachada` pasa a `facturada` automáticamente.
- **UX:** acciones **Descargar / Imprimir / Enviar email (con PDF)** en el POS post-emisión + detalle + historial; botón **"Emitir factura"** en el detalle si se saltó el prompt; visual del PDF (recuadro + wrap de dirección).
- **Bugfixes generales:** **400** por `venta_items.descripcion` inexistente (rompía descargar/imprimir/email); **recuperación de chunk viejo** tras deploy (vite:preloadError + ErrorBoundary "reading 'default'"); **ESC cierra el modal de arriba primero** (stack en `useModalKeyboard`); **Alertas WMS ocultas en básico** (sin ubicación/proveedor).
- **Tests:** `src/lib/facturacionLogic.ts` + **28 unit** (Factura C incluida), `modalKeyboard.test.ts` (+5), e2e mutante de emisión → suite **734**. EF **v8**.
- **EN PROD** (PR #197, mig 210 + EF v8 aplicadas antes del merge; 4 tenants en homologación). **Para producción real (operativo de GO):** cert de PRODUCCIÓN + token AfipSDK prod + toggle a PRODUCCIÓN.

---

## v1.59.4 — $/km editable en el envío del POS (PROD ✅, PR #196)

En modo básico no existe Config→Envíos para cargar la tarifa por km, así que el modo "Por KM" del envío en el POS quedaba inusable (campo `$/km` read-only en "—"). Ahora el `$/km` es un input editable: pre-cargado con `sucursal.costo_km_envio`/`tenant.costo_envio_por_km` si existe, vacío si no; el costo (km × $/km) se recalcula solo. Funciona en básico (tarifa ad-hoc por venta) y avanzado (override por venta). El modo "$ Monto fijo" sigue como alternativa para el costo total directo. Sin migración.

---

## v1.59.3 — UX Inventario: alineación Cantidad + ESC cierra detalle + autoFocus SKU (PROD ✅, PR #195)

Refinamientos de UX (review GO), sin migración, shortcuts generales (básico+avanzado): (1) alineación de la columna Cantidad en la grilla de stock (regresión de v1.59.1: header `grid-cols-4` vs filas `grid-cols-2` en básico); (2) ESC cierra el modal de detalle de movimiento (ingreso/rebaje/historial); (3) Enter en Agregar/Quitar Stock abre el modal con autoFocus en la búsqueda de SKU.

---

## v1.59.2 — Fix venta en modo básico, parte 2: el ESTADO (PROD ✅, PR #194)

**El bloqueo real de la venta en básico.** v1.59.1 arregló el filtro de ubicación, pero el stock de básico también tiene `estado_id = NULL` y el cálculo de stock disponible (`stockMap` → `agregarProducto`) filtraba `.in('estado_id', es_disponible_venta)` → excluía el stock NULL-estado → `stock_disponible = 0` → bloqueaba con "sin stock" antes del despacho. **Fix:** el filtro de estado aplica solo en avanzado. **Regla:** el stock de básico tiene `ubicacion_id` Y `estado_id` NULL → toda query de venta/disponibilidad debe ser mode-aware. Sin migración.

---

## v1.59.1 — Fix venta en modo básico (bloqueante) + recortes Inventario WMS + e2e caja (PROD ✅, PR #193)

**Fix crítico de primer cliente:** no se podía vender en modo básico (stock sin ubicación). `registrarVenta` surtía filtrando `.not('ubicacion_id','is',null)` en 5 queries → excluía todo el stock básico (NULL). Helper `soloUbicado(q)` aplica el filtro solo en avanzado (WMS). Verificado en DEV (0→10 disponible) + regresión avanzado verde. **Recortes Inventario básico (review GO):** modal de detalle de movimiento sin Estado/LPN · tab Autorizaciones oculto (no hay modal de acciones LPN que las genere) · grilla sin columnas Lote/Venc./Series (grid-cols 4→2) · ajuste +1/-1 por diseño vía Agregar/Quitar. **Testing:** primer e2e mutante de ciclo de caja (apertura+arqueo+cierre, self-healing). UI-only, sin migración.

---

## v1.59.0 — Auditoría pre-cliente: modo básico + seguridad (208/209) + e2e mutante (PROD ✅, PR #191)

**Auditoría pre-primer-cliente (tandas 1+2)** en PROD (migs 208/209 antes del merge, `dev=main`). **Recortes de modo básico (UI):** Productos→**Estructura** (empaque unidad/caja/pallet = WMS) y Configuración→Conectividad→sub-tab **API** ocultos; se mantiene Integraciones (TN/MeLi/MP). **Seguridad (mig 208):** policy SELECT en `planes`, `search_path=public` en 25 funciones, `REVOKE FROM PUBLIC`+re-GRANT en SECURITY DEFINER no públicas (períodos, sweeps CC, clave maestra anti-fuerza-bruta, seeds) → search_path 25→0, rls_no_policy 1→0, anon SECURITY DEFINER 29→15. **Seguridad (mig 209):** buckets `avatares`/`productos` con SELECT scopeado → listado cross-tenant 2→0. **Salud:** react-router-dom 6.30.4 (open-redirect); performance advisors (646) = deuda de escala documentada. **Testing:** recorrido funcional verde + primer e2e MUTANTE de venta; suite **701 unit + 158 e2e**. **Decisiones won't-fix/diferido:** pg_net (no relocatable), RLS por sucursal (0 exposición hoy), leaked-password (toggle de Auth, acción de GO).

---

## v1.58.0 — Modo básico: ocultar superficies internas avanzadas "claras" (PROD ✅, PR #190)

Auditoría de pestañas/sub-módulos que seguían en básico. Se ocultan (modo avanzado): Inventario→Kits · Productos→"Es un KIT" + Precios mayoristas · Gastos→OC, Reportes-compras, Recursos. Se dejan en básico (decisión GO): Conteos, variantes, USD, Bóveda, Cheques, Cierres, Autorizaciones. Sin migración. **Además:** e2e DEPOSITO + CONTADOR habilitados (usuarios de prueba creados en DEV, 27 tests verdes).

---

## v1.57.0 — Modo básico "mínimo mostrador" + auditoría de roles (PROD ✅)

> **v1.55.0 → v1.57.0 deployadas a PROD juntas el 2026-06-13 (PR #189, mig 207).** Los tres bloques abajo describen el feature completo; al deployar, los tenants existentes quedaron en `avanzado` (cero impacto).


El modo básico ocultaba solo 3 módulos; ahora también **Recursos** y **Biblioteca** (empresariales), **Facturación** (solo si habilitada) y **Sucursales** (solo si >1) → básico típico = 12 módulos. La visibilidad del nav se extrajo a `navVisibility.ts` (pura) con matriz rol×modo en tests; en el camino se corrigieron **2 bugs** (`supervisorOnly` ocultaba Recepciones a DEPOSITO e Historial a CONTADOR). **Gap de seguridad cerrado:** rol custom marcado `'ver'` ya no puede mutar (helper `permisosModulo.ts` aplicado en Ventas/Caja/Inventario/Productos/Gastos/Clientes). e2e nuevos para DEPOSITO y CONTADOR. Suite **701**. Sin migración.

---

## v1.56.0 — Modo Básico/Avanzado · F2 superficies internas + F3 sugerencia (PROD ✅, PR #189)

Cierra el feature (F1+F2+F3 completos, falta solo deploy a PROD). **F2**: POS sin picker LPN ni cotización courier · Proveedores sin OC/comparar presupuestos · Config sin tab Envíos / Inventario reducido / Gastos sin gobierno OC · Dashboard sin chip Envíos. **F3**: banner descartable de sugerencia de modo avanzado por rubro (`sugiereModoAvanzado`) con CTA a Configuración. Sin migración. Suite **679**.

---

## v1.55.0 — Modo de operación Básico vs Avanzado (WMS) · F1 (PROD ✅, PR #189, mig 207)

**Dos experiencias en un solo SaaS.** Modo **Básico** (default para tenants nuevos, todos los planes): mostrador simple para kioscos/almacenes/pymes chicas — POS, caja, productos simples, stock simple, clientes, gastos; sin LPN/lotes/series/vencimientos/ubicaciones/OC/envíos. Modo **Avanzado (WMS)**: el sistema completo, toggle del DUEÑO en Configuración gateado a plan **Pro+** (el trial lo prueba). **El modo gatea UI, nunca datos**: el ledger sigue grado WMS por debajo, así el upgrade muestra el historial ya trazable; productos heredados con tracking conservan su flujo aun en básico. Mig **207** (existentes → avanzado, cero impacto). Kill-switch `MODO_BASICO_ENABLED`. Lib `modoOperacion.ts` +14 tests → suite **679**. Detalle en [[wiki/features/modo-basico-avanzado]]. Pendiente: **F2** (POS/Proveedores/secciones de Config) + **F3** (sugerencia en onboarding + copy de planes).

---

## v1.54.0 — Cheques conectados al circuito de pago (PROD ✅)

Ítems #5 y #6 de la auditoría de procesos. Mig **206** (`cheques.gasto_id`). **Pagar OC/gasto con medio "Cheque" crea el cheque vinculado** (mini-form n°/banco/fecha de cobro obligatoria → alerta de próximos a cobrar). **Cheque propio rechazado revierte el pago**: OC vuelve a pendiente/parcial + la deuda reaparece en la CC del proveedor (ajuste auditado); gasto vuelve a pendiente/parcial. Libs `montoChequeDeMedios`/`reversionPagoOC`/`reversionPagoGasto` +11 tests → suite **665**. Además: `process-aging` eliminada (EF muerta) y verificado que `birthday-notifications` ya corre por cron diario de GH Actions (hallazgo de auditoría corregido). PR #186.

---

## v1.53.0 — Traslados de stock entre sucursales: tránsito + confirmación (PROD ✅)

Ítem #4 de la auditoría de procesos — **antes no existía forma formal de mover stock entre sucursales**. Mig **205**: `traslados` + `traslado_items` (snapshot LPN/lote/venc/costo/series, correlativo por tenant). Tab **Traslados** en Inventario: despachar (DEPOSITO+, sale del origen, queda **en tránsito**) → confirmar recepción (solo el destino; entra con el mismo LPN/lote/series) → faltantes auditados (`recibido_parcial`) · cancelar = reingreso. Ledger `movimientos_stock` tipo `traslado` en ambas puntas + Historial de actividad. Lib `trasladoLogic.ts` +22 tests → suite **654**. Decisiones relevadas con GO (tránsito+confirmación · por LPN · destino confirma · parcial auditado). PR #184.

---

## v1.52.0 — Auditoría de procesos: módulos conectados (caja/envíos/devoluciones) (PROD ✅)

Quick wins 1+2+3 de la **auditoría de flujos cruzados** (2026-06-11, verificada contra código). **Sin migraciones.** (1) **Cobranza CC impacta la caja**: las 3 vías (ficha/POS/Caja) registran `ingreso` real si es efectivo o `ingreso_informativo` si no — cierra el descuadre histórico de arqueo; sin caja imputable → warning. (2) **Anular venta cancela sus envíos `pendiente`** (en curso: avisa). (3) **Envío devuelto → CTA "Registrar devolución de la venta"** (`/ventas?id=X&devolver=1`). Lógica pura `movimientoCajaCobranza` +7 tests → suite **632**. Hallazgos restantes de la auditoría (traslado entre sucursales, cheques conectados, EFs huérfanas, cron externo) en `project_pendientes.md`. PR #182.

---

## v1.51.1 — Testing e2e: suite reparada + gobernanza de caja + unit estable (PROD ✅)

Sesión de **testing** (sin cambios de comportamiento de la app, **sin migraciones**). La suite e2e estaba podrida tras ~50 versiones de evolución de UI: **11 smoke tests** reescritos contra la UI real (dashboard, inventario→`/productos`, `/movimientos` huérfano→tabs Agregar/Quitar stock, caja U2 con gate de arqueo, clientes DNI/tel obligatorios + baja A6, suscripción vía avatar, badge de alertas que capea en "9+"). **Tests e2e nuevos de gobernanza de caja** del plan `caja.plan.md` (fuera de alcance unit): A2 apertura a nombre de cajero ajeno + traspaso entre cajas (ISS-193). **Unit:** `vitest fileParallelism:false` (el paralelismo agotaba la RAM y mataba la suite). Verificación: **unit 625/625 · e2e 129/129** · build verde · PR #180. Detalle en `wiki/development/testing.md`.

---

## v1.51.0 — RRHH diferidos: tardanza + fichado QR + portal del empleado (PROD ✅)

Cierre de los 3 pendientes diferidos de RRHH 2.0. **Auto-descuento de tardanza** en la liquidación (`minutosTardeFacturables` desde `rrhh_fichadas` vs `empleados.horario_entrada` + `descuentoTardanza`, config `rrhh_tardanza_modo`/`_tolerancia_min`/`_horas_mes_base`) · **fichado por QR público** `/fichar/:token` (`FicharPage` + `tenants.fichado_token` + RPCs `get_fichado_info`/`fichar_qr` SECURITY DEFINER anon, config QR en RRHH→Asistencia) · **portal del empleado** `/mi-portal` (`MiPortalPage`: recibos/vacaciones/documentos del empleado logueado según `rrhh_portal_capacidades`, nav "Mi Portal"). Mig **204**. +7 tests → suite **625**. **No quedan diferidos de RRHH.**

---

## v1.50.0 — Caja: tanda final (E1/E3/L3/M3/M4) · 🎉 relevamiento Caja A-M COMPLETO (PROD ✅)

Cierre del relevamiento Caja: la mayoría ya estaba en PROD (migs 136-142, hito v1.10.0); esta tanda cierra los ítems chicos que faltaban. **E1** visibilidad de bóveda para roles personalizados (`accedeABoveda`, `caja_fuerte_roles` con `custom:<id>`) · **E3** arqueo manual de bóveda (`boveda_arqueos`, RLS DUEÑO+, modal + historial) · **L3** préstamo a empleado (checkbox + nota firmada en RRHH → Anticipos, `rrhh_anticipos.es_prestamo`/`documento_url`) · **M3** panel de cajero simplificado `/caja/panel` (`PanelCajeroPage`, full-screen touch) · **M4** sonido al cobrar (`sonidoCobro.ts`, Web Audio). Mig **203**. +5 tests (`accedeABoveda`) → suite **618**. PROD vía PR #178 (incluye v1.49.0).

---

## v1.49.0 — Courier: logging diagnóstico + "Probar credenciales" (PROD ✅ vía v1.50.0)

Accionable del Punto 2 (Email+Couriers) sin necesidad de cuenta B2B. **Logging diagnóstico** en `courier-api` (helper `courierFetch`: método + URL + status + body recortado ante error; log inline en SOAP de OCA; log de entrada/catch en el router; **nunca** credenciales) + nueva acción **`probar`** y botón "**Probar credenciales**" por courier en Config → Envíos (`CourierCredencialesPanel`) que valida las claves guardadas con el paso de auth más barato (Andreani→`login`, Correo→`getToken`, OCA→tarifa de muestra). Front `probarCredencialesCourier()`. Sin migración. Build + suite 613 verdes. **Quedó solo en DEV** (decisión GO); `courier-api` deployada a DEV. Pendiente subir a PROD (deploy de la función + PR `dev → main` + release).

---

## v1.48.0 — RRHH RH7+RH8 · 🎉 RRHH 2.0 COMPLETO (PROD ✅)

RH7 documentos obligatorios + vencimiento (E1/E2) · capacitación obligatoria (E3) · **evaluación de desempeño 1-10/360°** (F4) · config portal del empleado (F2) + notificaciones del ciclo (F3) · RH8 **tab Reportes** (costo laboral/asistencia/vacaciones/antigüedad/recibos + export Excel/CSV/PDF) + **liquidación final** al egreso (indemnización LCT 245 + SAC proporcional + vacaciones no gozadas, editable). Libs `rrhhDocumentos.ts` + `rrhhReportes.ts` + `liquidacionFinal.ts` + `RrhhReportesPanel.tsx` + 17 tests → suite 613. Migs 201-202. **RRHH 2.0 (RH1-RH8) COMPLETO.** Diferidos: QR público de fichado + auto-descuento tardanza (RH6) + portal del empleado UI.

---

## v1.47.0 — RRHH RH4+RH5: frecuencia/anticipos + vacaciones 2.0 (PROD ✅)

RH4 frecuencia de liquidación por empleado (**prorratea el básico**) + **anticipos** con descuento automático en la próxima liquidación · RH5 vacaciones 2.0: **días por antigüedad LCT** (sugerencia+override), aprobación con **alerta de aviso + solapamiento**, **remanente auto** con límite. Libs `rrhhLiquidacion.ts` + `rrhhVacaciones.ts` + 18 tests → suite 596. Migs 199-200. **Pendientes RRHH: RH7/RH8 + (RH6) QR público y auto-descuento tardanza.**

---

## v1.46.0 — RRHH RH1+RH2+RH3+RH6: empleados 2.0 · aportes/SAC · nómina contable · asistencia 2.0 (PROD ✅)

RH1 empleados 2.0 (obligatorios, motivo de egreso + reactivar, **tipo de contrato configurable** drop CHECK, datos bancarios) · RH2 **aportes AR configurables por empleado** (checkbox, % en Config) + beneficios extra + **SAC = 50% del mejor sueldo del semestre** · RH3 **nómina contable** (pagar genera gasto en Gastos pendiente + cargas sociales por concepto + recibo PDF + comprobante firmado + doble validación) · RH6 **asistencia 2.0** (fichado, horario por empleado, licencias subdivididas + comprobante, horas extra 50/100%, feriados con regla de pago). Libs `rrhhNomina.ts` + `rrhhAsistencia.ts` + `reciboSueldoPDF.ts` + 20 tests → suite 578. Migs 195-198. **Pendientes RRHH: RH4/RH5/RH7/RH8 + (en RH6) QR público de fichado y auto-descuento de tardanza.**

---

## v1.45.0 — Envíos EN7: envío propio + recursos + reportes/alertas (PROD ✅)

G2 envío propio con **vehículo** (recurso) + KM + **combustible auto-gasto** (suma KM al recurso) · H1 tab **Reportes** (pendientes/atrasados, cumplimiento por courier, pagos/mes, **margen logístico**, distribución por zona/CP, productividad de repartidores) · H2 **Alertas** configurables · H3 export Excel/CSV/PDF + **etiquetas A4** con QR + hoja de ruta PDF. Libs `enviosRecurso.ts` + `enviosReportes.ts` + 17 tests → suite 558. Mig 194. **Cierra Envíos salvo EN6 (integraciones courier, bloqueado por cuentas B2B).**

---

## v1.44.0 — Envíos EN5: creación y alcance (PROD ✅)

A1 DEPOSITO crea envíos · A2 envíos libres sin venta (traslado/muestra/dev_proveedor) · A3 sugerencia de courier por CP · A4 plazo de despacho por canal + badge "Atrasado" · A5 múltiples envíos por venta con desglose (`envio_items`). Lib `enviosCreacion.ts` + 12 tests → suite 541. Mig 193.

---

## v1.43.0 — Envíos EN4: costos y tarifas avanzados (PROD ✅)

B1 recargo horario · B2 factor KM · B3 costo mínimo/escalonado · B4 cobro al cliente (100%/margen/subsidio) · B5 envío gratis condicional · B6 diferencia real vs cotizado a-favor/pérdida (precio al cliente inmutable). Motor `enviosTarifas.ts` + 15 tests → suite 529. Mig 192.

---

## v1.42.0 — Envíos EN3: reparto (repartidores + hoja de ruta) (PROD ✅)

G1 catálogo de repartidores + asignación + productividad. G3/E3 hoja de ruta del día (orden por proximidad/zona, PDF, link agrupado `/hoja-ruta/:token` + cumplimiento). E1 expiración del token config. E2 transportista llamar/WA/incidencia. E4 identidad config. E5 notif "en camino" WA. Lib `enviosReparto.ts` + 8 tests → suite 514. Mig 191.

---

## v1.41.0 — Envíos EN2: POD robusto + cierre de entrega (PROD ✅)

D1 campos POD requeridos configurables · D2 mín. de fotos · D3 firma del receptor (canvas) + DNI + OTP sobre umbral (propio, código al cliente por WA) · D4 geoloc con fallback graceful · D5 sub-estados de no-entrega + motivo · D6 reintento con contador + recargo. RPCs del transportista ampliadas, página del chofer renovada. Lib `enviosPod.ts` + 18 tests → suite 506. Mig 190.

---

## v1.40.0 — Envíos EN1: pagos a courier contables + conciliación (PROD ✅)

C2 gasto automático al pagar courier tercero (Transporte y fletes, IVA crédito fiscal) + egreso de caja si efectivo + link `envios.gasto_id`. C3 tab "Facturas Courier": cargar factura del courier por período + conciliar contra lo registrado + alerta de diferencias (`courier_facturas` + `courier_factura_lineas`). C4 doble firma por umbral con clave maestra. Config → Envíos: toggle gasto + alícuota IVA + umbral. Lib `enviosCourierPago.ts` + 14 tests → suite 488. Mig 189. **Primera fase del relevamiento Envíos (EN1-EN7).**

---

## v1.39.0 — Compras CO8: reportes, alertas, export y calificación · Compras 2.0 completo (PROD ✅)

G1 reportes (tab Reportes en Gastos): compras por proveedor, top productos, aging de pagos, OCs vencidas, evolución de costos. E4 calificación de proveedor (A/B/C). G3 export Excel/CSV/PDF. G2 alerta "bajo mínimo sin OC pendiente". Lib `comprasReportes.ts` + 10 tests → suite 474. Sin migración. **Cierra el plan Compras 2.0 (CO1-CO8).**

## v1.38.0 — Compras CO7b: servicios (PROD ✅)

F1 servicios recurrentes (`servicio_items.recurrente`/`frecuencia`/`proximo_vencimiento`; banner "Generar gasto" con sweep lazy). F2 catálogo genérico del tenant (`proveedor_id` nullable + panel "Servicios generales"). F3 comparar presupuestos lado a lado (agrupa por concepto, marca el más barato). Lib `serviciosRecurrentes.ts` + 11 tests → suite 464. Mig 188.

## v1.37.0 — Compras CO7a: OC inteligente (PROD ✅)

A6 enviar OC al proveedor — PDF (`ocPDF.ts` jsPDF), Email (`send-email`) y WhatsApp (`wa.me`) desde el detalle de la OC. A3 auto-draft desde stock bajo — "Generar OC sugerida" en Alertas consolida productos bajo mínimo por proveedor y crea OCs borrador. +6 tests → suite 453. Sin migración.

## v1.36.0 — Compras CO6: cheques diferidos (PROD ✅)

D4 — gestión de cheques diferidos. Tabla `cheques` (propios emitidos a proveedores / de terceros recibidos), `fecha_cobro` diferida, estados (en_cartera/entregado/depositado/cobrado/endosado/rechazado/anulado) + endoso (pagar a otro proveedor con un cheque de tercero). Nuevo tab **Cheques** en Gastos: registro, transiciones por tipo, endoso, filtros, total pendiente y alerta de próximos a cobrar. Config → `cheques_alerta_dias` (default 7). Lib pura `comprasCheques.ts` + 19 tests → suite 447. Mig 187 (aditiva).

## v1.35.0 — Compras CO5: pago anticipo/contra-entrega + schedule (PROD ✅)

D1 modo de pago por proveedor (`proveedores.modo_pago` contado/anticipo/contra_entrega/cuenta_corriente + `anticipo_pct`) → la OC propone "paga con anticipo" + % al elegir el proveedor (override por OC, snapshot en `ordenes_compra.paga_con_anticipo`/`anticipo_pct`). D2 plan de pagos opcional por OC (`pago_schedule JSONB`, valida suma 100%, guía en el modal de pago). D3 comprobante de transferencia (reusa `ordenes_compra.comprobante_url`). Lib pura `comprasPago.ts` + 16 tests → suite 428. Mig 186 (aditiva).

## v1.34.0 — Compras CO4: devolución a proveedor (PROD ✅)

Entidad separada `devoluciones_proveedor` (+ items). Desde una OC recibida → "Devolver a proveedor": ítems + cantidades, motivo (catálogo) + obs opcional, forma del reembolso: crédito en CC (nota de crédito) / efectivo (ingreso a caja) / reposición (OC nueva borrador). Rebaja stock FIFO + movimiento; valida disponible. Cierra el `tiene_reembolso_pendiente` huérfano. Lib `devolucionProveedor.ts` + 9 tests → suite 412. Mig 185.

## v1.33.0 — Compras CO3: costos (PROD ✅)

E1 alerta de cambio de costo al recibir + el operador decide actualizar (umbral % config) · E2 costos accesorios sueltos en la OC (aduana/comisión/otros) · B6 editar precio en recepción con audit · E3 alta rápida de producto desde la recepción (DUEÑO/SUPERVISOR, pendiente de revisión). Lib `comprasCostos.ts` + 10 tests → suite 403. Mig 184.

## v1.32.0 — Compras CO2: recepción robusta (PROD ✅)

Segunda fase del módulo Compras. **B5 (fix):** el estado de la OC se recalcula desde el acumulado de todas las recepciones confirmadas (no solo la actual) → OC completada en parciales llega bien a `recibida`. + B3 over-receipt umbral % · B4 motivo de faltante + alerta · B1c over/under requiere SUPERVISOR+ · B7 adjuntar remito (bucket privado scoped por tenant) · B2 sin OC exige proveedor. Lib `recepcionLogic.ts` + 13 tests → suite 393. Mig 183.

## v1.31.0 — Compras CO1: gobierno de OC (PROD ✅)

Primera fase del módulo Compras. A1 creación por rol (DEPOSITO solo borradores) · A2 aprobación de OC por umbral antes de enviar · A4 sucursal obligatoria · A5 numeración configurable (default por sucursal) · D5 pago (CONTADOR read-only + doble firma por umbral con clave maestra). Lib `comprasPermisos.ts` + 14 tests. Config en Config → Gastos. Mig 182.

## v1.30.1 — ISS-151: excluir 'Incobrable' del Dashboard (PROD ✅)

Bugfix: el write-off 'Incobrable' (B6) contaba como ingreso en los gráficos de medios de pago → distorsionaba la ganancia. Se excluye junto a los demás pseudo-métodos, unificados en `PSEUDO_METODOS_PAGO`/`esMetodoRealPago` (`src/lib/ccLogic.ts`, +4 tests). Cierra ISS-151 (Condonar/Revertir CC ya estaban en PROD).

## v1.30.0 — Conteos 2.0 · cierre 100% (F2b-ref + F3b + A2) (PROD ✅)

Cierre **100%** de Conteos 2.0 (ISS-CONT).
- **F2b-ref**: escanear un producto fuera del alcance con stock en la sucursal → fila "fuera de alcance" (mercadería mal ubicada); sin stock → aviso hacia Ingreso.
- **F3b**: snapshot de costo por ítem (valorización estable al continuar borradores) + **doble conteo formal** (re-ingreso de filas sobre umbral en columna "Recontar"; saltable con clave maestra SUPERVISOR/DUEÑO).
- **A2**: toggle `conteo_wall_to_wall_bloquea` (default OFF) — el conteo de sucursal completa con confirmación de DUEÑO bloquea ventas (reserva/despacho) y movimientos hasta cerrarlo.
- Mig 181 (aditiva). Build verde, 362 tests verdes.

🎉 **Conteos 2.0 (F1-F4 + refinamientos) cerrado al 100%.**

## v1.29.0 — Conteos 2.0 · F2b (scan-to-count) + F4 (ABC/cíclico/reportes/trazabilidad) — cierre del módulo (PROD ✅)

Cierre de **Conteos 2.0** (ISS-CONT), F1-F4 en PROD.
- **F2b — scan-to-count**: "Escanear para contar" abre cámara persistente que suma a la fila del producto escaneado (cantidad del AI GS1 o +1; reusa el stack GS1).
- **F4 — clase ABC** (auto Pareto 80/95 por valor de movimiento de 12m + override manual), **conteo cíclico sugerido** (días por clase configurables, panel "Conviene contar"), **reportes de exactitud + valorización** ($ faltante/sobrante/neto, por conteo y acumulado + export Excel) y **trazabilidad por operador** (quién contó cada ítem).
- Lógica pura testeada (`conteoAbc.ts`, +16 tests → 362). Mig 180 (aditiva).

Pendientes futuros (no bloqueantes): F2b-refinamiento (alta de fila al escanear fuera de scope) · F3b (doble conteo formal por 2º operador + clave maestra C4 + snapshot de costo) · wall-to-wall A2 (bloqueo POS durante conteo full).

## v1.27.0 — Conteos 2.0 · F3: gate de ajustes + autorizaciones + reconciliación delta (PROD ✅)

Tercera fase de **Conteos 2.0** — el control de los ajustes (lo más sensible para la plata).
- **Gate de aprobación**: las diferencias de un conteo van al tab **Autorizaciones** (`ajuste_conteo`) antes de tocar el stock. Configurable por umbral (unidades/%/$); sin gate → todo a aprobación.
- **Reconciliación por delta**: al aplicar no se pisa el stock — respeta ventas ocurridas durante el conteo.
- **Doble conteo**: aviso al finalizar de las filas que superan el umbral de discrepancia.
- Lógica pura testeada (`conteoAjuste.ts`, +16 tests → 346). Mig 179. `migration-reviewer` + `code-reviewer` en el flujo.

Pendiente: F2b (scan-to-count) · F3b (doble conteo formal + clave maestra) · F4 (clase ABC + cíclico + reportes).

## v1.26.0 — Conteos 2.0 · F2a: modos + conteo a ciegas + unidad de medida + secuencia (PROD ✅)

Segunda fase de **Conteos 2.0**.
- **Modo configurable** (Rápido / Guiado a ciegas / Elegir al crear), en Config → Inventario.
- **Conteo a ciegas**: el operador cuenta sin ver el stock del sistema (anti sesgo de confirmación); revelar fila puntual (DUEÑO/SUPERVISOR).
- **Filas en blanco**: distingue "no contada" (se omite) de "contó cero" (ajusta).
- **Fix**: el campo "Contado" respeta la unidad — enteros en piezas/unidades, decimales en kg/gr (corrige el 15→14,999).
- **`ubicaciones.secuencia`**: orden de recorrido para conteo y picking. Mig 178.
- `migration-reviewer` + `code-reviewer` en el flujo. 330 tests verdes.

Próximas: F2b (scan-to-count) · F3 (gate de ajustes + autorizaciones + doble conteo) · F4 (clase ABC + cíclico + reportes).

## v1.25.0 — Conteos 2.0 · F1: scope por Marca / Categoría / Wall-to-wall (PROD ✅)

Primera fase de **Conteos 2.0** (ISS-CONT, relevado con GO). El conteo de inventario deja de ser solo por ubicación/producto:
- **Por Marca** (lo pedido), **por Categoría** y **Sucursal completa (wall-to-wall)**.
- Mig 177 (`inventario_conteos.tipo` ampliado + `filtros JSONB`). UI con toggle de 5 alcances + carga dinámica.
- Marcas/categorías derivadas del stock de la sucursal; scopes amplios exigen sucursal específica (aislamiento).
- `migration-reviewer` + `code-reviewer` en el flujo (corrigió un cruce de sucursales en wall-to-wall). 330 tests verdes.

Próximas fases: F2 (modos rápido/guiado + ciego + scan + secuencia de ubicación) · F3 (gate de ajustes + autorizaciones + doble conteo) · F4 (clase ABC + cíclico + reportes).

## v1.24.0 — Clientes: C6 segmentación+export + D4 NC manual de proveedor (PROD ✅)

Backlog diferido de Clientes (sin migración).
- **C6 — Segmentación para marketing:** filtros (etiqueta, estado CC, actividad, mínimo comprado, con contacto) + export CSV/Excel de la lista segmentada, en ClientesPage → Reportes. Para enviar desde una herramienta de mailing/WhatsApp externa.
- **D4 — NC manual de proveedor:** form en el modal CC (monto, correlativo `NC-NNNN`, motivo, adjunto) que registra una nota de crédito que reduce la deuda. Cierra el ◑ que dejó CL5.
- `code-reviewer` en el flujo pre-merge. Build verde, 330 tests verdes.

Diferidos restantes: B7 (tope deuda global, "revisar en 3-6 meses"), F2 (fidelización puntos, requiere relevamiento), C3 (envío background, bloqueado por `pg_cron`).

## v1.23.2 — QA: extensión de tests a Caja / Inventario / Ventas (PROD ✅)

Release interno de calidad (sin cambio de comportamiento, sin migración).
- **Caja:** lógica de arqueo extraída a `src/lib/cajaArqueo.ts` (rewire behavior-preserving de `CajaPage.tsx`) + tests de la matriz de permisos `cajaPermisos` (J3/B5/B6). **+57 tests**.
- **Inventario:** tests de `unidades.ts` (conversión kg↔gr / lt↔ml). **+17 tests**.
- **Ventas:** tests de descuento de combo, visibilidad de costo (G4) y umbral de gasto. **+27 tests**.
- Planes en `tests/specs/{caja,inventario,ventas}.plan.md`. **Suite total: 329 unit tests verdes.**

## v1.23.1 — QA: lógica de CC testeable + ecosistema de subagentes (PROD ✅)

Release interno de calidad (sin cambio de comportamiento, sin migración).
- Lógica de cuenta corriente extraída a `src/lib/ccLogic.ts` (función pura, single source of truth) + **50 unit tests** nuevos. Suite total: 228 verdes.
- Plan de escenarios de Clientes en `tests/specs/clientes.plan.md` (41 escenarios).
- **9 subagentes de proyecto** en `.claude/agents/` (relevamiento, spec-extractor, test-author, test-runner, migration-reviewer, code-reviewer, bug-fixer, deploy-runner, wiki-keeper). Ver `wiki/development/agentes-claude-code.md`.

## v1.23.0 — Relevamiento Clientes CL4+CL5+CL6: módulo Clientes COMPLETO (PROD ✅)

Cierre del relevamiento de Clientes. Migrations 175 (CL4) + 176 (CL5); CL6 sin migración.
- **CL4 notificaciones:** email automático al registrar deuda CC (C1) y al pagar (C4); umbral pre-vencimiento configurable (C2); panel de cumpleaños + saludo WA (C5). Config en Config → Ventas → Operativa. Defaults OFF.
- **CL5 CC proveedores:** cuentas bancarias múltiples (D6), PDF estado de cuenta (D3), columnas de NC con correlativo/adjunto (D4).
- **CL6 reportes/audit:** tab Reportes (top clientes, inactivos +60d, aging CC), export Excel (G3), audit log de cambios del cliente (F4).
- **Fix:** autofill del navegador en el buscador de ventas al abrir el modal de clave maestra.
- **🎉 Módulo Clientes CL1–CL6 completo.**

## v1.20.0 — Relevamiento Clientes CL3: incobrables + estado de cuenta (PROD ✅)

Tercera fase del backlog Clientes. Migration 173 + bugfix 174.
- **B6 incobrables:** "Dar de baja incobrable" (DUEÑO + clave maestra) → condona la deuda CC + gasto automático "Deudores incobrables" + audit.
- **B8 estado de cuenta:** PDF descargable + portal público `/cuenta/:token` (sin login, RPC anon).
- **Bugfix (mig 174):** `DROP CONSTRAINT ventas_origen_check` — el canal de venta es configurable desde mig 168 y la constraint rígida rechazaba canales nuevos al vender.
- **Próximo:** CL4 (notificaciones), CL5-CL6.

## v1.19.0 — Relevamiento Clientes CL1 + CL2: datos/permisos + CC clientes (PROD ✅)

Primeras dos fases del backlog Clientes (relevamiento `relevamiento_clientes_respuestas.md`). Migrations 171 + 172.
- **CL1 (mig 171):** baja = soft delete con razón (A6); alerta de duplicado al crear (A2); import con 3 modos + actualización + etiquetas (A5); autocomplete de etiquetas (F1); habilitar CC solo DUEÑO/SUPERVISOR (B2); CONTADOR read-only en Clientes (H2).
- **CL2 (mig 172):** enforcement de límite CC configurable + límite default (B1); vencimiento + interés de mora con recálculo sweep-lazy (B3); morosidad configurable (B4); cobranza FIFO desde ficha + POS + Caja (B5); config nueva en Configuración → Ventas → Operativa.
- **Próximo:** CL3 (incobrables + estado de cuenta PDF/portal), CL4-CL6.

## v1.17.0 — Relevamiento Ventas VF5: edición post-venta + NC interna (PROD ✅)

Quinta y última fase del backlog Ventas H-K (sin migración). **Relevamiento Ventas A-K completo.**
- **H1a**: quitar/editar ítems de una venta cobrada (vía Devolver) requiere DUEÑO/SUPERVISOR/ADMIN; otros roles necesitan la clave maestra para autorizar.
- **H1b**: al ajustar una venta facturada, el comprobante se identifica como "Nota de Crédito interna · no fiscal" + queda en el audit log de la venta.
- Pendiente futuro (fuera del relevamiento): NC electrónica AFIP (L1), venta física en USD (G5).

## v1.16.0 — Relevamiento Ventas VF4: reportes + alertas + export (PROD ✅)

Cuarta fase del backlog Ventas H-K (mig **170**).
- **K1**: 5 reportes nuevos en ReportesPage — baja rotación, más devoluciones, anuladas/devueltas con motivo, comparativa por canal (online/presencial), margen real por venta.
- **K3**: export CSV además de Excel/PDF en cada reporte.
- **K2**: alertas event-driven (margen negativo al cerrar venta; cliente/producto con >N devoluciones en M días) a DUEÑO/SUPERVISOR/ADMIN, con umbrales en Config → Ventas → Operativa.
- Pendiente del backlog: **VF5** (edición post-venta H1 + NC interna). L1 (Top 3) sin responder.

## v1.15.0 — Relevamiento Ventas VF1-VF3: POS operativo + canales + auditoría (PROD ✅)

Primeras 3 fases del backlog Ventas H-K (mig **167-169**).
- **VF1 (H2-H5)**: caja obligatoria en reserva/venta directa incl. 100% CC (solo presupuesto sin caja); flag Consumidor Final vs cliente registrado (cliente obligatorio si factura); enviar ticket por email; reimpresión desde historial.
- **VF2 (I1-I2)**: canales de venta configurables por tenant (online/presencial) + reglas distintas por clasificación (plazo devolución, descuento máx, lista de precios, requisito de cliente). MP deja de ser canal.
- **VF3 (J1-J3)**: audit log por venta (anulación/cambio cliente/override descuento); clave maestra para esas acciones; CONTADOR read-only en Ventas.
- Pendiente del backlog: VF4 (reportes/alertas) + VF5 (edición post-venta + NC interna). L1 (Top 3) sin responder.

## v1.14.1 — Hotfix: registro de negocio nuevo roto por RLS (PROD ✅)

Trigger de seed de `categorias_gasto` no era SECURITY DEFINER → fallaba el alta de tenant. Fix mig 166.

## v1.14.0 — ISS-174: cotización/generación de envíos por API de courier (PROD ✅)

Integración directa con las APIs de los couriers para cotizar y generar envíos (mig **162-165**).
- **F1 fundación**: servicio = select dependiente en POS; catálogo compartido `src/lib/couriers/catalogo.ts`; `courier_credenciales` (credenciales de API por tenant), `tenants.envio_peso_fuente` ('manual'|'producto'); peso/dim en producto; Config → Envíos (toggle peso-fuente + `CourierCredencialesPanel` owner-only).
- **F2-F5 integración**: Edge Function `courier-api` (cotizar/generar/tracking) con adapters **Andreani** (REST), **Correo Argentino** (Paq.ar) y **OCA** (SOAP). Cliente `src/lib/couriers/api.ts`. Cotizar en POS + Envíos; "Generar con courier" + etiqueta + "Actualizar tracking" en Envíos. Credenciales solo server-side.
- **⚠ Pendiente**: validar los adapters con cuentas B2B reales (escritos según docs públicas). Fail-safe sin credenciales.

## v1.13.0 — Relevamiento Ventas E/F/G completo: descuentos por rol + precio USD (PROD ✅)

Cierra el relevamiento de Ventas (mig **161**).
- **G3 — descuentos por rol**: solo DUEÑO/SUPERVISOR/ADMIN aplican descuentos (antes solo se bloqueaba CAJERO); bloqueo de inputs en POS + validación dura (ítem y global); SUPERVISOR sujeto a `descuento_max_supervisor_pct`, DUEÑO/ADMIN sin tope. Config aclarada.
- **G5 — precio en USD**: `productos.precio_usd` + `moneda_venta` ('local' | 'usd'); si es USD, el POS convierte a pesos a la cotización vigente al cargar el producto al carrito. (Venta física en USD/caja USD: fase futura.)

## v1.12.0 — Relevamiento Ventas E/F/G: reservas, presupuestos, mayorista (PROD ✅)

Implementación de las secciones E/F/G del relevamiento de Ventas (mig **159** + **160**).
- **Reservas (E1/E2/E6)**: seña obligatoria + mínima % configurable; vencimiento configurable con **liberación automática de stock** (`liberar_reservas_vencidas`, sweep lazy); cancelación con **penalidad %** + destino **devolución o crédito a favor** del cliente (`cliente_creditos`), gate por rol (E4); **redención** del crédito como medio de pago en el POS + saldo a favor en la ficha del cliente; **motivo de cancelación** con catálogo + observación (E3).
- **Presupuestos (F1/F5)**: correlativo independiente `PRES-{cod}-NNNN` por sucursal; botón "Actualizar presupuesto" on-demand (precios + reset de validez).
- **Listas/B2B (G1/G2/G4)**: precio **mayorista por cantidad** aplicado en el POS (tiers `producto_precios_mayorista`); **costo/margen oculto** para CAJERO/DEPOSITO.
- Config nueva en Config → Ventas → Operativa → "Reservas".

## v1.11.6 — ISS-127: GS1 QR Code como 3ª simbología (PROD ✅)

Los perfiles de códigos compuestos suman **GS1 QR Code** (`bcid gs1qrcode`) además de GS1-128 y DataMatrix. Generación individual y masiva. Sin migración.

## v1.11.5 — ISS-127 Códigos compuestos GS1 (grado WMS) — completo (PROD ✅)

Subsistema nuevo de códigos compuestos GS1 (GS1-128 + DataMatrix), leer/escribir múltiples campos en un código. **3 fases completas** (mig 157+158):
- **F1 — fundación**: `codigo_perfiles` (perfiles GS1/custom por proveedor) + `productos.gtin` + `src/lib/gs1.ts` (parser/encoder GS1) + Config → Inventario → Códigos + generación desde el LPN (`bwip-js`).
- **F2 — lectura ingreso**: detección GS1 (`looksLikeGS1`) + `resolverScanCompuesto` (match GTIN→producto con fallback) + autocompletado en ingreso individual y masivo.
- **F3 — cobertura completa**: DataMatrix lectura (`@zxing/library`) + Ventas/POS + Recepciones + Rebaje (lote→LPN) + modo `directo` (auto-crear LPN) + generación masiva de etiquetas.

## v1.11.4 — Seguridad deps + restyle visual + selección manual de LPN en reservas (PROD ✅)

Release combinado. **Seguridad**: `npm audit` 13→5 vulnerabilidades (jspdf 2→4 crítica, jspdf-autotable 3→5, xlsx → distribución oficial SheetJS, dompurify; las 5 restantes son solo dev-server). **Visual**: fondo de pantalla `#F5F0FF` (lila) → `#F8FAFC` (slate frío) + scrollbars rediseñados (pill flotante con tinte violeta de marca, light+dark). **Reservas (mig 156)**: `venta_items.lpn_plan JSONB` persiste el plan de LPN del carrito; al despachar una reserva se honra la selección manual del operador (Fase A) + autocompleta por sort si cambió el stock (Fase B). Cierra el anti-patrón de reservas (la parte de `stock_actual` ya estaba resuelta desde v1.11.0).

## v1.11.3 — Cierre Trazabilidad-extendida: devoluciones + recall por producto (PROD ✅)

Completa la Trazabilidad-extendida (sin migration, solo código sobre mig 155). Las **devoluciones** ahora se registran en `/historial` (`tipo_transaccion='devolucion'`, agrupadas por transacción, con producto_id + LPN → entran al recall de la unidad). La transición reserva→despacho/devuelta queda clasificada. El filtro "Trazá una unidad" suma búsqueda por **producto (nombre/SKU)** además de LPN/serie.

## v1.11.2 — Trazabilidad-extendida (/historial grado WMS) + aislamiento sucursal (PROD ✅)

Release que junta tres frentes. **Trazabilidad-extendida (mig 155)**: `actividad_log` pasa a ledger grado WMS (Manhattan/Blue Yonder) con `transaccion_id` + snapshots LPN/lote/serie. `/historial` (a) consolida las N filas de una acción en 1 transacción (cabecera + detalle), (b) suma filtro de recall "Trazá una unidad" por LPN/serie cruzando con `venta_item_despachos`, (c) export del set filtrado completo. **Aislamiento por sucursal**: guard de `setSucursal` (3ª capa cliente) + rótulo "Stock total (todas las sucursales)" en vista global. Decisión de diseño: ledger inmutable write-time, no heurística read-time.

## v1.11.1 — Patch ISS-075: manual/auto + stock vendible por sucursal + Inventario→Historial (PROD ✅)

Correctivo tras QA. Sin migrations. (a) `origen` manual/auto correcto (solo LPN elegidos por el operador son manual); (b) stock del movimiento de venta = vendible en la sucursal (no el total global); (c) desglose por LPN en el modal de Inventario→Historial (vivía en InventarioPage, no en la huérfana MovimientosPage, que se eliminó); (d) ingreso/rebaje manual al Historial de actividad portado a InventarioPage.

## v1.11.0 — ISS-075 trazabilidad despacho por LPN + ISS-151 CC + fix race rebaje (PROD ✅)

- **ISS-075** — trazabilidad de despacho: tabla `venta_item_despachos` (desglose por LPN/ubicación/serie de cada ítem vendido + `origen` manual/auto). Visible en detalle de venta, detalle de movimiento y `/historial`. Ingreso/rebaje manual al `actividad_log`. Toggle en Config → Inventario. Migrations 153+154.
- **ISS-151** — Cuenta Corriente: Condonar (write-off) + Revertir (restaura deuda), solo DUEÑO/SUPERVISOR/ADMIN. Dashboard excluye pseudo-métodos (CC/condonación) del mix de medios de pago.
- **Fix race condition (crítico)**: rebaje de venta era paralelo (`Promise.all`) → con el mismo producto en varias líneas del carrito se pisaba. Ahora secuencial. `stock_actual` lo maneja solo el trigger (se removió el update manual que lo desincronizaba). Recalc global de saneo.

## v1.10.4 — ISS-178 rangos horarios + C3/A7 relevamiento Ventas (PROD ✅)

**Estado:** desplegado en PROD ✅
**Fecha:** 2026-05-29
**Migration:** 152 (`envio_rangos_horarios JSONB` + `envios.rango_horario_desde/hasta TIME`) aplicada en PROD pre-merge

### Cambios
- **ISS-178** (Ventas + Envíos + Config · mig 152): rangos horarios de entrega configurables. `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos (8-13 / 13-18 / 18-22). `envios.rango_horario_desde/hasta TIME` como snapshot al momento del envío (no rompe si después se borra el rango de la config). Config → Envíos: card nueva con CRUD inline. VentasPage modal de envío y EnviosPage form: selector. EnviosPage tabla: badge accent con el rango.
- **C3 (parcial)** (POS · relevamiento Ventas A-D): CAJERO ya no puede colocar/editar descuentos por ítem ni descuento general en VentasPage. Inputs `disabled` con tooltip "Bloqueado para CAJERO. Pedile al SUPERVISOR/DUEÑO". Pendiente del mismo C3 (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR.
- **A7** (Devoluciones · relevamiento Ventas A-D): radio "Dejar en DEV para revisión" (default — flujo previo) / "Reintegrar a stock vendible" (línea sin ubicación + `estado_id` = primer `es_disponible_venta`, aparece en alerta "Inventario sin ubicación") en el modal de devolución. Solo afecta a items no serializados.

---

## v1.10.4 — ISS-178 rangos horarios + C3/A7 relevamiento Ventas (PROD ✅)

**Estado:** desplegado en PROD ✅
**Fecha:** 2026-05-29
**Migration:** 152 (`envio_rangos_horarios JSONB` + `envios.rango_horario_desde/hasta TIME`) aplicada en PROD pre-merge

### Cambios
- **ISS-178** (Ventas + Envíos + Config · mig 152): rangos horarios de entrega configurables. `tenants.envio_rangos_horarios JSONB NOT NULL DEFAULT` con seed de 3 rangos típicos (8-13 / 13-18 / 18-22). `envios.rango_horario_desde/hasta TIME` como snapshot al momento del envío (no rompe si después se borra el rango de la config). Config → Envíos: card nueva con CRUD inline. VentasPage modal de envío y EnviosPage form: selector. EnviosPage tabla: badge accent con el rango.
- **C3 (parcial)** (POS · relevamiento Ventas A-D): CAJERO ya no puede colocar/editar descuentos por ítem ni descuento general en VentasPage. Inputs `disabled` con tooltip "Bloqueado para CAJERO. Pedile al SUPERVISOR/DUEÑO". Pendiente del mismo C3 (feature mayor): descuentos automáticos por medio de pago + umbral por monto configurable para SUPERVISOR.
- **A7** (Devoluciones · relevamiento Ventas A-D): radio "Dejar en DEV para revisión" (default — flujo previo) / "Reintegrar a stock vendible" (línea sin ubicación + `estado_id` = primer `es_disponible_venta`, aparece en alerta "Inventario sin ubicación") en el modal de devolución. Solo afecta a items no serializados.

---

## v1.10.3 — ISS-194 caja fuerte + RRHH-A5 + 3 bugs UX (PROD ✅)

**Estado:** desplegado en PROD ✅
**Fecha:** 2026-05-29
**Migration:** 151 (UNIQUE parcial `empleados(tenant_id, user_id)`) aplicada en PROD pre-merge

### Cambios
- **ISS-194** (Caja): `caja_fuerte_roles` default a `['DUEÑO']` (antes incluía SUPERVISOR + SUPER_USUARIO). Estos 2 roles aparecen como toggles habilitables en Config → Caja → Acceso a Caja Fuerte. ADMIN sin acceso. Tenants existentes con el valor viejo conservan su configuración — deben desactivar manualmente si lo prefieren.
- **RRHH-A5** (RRHH · mig 151): selector "Usuario del sistema (opcional)" en el form de empleado + columna "Usuario" en la tabla + validación cliente de duplicados. Habilita "Mi Equipo" del SUPERVISOR sin tocar la BD a mano — antes había que poblar `empleados.user_id` por SQL.
- **ISS-080** (Alertas): AlertasPage filtra por sucursal activa todas las secciones. Cruce client-side para `alertas` (vs PSMSS + `inventario_lineas` en la sucursal) y productos sin categoría (productos con stock activo en la sucursal). Sin schema change — la deuda técnica de `alertas` global queda documentada.
- **ISS-108** (Header / Mobile): selector de sucursal visible en celular. Ícono `Building2` + nombre truncado + `<select>` transparente superpuesto si el usuario `puedeVerTodas`. Antes el selector era `hidden sm:flex` y desaparecía bajo 640px.
- **ISS-148** (Recursos): componente `UbicacionPicker` reemplaza al input libre en los 3 puntos (form crear/editar, modal "Asignar ubicación", edit inline). Select con opciones del histórico filtradas por sucursal + opción "+ Nueva ubicación..." para typing puntual. Sin schema change.

---

## v1.10.2 — Bugfixes ISS-152/173 + caja sin PDF automático (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #120 mergeado `cc5c2073`, release latest, migrations 148-150 aplicadas pre-merge)
**Fecha:** 2026-05-28
**Release:** [v1.10.2](https://github.com/genesis360-app/genesis360/releases/tag/v1.10.2)
**Migrations:** 148 (unidades predefinidas) · 149 (habilitado_ventas/gastos en métodos pago) · 150 (monto_pagado/estado_pago en gastos)

### Cambios
- **ISS-152** (Gastos): selector de caja en nuevo gasto filtra estrictamente por sucursal activa — nunca muestra cajas de otras sucursales.
- **ISS-173** (Ventas): `monto_pagado` en reservas con pago parcial (seña) se calcula desde los medios reales ingresados, no desde `total − CC`. Corrige "Ya cobrado" cuando solo se cobró una seña.
- **Caja**: elimina descarga automática de PDF al cerrar sesión. El PDF de cierre sigue disponible manualmente desde el historial.

---

## v1.10.1 — Cierre HITO v1.9.0 + quick wins Envíos + 10 bugfixes (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #119 mergeado `842d7353`, release latest, migrations 143-147 aplicadas pre-merge, Vercel deploy `dpl_BxMq3Zu9iKEoNjLBEus76jk5xfX5`)
**Fecha:** 2026-05-28
**Release:** [v1.10.1](https://github.com/genesis360-app/genesis360/releases/tag/v1.10.1)
**Migrations:** 143 (cron tokens) · 144 (envio_pod_fotos) · 145 (fix saldo nómina) · 146 (FK traspasos) · 147 (supervisor=empleado)

### Cambios — features
- **Candado 🔒 por fila** en VentasPage y CajaPage: badge ámbar "Cerrado" en cada fila/sesión que cae en periodo contable cerrado, usando `useCierreContable.isPeriodoCerrado(fecha)`. Evita el rebote del toast del trigger DB.
- **PDF descargable del cierre contable** desde `CierresContablesPanel`: header BRAND + datos fiscales + periodo + snapshot tabla (Ventas/Gastos/Sueldos/OC) + resumen (Egresos + Resultado neto). Lee de `cierres_contables.totales JSONB`.
- **Cron limpieza tokens transportista** (migration 143): pg_cron diario 07:00 UTC. NULL en `envios.token_transportista` para envíos entregados/cancelados/devolucion con +30 días.
- **Múltiples fotos POD** (migration 144): tabla `envio_pod_fotos` con RLS + backfill + componente `PodFotosManager` con upload múltiple, thumbnails y eliminar. Integrado en modal POD y modal de edición. Sincroniza la primera foto (orden 0) con `envios.pod_url` para retro-compat.

### Cambios — bugfixes (10 issues)
- **ISS-182/183** (Gastos): comprobante obligatorio + medios de pago que cubran el total se validan al guardar.
- **ISS-184** (RRHH): empleados aparecen al instante tras crear (optimistic update).
- **ISS-195** (Cierre): cierres visibles en historial (quitado `users.email` inexistente del select).
- **ISS-150** (Recepción): precio costo no editable si la OC ya está pagada.
- **ISS-186** (RRHH/Caja) · migration 145: pagar nómina desde bóveda/caja considera traspasos en el saldo.
- **ISS-193** (Caja) · migration 146: corregir un traspaso ajusta la caja origen.
- **ISS-156/175/176** (Envíos): envío cobrado en venta no figura en Pagos Courier; `/transporte` valida pago.
- **ISS-185** (RRHH) · migration 147: supervisor del empleado = otro empleado (FK a empleados).

### Resiliencia
- ErrorBoundary reporta a Sentry + muestra detalle/ID + boundary por-ruta (un crash de página no tumba el menú).

---

## v1.10.0 — HITO Pipeline Reglas Caja CERRADO (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #118 mergeado `c857384b`, release latest, migrations 136-142 aplicadas)
**Fecha:** 2026-05-26
**Release:** [v1.10.0](https://github.com/genesis360-app/genesis360/releases/tag/v1.10.0)

### Cierre del pipeline Caja

8 de 8 decisiones críticas del relevamiento (PDF `relevamiento-caja-reglas-negocio.pdf`) implementadas en 6 versiones consecutivas durante 2 días.

### Migration 142 (esta versión)
- Vista `vw_caja_resumen_diario` (día/caja/sucursal) — sesiones, apertura, ingresos/egresos/ventas, saldo sistema, conteo real, diferencias. Excluye caja fuerte
- Vista `vw_caja_mensual_por_sucursal` (mes/sucursal) — totales, cajas activas, cajeros distintos. Alineada con cierre contable

### Componente `<CajaReportes />` (nuevo)
4 sub-tabs en CajaPage → tab Reportes:
- (a) Diario por caja con filtros fecha + sucursal
- (b) Diario consolidado de todas las cajas
- (c) Mensual por sucursal
- (d) Por cajero (volumen + diferencias 30 días)

3 exports en cada reporte: Excel · PDF · CSV (con BOM utf-8 para Excel ES)

### Fixes adicionales en la sesión
- ConfigPage tab Facturación: toggle auto-guarda con `setTenant(data)` para persistir
- VentasPage: caja predeterminada se pre-selecciona con `useMemo` (sin race con `useEffect`)
- VentasPage: medios de pago dinámicos desde `metodos_pago` (eliminada constante hardcodeada con "Otro" genérico)
- Bóveda: backfill fuzzy + helper `cuentaOrigenDeMetodo` tolerante a variantes de nombre (sin tildes/sin "de")

---

## v1.9.5 — Caja Fase 2.2a: Operaciones especiales (PROD ✅ vía v1.10.0)

**Fecha:** 2026-05-26 · L1/L4/L5/B7/G1 sin migration nueva
- L4: bloqueo cambio sucursal con caja propia abierta (AppLayout)
- L1: selector caja en devolución con efectivo (VentasPage)
- L5: cadena anulación según estado (caja abierta/cerrada/periodo cerrado)
- G1: botón "Corregir" en movimientos manuales con audit log
- B7: doble validación al cierre con cliente Supabase secundario (sin romper sesión)

---

## v1.9.4 — Caja Fase 2.1: Ticket cierre + Diferencias (PROD ✅ vía v1.10.0)

**Fecha:** 2026-05-26 · Migration 141
- `caja_sesiones.numero` correlativo por sucursal con trigger (K3)
- `caja_sesiones.snapshot_totales` JSONB para regenerar ticket idéntico (K2)
- `tenants.diferencia_caja_umbral/alerta_roles/alerta_canales` (B1/B2/B3)
- Vista `vw_diferencias_por_cajero` 30 días (B4)
- Ticket PDF ampliado A4 + formato térmico 80mm (C1+C3)
- Movimiento "Diferencia caja" asociado al cajero responsable

---

## v1.9.3 — Caja Fase 2.0: Permisos + Roles (PROD ✅ vía v1.10.0)

**Fecha:** 2026-05-26 · Migration 140
- `caja_sesiones.abierta_por` (A2)
- `tenants.config_caja JSONB` para permisos opcionales
- RPCs `requiere_clave_maestra` y `verificar_clave_maestra` SECURITY DEFINER (B5)
- Helper `src/lib/cajaPermisos.ts` con matriz J3 completa
- CONTADOR read-only · Abrir a nombre de cajero · Banner caja olvidada 24h · Clave maestra al cerrar ajena · Mail al DUEÑO al cierre

---

## v1.9.2 — Caja Tanda 1.5: Bóveda como billetera del negocio + Extraer dinero (PROD ✅ vía v1.10.0)

**Estado:** desplegado en DEV ✅ ([Vercel READY](https://genesis360-git-dev-tongas86s-projects.vercel.app) · commit `45e46cc7` · migrations 137+138 aplicadas)
**Fecha:** 2026-05-25
**Release:** [v1.9.2](https://github.com/genesis360-app/genesis360/releases/tag/v1.9.2)

### Goal cubierto
La bóveda muestra TODO el capital del negocio categorizado por cuenta de origen (efectivo, débito, crédito, MP, transferencia, etc.). Solo el DUEÑO/ADMIN/SUPER_USUARIO puede extraer dinero con registro privado.

### Migrations
- **137** `137_boveda_retiros_y_backfill.sql` · Tabla `boveda_retiros(id, tenant_id, cuenta_origen_id, monto, tipo_retiro, motivo, notas, usuario_id, movimiento_id, created_at)` con CHECK de 6 tipos (`banco/retiro_personal/gasto/inversion/pago_proveedor/otro`) · **RLS estricta** que exige rol IN ('DUEÑO','ADMIN','SUPER_USUARIO') · Backfill `cuenta_origen_id` en movimientos históricos por concepto `[Nombre Método]` o tipo efectivo · UNIQUE partial index (1 cuenta efectivo por tenant)
- **138** `138_cuentas_origen_seed_metodos.sql` · Auto-seed: crea cuenta_origen por cada método de pago activo no-efectivo (MP/UALA → billetera · Tarjeta/Transferencia → banco · resto → otro) + vincula `metodos_pago.cuenta_origen_id` + re-aplica backfill

### Frontend (CajaPage tab Bóveda)
- **Botón "Extraer dinero"** (rojo, ml-auto) solo DUEÑO/ADMIN/SUPER_USUARIO
- **Modal completo**: selector de cuenta con saldo disponible en label · monto (valida saldo) · tipo de retiro (6 opciones) · motivo obligatorio · notas opcionales
- **Mutation `extraerDeBoveda`**: crea movimiento (`egreso_traspaso` si efectivo o `egreso_informativo` si banco/billetera) con `cuenta_origen_id` · inserta registro en `boveda_retiros` con link al movimiento
- **Sección "Historial de extracciones (privado)"** con borde rojo, último 50 retiros, badge por tipo, cuenta, motivo, notas, usuario, fecha/hora — solo DUEÑO+
- **Card "Capital del negocio · Total $X"** arriba derecha sumando todas las cuentas activas (solo DUEÑO+)
- Eliminada card hardcodeada "Efectivo (caja fuerte)" — ahora viene de `vw_boveda_cuentas` (única fuente de verdad)
- `operarCajaFuerte`: los 4 inserts de traspaso ahora setean `cuenta_origen_id = id cuenta efectivo`

### Datos validados en DEV
- Efectivo: $12.874.811 (86 movs)
- Mercado Pago: $37.228 (10 movs)
- Transferencia: -$958.749 (7 movs)

### Cubre del relevamiento
- ✅ **E4 + E5** del relevamiento Caja del 2026-05-25 (parcial — falta umbral configurable + email/notif)

---

## v1.9.1 — Caja Tanda 1: Cajas por moneda + Cuentas de Origen + sin egreso manual + arqueo pre-cierre (DEV ✅)

**Estado:** desplegado en DEV ✅ (commit `92e0cca5` · migration 136 aplicada)
**Fecha:** 2026-05-25
**Release:** [v1.9.1](https://github.com/genesis360-app/genesis360/releases/tag/v1.9.1)

### Migration 136
- `cajas.moneda TEXT NOT NULL DEFAULT 'ARS'` + índice + seed desde `tenants.moneda` (23 cajas en DEV)
- Tabla `cuentas_origen(id, tenant_id, nombre, tipo, banco, numero, alias, moneda, activo, notas)` con CHECK + RLS tenant + seed cuenta `Efectivo` por tenant
- `metodos_pago.cuenta_origen_id` FK opcional
- `caja_movimientos.cuenta_origen_id` FK + índice parcial
- Vista `vw_boveda_cuentas` con `security_invoker=true`

### Frontend
- **ConfigPage** tab Caja: ABM Cuentas de Origen con edición inline + toggle activo + eliminar con guard de FK
- **ConfigPage** tab Ventas: selector "Acredita en" en cada método de pago + badge `→ Cuenta`
- **VentasPage + GastosPage**: nueva query `metodos_pago_cfg` + helper `cuentaOrigenDeMetodo()` aplicado en los 10 inserts de movimientos informativos
- **CajaPage** tab Bóveda: cards de saldos discriminados por cuenta de origen con icono por tipo + saldo + count + moneda
- **CajaPage** modal Nueva Caja: selector de moneda obligatorio
- **CajaPage**: badges de moneda en pílulas y lista de configuración
- **CajaPage** modal movimiento manual: solo registra ingresos (G2 · sin egreso manual)
- **CajaPage**: arqueo pre-cierre obligatorio (D3 · botón "Cerrar caja" reemplazado por "Arqueo requerido" + validación dura)

### Cubre del relevamiento
- ✅ **F1** (cajas por moneda), **H1** (cuentas de origen + bóveda discriminada), **G2** (eliminar egreso manual), **D3** (arqueo pre-cierre obligatorio)

### Documentos
- PDF generado: `relevamiento-caja-reglas-negocio.pdf` (50 preguntas en 14 secciones) en raíz del repo
- Wiki: `sources/relevamientos/caja_2026-05-25.md` con respuestas A-I + estado de implementación

---

## v1.9.0 — HITO: Reglas Gastos Fases 4 + 5 — Capitalización + Cierre Contable (PROD ✅)

**Estado:** desplegado en PROD ✅ (PR #117 mergeado, Vercel READY, migrations 134+135 aplicadas)
**Fecha:** 2026-05-25

### Migrations
- **134** `gastos.capitaliza_recurso BOOLEAN` con CHECK constraint (TRUE solo si recurso_id IS NOT NULL) + índice parcial · VIEW `vw_egresos_consolidados` (gastos + rrhh_salarios.pagado=true) con `security_invoker=true`
- **135** Cierre contable mensual: tabla `cierres_contables(tenant, periodo, fecha_cierre, cerrado_por, cerrado_por_rol, observaciones, totales JSONB)` UNIQUE(tenant, periodo) + 5 triggers BEFORE UPDATE/DELETE en `gastos/ventas/caja_movimientos/caja_sesiones/ordenes_compra` + RPCs `cerrar_periodo` y `reabrir_periodo` + `gastos.gasto_padre_id` + `gastos.es_correccion`

### Fase 4 — Recursos↔Gastos + Dashboard consolidado
- **Capitalización**: checkbox "Sumar al valor del recurso" en form de gasto (visible solo si hay recurso_id) → `capitaliza_recurso=true` suma al valor patrimonial
- **RecursosPage**: nueva card stats "Mantenimiento acumulado" + chips por recurso "🔧 Mantto" + "📈 Cap." con cantidad de gastos · valor patrimonial = base + capitalizaciones
- **DashGastosArea**: banner "Costo laboral del período (RRHH)" debajo de los 4 KPIs con link a `/rrhh?tab=nomina` + total consolidado Gastos + RRHH
- **RentabilidadPage**: nueva sección "Estado de resultados (período)" con líneas separadas Ventas / CMV / Ganancia bruta / Gastos operativos / **Sueldos pagados (RRHH)** / Resultado neto

### Fase 5 — Cierre Contable Mensual (HITO transversal)
- **DB**: triggers BEFORE UPDATE/DELETE bloquean modificaciones en periodos cerrados con RAISE EXCEPTION SQLSTATE P0001. Helpers `ultimo_cierre_hasta(tenant)` y `periodo_cerrado(tenant, fecha)`
- **RPC `cerrar_periodo`**: DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN. Valida que el periodo sea > último cierre y no esté en curso. Snapshot de totales (gastos, ventas, sueldos, OC) en JSONB
- **RPC `reabrir_periodo`**: solo último cierre + solo DUEÑO/ADMIN/SUPER_USUARIO
- **Frontend**:
  - Hook `useCierreContable()` → `{ ultimoCierre, isPeriodoCerrado(fecha) }` + helper `manejarErrorPeriodoCerrado()`
  - Componente `CierresContablesPanel` con preview live + listado expandible con totales snapshot + botón "Reabrir"
  - Nuevo tab "Cierres contables" en GastosPage
  - Notas de corrección: candado 🔒 reemplaza Editar/Eliminar para gastos cerrados · modal de corrección pre-rellena datos del padre, fecha=hoy, monto negativo permitido · persiste `gasto_padre_id` + `es_correccion=true`
  - VentasPage: handler "Eliminar venta" intercepta y muestra el mensaje del trigger

### Doc nuevo
- `wiki/development/cierre-contable.md` — concepto, schema, triggers, RPCs, hook, componente, casos de uso, pendientes opcionales

---

## v1.8.44 — Reglas de Negocio Gastos Fases 1-3 + Moneda multi-país (PROD ✅)

**Estado:** completado en DEV
**Fecha:** 2026-05-24

### Migration
- **133** `tenants.moneda` (11 monedas LatAm + EUR/USD) + `gastos/gastos_fijos.alicuota_iva` + tabla `autorizaciones_cc` (motivo_bloqueo `limite_excedido | oc_vencida`)

### Nuevas features
- **Moneda principal del tenant** (etiqueta visual, sin conversión): selector en ConfigPage > Mi Negocio. Lista inicial: ARS, USD, CLP, UYU, PYG, BOB, BRL, PEN, MXN, COP, EUR
- **Helper centralizado `src/lib/formato.ts`**: `formatMoneda(monto, moneda)` con símbolo + locale específicos por moneda. Migración aplicada en: Gastos, Caja, Clientes, Envíos, Facturación, Métricas, Rentabilidad, Reportes
- **IVA auto según tipo de comprobante**: al seleccionar Factura A/B/Ticket → 21% · Factura C/Recibo/bienes usados → sin_iva. Solo si tipo_iva está vacío (no sobrescribe selección manual)
- **Selector de alícuota IVA extendido**: 21%, 10.5%, 27%, 0%, exento, sin_iva, personalizado (input numérico)
- **Sucursal obligatoria por categoría**: si la categoría tiene `requiere_sucursal=true` y no hay sucursal activa, bloqueo + aviso amber inline
- **Bloqueo CC con proveedor problemático**:
  - Helper `chequearBloqueoCC(proveedorId, monto)`: detecta OC con CC vencida o saldo + monto > límite_credito_proveedor
  - Modal `SolicitarOverrideCCModal` permite pedir autorización al DUEÑO con motivo
  - Bandeja `BandejaAutorizacionesCC` para que el DUEÑO apruebe/rechace
  - `existeAutorizacionCCAprobada(proveedorId)`: si hay aprobación válida <24h sin usar, se permite continuar sin volver a pedir
- **Sub-tabs en "Autorizaciones"** dentro de GastosPage: Gastos / CC Proveedores

### Pendientes Fase 4-5 (v1.8.45 → v1.9.0)
Ver `wiki/development/reglas-negocio.md` sección "Plan de implementación".

---

## v1.8.43 — Reglas de Negocio Gastos Fase 2: Umbrales + Autorizaciones (PROD ✅ vía v1.8.44)

**Estado:** completado en DEV
**Fecha:** 2026-05-24

### Migration
- **132** `sucursales.umbral_gasto_supervisor/cajero` + tabla `autorizaciones_gasto` (tipo/monto/payload/solicitante_rol/estado/aprobador) + helper SQL `puede_aprobar_autorizacion_gasto`

### Nuevas features
- **Helper `src/lib/umbralGasto.ts`**: `evaluarUmbralGasto(rol, sucursal, monto)` + `puedeAprobar(solicRol, aprobRol)`. Reglas: DUEÑO/ADMIN sin tope · SUPERVISOR umbral configurable (NULL = sin tope) · CAJERO umbral configurable (NULL = todo pide auth) · CONTADOR no crea (solo IVA)
- **SolicitarAutorizacionGastoModal** (componente): se abre cuando el monto supera el umbral del rol; pide motivo y crea registro en `autorizaciones_gasto` con payload completo
- **BandejaAutorizacionesGasto** (componente): nuevo tab en GastosPage visible solo a SUPERVISOR+ con badge de pendientes (refetch 30s). Aprueba ejecutando INSERT/UPDATE/DELETE en gastos según `tipo` + marca aprobada; rechaza con motivo obligatorio
- **SucursalesPage** — bloque "Umbrales de autorización de gastos" con 2 inputs por sucursal (supervisor + cajero)
- **GastosPage** — restricciones de rol:
  - CAJERO ve solo sus propios gastos (filter `usuario_id = user.id`)
  - CONTADOR: aviso 📊 en modal de edición + monto bloqueado + botón "Nuevo gasto" oculto

### Pendientes Fase 3-5 (v1.8.44 → v1.9.0)
Ver `wiki/development/reglas-negocio.md` sección "Plan de implementación".

---

## v1.8.42 — Reglas de Negocio Gastos Fase 1 (PROD ✅ vía v1.8.44)

**Estado:** completado en DEV  
**Fecha:** 2026-05-24

### Migrations
- **130** `categorias_gasto`: catálogo por tenant + seed de 16 categorías + trigger automático + FK opcional en gastos/gastos_fijos
- **131** `tenants.gastos_*`: 7 columnas para reglas de comprobante (4 toggles OR + monto umbral) + días alerta borrador + días alerta anticipo OC

### Nuevas features
- **GastosPage** — selector de categoría dinámico desde tabla `categorias_gasto` (fallback a constante hardcoded)
- **GastosPage tab Fijos** — indicadores de estado por gasto fijo: 🟢 Dentro de fecha · 🟡 Pendiente este mes · 🔴 Atrasado (+Nd) · ✅ Generado este mes
- **GastosPage tab OC** — badge "💰 Anticipo" naranja/rojo cuando hay pago sin recepción (rojo después de N días configurable)
- **ConfigPage tab Gastos** (nueva) — 3 secciones: Reglas comprobante (4 toggles + umbral), Alertas (2 inputs), Categorías (CRUD con `requiere_sucursal` + `activo`)

### Pendientes Fase 2-5 (v1.8.43 → v1.9.0)
Ver `wiki/development/reglas-negocio.md` sección "Plan de implementación".

---

## v1.8.40 — Módulo Envíos completo + fixes integridad inventario (PROD ✅)

**Estado:** desplegado a PROD  
**Fecha:** 2026-05-23 · PR #115

### Nuevas features Envíos
- **ISS-165** Página pública `/transporte/:token` para transportista (sin login, mobile-first)
- **ISS-166** Botón cámara en modal POD — sube foto a Storage `etiquetas-envios/pod/`
- **ISS-167** QR codes en remito PDF (envío esquina superior derecha, venta al lado del DESTINATARIO)
- **ISS-168** LPN y ubicación de mercadería en panel expandido de cada envío
- **ISS-169** Pestaña Pagos Courier — selección múltiple, marcar pagados
- **ISS-171** Bloquea progresión de estado si costo del courier no está pagado
- Número venta coherente Ventas ↔ Envíos (prefijo sucursal opcional, fallback `#global`)
- DashEnviosArea: `en_bodega` en funnel, velocidad real desde POD, insight cancelados

### Fixes críticos integridad inventario
- Cambio de sucursal en VentasPage limpia carrito automáticamente (toast explicativo)
- Query de lineas filtra estrictamente por `sucursal_id` al vender/reservar
- Validación: bloquea venta si hay >1 sucursal y ninguna seleccionada
- Carrito restaurado: re-fetch de lineas dentro del mismo effect (sin race condition)

### Fixes UX
- Autocomplete direcciones con `AutocompleteSuggestion` API (misma que Google Maps)
- Cálculo distancia con Haversine + coords pre-geocodificadas (instantáneo, sin API calls)
- Alertas si dirección de origen o destino no geocodifica con link a corregir
- Stock 0 al restaurar carrito: resuelto definitivamente
- Botón "Compartir transportista" usa `VITE_APP_URL` (link siempre a producción)

### Migrations en PROD
- 127: `envios` — POD fields + estado `en_bodega`
- 128: `envios` — `costo_pagado + fecha_pago_courier + medio_pago_courier`
- 129: `envios.token_transportista` + 3 funciones SECURITY DEFINER públicas

---

## v1.8.39 — POD + en_bodega + fix crítico envíos + corrección totales (DEV ✅)

**Estado:** en DEV · pendiente deploy a PROD  
**Fecha:** 2026-05-21

### Fixes críticos
- **BUG envíos auto-creados**: `cliente_id` inexistente en tabla causaba que el INSERT fallara → ningún envío se creaba al hacer una venta con envío. Fix: campo eliminado.
- **Saldo modal con envío**: `ventaDetalle.total` no incluía `costo_envio` → saldo incorrecto al completar reservas o presupuestos con envío. Fix: usa `total + costo_envio`.
- **Totales en historial**: lista, detalle y ticket ahora muestran `total + costo_envio` (total real pagado).

### Nuevas features
- **Estado `en_bodega`**: nuevo estado entre `en_camino` y `entregado` (paquete en depósito del courier). Badge violeta + icono Warehouse.
- **POD (Proof of Delivery)**: campos `pod_fecha`, `pod_receptor`, `pod_notas`, `pod_url` en tabla `envios`. Modal POD standalone + sección en modal de edición.
- **Fecha de entrega acordada en VentasPage**: nuevo campo en el panel de envío del POS, se guarda en el envío auto-creado.
- **Canal correcto en envío auto-creado**: usa `canalPOS` de la venta (Instagram, Facebook, WhatsApp, etc.) en lugar de hardcodear 'POS'.

### Migration
- 127: `envios` — POD fields + CHECK `en_bodega`

---

## v1.8.38 — Scan ticket IA + fixes Dashboard + ISS-090 CC (DEV ✅)

**Estado:** en DEV · pendiente deploy a PROD

### Nuevas features
- **Scan ticket** (Claude Sonnet 4.6 vision): EF `scan-ticket` analiza foto de ticket de supermercado
  - **RecepcionesPage**: escanear ticket → matcheo contra catálogo → carga automática al formulario de recepción con precio_costo del ticket
  - **ProductosPage**: escanear ticket → validar catálogo → actualizar precio_costo o crear productos nuevos con SKU auto-generado

### Fixes críticos
- **Dashboard Productos/Inventario — KPIs en $0**: columna `categoria` migrada a FK `categoria_id` → queries usaban columna inexistente → 400 → data=null → todo en 0
- **Dashboard rotación/runway = 0**: `movimientos_stock` de ventas creados sin `sucursal_id` → filtro estricto los excluía → rotación 0
- **Banner sucursal en Dashboard**: aviso cuando hay sucursal seleccionada (el selector no aparece en /dashboard) + botón "Ver todo"
- **ISS-090 CC validación**: validar correctamente pagos mixtos CC+efectivo, CC+tarjeta, y 100% CC

---

## v1.8.37 — Gastos/Caja/Config/MODO/ISS-136 (PROD ✅)

**PR #114** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.37  
**Migrations 122–126** aplicadas en DEV y PROD ✅

### ISS-136 — Gastos en Caja (fix definitivo)
- Gastos variables, Gastos Fijos (Generar) y pagos OC registran en caja correctamente
- Efectivo → `egreso` (descuenta saldo) · Otros → `egreso_informativo` (informativo)
- Editar gasto borrador para agregarle pago también registra en caja
- Bloqueo de monto/pago al editar si ya fue a caja
- Reversión automática al eliminar gasto con pago (movimiento inverso)
- Prioriza sesión propia del usuario (evita enviar a caja de otro)

### ISS-110 — Canales de venta
- `ventas_origen_check` extendida con Instagram, Facebook, WhatsApp, Otros (migration 122)

### MODO — Integración completa
- `modo-crear-pago` y `modo-webhook` deployadas en DEV y PROD
- QR interoperable + polling de confirmación + modal redesigned

### ConfigPage — Fases 1-4
- 11 tabs temáticas con grupos (Negocio/Sistema)
- Mi negocio: email legal, redondeo de precios, config por sucursal
- Ventas: comisión % por método, cliente en POS, descuento máx cajero/supervisor
- Caja: contraseña maestra, umbral bóveda
- Métodos de pago desde DB (ISS-133), badge "Borrador" (ISS-138), descuento en OC (ISS-132)

---

## v1.8.31 — Variantes, multi-sucursal completo, Dashboard renovado (PROD ✅)

**PR #113** — mergeado a `main` ✅  
**Migrations 111–121** aplicadas ✅

---

## v1.8.27 — Fix crítico registro nuevo negocio (PROD ✅)

**PR #112** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.27  
**Migrations 109–110** aplicadas en DEV y PROD ✅

- Fix: `fn_crear_caja_fuerte` declarada `SECURITY DEFINER` — el trigger disparaba antes de que el user existiera en `users`, bloqueando el INSERT en `cajas` por RLS
- Migration 109: tabla `modo_credentials` (MODO payments — ISS-072)

---

## v1.8.22 — Cuotas tarjeta + CC parcial + Ticket sucursal + Bugfixes (PROD ✅)

**PR #111** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.22  
**Migration 108** aplicada en DEV y PROD ✅

### v1.8.21 — Bugfixes batch (13 issues)
- ISS-087: ★ visual en caja predeterminada
- ISS-088: fix monto sugerido apertura (monto_cierre confiable)
- ISS-089: selector caja origen en modal Ingresar a Caja Fuerte + validación saldo
- ISS-094: rollback venta CC cuando falla stock
- ISS-097: fix crítico Rules of Hooks en EnviosPage
- ISS-081/082: decimales en ventas + faltante estático al tipear
- ISS-091: badge stock insuficiente en carrito
- ISS-092: carrito recuperado restaura modoCC + clienteCCEnabled desde DB
- ISS-093: tag CC en historial de ventas
- ISS-103: selector canal de venta en POS
- ISS-084: gastos efectivo con caja específica + validación saldo + Caja Fuerte
- ISS-102: clientes y proveedores globales (sin filtro de sucursal)

### v1.8.22 — Features batch (5 issues)
- ISS-085: Número de ticket por sucursal con prefijo (migration 108)
- ISS-086: Cuotas tarjeta de crédito — config bancos en ConfigPage + picker en POS
- ISS-090: CC como método de pago parcial en ventas (pago mixto)
- ISS-095: OC con CC como método de pago parcial (flujo unificado)
- ISS-096: Comprobante de pago en OC — adjuntar PDF/imagen

---

## v1.8.1 — Módulo Recursos + estructura en ingreso + multi-sucursal + fixes (PROD ✅)

### Multi-sucursal — filtrado estricto
- `useSucursalFilter.applyFilter`: `.or(eq+null)` → `.eq()` estricto. Con sucursal activa, datos exclusivos de esa sucursal.
- Opción "Todas las sucursales" en selector del header.
- `authStore`: sentinel `'__global__'` en localStorage para persistir vista global entre recargas.

### Módulo Recursos (migration 089)

### Módulo Recursos (migration 089)
- Nueva tabla `recursos` (patrimonio del negocio, no para vender). Estados: activo/en_reparacion/dado_de_baja/pendiente_adquisicion.
- `RecursosPage` 2 tabs: Patrimonio + Por adquirir. CRUD, stats, alertas garantía, CTA cotizar → /proveedores.
- Sidebar: ícono Landmark, ownerOnly, entre Prov./Servicios y Recepciones.

### Estructura de embalaje en ingreso de stock
- `InventarioPage` modal ingreso: select de estructura preseleccionado con la default del producto.
- `RecepcionesPage`: idem por cada ítem. Carga estructuras async al agregar producto (manual o desde OC).
- Guarda `estructura_id` en `inventario_lineas` en ambos flujos.

### Fixes
- Banner DEV: `h-4 text-[10px]` (~25% más fino) + `mt-4` en AppLayout → no solapa header/sidebar.
- ProveedoresPage: badge estado_pago en cards de OC (rojo/ámbar/azul/vencida).
- EnviosPage: botón WhatsApp fallaba — faltaba `telefono` en join de clientes.

### Housekeeping
- CLAUDE.md reducido de ~1500 a ~120 líneas. Reglas de wiki obligatorias.

**Migration 089 aplicada en PROD** ✅  
**PR #105** — mergeado a `main` ✅  
**Release:** https://github.com/genesis360-app/genesis360/releases/tag/v1.8.1

---

## v1.8.0 — NC electrónicas + email CAE + fixes OC (migration 088)

### Notas de Crédito electrónicas
- `devoluciones` + campos `nc_cae`, `nc_vencimiento_cae`, `nc_numero_comprobante`, `nc_tipo CHECK(NC-A/NC-B/NC-C)`, `nc_punto_venta`
- EF `emitir-factura`: acepta `tipo_comprobante: NC-A|NC-B|NC-C` + `devolucion_id` → guarda CAE en `devoluciones`
- VentasPage: badge verde `NC-B #000001` + botón "Emitir NC" en sección devoluciones del modal

### Email al cliente al emitir CAE
- EF `send-email`: nuevo tipo `factura_emitida` con tabla ítems + badge CAE
- EF `emitir-factura`: fire-and-forget email post-CAE al cliente (solo facturas, no NC)

### GastosPage OC — fixes
- Medios de pago mixtos en OC: N filas + "+ Agregar medio", total en tiempo real, egreso de caja por cada Efectivo
- Fix CC: ya no valida monto, registra saldo como deuda automáticamente
- OC pagadas al fondo con sort + expand ítems

### ProveedoresPage — fix
- "Confirmar OC" solo habilitado con `estado_pago = 'pagada'` o `'cuenta_corriente'`. Con `pago_parcial` muestra tooltip bloqueado.

---

## v1.7.0 — API pull (migration 087)

- EF `data-api` (--no-verify-jwt): GET con `entity`, `format`, `limit`, `offset`, `updated_since`, `sucursal_id`. Entidades: productos/clientes/proveedores/inventario. Auth: X-API-Key. Rate 120 req/min.
- Migration 087: tabla `api_keys` (key_prefix, key_hash SHA-256, permisos TEXT[], activo, last_used_at). RLS tenant + OWNER/ADMIN.
- ConfigPage tab "API" (OWNER/ADMIN): generar key (plain text una sola vez), tabla prefijo + last_used_at, revocar, docs inline.
- Exportar JSON/CSV en ProductosPage, ClientesPage, ProveedoresPage (dropdown, BOM UTF-8).

---

## v1.6.1 — Security hardening + Sentry + OC PDF/CSV (migrations 086 + 086b)

### Security hardening
- `REVOKE EXECUTE FROM PUBLIC` en funciones de trigger/internas
- `REVOKE FROM PUBLIC + GRANT TO authenticated` en funciones de negocio y auth helpers
- `SET search_path = public` en ~35 funciones
- Buckets `avatares` + `productos`: policy SELECT restringida a `authenticated`
- **Resultado:** 80 → 7 warnings en Supabase Security Advisor (7 aceptados by design)

### Sentry
- `@sentry/react` en `src/main.tsx`, `tracesSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`
- Variable `VITE_SENTRY_DSN` en Vercel Production

### OC — fixes
- Cantidad en ítems respeta `unidad_medida`: enteros bloquean `.`/`,`; decimales `step=0.001`
- Botones PDF (jsPDF + autoTable) y CSV (BOM UTF-8) en modal detalle OC. Nombre: `OC_0001_Proveedor.pdf/.csv`

### npm audit: 21 → 7 vulnerabilidades

---

## v1.6.0 — OC gestión de pagos + CC Proveedores (migration 085)

- `ordenes_compra` + `estado_pago` (pendiente_pago/pago_parcial/pagada/cuenta_corriente) · monto_total · monto_pagado · fecha_vencimiento_pago
- Tab "Órdenes de Compra" en GastosPage: lista filtrable, badge rojo/ámbar por vencimiento, modal pago/CC
- ProveedoresPage: Confirmar OC deshabilitado con `pendiente_pago`, botón CreditCard por proveedor → modal CC
- Tabla `proveedor_cc_movimientos` + `fn_saldo_proveedor_cc()` SECURITY DEFINER
- AlertasPage: sección roja "OC vencidas sin pagar" + sección ámbar "OC por vencer en 3d"

---

## v1.5.0 — Notificaciones reales + Caja Fuerte + PDF Factura QR (migration 084)

- Tabla `notificaciones` real con RLS user-only. `NotificacionesButton` con datos reales.
- EF `send-email` tipo `notificacion`. Warning diferencia apertura → notifica supervisores.
- Tab Caja Fuerte + Tab Configuración en CajaPage. `getTipoDisplay()` distingue venta/manual.
- `src/lib/facturasPDF.ts`: PDF A4 con QR AFIP (RG 4291). `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- Pago CC inline: `registrarPagoCC()` FIFO sobre ventas CC.

---

## v1.4.0 — Cuenta Corriente + Presupuesto vencido + Bulk actions (migration 083)

- `clientes.cuenta_corriente_habilitada` + `limite_credito` + `plazo_pago_dias`; `ventas.es_cuenta_corriente`
- Tab "CC" en ClientesPage: KPIs, deuda, botón WA, registrar pago
- VentasPage: botón "Despachar a cuenta corriente" (bypasa validación pago/caja)
- `isPresupuestoVencido()`: badge "Vencido" + banner en modal + "Actualizar precios ahora"
- Bulk actions en ProductosPage: checkboxes + barra flotante (categoría/regla/aging/atributos/desactivar)
- TN Stock Worker: BATCH_SIZE 200, CONCURRENCY 20 → ~2.400 jobs/min

---

## v1.3.0 — Facturación AFIP + Envíos + WhatsApp (migrations 072–081)

- `FacturacionPage` 4 tabs: Panel · Facturación · Libros IVA · Liquidación. EF `emitir-factura` con AfipSDK. Homologación exitosa.
- `EnviosPage` con estados, remito PDF, WhatsApp Click-to-Chat. Prerequisito: `cliente_domicilios` (migration 074).
- `src/lib/whatsapp.ts`: normalización, plantilla configurable, `$ por km`.
- Clientes: notas (append-only), fecha_nacimiento, etiquetas, búsqueda por DNI.
- GastosPage overhaul: IVA, múltiples medios, historial separado, fijos con alerta.
- Proveedores: `proveedor_productos`, `servicio_items`, `servicio_presupuestos`.

---

## Historial comprimido (antes de v1.3.0)

| Versión | Hito principal |
|---------|---------------|
| v0.26.0 | RRHH Phase 1 — empleados, puestos, departamentos |
| v0.27.0 | Caja ↔ Ventas ↔ Gastos integrados |
| v0.32.0 | RRHH Phase 2A — Nómina |
| v0.33.0 | RRHH Vacaciones + Asistencia |
| v0.34.0 | RRHH Documentos + Capacitaciones |
| v0.35.0 | RRHH Dashboard + Phase 5 Supervisor |
| v0.36.0 | Límites de movimientos por plan |
| v0.37.0 | Matriz de features + UpgradePrompt |
| v0.42.0 | Multi-sucursal |
| v0.47.0 | Scanner reescrito (BarcodeDetector + ZBar WASM) |
| v0.51.0 | Scanner definitivo + Completar desde foto (Claude Haiku) |
| v0.57.0 | WMS Fase 1 (estructuras) + Ingreso/Rebaje masivo |
| v0.58.0 | Devoluciones |
| v0.63.0 | Mi Cuenta + restricciones menú por rol |
| v0.65.0 | KITs/Kitting WMS Fase 2.5 |
| v0.68.0 | IVA por producto + Design System Sprint 1+2 |
| v0.69.0 | Dashboard rediseño + FilterBar + La Balanza + Mix de Caja |
| v0.72.0 | Roles CONTADOR + DEPOSITO |
| v0.76.0 | Módulo Proveedores + Órdenes de Compra |
| v0.83.0 | Conteo de inventario + Estructura LPN |
| v0.86.0 | Tab Autorizaciones DEPOSITO |
| v0.87.0 | Combinar LPNs + LPN Madre |
| v0.88.0 | Módulo Recepciones/ASN |
| v0.89.0 | Integraciones OAuth (TiendaNube + MercadoPago) |
| v0.90.0 | TN Webhooks + Sync stock + Monitoring diario |
| v1.0.0 | Stock reservation + pg_cron sync 5min |
| v1.1.0 | Importar maestros extendido + Config UX |
| v1.2.0 | Clientes mejorado (dominios, etiquetas) |

---

## Pendientes / Backlog

> Estado real de PROD/DEV → ver `G360.Wiki/sources/raw/project_pendientes.md`

### Media prioridad
- **Notificación automática CC vencida** — pg_cron diario → INSERT `notificaciones` para clientes/OC vencidas sin pagar
- **OC → Gasto automático** al confirmar recepción en RecepcionesPage
- **Centro de Soporte `/ayuda`** — FAQ por módulo, guías interactivas, form bug-report

### Backlog técnico
- **WMS Fase 3** — `wms_tareas` (putaway/picking/replenishment) + listas de picking con ruta óptima
- **RecepcionesPage completa** — schema existe (migrations 050+059), falta flujo UI completo
- **Sync catálogo TN/ML** — push nombre/precio/descripción hacia marketplaces
- ~~**Courier rates APIs (ISS-174)**~~ — ✅ **Hecho en v1.14.0** (F1-F5: cotizar/generar/tracking por API directa Andreani/Correo/OCA, Edge Function `courier-api`). Pendiente solo: validar adapters con cuentas B2B reales.
- **WhatsApp automático** — espera WABA account

### Pendiente manual (no código)
- Verificar genesis360.pro en Resend → cambiar FROM a `noreply@genesis360.pro`
- Cargar créditos en console.anthropic.com para `scan-product` (Claude Haiku ~$0.0003/img)
- Constitución empresa → CUIT activo (bloquea AFIP en PROD real)
- Google Ads Standard Token (proceso largo)

### Ideas futuras
- Cupones de descuento
- WhatsApp diario automático
- IA chat integrado
- Benchmark por rubro
- Multilenguaje

---

## Links relacionados

- [[wiki/business/modelo-negocio]]
- [[wiki/business/planes-pricing]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/wms]]
- [[wiki/features/envios]]
- [[wiki/features/clientes-proveedores]]
