---
title: Padrón de ARCA — autocompletar por CUIT
category: integrations
tags: [arca, afip, padron, cuit, condicion-iva, ws_sr_constancia_inscripcion, fiscal]
sources: [migration 446, supabase/functions/consultar-cuit/index.ts, supabase/functions/_shared/padronArca.ts, manual ws_sr_constancia_inscripcion v3.4]
updated: 2026-10-01
---

# Padrón de ARCA — autocompletar por CUIT

> Estado: **fases 1-4 hechas en DEV (2026-10-01)** — EF `consultar-cuit` + mig 446 en Supabase DEV, pantallas en
> `dev`, e2e `165` verde contra el padrón de **homologación**. **Falta PROD**: el `produccion.crt` de Fede y la
> relación con el servicio en producción (paso 2 de `sources/raw/guia_fede_certificado_plataforma.md`).

## Qué hace

Al cargar un CUIT válido, la app consulta el padrón de ARCA y muestra una **vista previa** con razón social,
condición frente al IVA y domicilio fiscal. La persona marca qué datos usar y los aplica. Nada se escribe solo.

Dónde aparece (decisión de GO, 2026-10-01):

| Pantalla | Archivo | Campos que propone |
|---|---|---|
| Ficha de cliente | `ClientesPage.tsx` | nombre (solo si está vacío), `condicion_iva_receptor`, `domicilio_fiscal` |
| Ficha de proveedor | `ProveedoresPage.tsx` | nombre comercial (si está vacío), `razon_social`, `condicion_iva`, `domicilio` |
| Emisor fiscal (multi-CUIT) | `EmisoresFiscalesPanel.tsx` | `razon_social_fiscal`, `condicion_iva_emisor`, `domicilio_fiscal` |
| Alta inicial del emisor | `ConfigPage.tsx` (Facturación) | ídem emisor |
| Alta rápida del POS | `VentasPage.tsx` | nombre, condición IVA, domicilio fiscal — el alta rápida **ganó el campo CUIT** (opcional) |

- La consulta es **automática** cuando el CUIT cambia y queda válido (debounce 500 ms). Al abrir una ficha que ya
  tenía CUIT no consulta sola: aparece el botón **"Consultar en ARCA"**.
- Un campo con valor propio marcado `conservarSiHayValor` (el nombre) no se preselecciona.
- En DEV la tarjeta muestra **"padrón de prueba"** (homologación: datos ficticios de ARCA).
- POS: un CUIT con dígito verificador inválido bloquea el guardado; con CUIT el DNI no se exige (misma regla que la
  ficha, `dniObligatorioEnFicha`). El CUIT se guarda solo con dígitos.

## 🛑 Condición IVA (REGLA #0)

Decide la letra de la factura (A/B al cliente; A-B vs C del emisor). Mapeo en
`supabase/functions/_shared/padronArca.ts` → `condicionIvaDesde`:

| ARCA | Código neutro |
|---|---|
| viene `datosMonotributo` | `MONOTRIBUTO` (prevalece) |
| impuesto **30** (IVA) en `datosRegimenGeneral` | `RI` |
| impuesto **32** (IVA exento) | `EXENTO` |
| `datosRegimenGeneral` completo, sin IVA ni monotributo, sin errores de régimen | `CF` |
| `errorRegimenGeneral` / `errorMonotributo` / constancia bloqueada / sin régimen | **`null` = no determinada** |

**Nunca se propone CF por descarte.** Con `null` la tarjeta dice "ARCA no la pudo determinar: elegila a mano".
Cada ficha traduce el código neutro a su vocabulario (`src/lib/padronArca.ts`): cliente `RI/Monotributista/Exento/CF`
(`IVA_RECEPTOR_ID`), proveedor `responsable_inscripto/monotributo/exento/consumidor_final` (CHECK de la tabla), emisor
`RI/Monotributista/Exento` — un CUIT "CF" no puede ser emisor y se avisa.

Solo vienen los impuestos **inscriptos** (manual v3.4, tipo `Impuesto`), así que un IVA dado de baja no aparece.

## Arquitectura

```
Pantalla ─ PadronArcaSugerencia ─ supabase.functions.invoke('consultar-cuit', {cuit})
  EF consultar-cuit (verify_jwt)
    1. sesión → users.tenant_id / activo (NULL = activo)
    2. CUIT válido (módulo 11) o 400
    3. cache padron_arca_cache (cuit, environment) — 24 h si encontró, 1 h si "no existe"; errores no se cachean
    4. rate limit persistente: 30/min por usuario + 500/día por negocio (`fn_rate_limit_consumir`)
    5. TA de WSAA en afip_wsaa_ta (cuit plataforma, service 'ws_sr_constancia_inscripcion', environment)
       — firma con signTra (node-forge) + buildTRA/parseLoginCmsResponse del motor propio (emitir-factura/wsfe-core.ts)
    6. getPersona_v2(token, sign, cuitRepresentada = CUIT del cert, idPersona) → parseGetPersonaV2Response
```

- **Certificado de plataforma** (no el del negocio): CUIT de Fede `20422374168`, alias `genesis360plataforma`. Así
  funciona también para negocios sin certificado propio. Bucket `certificados-afip`:
  `plataforma/20422374168/<homologacion|produccion>.crt` + clave `plataforma/20422374168/2026-10-01T05-21-29-127Z.key`.
- **Secrets**: `ARCA_PADRON_KEY_PATH` **obligatorio** (ruta de la clave; el nombre cambia si se regenera — cargado en
  DEV) · opcionales `ARCA_PADRON_PRODUCCION=true` (padrón real; sin esto, homologación), `ARCA_PADRON_CUIT`,
  `ARCA_PADRON_CERT_PATH` y el master kill `AFIP_FORCE_HOMOLOGACION`.
- **Rate limit**: 30/min por usuario · 500/día por negocio · 5.000/día global (las consultas salen con la identidad
  del certificado de Genesis360). Si ARCA rechaza el TA cacheado se borra y se pide uno nuevo una vez.
- Endpoints: homologación `https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5`, producción
  `https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5`.
- No toca `emitir-factura` (reusa sus módulos puros sin modificarlos).

## Respuesta de la EF

`{ ok: true, persona: { cuit, tipoPersona, nombre, estadoClave, activa, condicionIva, domicilio{direccion, localidad,
codPostal, provincia, texto}, avisos[] }, fuente: 'arca'|'cache', ambiente }` o
`{ ok: false, motivo: 'no_existe'|'error_arca', mensaje }`. Errores de transporte → mensaje "No se pudo consultar
ARCA… podés cargar los datos a mano" (el detalle queda en el log). `avisos` = textos de `errorConstancia` /
`errorRegimenGeneral` / `errorMonotributo` (ARCA puede mandarlos junto con datos parciales).

## Tests

- unit `tests/unit/padronArca.test.ts` (21: CUIT, sobre, mapeo IVA con los bordes de REGLA #0, domicilio, errores)
- unit `tests/unit/padronArcaFront.test.ts` (traducción a cada vocabulario) · `clienteCampos.test.ts` (DNI con CUIT)
- e2e `tests/e2e/165_padron_arca_autocompletar.spec.ts` (cliente, nombre no pisado, CUIT inválido, proveedor, POS)
- UAT §75 en `tests/specs/uat-modo-basico.md`

CUITs útiles del padrón de **homologación** (datos ficticios de ARCA): `30500010912` RI con domicilio ·
`20201731594` CF (ejemplo del manual) · `27298672478` "Domicilio Incompleto", sin régimen → condición `null` ·
`20000000516` CUIT cancelada.

## Pendiente

1. `produccion.crt` de Fede → subir a `certificados-afip/plataforma/20422374168/produccion.crt` en **PROD** + secrets
   `ARCA_PADRON_KEY_PATH` y `ARCA_PADRON_PRODUCCION=true` en PROD + mig 446 + deploy de la EF (antes del merge).
2. Duda fiscal **C-19** ([[wiki/business/consultas-contador]]): CF cuando hay régimen general sin IVA.
3. El mismo certificado destraba la **facturación de plataforma** (`platform_billers.cert_crt_path`/`cert_key_path`).

Relacionado: [[wiki/features/facturacion-afip]] · [[wiki/features/clientes-proveedores]] ·
[[wiki/features/multi-cuit]] · `sources/raw/guia_fede_certificado_plataforma.md`.
