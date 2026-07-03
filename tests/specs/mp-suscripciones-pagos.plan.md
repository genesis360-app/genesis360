# Plan UAT — Suscripciones, Pagos y Cancelaciones de Mercado Pago (billing de PLATAFORMA)

> Alcance: cómo **Genesis360 le cobra la suscripción a cada tenant** (no el cobro del
> tenant a sus clientes). Cubre alta/activación, cobros recurrentes, cancelación, cambio
> de plan, add-ons (temporal/fijo), robustez del webhook, integridad contable REGLA #0,
> anti-drift DB↔MP, aislamiento multi-tenant y config de entorno.
>
> Código fuente auditado (2026-07-02, tras el fix `payer_email`):
> - `supabase/functions/mp-verificar-suscripcion/index.ts` (activación al volver del checkout)
> - `supabase/functions/cancel-suscripcion/index.ts` (cancelación app + panel STAFF ADMIN)
> - `supabase/functions/mp-webhook/index.ts` (webhook: suscripciones, pagos de venta, add-ons)
> - `supabase/functions/crear-suscripcion/index.ts` (⚠️ LEGACY, ver hallazgo H1 — no referenciada desde `src/`)
> - `supabase/functions/mp-addon/index.ts` (add-on temporal de movimientos, pago único)
> - `supabase/functions/mp-addon-fijo/index.ts` (add-ons fijos recurrentes, PUT delta sobre preapproval)
> - `supabase/functions/admin-api/index.ts` (acción `billing.cancel_subscription`)
> - `src/pages/SuscripcionPage.tsx`, `src/pages/MiCuentaPage.tsx`, `src/pages/AdminPage.tsx`
> - `src/lib/addons.ts`, `src/config/brand.ts` (`MP_PLAN_IDS`, `ADDON_PACKS`, `PLAN_BASE_LIMITS`)
> - `src/hooks/usePlanLimits.ts`
> - `supabase/schema_full.sql` (RLS `tenants_update`, `ventas_externas_logs` UNIQUE, `tenant_addons` UNIQUE)

## Hallazgos relevantes durante la lectura de código (antes de los escenarios)

- **H1 — `crear-suscripcion` es código LEGACY/HUÉRFANO.** Ningún archivo en `src/` lo invoca
  (`SuscripcionPage.tsx` arma el `init_point` de MP directamente en el cliente con
  `preapproval_plan_id` + `external_reference`, sin pasar por ninguna Edge Function). Este EF
  crea el preapproval server-side con `external_reference: tenantId` — que es exactamente el
  campo que MP **no persiste** en checkout por plan. Si algo todavía lo invoca (link viejo,
  integración externa), es una superficie de riesgo dormida: no tiene el fix de `payer_email`.
  **Acción sugerida para GO**: confirmar que no hay ningún link/flujo activo que lo llame; si no,
  candidato a deprecar/eliminar para no mantener dos caminos de alta divergentes.
- **H2 — El webhook `mp-webhook` NO valida la firma `x-signature` de MP.** El header está
  aceptado en CORS (`Access-Control-Allow-Headers: ... x-signature, x-request-id`) pero el código
  nunca lo lee ni lo verifica contra el secret. Cualquiera que conozca la URL del endpoint puede
  simular un POST `{"type":"payment","data":{"id":"<paymentId real o inventado>"}}` — el código
  igual hace un `GET` a MP para confirmar el pago real antes de tocar la DB, así que un ID
  inventado no pasa (`payment.status === 'approved'` no se cumple), **pero** un atacante que
  conozca un `payment_id` real de OTRO pago propio podría forzar su reprocesamiento antes de
  tiempo, o simplemente generar ruido/DoS de invocaciones. Severidad media (no crítico porque el
  GET a MP es la verdadera fuente de verdad), pero es una superficie sin el guard estándar de
  webhooks. Ver escenario **WH-SIG**.
- **H3 — `mp-addon-fijo` tiene comentario "NO deployado / NO activado hasta que GO reconfigure
  planes a $60k/$100k"** pero según MEMORY.md los planes YA están en $60k/$100k desde la sesión
  2026-07-02 (F3 ya en v1.102). Si el comentario quedó desactualizado, confirmar con GO que el
  flujo de add-ons fijos está realmente habilitado en PROD antes de dar por bueno cualquier
  escenario de esa sección.
- **H4 — Add-ons FIJOS no tienen webhook/confirmación server-to-server**: el PUT del monto y el
  insert en `tenant_addons` ocurren en la MISMA invocación síncrona de `mp-addon-fijo` (no hay
  paso "pending" + webhook). Si el usuario cierra la pestaña justo después del PUT exitoso pero
  antes de que la respuesta HTTP vuelva, el insert en `tenant_addons` sí se ejecutó (es
  server-side, no depende del cliente) — no hay ventana de pérdida real, pero SÍ depende de que
  `admin.from('tenant_addons').insert` no falle silenciosamente; está bien manejado (revierte el
  monto MP si el insert falla). Confirmado OK, sin acción.
- **H5 — El webhook de add-ons temporales activa headers `x-signature`/idempotencia PERO el
  fallback legacy `ref.endsWith('|addon_movimientos')` y el `else` final (`ref` = tenantId puro →
  marca `subscription_status: 'active'` a ciegas) NO tienen ningún guard de pertenencia ni
  idempotencia** — cualquier `payment.external_reference` que sea un UUID de tenant válido activa
  la cuenta sin verificar que el pago corresponda a un preapproval o monto esperado. Este es el
  código heredado pre-fix (paths de pago que no son add-on ni venta). Ver escenario **WH-LEGACY**.
- **H6 — `usePlanLimits` calcula `plan_id` = `tenant.plan_tier` en DB, no `mp_subscription_id`.**
  Esto es correcto y consistente con el resto del código (`plan_tier` es la fuente de verdad de
  límites desde mig 251), pero significa que un drift `plan_tier` ↔ `mp_subscription_id` (p.ej. el
  webhook actualiza `plan_tier` pero no `mp_subscription_id`, o viceversa) puede dejar al tenant
  con acceso a features de un plan que no está pagando. Ver sección de auditoría SQL.

---

## 1. Alta / Activación (checkout por plan)

### CRÍTICO

**MP-A1 — Activación normal por `preapproval_id` del redirect**
- Given un tenant en `trial`, hace clic en "Suscribirme" al plan Pro, MP redirige a
  `/suscripcion?status=approved&preapproval_id=abc123` tras pagar.
- When `handleVerificarPago` llama a `mp-verificar-suscripcion` con `preapproval_id: 'abc123'`, y
  en MP ese preapproval tiene `status: 'authorized'`, `preapproval_plan_id` = `MP_PLAN_IDS.pro`,
  `payer_email` = email del usuario logueado.
- Then MP: preapproval sigue `authorized` (no se toca). DB: `tenants.subscription_status='active'`,
  `mp_subscription_id='abc123'`, `plan_tier='pro'`, `max_users=15`, `max_productos=8000`. Caja/stock
  del tenant: **no tocados**.
- Severidad: crítico. Automatizable: **vitest-unit** (extraer la lógica de resolución/activación a
  una función pura testeable, ver "Candidatos a extracción" — hoy vive inline en el EF Deno) +
  **UAT-manual** end-to-end con MP real (sandbox no permite suscripciones reales, ver H de sección 10).
  Guard: `mp-verificar-suscripcion` (status-check + tier lookup + `admin.update`).

**MP-A2 — Activación por búsqueda `payer_email` (pestaña cerrada antes de volver)**
- Given un tenant pagó el plan Básico pero cerró la pestaña de MP antes del redirect a la app (no
  hay `preapproval_id` en la URL).
- When el usuario vuelve a `/suscripcion` más tarde y algo dispara `handleVerificarPago` sin
  `preapprovalId` (o se llama a `mp-verificar-suscripcion` con `body: {}`).
- Then la EF pagina `/preapproval/search`, filtra client-side por
  `payer_email === userEmail && status === 'authorized' && plan reconocido`, toma el más reciente
  por `date_created`, y activa igual que MP-A1.
- Severidad: crítico (sin esto, "pagó y no se le activó el plan" — el bug real que motivó el fix).
  Automatizable: vitest-unit (mockear `fetch` de `/preapproval/search` con resultados paginados,
  verificar selección del más reciente) + UAT-manual. Guard: bloque `else if (userEmail)` en
  `mp-verificar-suscripcion`.

**MP-A3 — `external_reference` vacío (comportamiento esperado en checkout por plan)**
- Given un preapproval de MP con `external_reference: ""` (o `null`) — el caso NORMAL en checkout
  por plan, no un edge case.
- When se verifica por `preapproval_id` o por búsqueda de `payer_email`.
- Then la activación **procede igual** (el código nunca lee `external_reference` en
  `mp-verificar-suscripcion`; la pertenencia es 100% por `payer_email` + claim exclusivo).
- Severidad: crítico (es la causa raíz del bug original — si alguien reintrodujera una dependencia
  de `external_reference` acá, todo el módulo vuelve a romperse). Automatizable: vitest-unit
  (assert explícito: "el código de activación no debe leer `sub.external_reference` en ningún
  branch"). Guard: ausencia deliberada de lectura de `external_reference` en el EF.

**MP-A4 — `payer_email` del preapproval ≠ email del usuario logueado → rechazo `owner_mismatch`**
- Given un usuario User B logueado con email `b@x.com`, envía un `preapproval_id` cuyo
  `payer_email` en MP es `a@x.com` (por ejemplo, adivinando/copiando un id ajeno, o un error de
  UI que reusa un id viejo).
- When llama a `mp-verificar-suscripcion` con ese `preapproval_id`.
- Then MP: sin cambios. DB: sin cambios (`tenants` de B sigue como estaba). Response:
  `{ activated: false, reason: 'owner_mismatch' }`, HTTP 403.
- Severidad: crítico (evita que un usuario active gratis su cuenta reusando el preapproval pagado
  de otro). Automatizable: vitest-unit (mock de `getPre` devolviendo `payer_email` distinto) +
  playwright-e2e (llamar la function con JWT de un usuario y `preapproval_id` de otro tenant real
  de test). Guard: `if (subEmail && (!userEmail || subEmail !== userEmail)) return 403`.

**MP-A5 — Preapproval ya reclamado por OTRO tenant → rechazo `ya_reclamada`**
- Given el tenant T1 ya activó su cuenta con `mp_subscription_id = 'xyz'` (guardado en
  `tenants`). Por bug de UI, replay, o manipulación del request, el tenant T2 (mismo `payer_email`
  si comparten owner con 2 cuentas, o edge case de emails iguales) intenta verificar el mismo
  `preapproval_id='xyz'`.
- When `mp-verificar-suscripcion` corre el claim exclusivo:
  `SELECT id FROM tenants WHERE mp_subscription_id='xyz' AND id != T2`.
- Then encuentra a T1 → DB: T2 **no se activa**. Response `{ activated: false, reason: 'ya_reclamada' }`,
  HTTP 409. T1 no se toca.
- Severidad: crítico (evita que un mismo pago "active" dos tenants — dos negocios por el precio de
  uno). Automatizable: vitest-unit (mock de `admin.from('tenants').select` devolviendo `otro`) +
  UAT-manual (requiere 2 tenants reales + 1 preapproval real). Guard: query `neq('id', tenantId)`
  antes del `.update`.

**MP-A6 — Plan desconocido (`preapproval_plan_id` no está en `MP_PLAN_IDS`) → rechazo**
- Given un preapproval `authorized` cuyo `preapproval_plan_id` no matchea ni `MP_PLAN_BASICO` ni
  `MP_PLAN_PRO` (ej. un plan de MP viejo/borrado, o de otra cuenta de MP por error de config de
  entorno).
- When se verifica.
- Then DB: sin cambios. Response `{ activated: false, reason: 'plan_desconocido', plan: <id> }`,
  HTTP 400.
- Severidad: crítico (sin este guard, un tenant podría "activarse" con un tier indefinido/`undefined`
  y romper `TIER_BASE[tier]`, o peor, quedar `active` sin `plan_tier` seteado — acceso gratis
  indefinido). Automatizable: vitest-unit puro (mapa `MP_PLAN_TIER[planId]` → `undefined`). Guard:
  `if (!tier) return json(..., 400)` ANTES de tocar la pertenencia o la DB.

**MP-A7 — `preapproval.status !== 'authorized'` (ej. `pending`) → NO activa, no es error**
- Given un preapproval recién creado en `status: 'pending'` (el usuario está a mitad del checkout,
  o el pago quedó en revisión de MP).
- When se llama a `mp-verificar-suscripcion` (por ejemplo el frontend reintenta).
- Then DB: sin cambios (tenant sigue en `trial`/estado previo). Response
  `{ activated: false, reason: 'no_autorizado', status: 'pending' }`, HTTP 200 (no es un error del
  sistema). El webhook `subscription_preapproval`/`preapproval` lo activará después cuando MP
  notifique el cambio a `authorized`.
- Severidad: alto (si esto activara de más, se regala acceso sin pago confirmado; si no re-intenta
  luego vía webhook, el usuario queda trabado en "procesando" para siempre — cubrir también el
  camino webhook, ver MP-W1). Automatizable: vitest-unit. Guard:
  `if (sub.status !== 'authorized') return json({ activated:false, reason:'no_autorizado' })`.

**MP-A8 — Intento de auto-activación navegando directo a la URL con `preapproval_id` ajeno, sin pagar**
- Given un usuario malicioso conoce (adivina/enumera) un `preapproval_id` válido de OTRO tenant que
  SÍ pagó, y navega directo a `/suscripcion?status=approved&preapproval_id=<ajeno>` sin haber
  pagado nada él mismo.
- When se dispara `handleVerificarPago` automáticamente (por el `useEffect` en `status===approved`).
- Then `mp-verificar-suscripcion` valida `payer_email` (MP-A4) — el preapproval ajeno tiene el
  email del dueño real, no el del atacante → `owner_mismatch`, 403. Ningún tenant se activa gratis.
- Severidad: crítico (vector de fraude directo si este guard faltara). Automatizable: playwright-e2e
  (navegar con URL manipulada, JWT de un tenant de test, `preapproval_id` de otro tenant de test) +
  vitest-unit del guard aislado (mismo guard que MP-A4, cubrir explícitamente como vector de ataque
  no solo como bug accidental).

### ALTO

**MP-A9 — `mp-verificar-suscripcion` sin `preapproval_id` NI `payer_email` resoluble**
- Given `bodyId` vacío y `user.email` vacío/null (edge case: usuario sin email, ej. alta rara vía
  algún proveedor OAuth sin email verificado).
- When se llama al EF.
- Then no entra a ninguna rama de búsqueda → `sub` queda `null` → response
  `{ activated: false, reason: 'no_encontrado' }`.
- Severidad: alto. Automatizable: vitest-unit. Guard: `if (!sub?.id) return json({...'no_encontrado'})`.

**MP-A10 — Cambio de plan evita doble cobro: cancela la suscripción anterior (`prevSubId`)**
- Given un tenant tiene `mp_subscription_id = 'sub_basico_1'` activo (plan Básico), y decide subir
  a Pro: paga un NUEVO preapproval `sub_pro_2`.
- When `mp-verificar-suscripcion` activa `sub_pro_2`, detecta `prevSubId='sub_basico_1' !== sub.id`.
- Then MP: PUT a `preapproval/sub_basico_1` con `{status:'cancelled'}` (best-effort, no bloqueante
  — si falla solo loguea, no aborta la activación de la nueva). DB: se activa igual con
  `mp_subscription_id='sub_pro_2'`, `plan_tier='pro'`.
- Severidad: alto (riesgo de DOBLE COBRO mensual si `sub_basico_1` sigue viva y cobrando en
  paralelo a `sub_pro_2`). **Gap identificado**: si el `fetch` de cancelación falla (ej. timeout),
  el código solo hace `console.error` y sigue — el tenant queda con DOS preapprovals vivos y nadie
  se entera hasta la auditoría SQL (sección 8) o el reclamo del cliente. Automatizable: vitest-unit
  (mock fetch fallando, verificar que la activación de la nueva sub sigue) + **recomendación**: que
  este `catch` dispare una alerta/log de severidad alta distinguible (hoy es un `console.error` más
  entre muchos). Guard: bloque `if (prevSubId && prevSubId !== sub.id)`.

### MEDIO

**MP-A11 — `/preapproval/search` sin `mp-verificar-suscripcion` puede devolver >100 resultados**
- Given la cuenta de MP de la plataforma tiene más de 100 preapprovals históricos (crecimiento
  natural de la base de clientes).
- When se busca por `payer_email` sin `preapproval_id`.
- Then el loop pagina con `offset += 100` hasta 1000 (10 páginas máx). Si el usuario buscado tiene
  su preapproval autorizado más reciente en la página 11+, NO se encuentra → `no_encontrado`.
- Severidad: medio (hoy con pocos clientes no aplica; se vuelve crítico según crece la base — anotar
  como deuda técnica). Automatizable: vitest-unit (mock de 11 páginas, confirmar que no revienta,
  solo no encuentra) + recomendación de subir el techo o buscar por filtro `payer_email` si MP algún
  día lo soporta server-side.

---

## 2. Cobros recurrentes (renovación mensual)

### CRÍTICO

**MP-W1 — Webhook `subscription_preapproval`/`preapproval`: `authorized` → activa el tenant**
- Given un preapproval en `pending` (tenant en camino a activarse, o recién cancelado y MP lo
  reactivó) pasa a `status: 'authorized'` en MP (pago mensual exitoso / primera autorización).
- When MP notifica `POST /mp-webhook` con `type: 'subscription_preapproval', data: {id}`.
- Then el EF hace GET a `/preapproval/{id}`, resuelve `tenantId` por `external_reference` (vacío
  en plan-checkout) o por `mp_subscription_id` ya linkeado, y hace
  `UPDATE tenants SET subscription_status='active', mp_subscription_id=id, plan_tier=tier,...`.
  Caja/stock del tenant: no tocados.
- Severidad: crítico. Automatizable: vitest-unit (extraer el mapeo `status→newStatus` y la
  resolución de tenantId a función pura) + UAT-manual (webhook real de MP en DEV). Guard: bloque
  `if (type === 'subscription_preapproval' || type === 'preapproval')`.

**MP-W2 — Webhook de pago rechazado (`payment.status !== 'approved'`) → NO toca el tenant**
- Given el cobro recurrente mensual de MP falla (tarjeta rechazada, fondos insuficientes).
- When MP notifica `type: 'payment'` con `data.id` de un pago `status: 'rejected'` (o `in_process`,
  `cancelled`).
- Then el bloque `if (payment.status === 'approved' && payment.external_reference)` NO se cumple →
  ninguna escritura a `tenants`/`tenant_addons`/`ventas`. El estado de la suscripción sigue
  gobernado por el evento `subscription_preapproval` que MP dispara en paralelo (que puede pasar a
  `paused`/`pending` según la política de reintentos de MP) — **no hay una acción explícita en el
  código para "pago rechazado de suscripción"**, depende de que MP también mande el evento de
  preapproval con el nuevo status.
- Severidad: crítico. **Gap a validar en UAT-manual**: confirmar con un pago de prueba rechazado en
  sandbox si MP realmente dispara el evento `subscription_preapproval` con `status: paused` o si
  el tenant queda en `active` indefinidamente pese al cobro fallido (zombie access). Automatizable:
  vitest-unit del guard de "no approved → no-op" (trivial) + **UAT-manual obligatorio** para el
  comportamiento real del ciclo de reintentos de MP.

**MP-W3 — Idempotencia: MP reenvía la misma notificación de pago dos veces**
- Given un pago `payment_id=999` de un add-on temporal ya fue procesado (fila insertada en
  `tenant_addons` con `mp_payment_id='999'`).
- When MP reenvía el mismo webhook (comportamiento documentado de MP: reintenta si no responde
  2xx a tiempo, o duplica por at-least-once delivery).
- Then el `INSERT INTO tenant_addons` choca contra `uq_tenant_addons_mp_payment` (UNIQUE índice
  parcial `WHERE mp_payment_id IS NOT NULL`) → error `23505` → el código lo detecta y solo loguea
  "ya acreditado (idempotente)", NO acredita de nuevo. DB: tenant_addons con **una sola fila** para
  ese `mp_payment_id`.
- Severidad: crítico (sin esto, reintentos de MP acreditarían movimientos extra infinitas veces).
  Automatizable: vitest-unit (simular insert duplicado, mock del código `23505`) — **candidato a
  extracción**: la función de manejo del insert+catch(23505) es lógica pura de decisión, hoy vive
  inline en el webhook. Guard: `uq_tenant_addons_mp_payment` (mig 253) + catch explícito de `23505`.

**MP-W4 — Idempotencia: pago de VENTA (seller conectado) reenviado por MP**
- Given un pago de una venta de un tenant con MP conectado (Mercado Pago del propio negocio,
  vertical distinta a la suscripción) ya se registró en `ventas_externas_logs` con
  `webhook_external_id='mp-payment-<paymentId>'`.
- When MP reenvía la notificación del mismo `payment_id`.
- Then el INSERT en `ventas_externas_logs` choca contra `UNIQUE(tenant_id, integracion,
  webhook_external_id)` → `23505` → se loguea "ya procesado" y **NO se vuelve a sumar
  `monto_pagado`** ni se asienta el ingreso informativo en caja de nuevo.
- Severidad: crítico (REGLA #0 — sin esto, un reintento de MP duplicaría el cobro registrado de una
  venta del tenant). Automatizable: vitest-unit (misma lógica que MP-W3, mismo patrón). Guard:
  `UNIQUE(tenant_id, integracion, webhook_external_id)` en `ventas_externas_logs` + catch `23505`
  antes de tocar `ventas.monto_pagado`.

### ALTO

**MP-W5 — Webhook `preapproval` sin `data.id` → error controlado, no crashea**
- Given MP manda (por bug propio o payload malformado) un evento `type: 'preapproval'` sin
  `data.id`.
- When el EF corre.
- Then `if (!subscriptionId) throw new Error('No subscription id')` → el catch general responde
  HTTP 500 con `{error: 'No subscription id'}`. Ningún tenant se toca. MP reintentará (comportamiento
  estándar ante 5xx).
- Severidad: alto. Automatizable: vitest-unit.

**MP-W6 — Cobro recurrente de un tenant con `mp_subscription_id` DESLINKEADO (nunca activó por MP-A2)**
- Given un tenant pagó pero el webhook llega ANTES de que el usuario haya vuelto al checkout (o
  nunca volvió), y `tenants.mp_subscription_id` sigue `NULL`.
- When llega `subscription_preapproval` con `authorized` y `external_reference` vacío (checkout por
  plan).
- Then `tenantId = subscription.external_reference || null` → `null` → el fallback busca por
  `mp_subscription_id = subscriptionId` → tampoco lo encuentra (nunca se linkeó) → `tenantId` sigue
  `null` → **el bloque `if (tenantId)` no se ejecuta, el pago se pierde silenciosamente** (sin error,
  sin log de warning explícito más allá del genérico).
- Severidad: alto — este es el escenario que en la práctica activa la mayoría de los tenants
  reales (el webhook suele llegar antes de que el usuario abra la pestaña de vuelta), y el único
  camino que lo resuelve es que el usuario efectivamente vuelva a `/suscripcion` y dispare
  `mp-verificar-suscripcion` (MP-A2). **Gap**: no hay reconciliación automática — si el usuario
  cierra la pestaña Y nunca vuelve a `/suscripcion`, queda en `trial`/sin activar indefinidamente
  pese a estar pagando. Recomendación: cron/sweep periódico que busque preapprovals `authorized`
  en MP sin tenant linkeado y dispare la activación (mismo patrón que otros sweeps del proyecto).
  Automatizable: vitest-unit (confirmar el "silencio" del código actual) + anotar como deuda.

### MEDIO

**MP-W7 — Webhook de un `type` no reconocido (ej. `merchant_order`, futuros tipos de MP)**
- Given MP manda un webhook con `type` distinto a `payment`/`subscription_preapproval`/`preapproval`.
- When el EF corre.
- Then ningún bloque `if` matchea → cae directo al `return new Response({ok:true})` final. No hay
  error, no se toca nada.
- Severidad: medio (correcto por diseño — ignora tipos desconocidos sin romper). Automatizable:
  vitest-unit trivial.

---

## 3. Cancelación

### CRÍTICO

**MP-C1 — Cancelación normal desde la app (`MiCuentaPage`, DUEÑO)**
- Given un tenant `active` con `mp_subscription_id='sub123'`, `sub123` está `authorized` en MP.
- When el DUEÑO hace clic en "Cancelar suscripción" → `cancel-suscripcion` con `body: {}`.
- Then MP: PUT a `preapproval/sub123` → `status: 'cancelled'`. DB: `tenants.subscription_status
  ='cancelled'`. `plan_tier` **NO se toca** (acceso hasta fin de período). Response
  `{cancelled: true, mp_cancelled: 1}`.
- Severidad: crítico. Automatizable: vitest-unit (lógica de candidatos/pertenencia/fail-closed
  extraída — hoy inline) + UAT-manual con preapproval real. Guard: `storedId` = camino principal +
  fail-closed check.

**MP-C2 — Fail-closed: PUT a MP falla (network/5xx) → NO marca `cancelled` en DB**
- Given un tenant con `mp_subscription_id='sub123'` vivo (`authorized`), MP devuelve 500 (o
  timeout) al intentar el PUT de cancelación.
- When se llama a `cancel-suscripcion`.
- Then `putRes.ok` es `false` → `errores.push('sub123:500')` → `storedConfirmado` queda `false`
  (nunca se setea a `true` porque el PUT no fue OK) → el chequeo final
  `if (errores.length || !storedConfirmado)` es verdadero → response HTTP 502
  `{error: 'No se pudo cancelar en Mercado Pago...'}`. DB: **`tenants.subscription_status` NO se
  actualiza** (sigue `active`, sigue cobrando, la UI no miente).
- Severidad: crítico (esto es exactamente el bug que se arregló — antes fail-openaba). Automatizable:
  vitest-unit (mock fetch PUT devolviendo 500) — **alto ROI, cero infra, es EL escenario que rompió
  producción**. Guard: `storedConfirmado` flag + `errores` array + gate final antes del UPDATE.

**MP-C3 — Fail-closed: `mp_subscription_id` guardado pero MP no lo puede confirmar (GET falla)**
- Given `tenants.mp_subscription_id='sub123'`, pero al hacer GET a `preapproval/sub123` MP
  responde 404 (id inválido/borrado) o 500.
- When `cancel-suscripcion` corre el loop de candidatos.
- Then `getRes.ok` falso → `if (id === storedId) errores.push('sub123:get_404')` → `continue` (no
  se marca `storedConfirmado=true` para el id guardado) → gate final → HTTP 502, DB sin cambios.
- Severidad: crítico (mismo patrón que MP-C2, cubre el otro punto de falla: lectura en vez de
  escritura). Automatizable: vitest-unit (mock GET 404). Guard: mismo gate `storedConfirmado`.

**MP-C4 — Cancelación desde panel `admin-api` (`billing.cancel_subscription`)**
- Given un STAFF con rol `admin` o `billing` en el panel `admin.genesis360.pro`, tenant T tiene
  `mp_subscription_id='subX'` vivo (con `external_reference` VACÍO, como en todo checkout por plan).
- When el STAFF ejecuta la acción `billing.cancel_subscription` con `{tenantId: T}`.
- Then `cancelarSubMP` cancela `subX` en MP (PUT status:'cancelled') y, sin errores, hace
  `UPDATE tenants SET subscription_status='cancelled'` + `audit({tenantId, mp_cancelled:1})`.
- Severidad: crítico. Automatizable: vitest-unit del espejo `cancelarSubMP` + UAT-manual del panel
  real. Guard: `ROLE_MODULES` (`admin`/`billing` → módulo `billing`) + fail-closed real (ver MP-C4b).

**🐞 MP-C4b — REGRESIÓN (bug real encontrado 2026-07-02, ARREGLADO): `admin-api` fail-abría**
- Given el mismo tenant T con `mp_subscription_id='subX'` vivo y `external_reference` VACÍO.
- When se cancela desde el panel con la versión VIEJA de `cancelarSubMP`, que gateaba con
  `if (pre.external_reference !== tenantId) continue`.
- Then el id guardado se SALTEABA (external_reference vacío ≠ tenant) → `mp_cancelled=0`,
  `errores=[]` → el handler marcaba `subscription_status='cancelled'` SIN cancelar en MP →
  **fail-open: el panel decía "cancelado" y MP seguía cobrando** (el MISMO bug de la app, en el
  camino DUPLICADO del panel — que la primera versión de este plan daba erróneamente por
  "fail-closed idéntico"; NO lo era).
- Fix (2026-07-02): `cancelarSubMP` ahora acepta pertenencia por `id === storedId` (además de
  external_reference) y es fail-closed real (si el id guardado no se confirma fuera de cobro,
  agrega `'no_confirmado'` a `errores` → NO marca cancelado). Debe quedar IDÉNTICO a
  `cancel-suscripcion` (evitar que las dos copias diverjan otra vez — ver "Candidatos a
  extracción" #2: unificar en un módulo compartido).
- Severidad: **crítico**. Automatizable: **vitest-unit obligatorio de regresión** — mock: preapproval
  `authorized` con `external_reference` vacío + `id === storedId` ⇒ DEBE dar `mp_cancelled=1`; GET/PUT
  fallando sobre el id guardado ⇒ DEBE devolver error (`'no_confirmado'`/`id:status`), NO marcar
  cancelado. Assert clave: el código NO debe saltear un id guardado por `external_reference` vacío.
  UAT-manual: cancelar la sub de prueba real desde el panel y confirmar en MP que pasó a "Cancelada".

**MP-C5 — STAFF ADMIN cancela la suscripción de un tenant AJENO desde `AdminPage`**
- Given un usuario con `rol='ADMIN'` (STAFF de plataforma, ver `reference_rol_admin_staff_aislamiento`)
  edita el tenant T2 (no el propio) desde `AdminPage`, cambia `subscription_status` a `cancelled`.
- When se llama a `cancel-suscripcion` con `body: {tenant_id: T2}`.
- Then el EF valida `userRow.rol === 'ADMIN'` (`callerTenantId !== requested` requiere rol ADMIN) →
  cancela en MP y en DB para T2. Otros roles (DUEÑO de T1 pidiendo cancelar T2) → 403.
- Severidad: crítico. Automatizable: vitest-unit (mock `userRow.rol`) + playwright-e2e (login como
  STAFF ADMIN real, cancelar un tenant de test) — ver también sección 9 (aislamiento). Guard:
  `if (requested !== callerTenantId) { if (userRow?.rol !== 'ADMIN') return 403 }`.

**MP-C6 — Doble cancelación (idempotente)**
- Given un tenant ya está `cancelled` en DB, y su preapproval ya está `cancelled` en MP.
- When se llama a `cancel-suscripcion` de nuevo (doble clic, reintento de red del cliente).
- Then el GET del preapproval devuelve `status: 'cancelled'` → `if (pre?.status === 'cancelled') {
  mpCancelled++; storedConfirmado=true; continue }` (no intenta un PUT redundante) → gate final
  pasa sin errores → `UPDATE tenants SET subscription_status='cancelled'` (no-op, ya lo estaba) →
  response `{cancelled:true, mp_cancelled:1}`.
- Severidad: alto (no debe romper ni devolver error en un doble clic). Automatizable: vitest-unit.
  Guard: el check `pre?.status === 'cancelled'` ANTES del PUT.

**MP-C7 — Cancelar sin preapproval vivo (tenant legacy sin `mp_subscription_id`, nunca linkeado)**
- Given un tenant viejo (pre-fix) con `mp_subscription_id=NULL`, `subscription_status='active'`
  (drift histórico — pagó pero nunca se linkeó por el bug original).
- When el DUEÑO cancela desde `MiCuentaPage`.
- Then `storedId=null` → `storedConfirmado = storedId ? false : true` → **arranca en `true`**
  (best-effort: sin id guardado, no hay nada que confirmar). El loop de candidatos busca por
  `external_reference=tenantId` (histórico, probablemente vacío en checkout-por-plan) — si no
  encuentra nada, `candidatos` queda vacío, el loop no corre, `errores=[]`,
  `storedConfirmado=true` → pasa el gate → `UPDATE tenants SET subscription_status='cancelled'`.
- Severidad: **alto — posible fail-OPEN residual**: si este tenant en realidad SÍ tiene un
  preapproval vivo en MP (pagando) pero nunca se linkeó (`mp_subscription_id` sigue NULL) y su
  `external_reference` tampoco lo tiene (checkout por plan), **la cancelación en DB "tiene éxito"
  sin haber cancelado nada en MP** → el tenant sigue siendo cobrado en MP pero la app dice
  "cancelado". Este es exactamente el mismo agujero estructural del bug original, para el
  subconjunto de tenants que jamás pasaron por `mp-verificar-suscripcion` con éxito. Automatizable:
  vitest-unit (confirmar el comportamiento actual del código) + **recomendación urgente**: correr
  la auditoría SQL de la sección 8 para identificar si existen tenants `active` con
  `mp_subscription_id IS NULL` HOY en PROD, y si existen, resolverlos manualmentes antes de que
  alguno intente cancelar y quede fail-open. Guard actual: NINGUNO adicional — depende 100% de que
  el linkeo haya ocurrido antes.

**MP-C8 — Cancelación desde el panel de MP directo (fuera de la app) → webhook sincroniza DB**
- Given el usuario cancela su preapproval directamente desde su cuenta de Mercado Pago (fuera de
  Genesis360), sin pasar por `cancel-suscripcion`.
- When MP dispara el webhook `subscription_preapproval` con `status: 'cancelled'`.
- Then `mp-webhook` resuelve `tenantId` por `mp_subscription_id` (fallback, dado que
  `external_reference` viene vacío) → `UPDATE tenants SET subscription_status='cancelled',
  mp_subscription_id=<id>`. La DB queda sincronizada SIN que el usuario haya usado el botón de la
  app.
- Severidad: crítico (sin esto, un usuario que cancela desde MP directamente queda con acceso
  "fantasma" — DB dice `active`, MP dice `cancelled`, situación inversa a la del bug original pero
  igual de grave: revenue perdido sin que el sistema se entere). Automatizable: vitest-unit (mismo
  MP-W1 pero con status `cancelled`) + UAT-manual (cancelar un preapproval real desde el dashboard
  de MP, confirmar sync). Guard: el mismo fallback `mp_subscription_id` de MP-W1/W6.

### ALTO

**MP-C9 — Acceso se mantiene hasta fin de período (no se toca `plan_tier` al cancelar)**
- Given un tenant Pro cancela su suscripción a mitad de ciclo de facturación.
- When `cancel-suscripcion` marca `subscription_status='cancelled'`.
- Then `plan_tier` sigue `'pro'` en DB — el UPDATE de cancelación **solo** toca
  `subscription_status`. `usePlanLimits`/`fn_tenant_limite` deben seguir dando límites Pro hasta
  que expire el período (dependiendo de cómo el resto del sistema interprete `cancelled` +
  `plan_tier`).
- Severidad: alto — **falta verificar** si existe algún guard adicional en `usePlanLimits`/
  `AuthGuard`/`SubscriptionGuard` que trate `cancelled` como "sin acceso inmediato" vs
  "acceso degradado hasta tal fecha" (no se ve un campo tipo `access_until` en el `UPDATE`).
  Riesgo: si `SubscriptionGuard` bloquea apenas ve `cancelled` (sin mirar fecha), el usuario pierde
  acceso INMEDIATO pese a "hasta fin de período" prometido en el toast (`'Tu plan pasará a Free al
  finalizar el período'`) — contradicción potencial UX↔lógica real. **Acción**: leer
  `SubscriptionGuard`/`AuthGuard.tsx` para confirmar el comportamiento real y agregar un escenario
  específico (candidato a plan aparte si no está cubierto). Automatizable: vitest-unit (una vez
  confirmada la lógica real) o playwright-e2e.

### MEDIO

**MP-C10 — Cancelación con `MP_ACCESS_TOKEN` no configurado (config de entorno)**
- Given la env var `MP_ACCESS_TOKEN` no está seteada en el entorno de la Edge Function (error de
  deploy/config).
- When se llama a `cancel-suscripcion` (o cualquier EF de esta familia).
- Then `if (!mpToken) return json({error:'MP no configurado'}, 500)` — falla explícito y temprano,
  sin tocar DB.
- Severidad: medio (config, no lógica de negocio) pero previene un fail-open silencioso. Automatizable:
  vitest-unit trivial.

---

## 4. Cambio de plan

### ALTO

**MP-P1 — Básico → Pro: la sub anterior se cancela (cubierto en MP-A10, referencia cruzada)**
Ver MP-A10. Mismo escenario, mirado desde "cambio de plan" en vez de "activación": el punto de
riesgo es el DOBLE COBRO si la cancelación best-effort de `prevSubId` falla silenciosamente.

**MP-P2 — Pro → Básico (downgrade guiado del PLAN, no de add-ons)**
- Given un tenant Pro con uso actual por encima del límite Básico (ej. 3.500 productos activos,
  Básico tope 2.000).
- When el usuario intenta bajar de Pro a Básico desde `SuscripcionPage` (`handleSuscribir` con el
  plan Básico).
- Then **hallazgo a confirmar**: `handleSuscribir` simplemente redirige a un NUEVO checkout de MP
  para el plan Básico — no hay ningún guard visible en el código leído que bloquee el downgrade de
  PLAN por uso excedido (a diferencia del downgrade guiado de ADD-ONS fijos, que sí lo tiene en
  `mp-addon-fijo`). Si el usuario completa el pago del plan Básico, `mp-verificar-suscripcion`
  activaría igual (no hay check de `productos_actuales > TIER_BASE.basico.max_productos` en ese
  EF). El tenant quedaría en `plan_tier='basico'` con 3.500 productos activos (por encima del
  límite básico) — degradación silenciosa de límites, no bloqueo.
- Severidad: alto — **requiere decisión de producto de GO**: ¿el downgrade de PLAN debe tener el
  mismo guard de "downgrade guiado" que los add-ons fijos (bloquear hasta desactivar excedente), o
  es aceptable que el tenant quede sobre-límite y simplemente no pueda crear más hasta bajar? Hoy
  el comportamiento real es "sin bloqueo, sin guard" — anotar como **gap a resolver antes de
  ofrecer downgrade de plan en producción**, no solo como test. Automatizable: una vez definido el
  comportamiento esperado, vitest-unit + playwright-e2e.

---

## 5. Add-ons

### CRÍTICO

**MP-AD1 — Add-on TEMPORAL (movimientos): pago único, vence a 30 días**
- Given un tenant compra un pack de 5.000 movimientos ($10.000) vía `mp-addon`.
- When el pago se aprueba y llega el webhook `type: 'payment'`.
- Then `parseAddonRef` reconoce `tipo:'temporal'` → `INSERT INTO tenant_addons {tenant_id,
  dimension:'movimientos', cantidad:5000, tipo:'temporal', vence_at: now+30d,
  mp_payment_id: paymentId}`. DB: `usePlanLimits` debe sumar esos 5.000 al límite efectivo mientras
  `vence_at > now`.
- Severidad: crítico. Automatizable: vitest-unit YA cubierto parcialmente en `addons.test.ts`
  (serialización del ref) — **falta** el test de la lógica de acreditación/vencimiento en sí
  (candidato a extracción, ver abajo). Guard: `parseAddonRef` + `uq_tenant_addons_mp_payment`.

**MP-AD2 — Precio SIEMPRE del catálogo server-side, nunca del cliente**
- Given un cliente manipulado envía `mp-addon` con `{dimension:'movimientos', cantidad: 999999}`
  (cantidad inventada, no en el catálogo).
- When `mp-addon` revalida contra `ADDON_PACKS.movimientos.packs.find(p => p.cantidad === cantidad)`.
- Then no encuentra match → `throw new Error('Pack de movimientos inválido: 999999')` → HTTP 400,
  no se crea preferencia de pago, no se cobra nada.
- Severidad: crítico (evita comprar cantidades arbitrarias a precio inventado/gratis). Automatizable:
  vitest-unit (parte de esta lógica YA está cubierta indirectamente en `addons.test.ts` vía
  `findAddonPack` — falta el test específico del EF `mp-addon`/`mp-addon-fijo` rechazando el
  request, mockeado). Guard: catálogo `ADDON_PACKS` hardcodeado server-side + `.find()`.

**MP-AD3 — Add-on FIJO: ALTA fail-closed si el PUT a MP falla**
- Given un tenant con `mp_subscription_id='subX'` activo, monto actual $60.000, agrega un add-on
  de 3 usuarios ($10.000/mes).
- When `mp-addon-fijo` hace `PUT preapproval/subX {auto_recurring:{transaction_amount: 70000}}` y
  MP devuelve 500.
- Then `if (!putRes.ok) return json({error:...}, 502)` — **NO se inserta la fila en
  `tenant_addons`**. DB: sin cambios, el tenant sigue con el límite base de usuarios, MP sigue
  cobrando $60.000 (no se subió el monto).
- Severidad: crítico (fail-closed correcto — nunca "regalar" upgrade sin que MP confirme el nuevo
  cobro). Automatizable: vitest-unit (mock PUT 500) — **candidato a extracción**, la lógica de
  "calcular nuevoMonto, intentar PUT, solo si OK insertar" es pura y vale la pena testear aislada
  del Deno runtime. Guard: gate `if (!putRes.ok) return 502` antes del insert.

**MP-AD4 — Add-on FIJO: ALTA con insert fallido tras PUT exitoso → revierte el monto en MP**
- Given el PUT a MP fue exitoso (nuevo monto $70.000 confirmado), pero el
  `INSERT INTO tenant_addons` falla (ej. constraint, timeout de DB).
- When `mp-addon-fijo` detecta `insErr`.
- Then hace un segundo PUT best-effort para volver el monto a $60.000 (`.catch(() => {})` — no
  bloqueante) y responde HTTP 500 `{error: 'Se revirtió el monto; reintentá.'}`.
- Severidad: crítico (evita quedar cobrando de más sin el add-on efectivamente otorgado) — **pero
  el revert es best-effort/fire-and-forget**: si ESE segundo PUT también falla, el tenant queda
  pagando $70.000 sin add-on registrado y sin ningún log más allá del `console.error` inicial. Es
  un gap de conciliación (mismo patrón de riesgo que MP-A10). Automatizable: vitest-unit (mock
  insert fallando, confirmar que se intenta el revert) + anotar el sub-caso "revert también falla"
  como riesgo residual a vigilar por la auditoría SQL de drift (comparar monto real MP vs
  `precioBase + precioMensualAddonsFijos(tenant_addons)` esperado).

**MP-AD5 — Add-on FIJO: BAJA bloqueada por downgrade guiado (uso excede el nuevo límite)**
- Given un tenant Básico (base 2.000 SKU) tiene un add-on fijo de 2.000 SKU (`tenant_addons`,
  límite efectivo 4.000), usa 3.200 productos activos, intenta quitar el add-on.
- When `mp-addon-fijo` con `action:'quitar'`.
- Then `fn_tenant_limite` da 4.000 (límite CON el add-on), `nuevoLimite = 4000-2000 = 2000`,
  `uso=3200 > 2000` → response `{blocked:true, reason:'downgrade', excedente:1200, nuevo_limite:2000,
  uso:3200, dimension:'sku'}`, HTTP 200 (no es error). DB: **no se toca nada** (ni el monto de MP
  ni `tenant_addons`).
- Severidad: crítico (evita que un downgrade deje al tenant con menos productos permitidos de los
  que tiene activos, sin aviso — inconsistencia de negocio, no solo de plata). Automatizable:
  vitest-unit — la lógica de "cuánto excede" YA está extraída y testeada en `addons.test.ts`
  (`evaluarDowngrade`), **falta** el test de integración del EF que llama a `fn_tenant_limite` +
  cuenta `activo=true` y arma la response `blocked`. Guard: bloque `if (tabla) { ... if (uso >
  nuevoLimite) return json({blocked:true,...}) }`.

**MP-AD6 — Add-on FIJO: BAJA exitosa ajusta el monto por DELTA (resta el precio del pack)**
- Given un tenant con monto actual $85.000 (Pro $60k + add-on sucursales $15k + add-on usuarios
  $10k), quita el add-on de sucursales.
- When `mp-addon-fijo` con `action:'quitar'`, `addon_id` del add-on de sucursales.
- Then `nuevoMonto = 85000 - 15000 = 70000` → PUT a MP → si OK, `DELETE FROM tenant_addons WHERE
  id=addon_id`.
- Severidad: alto. Automatizable: vitest-unit (cálculo delta puro, candidato a extracción) + mock
  del flujo completo.

**MP-AD7 — Idempotencia de add-on fijo: doble clic en "Agregar"**
- Given el usuario hace doble clic en "Agregar" para el mismo pack antes de que la UI deshabilite
  el botón (`addonBusy` debería prevenirlo, pero validar el caso de dos requests concurrentes).
- When llegan dos invocaciones casi simultáneas de `mp-addon-fijo action:'agregar'` con el mismo
  pack.
- Then **hallazgo**: a diferencia del add-on TEMPORAL (que tiene `uq_tenant_addons_mp_payment`),
  el add-on FIJO **no tiene ninguna clave de idempotencia** — cada invocación exitosa hace su
  propio PUT delta + insert. Dos requests concurrentes podrían sumar el precio DOS VECES (montoActual
  leído por ambas ANTES de que la primera termine su PUT → race condition clásica de
  read-then-write sin lock).
- Severidad: alto — riesgo real de doble cobro por double-submit, mitigado en el cliente por
  `addonBusy` (deshabilita el botón) pero **sin ningún guard server-side**. Automatizable:
  vitest-unit (simular dos llamadas con el mismo `montoActual` base, confirmar que ambas escriben
  sin conflicto = bug reproducido) + **recomendación**: agregar un lock optimista (ej.
  `UPDATE tenants SET ... WHERE mp_subscription_id=X AND <version>` o serializar por
  `advisory_lock` en `tenantId`) antes de habilitar este flujo a escala. Guard actual: NINGUNO
  server-side (solo `addonBusy` en el cliente, bypasseable).

### MEDIO

**MP-AD8 — Add-on legacy `|addon_movimientos` (back-compat, links de pago viejos)**
- Given llega un pago con `external_reference` terminado en `|addon_movimientos` (formato legacy
  pre-Fase2).
- When el webhook procesa.
- Then suma 500 a `tenants.addon_movimientos` (columna legacy, no `tenant_addons`). Sin
  idempotencia explícita en este branch (no hay `uq_` ni check de duplicado) — **si MP reenvía,
  este camino SÍ duplica el crédito**, a diferencia del camino nuevo (MP-W3).
- Severidad: medio (solo afecta a integraciones/links viejos, no al flujo actual de la UI, pero
  sigue siendo código vivo en el webhook). Automatizable: vitest-unit (confirmar la ausencia de
  guard, documentar el riesgo) + recomendación de agregar el mismo patrón de log-idempotente si
  este camino sigue en uso.

---

## 6. Webhook — robustez / seguridad

### ALTO

**WH-SIG — Validación de firma `x-signature` del webhook de MP**
- Given MP firma sus webhooks con `x-signature` + `x-request-id` (estándar de MP para verificar
  autenticidad).
- When llega un POST a `mp-webhook` con esos headers.
- Then **hallazgo H2**: el código actual NO lee ni valida `x-signature` contra ningún secret. La
  mitigación real es indirecta: cada rama hace un GET a MP con el token de la plataforma para
  confirmar el estado real antes de escribir en DB, así que un payload falso con IDs inventados no
  logra nada. El riesgo residual es: (a) alguien con un `payment_id`/`preapproval_id` REAL propio
  (de un pago legítimo ya hecho) podría re-disparar el procesamiento antes de tiempo o generar
  carga; (b) no hay rechazo temprano de tráfico no-MP (costo de invocaciones/DoS leve).
- Severidad: alto (no crítico porque no hay path de escritura sin confirmación cruzada contra MP,
  pero es una desviación del estándar de seguridad de webhooks). Automatizable: UAT-manual (revisar
  si `MP_WEBHOOK_SECRET` existe como env var no usada) + recomendación de implementar la validación
  oficial (`x-signature` con HMAC-SHA256 sobre `id`+`request-id`+`ts`, documentado por MP) como
  mejora, no bloqueante para este plan pero SÍ para reportar a GO por REGLA #0 (dato sensible:
  revenue).

**WH-LEGACY — Rama `else` final del pago de plataforma (ni add-on ni legacy) activa sin guard**
- Given un `payment.external_reference` que es un UUID de tenant válido pero NO tiene el formato
  `|addon|` ni `|addon_movimientos` (ej. quedó de un flujo viejo tipo `crear-suscripcion`, o
  cualquier dato que technically parsee como UUID).
- When el pago se aprueba.
- Then cae al `else` final: `UPDATE tenants SET subscription_status:'active' WHERE id = ref` — **sin
  verificar el monto pagado, sin verificar que `ref` sea realmente un tenant_id (podría ser
  cualquier string), sin idempotencia, sin verificar que el pago corresponda a un plan válido**.
- Severidad: alto (superficie de riesgo heredada — ver H5/H1: se activa junto con `crear-suscripcion`
  legacy, que es el único emisor conocido de este formato de `external_reference`). Automatizable:
  vitest-unit (documentar el comportamiento actual como regression-guard) + **recomendación fuerte**:
  eliminar esta rama junto con `crear-suscripcion` si se confirma que no hay flujo activo que la
  use (H1), o si se mantiene, agregarle el mismo patrón de idempotencia + validación de monto que
  el resto.

**WH-DIST — No confundir pago de venta de seller conectado con pago de plataforma**
- Given un tenant tiene MP conectado para cobrar SUS PROPIAS ventas (`mercadopago_credentials`,
  `conectado=true`), y llega un webhook `type:'payment'` con `event.user_id` = el `seller_id` de
  ESE tenant.
- When el EF resuelve `sellerCred` por `seller_id`.
- Then usa el `access_token` del SELLER (no el de la plataforma) para consultar el pago, y lo trata
  como pago de VENTA (rama `if (sellerCred)`), nunca como pago de suscripción de plataforma —
  aunque el `external_reference` casualmente matcheara un patrón de add-on/tenant.
- Severidad: alto (mezclar estos dos mundos sería un bug fiscal/contable grave — cobrarle a un
  cliente del tenant y acreditarlo como pago de la SUSCRIPCIÓN del tenant, o viceversa).
  Automatizable: vitest-unit (mock de `sellerCred` presente vs ausente, confirmar ramas mutuamente
  excluyentes) — ya bien separado en el código (`if (sellerCred) {...} else {...}`), cubrir con
  test de regresión. Guard: lookup de `mercadopago_credentials` por `seller_id` ANTES de decidir la
  rama.

### MEDIO

**WH-DUP-TYPE — Mismo `payment_id` llega como `payment` Y luego re-consultado por otro webhook `merchant_order`**
- Given MP a veces notifica el mismo evento lógico bajo distintos `type` (comportamiento documentado
  de MP con `merchant_order`).
- When llega un tipo no manejado.
- Then cubierto por MP-W7 (ignora tipos desconocidos). Sin riesgo adicional siempre que
  `merchant_order` no dispare una rama de escritura — confirmado que no la dispara (no hay
  `if (type === 'merchant_order')` en el código).
- Severidad: medio. Automatizable: vitest-unit trivial (regresión).

---

## 7. Integridad contable REGLA #0 (suscripción de PLATAFORMA vs tenant)

### CRÍTICO

**RG0-1 — El cobro de suscripción de PLATAFORMA NO asienta caja del tenant**
- Given un tenant paga su suscripción mensual (Pro, $100.000) vía preapproval.
- When el webhook procesa `subscription_preapproval`/`preapproval` `authorized`.
- Then el único efecto es `UPDATE tenants SET subscription_status, mp_subscription_id, plan_tier,
  max_users, max_productos`. **Ninguna fila se inserta en `caja_movimientos`, `caja_sesiones`,
  `movimientos_stock`, ni ninguna tabla de contabilidad del tenant.** El dinero de la suscripción
  es 100% revenue de Genesis360 (la plataforma), no del negocio del tenant — no debe aparecer en
  el arqueo de caja del tenant bajo ningún concepto.
- Severidad: crítico (REGLA #0 explícita — mezclar esto sería un error contable grave: el arqueo de
  caja de un kiosco no puede incluir lo que le paga a Genesis360). Automatizable: vitest-unit
  (assert de que la función de manejo de `subscription_preapproval` no referencia ninguna tabla de
  caja/stock) + playwright-e2e con aserción NEGATIVA en DB (después de activar una suscripción de
  test, `SELECT count(*) FROM caja_movimientos WHERE ... AND created_at > <momento del pago>` debe
  dar 0 filas nuevas atribuibles al pago de plataforma). Contraste explícito: el pago de una VENTA
  del tenant (rama `sellerCred`) SÍ asienta `ingreso_informativo` en caja (`asentarIngresoInformativoMp`)
  — ese es el comportamiento correcto para ESE caso, y el escenario acá es confirmar que NO se
  confunden (ver WH-DIST).

**RG0-2 — Refund de un pago de plataforma (ej. devolución del test de $1.000) no descuadra nada del tenant**
- Given GO hizo un test real con el plan Básico a $1.000 (ver MEMORY.md, sesión 2026-07-02) y en
  algún momento se hace un refund/devolución de ese pago desde MP.
- When MP notifica el evento de refund (`type` podría ser `payment` con `status: 'refunded'`, o un
  tipo dedicado según la versión de API de MP).
- Then **hallazgo**: no se ve en el código ningún manejo explícito de `status: 'refunded'` para
  pagos de plataforma — el filtro es `payment.status === 'approved'`, así que un refund
  simplemente NO dispara ninguna rama (no es `approved`). **Esto significa que un refund NO
  revierte automáticamente `subscription_status='active'`** — el tenant seguiría con acceso activo
  pese a la devolución, hasta que el ciclo de `subscription_preapproval` lo actualice (si MP
  cancela/pausa el preapproval como consecuencia del refund) o alguien lo cancele manualmente.
- Severidad: alto — riesgo de acceso otorgado sin cobro vigente tras un refund, pero acotado (no es
  un problema de PLATA del tenant, es un problema de revenue de Genesis360, y el volumen de refunds
  de suscripción esperado es bajísimo). Automatizable: vitest-unit (documentar el comportamiento
  actual) + UAT-manual (hacer el refund real del test de $1.000 pendiente — VER MEMORY.md
  "volver a $60.000 al terminar" — y confirmar qué pasa con el tenant de prueba). **Acción para
  GO**: al cerrar el test con Fede, verificar manualmente que el tenant de prueba quede en el
  estado correcto tras el refund/cancelación, no asumir que el webhook lo resuelve solo.

### MEDIO

**RG0-3 — Add-on temporal vencido (`vence_at < now`) dejar de contar en `usePlanLimits`, sin tocar plata**
- Given un add-on temporal de 5.000 movimientos con `vence_at` en el pasado.
- When `usePlanLimits` calcula `addonSum('movimientos')`.
- Then el filtro `a.tipo === 'fijo' || (a.vence_at && new Date(a.vence_at) > now)` excluye el
  vencido → no suma esos 5.000 al límite efectivo. La fila NO se borra de `tenant_addons` (queda
  como historial), solo deja de contar.
- Severidad: medio (no es plata, es límite de uso — pero sí puede bloquear al tenant de golpe si
  dependía de ese extra, UX a comunicar). Automatizable: vitest-unit puro (ya el patrón de filtro
  está en `usePlanLimits`, candidato a extracción a `src/lib/` para testear sin React Query — ver
  abajo).

---

## 8. Consistencia DB↔MP (anti-drift) — queries de auditoría SQL

Correr periódicamente (recomendado: sweep semanal o antes de cada cierre de sprint de billing).
Todas son de SOLO LECTURA — usar `execute_sql` (permitido para diagnóstico, no DDL).

```sql
-- DRIFT 1: tenants 'active' SIN mp_subscription_id (nunca se linkearon — candidatos a MP-C7)
-- Riesgo: si cancelan, la cancelación puede fail-abrir (no hay nada que confirmar en MP).
SELECT id, nombre, subscription_status, plan_tier, mp_subscription_id, created_at
FROM tenants
WHERE subscription_status = 'active' AND mp_subscription_id IS NULL;

-- DRIFT 2: tenants 'cancelled'/'trial' en DB pero con preapproval VIVO en MP
-- (requiere cruzar contra la API de MP externamente — acá solo se listan los candidatos a
--  chequear manualmente por mp_subscription_id, ya que Postgres no puede llamar a MP directo)
SELECT id, nombre, subscription_status, mp_subscription_id
FROM tenants
WHERE subscription_status IN ('cancelled', 'trial') AND mp_subscription_id IS NOT NULL;
-- Para cada fila: GET https://api.mercadopago.com/preapproval/<mp_subscription_id> y confirmar
-- que su status NO sea 'authorized' (si lo es → drift real: MP sigue cobrando, DB dice cancelado).

-- DRIFT 3: mp_subscription_id NULL con status 'active' (mismo universo que DRIFT 1, variante)
SELECT count(*) AS tenants_sin_link_activos
FROM tenants
WHERE subscription_status = 'active' AND (mp_subscription_id IS NULL OR mp_subscription_id = '');

-- DRIFT 4: plan_tier vs monto esperado — tenants con add-ons fijos activos
-- (para cruzar manualmente contra auto_recurring.transaction_amount real en MP)
SELECT t.id, t.nombre, t.plan_tier, t.mp_subscription_id,
       (SELECT precio FROM (VALUES ('basico',60000),('pro',100000)) AS p(tier,precio) WHERE p.tier = t.plan_tier) AS precio_base_esperado,
       COALESCE(SUM(CASE WHEN a.tipo = 'fijo' THEN
         CASE a.dimension
           WHEN 'sku' THEN CASE a.cantidad WHEN 500 THEN 5000 WHEN 2000 THEN 10000 WHEN 8000 THEN 25000 END
           WHEN 'sucursales' THEN CASE a.cantidad WHEN 1 THEN 15000 WHEN 3 THEN 35000 WHEN 5 THEN 55000 END
           WHEN 'usuarios' THEN CASE a.cantidad WHEN 1 THEN 5000 WHEN 3 THEN 10000 WHEN 5 THEN 15000 END
           WHEN 'movimientos' THEN CASE a.cantidad WHEN 1000 THEN 5000 WHEN 5000 THEN 10000 WHEN 20000 THEN 15000 END
         END
       ELSE 0 END), 0) AS addons_fijos_esperado
FROM tenants t
LEFT JOIN tenant_addons a ON a.tenant_id = t.id AND a.tipo = 'fijo'
WHERE t.subscription_status = 'active' AND t.mp_subscription_id IS NOT NULL
GROUP BY t.id, t.nombre, t.plan_tier, t.mp_subscription_id;
-- Comparar precio_base_esperado + addons_fijos_esperado contra el auto_recurring.transaction_amount
-- REAL de MP para cada mp_subscription_id (llamada externa) → detecta drift de MP-AD3/MP-AD4/MP-AD7.

-- DRIFT 5: mismo preapproval linkeado a MÁS DE UN tenant (no debería poder pasar por el claim
-- exclusivo de mp-verificar-suscripcion, pero confirmar que no hay resabios de antes del fix)
SELECT mp_subscription_id, count(*), array_agg(id) AS tenants
FROM tenants
WHERE mp_subscription_id IS NOT NULL
GROUP BY mp_subscription_id
HAVING count(*) > 1;

-- DRIFT 6: add-ons temporales vencidos hace mucho que nunca se limpiaron (housekeeping, no riesgo
-- de plata pero sí de tabla creciendo sin fin — confirmar si hay algún sweep de borrado)
SELECT count(*), min(vence_at), max(vence_at)
FROM tenant_addons
WHERE tipo = 'temporal' AND vence_at < now() - interval '90 days';
```

- Severidad: crítico (DRIFT 1/2/3/5 — plata/acceso). DRIFT 4 alto (plata, pero requiere cruce manual
  con MP). DRIFT 6 bajo (housekeeping).
- Tipo: **UAT-manual** (SQL de solo lectura corrido a mano/periódicamente; DRIFT 2 y 4 requieren
  además llamadas a la API de MP que no son SQL). No automatizable como test unitario — es
  monitoreo operativo, no test de CI. Candidato a convertir en un endpoint/cron de "salud de
  billing" a futuro (fuera de alcance de este plan).

---

## 9. Multi-tenant / aislamiento

### CRÍTICO

**MT-1 — Un tenant no puede cancelar la suscripción de otro tenant (rol normal)**
- Given usuario DUEÑO del tenant T1, intenta invocar `cancel-suscripcion` con
  `body: {tenant_id: T2}` (T2 ajeno).
- When el EF valida `requested !== callerTenantId` y `userRow?.rol !== 'ADMIN'`.
- Then HTTP 403 `{error: 'No autorizado para cancelar otra cuenta'}`. Ni MP ni DB de T2 se tocan.
- Severidad: crítico. Ya parcialmente cubierto en MP-C5 (caso positivo del STAFF ADMIN); este es el
  caso negativo explícito. Automatizable: vitest-unit + playwright-e2e (login T1, invocar function
  con `tenant_id` de T2 real de test, confirmar 403 y que T2 sigue activo). Guard: chequeo de rol
  ANTES de tocar `tenantId = requested`.

**MT-2 — RLS: `tenants_update` solo permite UPDATE a DUEÑO/ADMIN del propio tenant o `is_admin()`**
- Given un usuario con rol distinto de DUEÑO/ADMIN (ej. CAJERO) intenta un UPDATE directo a
  `tenants.subscription_status` vía cliente Supabase (bypasseando la UI).
- When corre la policy `tenants_update`.
- Then `USING (... AND rol IN ('DUEÑO','ADMIN')) OR is_admin()` — un CAJERO no cumple ninguna
  condición → UPDATE bloqueado por RLS (0 filas afectadas o error, según política).
- Severidad: crítico. Nota: esta policy protege el UPDATE DIRECTO desde el cliente; los EFs
  (`mp-verificar-suscripcion`, `cancel-suscripcion`, `mp-webhook`) usan `service_role` (bypassa
  RLS) — la protección real de ESOS caminos está en la lógica de la EF (validación de
  `auth.getUser()` + `tenantId` derivado del JWT), no en la policy. Automatizable: playwright-e2e
  con impersonación SQL (patrón de `reference_e2e_validation_capability`) — intentar el UPDATE
  directo con un JWT de CAJERO y confirmar el bloqueo. Guard: policy `tenants_update` en
  `schema_full.sql:713`.

**MT-3 — `mp-verificar-suscripcion` deriva `tenantId` SIEMPRE del JWT del caller, nunca del body**
- Given un usuario del tenant T1 intenta pasar algún parámetro que sugiera activar T2 (el EF no
  acepta `tenant_id` en el body en absoluto — solo `preapproval_id`).
- When se invoca.
- Then `tenantId` sale exclusivamente de `userClient.from('users').select('tenant_id').eq('id',
  user.id)` — no hay forma de inyectar un tenant distinto desde el cliente.
- Severidad: crítico (por diseño, sin superficie de ataque visible). Automatizable: vitest-unit de
  regresión (confirmar que el body parseado nunca se usa para determinar `tenantId`).

---

## 10. Config entorno DEV vs PROD (UAT-manual)

**ENV-1 — El webhook de MP apunta a UN SOLO entorno (chequeo manual obligatorio)**
- Given la configuración de notificaciones de MP (`notification_url` / webhook URL registrada en
  el panel de MP o en `crear-suscripcion`/`mp-addon` como `${SUPABASE_URL}/functions/v1/mp-webhook`)
  apunta a un `SUPABASE_URL` específico (DEV `gcmhzdedrkmmzfzfveig` **o** PROD `jjffnbrdjchquexdfgwq`,
  no ambos).
- When se testea un checkout de suscripción/add-on en el entorno QUE NO tiene el webhook
  configurado (ej. se prueba en DEV pero el webhook de la cuenta de MP usada apunta a PROD).
- Then el pago se aprueba en MP, pero el webhook llega al proyecto Supabase equivocado → la DB del
  entorno donde se está probando **nunca se actualiza** — el tester ve "no se activó" y puede
  interpretarlo erróneamente como un bug de código, cuando es un problema de config de entorno.
- Severidad: alto (fuente de falsos negativos/positivos en testing, y riesgo real si DEV y PROD
  comparten la MISMA cuenta de MP con planes distintos — un pago de test en DEV podría notificar a
  PROD y activar un tenant de PROD por error si los `MP_PLAN_IDS` coincidieran).
- Tipo: **UAT-manual, checklist previo a cualquier sesión de testing de billing**:
  1. Confirmar qué `SUPABASE_URL` está registrado como notification_url en la cuenta de MP usada
     para el test (panel de MP → aplicación → webhooks, o mirar el `notification_url` que mandan
     `mp-addon`/`crear-suscripcion` al crear la preferencia/preapproval).
  2. Confirmar que `MP_PLAN_BASICO`/`MP_PLAN_PRO` (env vars) en el proyecto Supabase bajo test
     correspondan a los planes de la MISMA cuenta de MP que se está usando para pagar.
  3. Si se va a testear en DEV, considerar temporalmente redirigir el webhook a DEV (o usar
     `mp-verificar-suscripcion` como respaldo manual — no depende del webhook, solo de que el
     usuario vuelva a `/suscripcion`).
  4. **NUNCA testear pagos reales de suscripción apuntando el checkout a los planes de PROD
     mientras se observa el resultado en DEV** — el mismo error de fondo que motivó anotar esto.
- No automatizable (es config de infraestructura externa, no código). Guard: ninguno automático —
  depende de disciplina operativa. Recomendación: documentar en el wiki (`reference_mp_suscripcion_cancel.md`
  ya tiene contexto relacionado) cuál es el `notification_url` activo HOY y en qué entorno.

---

## Candidatos a extracción (lógica pura hoy inline en Edge Functions Deno)

Las EFs no pueden importar `src/lib/` (bundle de frontend, runtime distinto), así que la extracción
real implica crear un módulo compartido (o duplicarlo deliberadamente como ya se hace con
`ADDON_PACKS`/`parseAddonRef` en `mp-webhook`) y testearlo con vitest. Priorizados por ROI:

1. **Resolución de pertenencia de preapproval** (`mp-verificar-suscripcion`): la cadena
   `payer_email match → claim exclusivo → plan reconocido → status authorized` es lógica de
   decisión pura si se le pasan los datos ya obtenidos (mock de `sub`, `userEmail`, `otro`). Cubre
   MP-A3/A4/A5/A6/A7/A8. **Alta prioridad** — es el corazón del fix que rompió producción.
2. **Fail-closed de cancelación** (`cancel-suscripcion` + espejo en `admin-api`): la función
   `evaluarCancelacion(candidatos, storedId) → {errores, storedConfirmado, accionMP}` es pura si se
   inyectan los resultados de los fetch como datos. Cubre MP-C2/C3/C6/C7. **Alta prioridad** — el
   otro corazón del fix, y HOY está duplicada entre `cancel-suscripcion` y `admin-api` (mismo
   algoritmo copiado, riesgo de que diverjan con el próximo cambio).
3. **Cálculo de delta de monto en add-ons fijos** (`mp-addon-fijo`): `calcularNuevoMonto(montoActual,
   pack, accion)` + el guard de downgrade (`evaluarDowngrade` YA extraído en `src/lib/addons.ts` —
   falta el análogo Deno-side o unificar). Cubre MP-AD3/AD5/AD6.
4. **Mapeo de `payment.status`/`preapproval.status` → `newStatus` de tenant** (`mp-webhook`): hoy es
   un `switch` inline de 5 líneas — bajo ROI de extraer solo por eso, pero si se extrae junto con
   el punto 1 (comparten el concepto "estado MP → estado tenant") gana sentido.
5. **Filtro de add-ons vigentes** (`usePlanLimits`): `addonSum(dim, addons, now)` ya casi está
   aislado del resto del hook — extraer a `src/lib/addons.ts` (junto a `evaluarDowngrade`) para
   testear el borde exacto de vencimiento (`vence_at === now`, `vence_at` en el pasado por 1ms,
   etc.) sin montar React Query. Cubre RG0-3.

---

## Resumen

**Total de escenarios: 43** (39 de ciclo de vida MP + 4 en la sección de auditoría SQL contadas
como un bloque UAT-manual único DRIFT 1-6, aquí contadas individualmente donde aplica severidad
distinta).

| # | Escenario | Severidad | Tipo | Guard actual |
|---|---|---|---|---|
| MP-A1 | Activación normal por preapproval_id | crítico | unit + UAT-manual | `mp-verificar-suscripcion` |
| MP-A2 | Activación por búsqueda payer_email | crítico | unit + UAT-manual | `mp-verificar-suscripcion` (search) |
| MP-A3 | external_reference vacío no bloquea activación | crítico | unit | ausencia deliberada de lectura de ref |
| MP-A4 | payer_email ≠ usuario → owner_mismatch | crítico | unit + e2e | check `subEmail !== userEmail` |
| MP-A5 | Preapproval ya reclamado por otro tenant | crítico | unit + UAT-manual | claim exclusivo `neq('id', tenantId)` |
| MP-A6 | Plan desconocido → rechazo | crítico | unit | `MP_PLAN_TIER[plan]` lookup |
| MP-A7 | status pending → no activa | alto | unit | check `status !== 'authorized'` |
| MP-A8 | Auto-activación con preapproval ajeno sin pagar | crítico | e2e + unit | mismo guard que MP-A4 |
| MP-A9 | Sin preapproval_id ni email resoluble | alto | unit | `if (!sub?.id)` |
| MP-A10 | Cambio de plan cancela sub anterior (evita doble cobro) | alto | unit | bloque `prevSubId` (best-effort, sin alerta en fallo) |
| MP-A11 | Búsqueda payer_email con >100 resultados | medio | unit | paginación (techo 1000) |
| MP-W1 | Webhook authorized → activa tenant | crítico | unit + UAT-manual | bloque `subscription_preapproval` |
| MP-W2 | Pago rechazado → no toca tenant (ciclo de reintentos MP sin manejo explícito) | crítico | UAT-manual | filtro `status === 'approved'` (gap: sin acción explícita en rejected) |
| MP-W3 | Idempotencia add-on temporal (reenvío MP) | crítico | unit | `uq_tenant_addons_mp_payment` + catch 23505 |
| MP-W4 | Idempotencia pago de venta (reenvío MP) | crítico | unit | UNIQUE `ventas_externas_logs` + catch 23505 |
| MP-W5 | Webhook preapproval sin data.id | alto | unit | `throw new Error` controlado |
| MP-W6 | Cobro recurrente sin tenant linkeado (pago se pierde silencioso) | alto | unit | NINGUNO (gap — depende de MP-A2 posterior) |
| MP-W7 | type desconocido → no-op | medio | unit | ausencia de rama |
| MP-C1 | Cancelación normal desde la app | crítico | unit + UAT-manual | `cancel-suscripcion` |
| MP-C2 | Fail-closed: PUT a MP falla | crítico | unit | flag `storedConfirmado` + `errores` |
| MP-C3 | Fail-closed: GET a MP falla (no confirmable) | crítico | unit | mismo flag `storedConfirmado` |
| MP-C4 | Cancelación desde admin-api | crítico | unit + UAT-manual | `cancelarSubMP` (espejo) |
| MP-C5 | STAFF ADMIN cancela tenant ajeno | crítico | unit + e2e | check `rol === 'ADMIN'` |
| MP-C6 | Doble cancelación idempotente | alto | unit | check `status === 'cancelled'` pre-PUT |
| MP-C7 | Cancelar sin preapproval vivo (legacy sin link) | alto | unit | NINGUNO adicional (riesgo fail-open residual) |
| MP-C8 | Cancelación desde panel MP → webhook sincroniza | crítico | unit + UAT-manual | fallback `mp_subscription_id` en webhook |
| MP-C9 | Acceso hasta fin de período (plan_tier no se toca) | alto | pendiente confirmar en SubscriptionGuard | UPDATE solo toca `subscription_status` |
| MP-C10 | MP_ACCESS_TOKEN no configurado | medio | unit | `if (!mpToken)` |
| MP-P1 | Básico→Pro sin doble cobro | alto | unit | = MP-A10 |
| MP-P2 | Pro→Básico sin guard de downgrade de plan | alto | pendiente decisión de producto | NINGUNO (gap) |
| MP-AD1 | Add-on temporal se acredita y vence a 30d | crítico | unit (parcial en addons.test.ts) | `parseAddonRef` + `vence_at` |
| MP-AD2 | Precio de add-on siempre del catálogo server | crítico | unit (parcial) | `ADDON_PACKS.find()` |
| MP-AD3 | Add-on fijo ALTA fail-closed si PUT falla | crítico | unit | gate `if (!putRes.ok)` |
| MP-AD4 | Add-on fijo ALTA revierte monto si insert falla | crítico | unit | revert best-effort (fire-and-forget, riesgo residual) |
| MP-AD5 | Add-on fijo BAJA bloqueada por downgrade guiado | crítico | unit (parcial: evaluarDowngrade cubierto) | `fn_tenant_limite` + check uso |
| MP-AD6 | Add-on fijo BAJA ajusta monto por delta | alto | unit | cálculo delta |
| MP-AD7 | Add-on fijo sin idempotencia server-side (race doble clic) | alto | unit (reproducir) | NINGUNO server-side (gap) |
| MP-AD8 | Add-on legacy `\|addon_movimientos` sin idempotencia | medio | unit (documentar riesgo) | NINGUNO |
| WH-SIG | Webhook no valida x-signature | alto | UAT-manual | NINGUNO (mitigado indirectamente por GET a MP) |
| WH-LEGACY | Rama else final activa sin guard/idempotencia | alto | unit (documentar) | NINGUNO |
| WH-DIST | No confundir pago de venta con pago de plataforma | alto | unit | lookup `mercadopago_credentials` por seller_id |
| RG0-1 | Suscripción de plataforma NO asienta caja del tenant | crítico | unit + e2e (aserción negativa) | ausencia deliberada de escritura a caja |
| RG0-2 | Refund de plataforma no revierte acceso automático | alto | unit (documentar) + UAT-manual | NINGUNO (gap) |
| RG0-3 | Add-on temporal vencido deja de contar (sin tocar plata) | medio | unit | filtro `vence_at > now` en `usePlanLimits` |
| DRIFT 1-6 | Auditoría SQL anti-drift DB↔MP | crítico/alto/bajo | UAT-manual (SQL) | ninguno automático — monitoreo operativo |
| MT-1 | Tenant no cancela suscripción de otro (caso negativo) | crítico | unit + e2e | check rol antes de `tenantId = requested` |
| MT-2 | RLS tenants_update bloquea UPDATE directo de rol no autorizado | crítico | e2e (impersonación SQL) | policy `tenants_update` |
| MT-3 | tenantId siempre del JWT, nunca del body | crítico | unit (regresión) | diseño del EF |
| ENV-1 | Webhook apunta a un solo entorno (DEV≠PROD) | alto | UAT-manual (checklist) | ninguno automático |

**Conteo:**
- Por severidad: **17 crítico**, **17 alto**, **6 medio** (DRIFT cuenta aparte, mixta).
- Por tipo: **~30 vitest-unit** (mayoría con extracción previa recomendada), **~8 UAT-manual puro**
  (requieren MP real o son config de entorno), **~7 playwright-e2e** (aislamiento/RLS/rol), varios
  escenarios son unit+e2e combinados.
- **Cubiertos hoy**: solo la lógica de `src/lib/addons.ts` (packs, serialización de ref, cálculo de
  downgrade, precio mensual) vía `tests/unit/addons.test.ts` — cubre parcialmente MP-AD1/AD2/AD5.
  **Ningún escenario de activación, cancelación, webhook o cobro recurrente tiene test hoy** — toda
  la lógica crítica vive sin cobertura dentro de las Edge Functions Deno.
- **Gaps de guard identificados (no solo falta de test, falta de protección real)**: MP-A10 (revert
  silencioso sin alerta), MP-C7 (fail-open residual en tenants nunca linkeados), MP-P2 (downgrade
  de plan sin guard), MP-AD4 (revert best-effort), MP-AD7 (sin idempotencia server-side en add-on
  fijo), MP-W2/W6 (webhook sin manejo explícito de rechazo/pérdida silenciosa), WH-SIG (sin
  validación de firma), WH-LEGACY (rama heredada sin guard), RG0-2 (refund sin reversión
  automática) — recomendado priorizar estos para `test-author` + posible ida y vuelta con GO antes
  de escribir los tests, ya que varios son decisiones de producto/arquitectura, no solo tests
  faltantes.

**Siguiente paso sugerido**: antes de que `test-author` escriba tests, resolver con GO los gaps
marcados como "pendiente decisión de producto" (MP-C9, MP-P2) y confirmar el estado real de H1
(crear-suscripcion) y H3 (mp-addon-fijo deployado o no) para no testear código muerto ni dejar sin
cubrir código vivo mal etiquetado como legacy.
