---
title: Edge Functions
category: architecture
tags: [edge-functions, deno, serverless, supabase]
sources: []
updated: 2026-09-23
---

# Edge Functions (51 funciones Deno)

> ⚠️ **Contado el 2026-09-18 sobre `supabase/functions/` del repo: son 51.** El título decía 30 y el índice
> 29 — ambos quedaron viejos. La topología de dónde encaja cada una está en
> [[wiki/architecture/infraestructura]].

Todas las Edge Functions corren en Deno/TypeScript en Supabase. Se autentican validando el JWT de Supabase en cada request.

---

## 🛑 El código desplegado puede no ser el del repo — auditoría 2026-09-14

**Mergear `dev`→`main` despliega el frontend (Vercel) y nada más.** Las Edge Functions se despliegan
a mano, y una migración aplicada no dice nada sobre la función que la usa.

El 2026-09-14, antes de desplegar `emitir-factura`, se bajó el código de PROD y resultó ser **el del
15/07**: le faltaba el lock anti doble emisión que el wiki daba "EN PROD desde 2026-08-20". La
auditoría de todas las funciones encontró además `tn-webhook`/`meli-webhook` sin la reserva atómica
de stock (DEV y PROD), `emitir-factura-plataforma` sin el "NO reintentar" de AfipSDK, `wa-webhook`
de PROD atrasada y **`scan-ticket` sin desplegar en PROD**. Todo realineado ese día (detalle en
`log.md`).

**Regla**: en cada deploy a PROD, y antes de escribir "EN PROD" sobre un cambio de una EF:

```bash
bash scripts/auditar-edge-functions.sh            # todas, DEV y PROD vs HEAD
bash scripts/auditar-edge-functions.sh emitir-factura tn-webhook
```

- Baja el código con `supabase functions download --use-api` (no necesita Docker) y lo compara con
  `git show HEAD:…`. `0` = idéntico.
- 🛑 Al redesplegar, **respetar `verify_jwt`**: los webhooks (`tn-webhook`, `meli-webhook`,
  `wa-webhook`, `modo-*`, `mp-webhook`, `mp-ipn`) van con `--no-verify-jwt`. Verificar con un GET
  sin `Authorization`: el gateway responde `UNAUTHORIZED_NO_AUTH_HEADER` solo donde está activo.
- 🐛 **Gotcha nuevo (2026-09-15):** el deploy por CLI **conserva** el `verify_jwt` que la función ya tenía — no lo
  fuerza al que dice el flag/código nuevo. Pasó con `marketplace-webhook`: quedó en `false` pese a que el código
  nuevo exige un usuario autenticado. Se corrige con un `PATCH` a la Management API (`verify_jwt: true`), no con la
  CLI. Ver [[wiki/development/deploy]].
- Drift de solo comentarios no justifica redesplegar una función de cobros.

🗑️ **Funciones que existían solo en PROD** — GO: *"si no se usan para nada y no se van a usar,
eliminalas"* (2026-09-14). Revisadas una por una (código, workflows, cron, triggers, logs de 24 h):

| Función | Veredicto | Evidencia |
|---|---|---|
| `crear-suscripcion` | 🗑️ borrada | nada la llama; la suscripción MP se arma en el frontend (`init_point`); su carpeta en el repo estaba vacía |
| `smart-endpoint` | 🗑️ borrada | duplicado viejo de `crear-suscripcion`, sin referencias |
| `clever-handler` | 🗑️ borrada | duplicado viejo de `mp-webhook`; todo `notification_url` apunta a `mp-webhook`, y con `verify_jwt` activo rebotaba a MP igual |
| `process-aging` | 🗑️ borrada | el wiki ya la daba por eliminada en v1.54.0 (código muerto: ConfigPage llama la RPC directo), pero seguía desplegada |
| `birthday-notifications` | ✅ se queda | la llama un cron diario de GitHub Actions (corrió el mismo día) |
| `data-api`, `marketplace-api` | ✅ se quedan | Configuración muestra sus endpoints a los usuarios |
| `marketplace-webhook` | 🔌 apagada (2026-09-14), ✅ redesplegada a PROD el 2026-09-15 (v20) | nadie la llamaba; ahora exige usuario autenticado del mismo negocio. `verify_jwt: true` en PROD (requirió un `PATCH` de la Management API — el deploy por CLI lo había conservado en `false`). Sigue sin existir en DEV, a propósito. Ver [[wiki/features/marketplace]] |

Antes de borrar se bajó el código de cada una a `D:/Dev/genesis360-backups/edge-functions-eliminadas-2026-09-14/`.

🟨 **Pendiente menor (auditoría previa al deploy del 2026-09-15):** además de las 4 redesplegadas
(`admin-api`, `billing-manual-avisar-pago`, `marketplace-webhook`, `ai-assistant`), quedan diferencias
**solo de comentarios/formato** (sin cambio de código real, verificado bajando el código de cada una) en
`mp-verificar-suscripcion` (PROD 8 líneas, DEV 4), `mp-ipn` (2/2), `marketplace-api` (PROD 21 líneas, DEV no
desplegada), `birthday-notifications` (PROD 4 líneas, DEV no desplegada) y 2 líneas en
`billing-manual-pagar`/`billing-manual-sweep`/`cancel-suscripcion` (del lado de DEV), `mp-addon-batch`,
`tn-stock-worker`, `wa-briefing-sweep`. Redeploy cosmético cuando se toquen (no urgente). `wa-embedded-signup-exchange`
sigue solo en DEV, a la espera de la App Review de Meta.

✅ **Segundo deploy del mismo día (2026-09-15, migs 427-429)**: `admin-api` (manda el mail del pago manual, mig 428)
y `ai-assistant` (`npm run ai:knowledge` regenerado desde el wiki) redeployadas otra vez en PROD, también en DEV.
`bash scripts/auditar-edge-functions.sh` sobre las dos: diff 0 en PROD y DEV.

🟨 **Drift medido de nuevo tras el deploy `v1.229.0` (2026-09-22, 22 EFs desplegadas, `auditar-edge-functions.sh`
completa: 102 líneas, 91 en 0):** este deploy **limpió 5** funciones que venían con diferencias de comentarios
(`birthday-notifications`, `mp-ipn`, `tn-stock-worker`, `wa-briefing-sweep`, `billing-manual-sweep` pasaron a 0
líneas de diff) y **no introdujo drift nuevo**. Lo que queda, todo preexistente y sin urgencia: `marketplace-api`
(prod **21** líneas — la más grande, revisar qué cambió antes de redeployar), `mp-verificar-suscripcion` (prod
**8** / dev **4**), `mp-addon-batch` (**6** en ambos), `billing-manual-pagar` (dev **2**), `cancel-suscripcion`
(dev **2**). Verificado línea por línea el 2026-09-22 (2ª sesión): **los 5 son 100% cosméticos** (comentarios,
formato de separadores), ninguna diferencia funcional — incluida `marketplace-api`, donde el rate limiting YA
estaba vivo en PROD (`RATE_LIMIT = 60`, `status: 429`), solo faltaba su comentario. `wa-embedded-signup-exchange`
sigue solo en DEV **a propósito** (a la espera de la App Review de Meta).

✅ **Deploy `v1.230.0` (2026-09-22, noche, PR #356, merge `f8d0ae3e`): limpió 3 drifts más.**
`marketplace-api` pasó de PROD **21 → 0**, y `data-api`/`transportista-subir-archivo` de **34/25 → 0**
(`auditar-edge-functions.sh` completo: 102 líneas, 94 en 0). Quedan **4**, los mismos ya verificados como
100% cosméticos: `mp-verificar-suscripcion` (prod 8 · dev 4), `mp-addon-batch` (6 en ambos), `billing-
manual-pagar` · `cancel-suscripcion` (dev 2). Más los dos esperados: `marketplace-webhook` NO_DESPLEGADA
en DEV (la única solo-PROD) y `wa-embedded-signup-exchange` NO_DESPLEGADA en PROD (a propósito, falta el
App Review de Meta).

✅ **2026-09-23 (EN DEV, sin tocar PROD): drift de DEV a CERO.** Se redesplegaron en DEV
`billing-manual-pagar`, `cancel-suscripcion`, `mp-verificar-suscripcion` y `mp-addon-batch` (todas
`verify_jwt=true`). **DEV = 0 drift en todo.** En PROD quedan **solo 2**: `mp-verificar-suscripcion`
(8 líneas) y `mp-addon-batch` (6 líneas), los dos ya verificados 100% cosméticos (guiones de separadores
y un comentario) — son funciones de cobro, el redeploy a PROD espera autorización de GO.

## 🔒⏱️ Rate limiting persistente (mig 432, 2026-09-22) — ✅ EN PROD (`v1.230.0`)

Cierra el pendiente 3 del backlog de la auditoría de seguridad del 2026-09-20 (ver "Backlog abierto" en
[[wiki/architecture/guards-server-side]]). `marketplace-api` (60 req/min por IP), `data-api` (120 req/min por
API key) y `transportista-subir-archivo` (30 req/min por IP) llevaban la cuenta en un `Map` en memoria del
isolate de Deno — se pierde en cada cold start, y Supabase corre varios isolates de la misma función en
paralelo, cada uno con su propio `Map`, así que el límite efectivo era 60 × (cantidad de isolates), un número
que no se controla ni se conoce.

**Fix**: el contador pasa a vivir en `public.rate_limit_contadores` (sin `tenant_id` a propósito — es
infraestructura del borde) + `fn_rate_limit_consumir` (atómica vía `INSERT … ON CONFLICT DO UPDATE …
RETURNING`, `SECURITY DEFINER`, `EXECUTE` solo `service_role`) + cron horario `cleanup_rate_limit_contadores`.
Módulo compartido nuevo **`supabase/functions/_shared/rateLimit.ts`** (primer `_shared` del repo):
`ipDelCliente(req)`, `consumirRateLimit(...)`, `respuesta429(...)`. Mantiene el `Map` local como **piso** (frena
una ráfaga del mismo isolate sin ir a la base) y hace **fail-open** contra la base a propósito — un hipo de la
base no tiene que tirar abajo la API pública entera.

**Dos hallazgos nuevos, encontrados y corregidos en el camino**:
1. El límite se esquivaba del todo: las tres resolvían la IP como `x-forwarded-for ?? cf-connecting-ip`, un
   header que **prefija el cliente** — mandando un valor distinto en cada request se estrenaba cubo cada vez.
   Ahora prioriza `cf-connecting-ip` (lo escribe el borde de Cloudflare, no falseable), después `x-real-ip`, y
   del `x-forwarded-for` toma el **último** hop.
2. `data-api`: probar API keys al azar era gratis (el límite corría DESPUÉS de validar la key). Cubo nuevo de
   intentos **fallidos** por IP (20/min).

**Verificado en DEV con tráfico real**: 70 requests a `marketplace-api` (10 en paralelo) → exactamente 60
pasan/10 dan 429, una sola fila de contador 70 (prueba la atomicidad). `data-api` con 25 API keys inventadas →
20×401+5×429. `transportista-subir-archivo`, 35 POST → 30×400+5×429.

**`marketplace-api` y `data-api` se desplegaron en DEV por primera vez** (antes solo existían en PROD, no se
podían probar) — con esto queda **1 sola función solo-PROD**: `marketplace-webhook`.

**Deployado a PROD la misma noche** (2026-09-22, PR #356, merge `f8d0ae3e`, release `v1.230.0` Latest) y
**verificado con tráfico real contra PROD**: 70 requests a `marketplace-api` → **64×403 + 6×429**,
reconciliando exacto contra la tabla (la ventana de las 02:15 quedó con contador 66 — los requests 61-66
fueron los bloqueados — y los 4 últimos cayeron en la ventana de las 02:16 ya limpia → 60+4 = los 64 que
pasaron).

🩸 **Gotcha de la verificación en PROD**: la primera corrida (65 requests) dio 65×403 y ningún 429 — no
era un bug, la ráfaga cayó a caballo del cambio de minuto y quedó partida 27+38 entre dos ventanas,
ninguna llegó a 60. Comportamiento correcto de una ventana FIJA (no deslizante): para verificar un límite
de ventana fija hay que asegurarse de que la ráfaga entre entera en una sola ventana, si no se lee como
falso negativo. Las filas de prueba se borraron de la tabla en los dos ambientes.

Detalle completo en `log.md` (2026-09-22, `deploy` y `update`) y `sources/raw/project_pendientes.md`
("ARRANCÁ ACÁ").

---

## 🛡️ Auditoría de seguridad 2026-09-20 — ✅ **EN PROD** desde el deploy `v1.229.0` (2026-09-22)

Detalle completo en [[wiki/architecture/guards-server-side]] (secciones "Tanda G" y "Segunda tanda").
Resumen de lo que cambia en esta página:

- **15 sweeps/workers** (los que antes solo dependían de `verify_jwt`, satisfecho por la anon key pública) ahora
  exigen el header `x-cron-secret` con `CRON_SECRET`, o la service key. Verificado en PROD: 8 sweeps
  representativos devuelven **401** con la anon key.
- `modo-webhook`, `tn-webhook` y `meli-webhook` pasan de "sin validar nada real" a validar de verdad (detalle en
  la tabla de abajo, dentro de la lista completa).
- `scan-product` y `scan-ticket` pasan de sin auth a exigir sesión de usuario.
- `mp-webhook` suma el interruptor `MP_WEBHOOK_SIG_ENFORCE` (sigue en log-only, falta cargar el secret) y
  `mp-ipn` devuelve **400** si el POST no trae `user_id` (antes agarraba una credencial de cualquier tenant).
- Migs **430** (aislamiento de Storage por negocio + `search_path`) y **431** (OTP de entrega criptográfico +
  vencimiento del link de estado de cuenta del cliente) — ✅ **EN DEV Y EN PROD**.

## Lista completa

| Función | Propósito |
|---------|-----------|
| `mp-webhook` | Recibe webhooks de Mercado Pago (pagos de suscripción). 🟨 Auditoría 2026-09-20/22 (mig 431): la firma HMAC está implementada y ahora tiene interruptor `MP_WEBHOOK_SIG_ENFORCE` para pasar a bloqueante — sigue en modo **LOG-ONLY**, falta cargar `MP_WEBHOOK_SECRET` (mitigado porque igual re-consulta la API de MP, ver [[wiki/architecture/guards-server-side]]) |
| `mp-ipn` | Mercado Pago IPN (notificación instantánea de pagos). ✅ Fix 2026-09-22 (mig 431, EN PROD): si el POST no trae `user_id`, ahora responde **400** — antes hacía `.limit(1)` y agarraba una credencial de cualquier tenant |
| `crear-suscripcion` | Inicia el flow de alta de suscripción en Mercado Pago |
| `invite-user` | Envía invitación por email a nuevo usuario del tenant |
| `emitir-factura` | Emisión de facturas electrónicas vía AFIP |
| `birthday-notifications` | Envía alertas de cumpleaños de empleados |
| `send-email` | Email transaccional genérico (usa Resend) |
| `scan-product` | Imagen → detección de barcode con IA (Claude Haiku) + Open Food Facts. 🔒 **Ahora exige sesión de usuario** (fix 2026-09-20, commit `f55fbf0f`, EN DEV) — antes cualquiera sin auth podía quemar la cuota de `ANTHROPIC_API_KEY` |
| `transportista-subir-archivo` | 🆕 2026-09-14 (v1.221.0, DEV y PROD) · `verify_jwt: false` — el transportista sube foto o firma de entrega desde `/transporte/:token` (página pública, sin sesión). Valida el token como `get_envio_by_token`, rechaza envíos entregados/cancelados, acepta PNG/JPEG ≤ 5 MB, arma la ruta `pod/<envio_id>/…` y sube con service_role; devuelve URL firmada. e2e 148. 🔒 **2026-09-22 (mig 432): rate limiting pasa a ser persistente** (30 req/min por IP, antes en memoria del isolate) — ✅ EN DEV Y EN PROD (deploy `v1.230.0`, PR #356) |
| `scan-ticket` | Foto de ticket de supermercado → lista de productos `[{barcode, nombre, cantidad, precio_unitario}]` (Claude Sonnet 4.6 vision). Usado en RecepcionesPage y ProductosPage. Retorna siempre HTTP 200 con `{ items: [] }` o `{ error: '...' }`. **Desplegada en PROD recién el 2026-09-14** — antes no existía ahí y esas dos pantallas fallaban. 🔒 **Ahora exige sesión de usuario** (fix 2026-09-20, commit `f55fbf0f`, EN DEV) — antes cualquiera sin auth podía quemar la cuota de `ANTHROPIC_API_KEY` |
| `meli-oauth-callback` | Callback OAuth para conectar cuenta Mercado Libre |
| `meli-webhook` | Procesa webhooks de Mercado Libre (cambios de stock). 🔒 Fix 2026-09-20 (commit `f55fbf0f`, EN DEV): `resource` del body se concatenaba crudo a la URL de un fetch que lleva el `access_token` del vendedor — un `resource` con `@` desviaba la llamada (y el token) al servidor del atacante. Ahora se valida contra `/^\/orders\/\d+$/` |
| `meli-search-items` | Busca productos en Mercado Libre |
| `tn-oauth-callback` | Callback OAuth para conectar cuenta Tienda Nube |
| `tn-webhook` | Procesa webhooks de Tienda Nube (stock sync). 🔒 Fix 2026-09-20 (commit `f55fbf0f`, EN DEV): antes no validaba nada (`order/cancelled` dejaba cancelar ventas y liberar stock desde afuera) — ahora valida el **HMAC-SHA256** de TiendaNube sobre el cuerpo crudo, con el secret `TN_CLIENT_SECRET` (ya existía) |
| `marketplace-webhook` | Webhook de stock del marketplace interno — 🔌 apagado (2026-09-14), solo acepta usuarios autenticados, ✅ EN PROD desde el 2026-09-15 (`verify_jwt: true`) |
| `generate-types` | Genera TypeScript types desde el schema de Supabase |
| `modo-crear-pago` | Genera payment intent en MODO — QR + deep link para cobros interoperables (DEV+PROD) |
| `modo-webhook` | Recibe confirmaciones de pago MODO — idempotente via `ventas_externas_logs` (DEV+PROD). 🔒 Fix 2026-09-20 (commit `f55fbf0f`, EN DEV): el comentario decía que validaba contra `modo_credentials` y era falso — cualquiera con el UUID de una venta la marcaba pagada por el importe que quisiera. Ahora exige `MODO_WEBHOOK_SECRET` y el monto sale del total de NUESTRA venta, nunca del body (409 si hay discrepancia). GO pidió conservar MODO, no eliminarlo |
| `wa-webhook` | `verify_jwt: false` (Meta no manda JWT de Supabase, la seguridad la da la firma HMAC). **✅ EN PROD desde 2026-08-27** (PR #334, merge `867d651a`, DORMIDA — 0 filas en `whatsapp_credentials` en PROD), commiteada v1.181.0/v1.182.0/v1.183.0 — webhook de WhatsApp Cloud API (Meta), responde consultas de stock/precio con Claude Sonnet 5 (Fase 1, tool-calling) + arma borradores de gasto con doble confirmación (Fase 2, `proponer_gasto` + botones interactivos) + acepta FOTOS (Claude Sonnet 5 multimodal) y AUDIO (transcripto con Groq Whisper) como formas nuevas de disparar `proponer_gasto` (Fase 3, verificada solo parcialmente — falta el happy path real, ver la página). Ver [[wiki/features/asistente-whatsapp]] |
| `wa-briefing-sweep` | `verify_jwt: false`. **✅ EN PROD desde 2026-08-27** (PR #334, merge `867d651a`, DORMIDA), commiteada v1.184.0 — disparada por **GitHub Actions** (`.github/workflows/wa-briefing-sweep.yml`, `schedule: '*/15 * * * *'` + `workflow_dispatch`, clon del molde de `repositores-cierre-dia-sweep`), NO por HTTP directo de un cliente; en `main` el trigger `schedule:` corre de verdad cada 15 min contra PROD. Asistente de WhatsApp Fase 4 (briefing diario proactivo): por cada sucursal activa con WhatsApp conectado y `whatsapp_credentials.numero_notificaciones` configurado, evalúa horario de apertura/cierre (`sucursales.horario_apertura`/`horario_cierre`) y manda un mensaje por **plantilla pre-aprobada de Meta** (`briefing_apertura_dia`/`briefing_cierre_dia`, business-initiated, no comparte código con `wa-webhook`) con el resumen de ventas/gastos del día. Verificada solo parcialmente — todo el código confirmado correcto contra la API real de Meta, pero el envío real está bloqueado por la aprobación PENDIENTE de las 2 plantillas. Ver [[wiki/features/asistente-whatsapp]] |
| `wa-embedded-signup-exchange` | 🆕 2026-08-27 (v1.185.0, commit `7c1e1a45`), **CÓDIGO VALIDADO end-to-end 2026-08-28 (v1.186.0, misma conversación sin `/clear`) — solo DEV, sin deploy a PROD** — `verify_jwt: true` (a diferencia de `wa-webhook`, esta la invoca un usuario logueado de Genesis360 desde el frontend, no Meta; guard de identidad JWT→`auth.getUser`→pertenencia al `tenant_id`, mismo patrón que `generar-csr`). Recibe `{tenant_id, code, waba_id, phone_number_id}` del popup de Embedded Signup de Meta: intercambia el `code` por el token propio de ESE cliente, registra el `phone_number_id`, suscribe la WABA a la app y hace upsert en `whatsapp_credentials` (mig 382, sin migración nueva). Confirmado con GO en vivo, probando por 3 caminos distintos con datos reales de Meta, que el código funciona correcto — el `code` de Meta se recibe e intercambia bien. **🛑 Bloqueada para completar el registro real de un WABA**: no por código, sino por la Verificación del Negocio de Meta (pendiente, 100% externo — documentos a cargo de Fede). Fix defensivo agregado: timeout de 3 min en `iniciarConexionWhatsapp` para no dejar el botón colgado sin error cuando Meta no completa el flujo. Ver [[wiki/features/asistente-whatsapp]] → "Embedded Signup" |
| *(~6 más)* | Monitoreo, aging de stock, workers, etc. |

### EFs activas DEV+PROD

| EF | auth | Descripción |
|---|---|---|
| `invite-user` | JWT-less | Invita usuario |
| `ai-assistant` | JWT-less | Groq/`openai/gpt-oss-120b` — chat + bug report + propuesta de config (Plan IA Fase 2) + memoria persistente por tenant (Plan IA Fase 3, mig 377-378) |
| `cancel-suscripcion` | JWT | PATCH preapproval MP |
| `emitir-factura` | JWT | AFIP factura electrónica |
| `crear-suscripcion` | JWT-less | MP preapproval |
| `mp-webhook` | JWT-less | Webhooks MP suscripciones |
| `data-api` | JWT | API pull externa (API keys). 🔒 **2026-09-22 (mig 432): rate limiting persistente** (120 req/min por key + 20 req/min de intentos fallidos por IP, antes en memoria del isolate) — ✅ EN DEV Y EN PROD (deploy `v1.230.0`, PR #356; verificado con tráfico real contra PROD) |
| `tn-stock-worker` | JWT-less | Sync stock TiendaNube |
| `meli-stock-worker` | JWT-less | Sync stock MercadoLibre |
| `mp-crear-link-pago` | JWT | Link de pago MP para ventas |
| `modo-crear-pago` | JWT-less | Genera payment intent MODO |
| `modo-webhook` | JWT-less | Confirmaciones de pago MODO |

---

## Patrón estándar de una Edge Function

```typescript
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (req) => {
  // 1. Validar JWT
  const authHeader = req.headers.get("Authorization");
  // ...

  // 2. Crear cliente Supabase con service role (para bypass RLS si necesario)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 3. Lógica de negocio
  // ...

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

---

## Función especial: `scan-product`

Esta función usa **Claude Haiku** para detectar barcodes a partir de imágenes cuando el escáner físico falla. Flujo:

1. Frontend envía imagen base64
2. Edge Function llama a Anthropic API (Claude Haiku)
3. Claude extrae el código de barras de la imagen
4. Se retorna el código al frontend para buscar el producto

> [!NOTE] Junto con `scan-ticket` (Claude Sonnet 4.6 vision) y `wa-webhook` (Claude Sonnet 5, **✅ EN PROD
> desde 2026-08-27**, DORMIDA — ver [[wiki/features/asistente-whatsapp]]), son las funciones que usan la
> API de Anthropic directamente — el asistente del header (`ai-assistant`) usa Groq, no Anthropic. ⚠ Desde
> la Fase 3 (2026-08-27), `wa-webhook` TAMBIÉN llama a Groq — pero solo para transcribir audio (Whisper), no
> para el "cerebro" (que sigue siendo Claude); es la misma `GROQ_API_KEY` que usa `ai-assistant`, radio de
> impacto acotado si Groq fallara. `wa-embedded-signup-exchange` (🆕 2026-08-27, solo DEV) NO usa IA — es
> solo intercambio de OAuth + llamadas REST a la Graph API de Meta.

---

## Deploy

Las Edge Functions se deployean con:
```bash
supabase functions deploy nombre-funcion
```

En DEV primero, PROD después. Ver [[wiki/development/deploy]].

⚠️ **Mergear a `main` no las despliega.** Después de cada deploy: `bash scripts/auditar-edge-functions.sh` (ver la sección de arriba).

---

## Links relacionados

- [[wiki/architecture/backend-supabase]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/integrations/mercado-libre]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/integrations/afip]]
- [[wiki/features/escaneo-barcode]]
