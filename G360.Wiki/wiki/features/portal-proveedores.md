---
name: portal-proveedores
description: Portal externo para que un PROVEEDOR (identidad separada de `users`, puede vincularse a varios negocios) vea las Órdenes de Compra que un negocio le mandó y proponga precio por ítem — el staff revisa y "aplica" a mano, nunca se automatiza un compromiso de pago (REGLA #0). Identidad (mig 387, v1.188.0) + acceso real a OC/invitación/UI (mig 390, v1.195.0) — 2ª mitad de la propuesta de Fede del 25/8/2026, la otra mitad fue el Asistente de WhatsApp (ver [[wiki/features/asistente-whatsapp]]). ✅ EN PROD desde el 2026-09-01 (PR #335); Redirect URLs de Supabase Auth ya configuradas (2026-09-02). `APP_URL` hardcodeada en `invitar-proveedor` PARCIALMENTE arreglada (v1.195.2, 2026-09-02, código configurable + warning en logs), pero el problema de fondo (no hay frontend público de DEV) sigue sin resolver — ver más abajo.
sources: [migration 387, migration 387b, migration 387c, migration 390, supabase/functions/invitar-proveedor, supabase/functions/send-email, src/pages/PortalProveedoresPage.tsx, src/pages/ProveedoresPage.tsx, src/store/authStore.ts, src/App.tsx, tests/e2e/138_portal_proveedores_invitacion_mutante.spec.ts, tests/e2e/139_portal_proveedores_respuesta_precio_mutante.spec.ts]
updated: 2026-09-02
---

# Portal de Proveedores

Origen: propuesta grande de Fede del 25/8/2026 (secciones A-M, ver [[wiki/features/asistente-whatsapp]] para
la otra mitad — el Asistente de WhatsApp, que arrancó primero por menor riesgo). Sección H: "negocio pide
cotización (pre-cargada con el precio de la última compra) → proveedor responde con presupuesto
estructurado (SIN fotos — campos reales, evita el problema de que la IA no sepa que se equivocó leyendo una
imagen borrosa) → sigue el flujo YA EXISTENTE de OC (pagada antes de pasar a Recepción)". Confirmado con GO:
**una sola cuenta de proveedor puede usarse en varios negocios (tenants) distintos** — gratis para el
proveedor por ahora (funnel de ventas).

## Fase 1 — Identidad cross-tenant (mig 387/387b/387c, v1.188.0, 2026-08-31)

El requisito "un proveedor, varios negocios" rompe el supuesto de raíz de `public.users`: `users.id` tiene
EXACTAMENTE un `tenant_id`, y toda la RLS de la app asume esa relación 1:1. En vez de forzar ese modelo, se
replicó el patrón **YA EXISTENTE** en el proyecto para identidades cross-tenant: `support_agents` (usado por
el panel `genesis360-admin`) — una identidad completamente separada de `users`, con FK física a
`auth.users`, vinculada a cada tenant vía una tabla puente explícita.

- **`proveedor_accounts`**: `id` = FK a `auth.users(id)`, `email` único (case-insensitive), `nombre`,
  `activo`.
- **`proveedor_account_tenants`**: tabla puente — `proveedor_account_id`, `tenant_id`, `proveedor_id`,
  `activo`. FK **compuesto** `(tenant_id, proveedor_id) → proveedores(tenant_id, id)` (requirió
  `UNIQUE(tenant_id, id)` en `proveedores`) — la DB garantiza que el vínculo pertenece de verdad a ese
  tenant, no dos FKs sueltas que un dato corrupto podría desalinear.
- RLS: el proveedor solo ve/edita su propia identidad y sus propios vínculos (`proveedor_accounts_self`,
  `proveedor_account_tenants_self_select`) — **sin policy de INSERT** en ninguna de las 2 (evita auto-alta
  con un email ajeno). El alta real es 100% server-side (Fase 2, abajo).
- `migration-reviewer` encontró 4 hallazgos bloqueantes reales en la 1ª pasada (FK física faltante,
  no-idempotencia, squatting de email vía INSERT, `GRANT` a `anon` en vez de `REVOKE`) — corregidos, APTA en
  la 2ª.

## Fase 2 — Acceso real a OC + invitación + UI (mig 390, v1.195.0, 2026-09-01)

Continuación directa de la Fase 1 — lo que había quedado explícitamente diferido: el flujo de invitación y
las policies sobre `ordenes_compra`. El ciclo de vida real de `ordenes_compra` (CO1-CO8, ✅ PROD, ver
[[wiki/features/clientes-proveedores]]) es `borrador→enviada→confirmada→cancelada→recibida_parcial→recibida`
— **sin inventar un estado nuevo**: el proveedor solo interactúa mientras la OC está `enviada`.

### Decisión de diseño confirmada con GO — REGLA #0

Para una OC ya facturada... digo, ya **enviada**, cuando el proveedor propone su precio real, **la OC nunca
se confirma sola**: un tercero externo no puede disparar un compromiso de pago sin que un DUEÑO/SUPERVISOR
lo revise. Por eso la propuesta del proveedor vive en columnas **nuevas**
(`orden_compra_items.precio_propuesto_proveedor` / `respondido_at`), separadas de `precio_unitario` (la
autoridad real, que solo edita el staff). El staff ve la propuesta en el detalle de la OC
(`ProveedoresPage.tsx`) y la **"Aplica" a mano** — recién ahí `precio_unitario` cambia.

### Diseño de acceso: RPC angostas, no RLS ancha sobre las tablas reales

Se descartó RLS directa sobre `tenants` a propósito: la tabla tiene columnas MUY sensibles
(`clave_maestra`, `afipsdk_token`, `cuit`, `cbu`, `fichado_token`, `mp_subscription_id`...) — cualquier
policy de fila ahí expondría todo eso al proveedor por accidente. En vez de eso, **5 funciones
`SECURITY DEFINER`** (mismo patrón que `get_cuenta_cliente_by_token`, el portal público de clientes),
ninguna confía en que el frontend mande el filtro correcto:

- `fn_portal_proveedor_negocios()` — tenants vinculados a la cuenta que llama (solo nombre/id, nunca la
  fila completa de `tenants`).
- `fn_portal_proveedor_ocs(p_tenant_id)` — OC del proveedor en ESE tenant, `estado <> 'borrador'` (nunca
  borradores internos). `p_tenant_id` no es un filtro de confianza: el JOIN exige que `auth.uid()` esté
  vinculado a ese tenant+proveedor vía el FK compuesto de la Fase 1.
- `fn_portal_proveedor_oc_items(p_oc_id)` — ítems de una OC puntual, con nombre/SKU de producto ya resuelto
  server-side (el proveedor **nunca** recibe acceso directo a `productos`).
- `fn_portal_proveedor_responder_item(p_item_id, p_precio)` — **ÚNICO camino de escritura** del proveedor:
  un `UPDATE` atómico (chequeo de pertenencia + `estado='enviada'` en el propio `WHERE`, evita una ventana
  TOCTOU) que solo puede tocar `precio_propuesto_proveedor`/`respondido_at` — estructuralmente no puede
  tocar `precio_unitario`/`cantidad`/`estado` reales.
- `fn_proveedor_portal_vinculo(p_proveedor_id)` — **lado STAFF**: hallazgo real encontrado con el e2e antes
  de cerrar la migración — la Fase 1 solo dejó policies de "el proveedor ve su propia fila", el staff (que
  es quien invita y necesita confirmar "¿ya está vinculado, a qué email?") no tenía NINGÚN camino de
  lectura. Filtra por `get_user_tenant_id()` (la función ya existente del proyecto), nunca por un parámetro
  del caller.

De paso, hardening no relacionado: `REVOKE ALL ... FROM anon` en `ordenes_compra`/`orden_compra_items`
(tenían GRANT completo por privilegios default nunca revocados — hallazgo preexistente, no explotable
porque RLS ya exige `auth.uid()` real, corregido de paso por tocar esas tablas de nuevo — ver
[[reference_revoke_public_no_anon]]).

### Invitación (Edge Function `invitar-proveedor`)

Desde la ficha del proveedor en `ProveedoresPage.tsx` (sección "Portal de Proveedores"), el staff
(DUEÑO/SUPERVISOR/ADMIN/SUPER_USUARIO — guard de rol server-side, no solo UI) carga un email → la función:

1. Valida identidad (JWT → `users` → pertenece al `tenant_id` recibido) y rol, mismo patrón que
   `generar-csr`/`wa-embedded-signup-exchange`.
2. `admin.generateLink({ type: 'magiclink', email, options: { redirectTo: '/portal-proveedores' } })` — se
   usa `magiclink` en vez de `invite` **a propósito**: crea la cuenta si no existe, pero también funciona
   si ya existe (una misma cuenta vinculada a varios negocios es el caso NORMAL, no un error — `invite`
   falla si el usuario ya existe).
3. `upsert` en `proveedor_accounts` + insert en `proveedor_account_tenants` si no estaba ya vinculado
   (idempotente).
4. Manda el link por el `send-email` propio (Resend, template `invitacion_proveedor`) — **nunca** el email
   default de Supabase.

### Portal (`PortalProveedoresPage.tsx`, ruta pública `/portal-proveedores`)

Página autocontenida FUERA de `AppLayout`/`AuthGuard` a propósito: una cuenta de proveedor es un
`auth.users` separado, sin fila en `users` — el resto de la app no la reconocería. Login con
email+contraseña (o ya autenticado sola al llegar por el link mágico) → selector de negocio si está
vinculada a varios → lista de OC (vía las RPC de arriba) → por cada ítem de una OC `enviada`, input de
precio + botón enviar (`fn_portal_proveedor_responder_item`). Botón para configurar contraseña en cualquier
momento (la cuenta nace sin una, vía magic link).

**Safety net en `authStore.ts`**: si una sesión de proveedor (sin fila en `users`) llega a tocar el resto de
la app, `loadUserData` chequea `proveedor_accounts` antes de marcar `needsOnboarding=true` — sin esto, una
cuenta de proveedor que navegue por error a una ruta interna terminaría en el wizard de "Registrá tu
negocio" y podría crear un tenant nuevo con esa misma identidad, mezclando roles.

## Verificación (e2e real contra DEV, specs 138/139)

- **Spec 138**: DUEÑO invita a un proveedor real desde su ficha → Edge Function real deployada → cuenta +
  vínculo creados en DB (verificado vía `fn_proveedor_portal_vinculo`, no por REST directo — esas tablas no
  tienen policy de lectura para staff). Idempotencia real (reinvitar no duplica). CAJERO recibe 403 del
  guard de rol server-side (no solo UI).
- **Spec 139** (2 tests separados a propósito — ver nota abajo): (A) el proveedor loguea por el portal REAL
  con contraseña, ve la OC `enviada`, propone un precio → verificado en DB que `precio_propuesto_proveedor`
  se guardó y `precio_unitario` **nunca** se tocó solo. (B) el staff ve la propuesta pendiente en
  `ProveedoresPage.tsx` y la aplica — `precio_unitario` recién ahí cambia al valor aplicado.
- La cuenta de proveedor de prueba se creó por el flujo REAL (`invitar-proveedor`, nunca insertada a mano en
  `proveedor_accounts`/`auth.users`); se le fijó una contraseña por SQL (`pgcrypto`, mismo hash que usa
  GoTrue) **solo** para poder loguearse con el formulario real sin depender de una bandeja de email — era la
  primera vez que esa cuenta (recién creada) tenía contraseña, no se tocó ninguna cuenta real.
- (A) y (B) se separaron porque encadenados (probado primero) disparaban consistentemente un flake **ya
  documentado del arnés** (ver docstring de `irAlPOS` en `tests/e2e/helpers/fixtures.ts`): el `useEffect`
  de restricciones de rutas por rol en `AppLayout.tsx` a veces redirige a `/dashboard` cuando
  `user`/`tenant`/`permisos_custom` no terminaron de resolver — no es un bug de esta feature. También se
  encontró y corrigió en el camino: `browser.newContext()` sin overrides en Playwright hereda el
  `storageState` configurado a nivel de PROYECTO en `playwright.config.ts` (la sesión del OWNER) — un
  contexto "nuevo" para simular al proveedor arrancaba ya logueado como el staff si no se pasaba
  explícitamente `storageState: { cookies: [], origins: [] }`.
- `npm run build` (tsc+vite) y 1637 tests unitarios verdes. Sin regresión en la suite de Compras/OC
  (specs 29, 33, 34, 35, 77, 78, 80).

## ✅ Redirect URLs de Supabase Auth — CERRADO (2026-09-02)

GO configuró **Authentication → URL Configuration → Redirect URLs** en ambos proyectos del Dashboard de
Supabase (confirmado con capturas de pantalla): **PROD** (`jjffnbrdjchquexdfgwq`) tiene 5 URLs, incluyendo
`https://genesis360.pro/portal-proveedores`; **DEV** (`gcmhzdedrkmmzfzfveig`) tiene 3 URLs, incluyendo esa
MISMA URL de producción — correcto a propósito, no un error (ver el bug de `APP_URL` hardcodeado justo
abajo, que explica por qué el link mágico apunta siempre a PROD hoy). Ya no es un pendiente.

## 🩹 `APP_URL` hardcodeado en `invitar-proveedor` — PARCIALMENTE arreglado (v1.195.2, 2026-09-02)

Bug original (encontrado 2026-09-02, ver `log.md` para el detalle completo de ambas sesiones):
`supabase/functions/invitar-proveedor/index.ts` línea 25 tenía `const APP_URL = 'https://genesis360.pro'`
**hardcodeado**, sin lógica condicional por ambiente (a diferencia de otras Edge Functions del proyecto).

**Investigación (misma sesión del fix)**: el problema es MÁS PROFUNDO que el hardcode. No existe NINGÚN
frontend público que hable con el proyecto de Supabase de **DEV** (`gcmhzdedrkmmzfzfveig`) — solo
`localhost:5173` vía `.env.local`. Verificado contra Vercel (proyecto `genesis360`,
`prj_P3wFYxAVTWMuKsXA04oR7g3V8495`): los únicos dominios configurados (`app.genesis360.pro`,
`www.genesis360.pro`, `genesis360.pro`, alias de `main`) apuntan TODOS al deployment de PROD. La causa real
no es "la URL de redirect está mal" — es que `admin.generateLink()` firma el JWT con la clave del proyecto
de Supabase donde corre la función (DEV), pero el único destino público alcanzable (`genesis360.pro`)
inicializa su cliente de Supabase contra PROD. La verificación de firma del JWT falla en el primer request
real después del magic link, la sesión del proveedor se rompe SIEMPRE que la invitación se genere desde una
función corriendo en DEV — sin importar qué URL de redirect se use. **Cambiar solo la URL no resuelve el
problema de fondo**; el fix completo real requeriría desplegar un frontend público que hable con DEV (infra
nueva, fuera de alcance).

**Qué se arregló (commit `899fa10b`, `dev`, v1.195.2)**:
1. `APP_URL` pasó a `Deno.env.get('APP_URL') ?? 'https://genesis360.pro'` — mismo patrón que
   `mp-oauth-callback`/`tn-oauth-callback`/`mp-crear-link-pago`/`mp-addon`/`modo-crear-pago`/
   `billing-manual-pagar`. Configurable y consistente con el resto del código; el fallback sigue siendo
   `genesis360.pro`.
2. `console.warn` NO bloqueante (constante `ES_DEV`) cuando la función corre en DEV, explicando en el log
   por qué la sesión del proveedor va a fallar — antes fallaba en silencio, sin rastro en logs.
3. Deployado a la Edge Function de **DEV** (versión 2, `ACTIVE`). **NO deployado a PROD** todavía (pasa por
   el flujo normal de PR `dev→main`).

**Sigue SIN resolver**: el problema de fondo (no hay frontend público de DEV) sigue igual. Invitar a un
proveedor real desde un tenant de DEV va a seguir fallando al establecer la sesión del proveedor hasta que
exista un frontend público que hable con el proyecto de DEV, o se decida explícitamente que esta feature
solo se prueba de punta a punta en PROD (situación de facto hoy). **Impacto: bajo/no bloqueante** — ningún
proveedor real existe en DEV (tenant de prueba), y las invitaciones reales solo van a importar en PROD.

## 🛑 Pendiente real antes de que un proveedor externo pueda usarlo de verdad

1. **El bug de `APP_URL` de arriba — PARCIALMENTE arreglado**: código prolijo + warning en logs, pero el
   problema de fondo de infra (sin frontend público de DEV) sigue igual.
2. La UI del portal es MVP a propósito: sin recuperación de contraseña self-service (si la olvida, el
   negocio la vuelve a invitar y le llega un link nuevo), sin historial más allá de la lista de OC.
3. `orden_compra_items` expone la fila completa de `productos` (incl. `precio_costo`/`stock_actual`) para
   los productos que aparecen en las OC del proveedor — vía la RPC 3, que hace el JOIN server-side pero
   proyecta solo nombre/sku. Exposición menor aceptada como costo de MVP (son productos que el propio
   proveedor ya provee a ese negocio).
4. `ordenes_compra.notas` se expone al proveedor tal cual (hallazgo del `migration-reviewer`, no
   bloqueante) — si alguna vez se usa para apuntes internos del staff no pensados para el proveedor, revisar
   antes de tener usuarios reales.

**🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, mig 390 aplicada y verificada también en PROD;
`APP_VERSION` `v1.195.0`). Redirect URLs de Supabase Auth ya configuradas (arriba). El fix de `APP_URL`
(v1.195.2) solo está en `dev`, sin deploy a PROD todavía — sin impacto real porque PROD no tiene el bug
(siempre habló consigo mismo).
