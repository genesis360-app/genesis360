---
title: Multi-CUIT por tenant (F5)
category: features
tags: [facturacion, afip, multi-cuit, emisores, enterprise, addon]
sources: [planes-pricing.md, facturacion-afip.md, project_pendientes.md]
updated: 2026-07-10
---

# Multi-CUIT por tenant (F5) — diseño y plan por fases

**Estado: Fases 1-6 IMPLEMENTADAS (código v1.127.0). Migs 267-268 en DEV; ⚠ mig 269 (add-on
`cuits`) + deploy de `mp-addon-batch` PENDIENTES de aplicar en DEV (MCP Supabase caído en la
sesión). Falta la prueba real con 2 CUITs (cert de Fede) + precio final del add-on (GO). NADA
en PROD todavía.**

## Por qué

Gap estructural contra la competencia: **Netegia, Zeus y Contabilium soportan 2-10 CUITs** por
cuenta (ver [[wiki/business/planes-pricing]] — quedó como F5 "candidato Enterprise / add-on
premium, después del WSFE propio"). El caso real: un mismo negocio opera con más de una razón
social (p.ej. una SA para mayorista y un monotributo del socio para mostrador) y hoy la única
salida es tener dos tenants separados → duplica stock, clientes, caja y usuarios. **Multi-CUIT =
un solo negocio operativo (stock/clientes/caja/usuarios compartidos) con N identidades FISCALES.**

El prerequisito ya está cumplido: el motor WSFE propio es el default (migs 250/264/265) y varias
piezas se diseñaron multi-CUIT-ready a propósito:
- `afip_wsaa_ta` (cache del TA de WSAA) tiene clave `(cuit, service, environment)` — no por tenant.
- La numeración SIEMPRE sale de `FECompUltimoAutorizado` por (CUIT, PV, tipo) — nunca contador local.
- El dual-provider (`afip_provider`) y el modo homologación/producción ya son flags por-entidad.

## Decisiones de producto (GO, 2026-07-10)

| Decisión | Elección |
|---|---|
| Selección del emisor por comprobante | **Por sucursal + override**: cada sucursal tiene un emisor asignado; el modal de emisión lo muestra como default y permite cambiarlo. La **NC SIEMPRE hereda el emisor de la factura original** (guard server-side, nunca se cruza de CUIT). |
| IVA crédito (gastos) | **También se imputa a emisor**, con default por la sucursal del gasto. Libro IVA Compras / liquidación / Posición IVA 100% separables por CUIT. |
| Monetización | **Add-on "CUIT adicional"** (recurrente, reusa el motor de add-ons batch ya validado). El 1er CUIT incluido en todos los planes. |
| Arranque | Plan + **Fase 1 ya** (modelo de datos neutro en DEV). |

## 🏛️ CUTOVER A FUENTE ÚNICA — ✅ EN PROD (v1.133.0, 2026-07-17, migs 271+272)

**`emisores_fiscales` es LA fuente de verdad de toda identidad fiscal.** El trigger transicional
tenants→emisores de la mig 267 se eliminó y el espejo se **invirtió**: el emisor default espeja a
`tenants.*` (que quedó de **solo lectura legacy** hasta el DROP de sus columnas fiscales — Fase 4).
Guards en DB: el emisor default no se puede borrar (salvo el cascade del tenant) ni desactivar (P0001).

- **PDFs** (`camposEmisorPDF`, `src/lib/emisorPdf.ts` — único armador): identidad por
  `ventas.emisor_id` · **NC siempre por su factura original** · **PV impreso POR emisor** ·
  documento fiscal sin identidad completa **no se imprime** (lanza, sin defaults inventados) ·
  regla #7: un emisor luego desactivado sigue imprimiendo SU identidad en sus comprobantes.
- **Escritores**: ConfigPage (ARCA) escribe en `emisores_fiscales`; el panel de Emisores edita
  también al **principal** (ambos escriben el MISMO registro → no pueden divergir; el form de ARCA
  se re-sincroniza vía efecto). Guard e2e: spec `87` (incluye test multi-CUIT con datos reales).
- **⚠ Gotcha de deploy**: la mig 271 fue **BREAKING para el frontend viejo** (que escribía en
  tenants) → se aplicó a PROD **pegada al merge** del PR #292, no aditiva-días-antes.
- **Auditoría de drift** (correr periódicamente, debe dar 0): query al final de
  `supabase/migrations/271_identidad_fiscal_fuente_unica.sql`.
- **F3b — 🟡 CODEADO EN DEV (2026-07-17), SIN COMMITEAR, pendiente de que GO lo pruebe en el dev
  server:** la sección ARCA de `ConfigPage` pasa a **resumen readonly + botón "Editar en Emisores
  fiscales"** cuando el tenant ya tiene CUIT (`EmisoresFiscalesPanel.editarPrincipal()` vía
  `forwardRef`); con CUIT vacío (alta nueva) sigue siendo el formulario completo (el panel no puede
  crear el emisor PRINCIPAL). 🛑 De paso se encontró y corrigió un bug REGLA #0: `handleSaveBiz`
  (los botones "Guardar" de otros tabs) seguía escribiendo identidad fiscal DIRECTO a `tenants`,
  reabriendo el drift que la mig 271 no bloquea a nivel DB (solo por convención). Detalle completo en
  `log.md` `[2026-07-17] update | 🧵 F3b + variantes talle/color FUNCIONALES`. **Nada de esto está
  commiteado, mergeado a `main` ni en PROD.**
- **Pendiente**: F4 (DROP físico de las columnas fiscales de `tenants`: grep lectores=0 + drift 0
  sostenido + soak; los lectores no-PDF —Gastos/Dash/Cierres— hoy leen tenants vía espejo, correctos).

## Modelo de datos (mig 267 — Fase 1)

**Tabla nueva `emisores_fiscales`** — una identidad fiscal del tenant. Absorbe los campos
fiscales que hoy viven en `tenants`:

```
emisores_fiscales
  id uuid PK · tenant_id FK → tenants
  nombre                    -- etiqueta interna (p.ej. "Otranto SA")
  cuit (UNIQUE por tenant) · razon_social_fiscal · condicion_iva_emisor (RI/Mono/Exento)
  domicilio_fiscal · ingresos_brutos · inicio_actividades · umbral_factura_b
  afip_produccion · afip_provider ('propio'|'afipsdk') · afipsdk_token
  banco · cbu · alias_cbu · leyenda_comprobante · logo_url   -- datos del PDF, por razón social
  es_default (UNIQUE parcial por tenant) · activo · created_at/updated_at
```

**Columnas nuevas en hijos** (todas nullable, FK a `emisores_fiscales`):
- `tenant_certificates.emisor_id` — el certificado firma por UN CUIT.
- `puntos_venta_afip.emisor_id` — los PV de AFIP son por CUIT (PV 1 del CUIT A ≠ PV 1 del CUIT B).
- `sucursales.emisor_fiscal_id` — la asignación sucursal→emisor (regla de default).
- `ventas.emisor_id` — con qué emisor se emitió el comprobante (lo setea la EF al persistir el CAE).
- `gastos.emisor_id` — a qué CUIT se imputa el IVA crédito.
- `devoluciones`: SIN columna — el emisor de la NC es SIEMPRE el de la venta (derivable por join).

**Backfill neutro:** cada tenant con `cuit` recibe UN emisor `es_default=true` copiado de sus
campos actuales; los hijos existentes (certs, PV, sucursales, ventas con CAE, gastos deducibles)
quedan linkeados a ese default. Con 1 emisor, el comportamiento es idéntico al actual.

**Sync transicional (trigger `fn_sync_emisor_fiscal_default`):** mientras la UI siga escribiendo
los campos fiscales en `tenants` (Fases 1-2), un trigger AFTER INSERT/UPDATE en `tenants` upsertea
el emisor default → la tabla nueva nunca queda stale. **Se elimina en la Fase 3** cuando la UI
pase a escribir en `emisores_fiscales` directamente (cutover de source of truth).

**Qué queda en `tenants`:** `facturacion_habilitada` (toggle del módulo, no es por CUIT) y los
datos de contacto del negocio (`telefono`/`email`/`sitio_web`). Las columnas fiscales legacy se
mantienen durante la transición y se deprecan al final (nunca se dropean sin release dedicada).

## Resolución del emisor (regla única, server-side)

```
emisor de una FACTURA  = body.emisor_id (override del modal)
                       ?? sucursal_de_la_venta.emisor_fiscal_id
                       ?? emisor default del tenant
emisor de una NC       = ventas.emisor_id de la factura original (SIN excepción — guard 400 si el
                         body manda otro)
emisor de un GASTO     = elegido en el form ?? sucursal del gasto ?? default
```
La EF valida SIEMPRE que el emisor pertenezca al tenant (mismo patrón que el guard de identidad
v1.125.0) y que esté `activo`.

## Fases

| Fase | Contenido | Riesgo | Estado |
|---|---|---|---|
| **1 — Modelo de datos (neutro)** | Mig 267: tabla + backfill + FKs + índices + RLS + trigger de sync. CERO cambio de comportamiento (nada lo lee todavía). | Bajo | ✅ DEV (2026-07-10) · PROD al deployar F2 |
| **2 — EF `emitir-factura` multi-emisor** | La EF resuelve el emisor (regla de arriba) y toma cuit/condición/cert/token/provider/produccion/umbral DEL EMISOR. Persiste `ventas.emisor_id`. Guards por emisor + guard de PV por CUIT + NC hereda emisor. Con 1 emisor = mismo flujo actual. **Mig 268**: cert único POR EMISOR + PV único por (tenant, emisor, número). ⚠ Lección de la validación: el guard de letra debe correr DESPUÉS de la resolución completa (un guard "preliminar" con el default rechazaba B en una sucursal asignada a un emisor RI con default Mono) → la venta se fetchea con `maybeSingle` y "Venta no encontrada" se lanza recién después de los guards (preserva la semántica del spec 56). | **Alto (REGLA #0)** | ✅ DEV v23 (2026-07-11): smokes 6/6 (letra por override, PV por CUIT, cert por emisor, 403 cross-tenant, herencia NC, resolución por sucursal) + regresión e2e 21/42/56/86 10/10 |
| **3 — UI Config (emisores adicionales)** | **Alcance ajustado en la implementación:** el form "Facturación Electrónica" existente SIGUE editando el emisor PRINCIPAL (escribe `tenants.*` y el trigger de mig 267 lo espeja — sin cutover total, cero riesgo de drift ni de romper los readers legacy del POS/PDF/dashboards). Lo nuevo: `EmisoresFiscalesPanel` (CRUD de emisores ADICIONALES + cert y PV por emisor + asignación sucursal→emisor + "sin cert/con cert" + activo/eliminar con guard de comprobantes) + las secciones existentes de cert/PV ahora escriben `emisor_id` del principal. El cutover total del form queda diferido a F4/F5 (cuando se migren los readers). | Medio | ✅ DEV (2026-07-11) |
| **4 — Selección en el flujo de venta** | ✅ Modal de emisión (POS `VentasPage` + `FacturacionPage`) muestra el emisor default de la sucursal con selector de override + **confirmación explícita (checkbox)** si se cambia (emitir con el CUIT equivocado es irreversible). Las letras (`tiposComprobantePermitidos`) y el umbral B se recalculan según la condición DEL EMISOR elegido; los PV ofrecidos son los del emisor (por CUIT). Envía `emisor_id` a la EF. Con 1 emisor no se muestra nada (hook `useEmisoresFiscales.multiEmisor`). Pendiente menor: los PDFs siguen tomando datos del emisor principal (razón social/logo) — F4b. | Alto (UX fiscal) | ✅ código (v1.127.0) |
| **5 — Reportes fiscales por emisor** | ✅ Selector de emisor en el header de `FacturacionPage` (KPIs del panel, Libro IVA Ventas/Compras, liquidación 12m — todo por CUIT vía `ventas.emisor_id`/`gastos.emisor_id`; NC por el emisor de su factura; filas legacy sin emisor cuentan como del principal). Gastos: `emisor_id` en el alta (variable + fijo) por la sucursal del gasto. Pendiente menor: Posición IVA del Dashboard/DashFacturacionArea todavía sin selector (usa todos los emisores) — F5b. | Medio | ✅ código (v1.127.0) |
| **6 — Monetización (add-on)** | ✅ Dimensión `cuits` en `fn_plan_base_limite` (base 1 en todos los planes) + trigger `fn_enforce_limite_cuits` (el emisor default no consume cupo; bloquea activar el adicional N+1 sin add-on) — **mig 269** · pack fijo "CUIT adicional" en `ADDON_PACKS` (brand.ts + espejo EF `mp-addon-batch`, con conteo especial que excluye el default) + configurador (`PricingConfigurator` DIMS) · gate/upsell en `EmisoresFiscalesPanel` (captura el error de límite server-side). ⚠ **Precio PROVISORIO** ($20k/$35k/$45k por 1/2/3) — GO confirma antes de PROD. | Medio | ✅ código (v1.127.0) · ⚠ mig 269 + EF sin aplicar en DEV |

Cada fase se deploya con su release y UAT propio (patrón [[feedback_features_grandes_por_fases]]).

## Riesgos REGLA #0 (no negociables)

1. **NC cruzada de CUIT = comprobante inválido ante AFIP** → el emisor de la NC se deriva SIEMPRE
   de la factura original server-side; el body no puede overridearlo (400).
2. **Emitir con el CUIT equivocado es irreversible** (solo se "arregla" con NC + re-factura) →
   default por sucursal + confirmación explícita en el override + el emisor elegido visible en el
   modal ANTES de emitir.
3. **Certificado de un emisor NO firma por otro** → cert lookup por `emisor_id` (no por tenant);
   guard "emisor sin cert activo" (igual al actual pero por emisor).
4. **Libro IVA / posición por CUIT**: débito y crédito del MISMO emisor (v1.125.0 ya dejó los
   libros por CUIT completo — con multi-CUIT el selector filtra por emisor, nunca mezcla).
5. **Numeración**: ya es remota por (CUIT, PV, tipo) — cero riesgo de colisión entre emisores.
   ⚠ PV es por CUIT: el modal debe listar SOLO los PV del emisor elegido.
6. **Gasto sin emisor con >1 emisor activo** = crédito mal imputado → obligatorio cuando hay
   multi-emisor (con default por sucursal); con 1 emisor sigue siendo implícito.
7. **TA de WSAA por certificado**: ya resuelto (cache por cuit) — dos emisores nunca comparten TA.

## Testing por fase

- **F1:** ✅ queries de verificación del backfill (emisor default = campos del tenant; hijos linkeados).
- **F2:** ✅ unit del resolver (`src/lib/emisorFiscal.ts`, 15 tests FAC-EMISOR-01→15) + regresión
  e2e 21/42/56/86 (10/10, CAE y NC reales por el resolver nuevo) + smokes 6/6 con un emisor fake B
  (RI, sin cert) en Jorgito: letra por override (RI rechaza C que el default Mono permitiría —
  prueba que la resolución manda), PV por CUIT, cert por emisor, 403 emisor de otro tenant,
  herencia de NC, y resolución por sucursal (encontró y arregló el bug del guard preliminar).
  **⬜ PENDIENTE: prueba real con 2 CUITs distintos** (⚠ requiere el certificado/CUIT de Fede —
  mañana; cargarlo como emisor adicional en un tenant DEV vía el panel nuevo y emitir con una
  sucursal asignada). Esto de paso **cierra el pendiente UAT §29** (matriz fiscal por condición
  con CAE real).
- **F4/F5:** e2e de selección (override + confirmación) + spec 86 extendido (selector de emisor en
  libros) + UAT nuevos FAC-31+.
- **F6:** unit de límites (patrón `planLimits.test.ts`) + e2e de enforcement.

## Onboarding del certificado AFIP por emisor (cómo conseguir el .crt / .key)

Cada emisor del circuito **propio** necesita su par certificado (`.crt`) + clave privada (`.key`)
de AFIP/ARCA para firmar el WSAA. **No se puede generar el `.crt` de forma 100% desatendida**: el
paso de emisión lo hace ARCA y exige el login del contribuyente con **clave fiscal nivel 3** — no
hay API pública para emitir un certificado WSAA sin esa autenticación. Lo que SÍ se puede
automatizar es todo lo demás (la parte nuestra):

**Flujo estándar (el que hacen Xubio/Contabilium con un asistente):**
1. La `.key` (clave privada RSA 2048) → **la generamos nosotros** (o el cliente con `openssl`).
2. El CSR (pedido de certificado, lleva el CUIT en el subject) → **lo generamos nosotros** desde el
   CUIT + la key.
3. El cliente entra a **ARCA → Administración de Certificados Digitales** (con clave fiscal),
   sube/pega el CSR y descarga el `.crt`. **Este paso es manual e ineludible** (clave fiscal).
4. El cliente **asocia el certificado al web service `wsfe`** (Administrador de Relaciones →
   "Nueva Relación" → Servicio de Facturación Electrónica) — también manual.
5. Sube el `.crt` de vuelta a Genesis360 (Config → Facturación → el emisor).

**✅ Wizard self-service (v1.128.0, implementado — mig 270 + EF `generar-csr`):** en el panel de
emisores, modo "Asistente":
1. Botón **"Generar CSR automáticamente"** → la EF `generar-csr` genera con node-forge una clave
   RSA 2048 + el CSR PKCS#10 firmado SHA-256 (subject `C=AR/O=<razón social>/CN=…/serialNumber=CUIT
   <11 díg>`). La `.key` se guarda en el bucket `certificados-afip` (nunca vuelve al browser); su
   path queda en `emisores_fiscales.csr_key_path` (mig 270) para aparearla después.
2. La UI muestra el CSR con **Copiar / Descargar .csr / Ir a ARCA** + el instructivo.
3. El cliente crea el cert en ARCA (con su clave fiscal — paso ineludible) y **sube SOLO el `.crt`**;
   `finalizarCertificadoDesdeCsr` lo manda a la EF **`finalizar-certificado`** (v1.x, 2026-07-14), que
   baja la `.key` pendiente, **valida que el `.crt` corresponda a esa clave** (mismo par RSA) y recién
   ahí activa el `tenant_certificates`. El modo "Ya tengo .crt + .key" (carga manual de ambos) sigue
   disponible.

Reduce el onboarding a "generá el CSR → pegalo en ARCA → subí el .crt" sin `openssl`. **AfipSDK
también ofrece esta ayuda** para su circuito; el circuito `afipsdk` sigue teniendo menos fricción
(token en vez de cert propio) para clientes que no quieran lidiar con el certificado.

**🛑 Fix v1.129.0 (hallazgo de GO 2026-07-12): el wizard también para el emisor PRINCIPAL.** En
v1.128.0 el asistente estaba SÓLO en los emisores **adicionales** (`!e.es_default`); el emisor
principal decía "se edita arriba ↑" y arriba (Config → Facturación → "Certificados AFIP") sólo había
carga manual de `.crt`+`.key` → **una persona que recién arranca, con únicamente su CUIT principal,
no tenía forma de generar su CSR desde la app**. Ahora la fila del principal (⭐) muestra su estado de
cert y un botón **"Certificado" → Asistente** (los datos fiscales y los PV del principal se siguen
editando arriba); y la sección "Certificados AFIP" muestra un **pointer** al asistente cuando todavía
no hay cert cargado. El flujo es idéntico para todos los emisores porque el pipeline de cert es
**por emisor** (`emisores_fiscales` + `tenant_certificates.emisor_id`), y el principal es sólo una
fila `es_default=true`. Además el asistente ahora maneja el caso **cross-sesión** (generaste el CSR
otro día): con `csr_key_path` seteado y sin CSR en memoria, ofrece **subir el `.crt` directo** (antes
te obligaba a regenerar, invalidando el `.crt` que ya te dio ARCA). Máquina de estados en
`src/lib/csrCert.ts` (`pasoWizardCert`: generar → subir-crt → pendiente-crt → activo).

**🛑 Guard crt↔clave (2026-07-14, commit `cb5b1caa` — REGLA #0).** Hasta acá el wizard aceptaba
cualquier `.crt` subido y lo apareaba con la `.key` del CSR **sin verificar que fueran el mismo par
RSA**. Si no correspondían, el error salía recién **al emitir**: `WSAA cms.sign.invalid: Firma
inválida`, críptico y tardío. Pasó de verdad (Fede, homologación): subió un `.crt` de un CSR viejo
sobre una clave regenerada (los timestamps del bucket mostraban 8–13 s entre generar el CSR y subir
el `.crt` → imposible haber ido a ARCA). **Fix:** la finalización se movió a la EF
**`finalizar-certificado`**, que valida el par con `certKeyMatch` (`supabase/functions/finalizar-certificado/certMatch.ts`,
compara módulo + exponente, forge inyectado — corre en Deno y Node) **antes** de activar; si no
aparea devuelve **400 con mensaje claro** ("el .crt no corresponde al CSR que generaste…"). La
validación es **server-side a propósito**: la `.key` nunca viaja al browser, así que el cliente no
puede compararla, y REGLA #0 exige el guard del lado del servidor. Tests: `tests/unit/certMatch.test.ts`
(par que aparea · `.crt` de otra clave rechazado · PEM inválido, 4 casos). **Lección de UX/onboarding:**
generar el CSR **una sola vez**, pegar ESE CSR en ARCA y subir el `.crt` que ARCA emite para él — no
reutilizar un `.crt` anterior ni regenerar el CSR después de pegarlo (invalida el `.crt`).

**✅ VALIDACIÓN MULTI-CUIT CON DATOS REALES (2026-07-15) — el pendiente "emisión con 2 CUITs" CERRADO.**
El tenant "Kiosco Buildi" (DEV) emitió con **dos identidades fiscales** en el mismo tenant:

| emisor | CUIT | condición | tipo | nº comprobante |
|---|---|---|---|---|
| adicional | 20422374168 (Fede) | Monotributista | **Factura C** | **1** — CAE `86280566995291` |
| default ⭐ | 23-32031506-9 | RI | **Factura B** | 3 → 30 |

**El invariante que lo prueba:** la Factura C del Monotributo salió con `numero_comprobante = 1`, no 31 —
hay **dos secuencias de Factura C independientes** en el mismo tenant (1→27 de un CUIT, 1→1 del otro).
La numeración sale de `FECompUltimoAutorizado` **por CUIT**, no de un contador del tenant. Además: TA de
WSAA cacheado **por CUIT** (`afip_wsaa_ta`), certificado propio por emisor, **0 violaciones** del
invariante letra↔condición (los "mismatch" que aparecen en crudo son **anteriores** a los flips de
condición hechos para testear → un registro fiscal histórico NO se juzga contra la config actual).

**🛑 Hardening del apareo emisor↔certificado (`certSelect.ts`, EF `emitir-factura` PROD v17).** La
selección caía a un cert **LEGACY** (`emisor_id IS NULL`) si el emisor no tenía el suyo → en un tenant
multi-CUIT eso **firma el WSAA con el CUIT de OTRO**. Inerte hoy (0 certs legacy en DEV y PROD,
verificado), pero arreglado: el legacy pertenece al CUIT original del tenant → **sólo lo usa el emisor
DEFAULT**; un emisor adicional se queda sin cert y la EF corta con 400 claro. `elegirCertificado` es
puro + 8 unit tests (`tests/unit/certSelect.test.ts`).

**Cobertura de tests (v1.129.0):** `tests/unit/csrCert.test.ts` (subject espejo de la EF + máquina
de pasos + extensiones, 14 casos), `tests/e2e/61_generar_csr_ef.spec.ts` (EF real en DEV: 401 anon ·
403 otro tenant · 400 CUIT inválido · happy path CSR PKCS#10 válido con la `.key` sin salir del
server), UAT §11.b (CERT-01→10, recorrido del que recién arranca) y plan `facturacion.plan.md §11`.

**Manual mientras tanto (homologación / testing):**
```bash
# 1. clave privada
openssl genrsa -out MiEmpresa.key 2048
# 2. CSR con el CUIT en el subject (reemplazar razón social y CUIT)
openssl req -new -key MiEmpresa.key \
  -subj "/C=AR/O=RAZON SOCIAL SA/CN=genesis360/serialNumber=CUIT 20123456789" \
  -out MiEmpresa.csr
# 3. subir MiEmpresa.csr en ARCA (homologación: "WSASS - Autogestión Certificados Homologación";
#    producción: "Administración de Certificados Digitales") → descargar el .crt
# 4. asociar el certificado al servicio wsfe en el Administrador de Relaciones
# 5. subir MiEmpresa.crt + MiEmpresa.key al emisor en Config → Facturación
```
El piloto actual **reusa un único certificado de homologación** (CUIT `23-32031506-9`) en los
tenants de prueba. Para la prueba con 2 CUITs de Fede: generar/obtener SU cert (homologación al
principio) y cargarlo como emisor adicional (o principal) por el panel.

## Abierto / a definir con GO

- Precio del add-on "CUIT adicional" (referencia competencia: incluido en planes de ~$150-300k).
- ¿Tope de emisores por tenant? (competencia: 2-10; propuesta: sin tope técnico, gate por add-on).
- Segundo CUIT de homologación para validar la matriz real (acción GO ante ARCA).
- ¿La facturación de PLATAFORMA (Fede) le factura el add-on igual que el resto? (asumo sí, es un
  add-on más del batch.)

## Links

- [[wiki/features/facturacion-afip]] — la capa que se generaliza (dual-provider, guards, runbooks)
- [[wiki/business/planes-pricing]] — F5 en el backlog de pricing / análisis de competencia
- [[wiki/features/configurador-addons-batch]] — el motor que monetiza el add-on (F6)
