---
title: Multi-CUIT por tenant (F5)
category: features
tags: [facturacion, afip, multi-cuit, emisores, enterprise, addon]
sources: [planes-pricing.md, facturacion-afip.md, project_pendientes.md]
updated: 2026-07-10
---

# Multi-CUIT por tenant (F5) — diseño y plan por fases

**Estado: Fase 1 (modelo de datos) EN DEV (mig 267, 2026-07-10). Fases 2-6 pendientes.**

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
| **2 — EF `emitir-factura` multi-emisor** | La EF resuelve el emisor (regla de arriba) y toma cuit/condición/cert/token/provider/produccion/umbral DEL EMISOR (hoy: de `tenants`). Persiste `ventas.emisor_id`. Guards por emisor (Mono→C, RI→A/B, A exige CUIT, B≥umbral) — la condición ahora varía POR EMISOR. NC: hereda emisor + guard. Con 1 emisor = mismo flujo actual (regresión e2e 21/42/56). | **Alto (REGLA #0)** | ⬜ |
| **3 — UI Config (CRUD de emisores)** | Config → Facturación pasa de formulario único a lista de emisores (form + cert upload + PV por emisor + marcar default + activo). Cutover: la UI escribe en `emisores_fiscales`, se elimina el trigger de sync, `tenants.*` fiscal queda read-only legacy. Asignación sucursal→emisor en Config → Sucursales. Runbook actualizado. | Medio | ⬜ |
| **4 — Selección en el flujo de venta** | Modal de emisión (POS + FacturacionPage) muestra el emisor default de la sucursal con selector para override + **confirmación explícita si se cambia** (emitir con el CUIT equivocado es irreversible). `detectarTipoComprobante`/`tiposComprobantePermitidos` reciben la condición DEL EMISOR ELEGIDO (las letras ofrecidas cambian al cambiar de emisor). PDFs con los datos del emisor del comprobante. | Alto (UX fiscal) | ⬜ |
| **5 — Reportes fiscales por emisor** | Selector de emisor en FacturacionPage (libros/KPIs/liquidación — libros por CUIT, v1.125.0, ahora por CUIT ELEGIDO), Posición IVA del Dashboard y DashFacturacionArea. Gastos: `emisor_id` en el form (default por sucursal). Export Excel por emisor. | Medio | ⬜ |
| **6 — Monetización (add-on)** | Dimensión `cuits` en `fn_plan_base_limite` (base: 1 en todos los planes) + pack fijo "CUIT adicional" en el configurador batch + enforcement server-side (no crear emisor activo N+1 sin add-on). Pricing a definir con GO (referencia: la competencia lo regala en planes altos; nosotros monetizamos por add-on). | Medio | ⬜ |

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

- **F1:** queries de verificación del backfill (emisor default = campos del tenant; hijos linkeados).
- **F2:** unit del resolver de emisor (lib pura espejo `src/lib/emisorFiscal.ts`) + regresión e2e
  21/42/56 (con 1 emisor, todo idéntico) + **e2e nuevo con 2 emisores en el tenant de prueba DEV**
  (⚠ requiere un SEGUNDO certificado/CUIT de homologación — acción GO; con el mismo CUIT de
  homologación actual se puede simular parcialmente con 2 emisores del mismo CUIT, pero la matriz
  Mono↔RI real exige otro CUIT). Esto de paso **cierra el pendiente UAT §29** (matriz fiscal por
  condición con CAE real).
- **F4/F5:** e2e de selección (override + confirmación) + spec 86 extendido (selector de emisor en
  libros) + UAT nuevos FAC-31+.
- **F6:** unit de límites (patrón `planLimits.test.ts`) + e2e de enforcement.

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
