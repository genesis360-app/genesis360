# Resiliencia — cómo se comporta la app cuando el backend NO está sano

> Capa abierta el **2026-09-06** a raíz de un incidente real. Hasta entonces toda la cobertura de la app
> (142 specs e2e) era **funcional**: probaba "¿anda la feature?" contra un backend sano. Nada ejercitaba
> backend lento, caído, 5xx sostenido, sesión vencida o red intermitente.
> Backlog completo: `tests/specs/uat-app.md`, **Tandas D / E / F**.

---

## D1 — El bucle de reintentos del refresco de sesión ✅ CERRADO

### El incidente

La instancia de DEV (`t4g.nano`, CPU compartida) se saturó: CPU 94 %, Disk IO 97 %, estado `Unhealthy`.
Al desglosar el tráfico apareció que la causa no era la carga legítima de la app, sino **la app misma
reintentando renovar su sesión**.

Medido en los logs de edge de DEV (24 h al 2026-09-06), consultados con SQL, no inferidos:

| Status | Requests |
|--------|----------|
| 522 (Cloudflare — sin conexión al origen) | 452 |
| 504 | 49 |
| 521 | 45 |
| 524 | 16 |
| 525 | 1 |
| **200** | **32** |
| **Total** | **595** |

El **100 %** eran `POST /auth/v1/token?grant_type=refresh_token` (ninguna era login). Por hora:
**~65 requests/hora sostenidas entre las 19 h y las 00 h del 5/9 — cinco horas seguidas sin rendirse.**
Eso descarta que el cliente descarte la sesión ante un 52x: el bucle es infinito.

**El problema de fondo no es la pestaña: es que el cliente se retroalimenta.** Backend saturado → falla el
refresco → el cliente reintenta → más carga → falla más. Con un cliente real, **cada navegador abierto es
un amplificador de la caída**.

### Causa raíz (leída en `node_modules/@supabase/auth-js` 2.98)

- Ticker cada 30 s (`AUTO_REFRESH_TICK_DURATION_MS`) que **nunca se detiene**.
- Hasta ~7 reintentos con backoff **dentro de cada tick** (200, 400, 800… ms).
- **No existe contador de fallos entre ticks.** Nada corta el bucle, por muchas horas que pase.
- `NETWORK_ERROR_CODES` solo contempla 502/503/504. Los **52x de Cloudflare**, que son los que realmente
  llegan cuando el origen no responde, caen fuera de su lógica de reintento.

### El fix

`src/lib/authRefreshBreaker.ts` — un cortacircuitos. **No se toca auth-js ni su configuración**: se envuelve
el `fetch` del cliente (`global.fetch` en `src/lib/supabase.ts`) y se intercepta **únicamente** ese endpoint.
Todo el resto del tráfico pasa sin tocar.

1. **Backoff exponencial con jitter ±20 %** entre intentos reales: 2 s → 4 → 8 → 16 → 32 → 64 → 128 → 256 →
   tope 5 min. El jitter evita que N pestañas reintenten todas en el mismo milisegundo.
2. **Con el circuito abierto el intento se corta localmente**: cero tráfico de red.
3. **Tras 10 fallos consecutivos se rinde** y no vuelve a salir a la red hasta que el usuario decida.
4. El cortocircuito devuelve **503 a propósito**: es el único rango que auth-js trata como reintentable, y
   por lo tanto el único que **no** le hace borrar la sesión guardada. Es deliberado — un cajero en medio de
   una venta no puede quedar deslogueado por un blip de 30 s del backend (REGLA #0).
5. Un **400/401** (`invalid_grant`, refresh token revocado o vencido) **no** abre el circuito: es una
   respuesta definitiva, y ahí sí corresponde que auth-js borre la sesión y mande a login limpio.

**Efecto medido contra el incidente real**: una caída de 5 h pasa de ~600 requests por pestaña a **10**, y
después silencio.

### Qué ve el usuario

`src/components/AvisoSesionSinRefresco.tsx`, montado en `App.tsx`. **No bloquea la pantalla**: aunque la app
esté degradada, el usuario tiene que poder leer y copiar lo que tiene delante.

- **2º fallo** → franja discreta abajo a la derecha: "Problemas de conexión con el servidor — reintentando…".
- **Se rindió** → tarjeta con el último status HTTP y dos salidas:
  - **Reintentar** → resetea el cortacircuitos y fuerza un `refreshSession()`. Si el backend volvió, el
    usuario sigue trabajando **sin perder nada ni volver a loguearse**.
  - **Volver a entrar** → `signOut({ scope: 'local' })`, que limpia la sesión **sin salir a la red** —
    justo cuando la red es el problema.

### Cobertura

`tests/unit/authRefreshBreaker.test.ts` — 19 tests. Lógica pura con reloj, aleatorio y `fetch` inyectados:
corre determinístico, sin tenant ni backend (cumple la nota de método de las tandas: un verde reproducible
necesita una foto de datos explícita, y acá la foto es "ninguna, a propósito").

El test de regresión reproduce la caída real del 5/9 — ticker cada 30 s durante 5 h = 600 intentos — y exige
**10 requests de red en total** y estado final `rendido`.

---

## Tanda E — Stress / carga (primera pasada, 2026-09-06)

Nunca se había medido cuántos usuarios concurrentes aguanta el sistema, con qué instancia, ni qué se
rompe primero.

**Instrumento**: `scripts/stress-lectura.mjs` → `npm run stress:lectura`. Simula N sesiones
concurrentes con el mix de LECTURAS que hace la app al navegar (catálogo, ventas, ítems, caja,
clientes, movimientos) y reporta p50/p95/p99, RPS y errores por tipo. **Solo GET**; se niega a correr
contra PROD o con más de 20 sesiones sin `--si-se-que-hago`.

### E1 — concurrencia ✅ (DEV, compute MICRO, 5 cuentas reales de distinto rol)

| Concurrencia | RPS | Errores | p50 | p95 |
|---|---|---|---|---|
| 5 sesiones · 20 s | 49,8 | **0** | 78 ms | 267 ms |
| 20 sesiones · 25 s (antes de E4-h2) | 86,3 | **0** | 112 ms | 1.461 ms |
| 20 sesiones · 25 s (**después** de E4-h2) | **173,9** | **0** | 103 ms | **193 ms** |

Cero errores en las tres corridas. El p95 disparado a 20 concurrentes **era casi todo una sola
consulta** (E4-h2); cerrada esa, el throughput se duplicó y el p95 bajó 7,6×.

### E2 — techo ✅ (DEV, 2026-09-14, autorizado por GO)

Rampa de 20 a 400 sesiones, 45 s por escalón y 20 s de pausa entre escalones
(`node scripts/stress-lectura.mjs --usuarios N --segundos 45 --si-se-que-hago`), con el mismo mix de
lecturas y las 5 cuentas de rol de E1.

| Sesiones | req/s | p50 | p95 | p99 | máx | Errores |
|---|---|---|---|---|---|---|
| 20 | 174,7 | 101 ms | 198 ms | 237 ms | 392 ms | 0 |
| 50 | 168,4 | 268 ms | 591 ms | 805 ms | 1,5 s | 0 |
| 100 | 162,0 | 446 ms | 1,67 s | 2,49 s | 5,3 s | 0 |
| 200 | 156,5 | 855 ms | 3,74 s | 5,82 s | 9,6 s | 0 |
| 400 | 145,9 | 1,76 s | 8,59 s | 12,8 s | 25,3 s | 0 |

**El techo es de unos 170 req/s y ya se toca con 20 sesiones.** De ahí en adelante el throughput no sube
(baja un poco) y lo que crece es la cola: la latencia escala casi lineal con la concurrencia. **No hubo ni
un error** en ningún escalón: la instancia no se cae, se pone lenta.

**El cuello**, medido en vivo con `pg_stat_activity` durante el escalón de 200: PostgREST con **21
conexiones** (19 activas, todas en CPU, sin `wait_event`), **0 esperas por lock** y `max_connections` 60,
lejos del tope. El pool de PostgREST (~20 conexiones) está lleno y la CPU de la instancia de DEV (MICRO) no
da más; el resto de las requests espera en la cola.

**Cómo leerlo:**
- Estas sesiones leen **sin pausa**, una request atrás de otra. Un usuario real piensa entre clic y clic, así
  que 170 req/s alcanzan para bastante más gente que 20 personas; cuánta, depende del ritmo real de uso, que
  no se midió.
- Son solo lecturas. Las escrituras (ventas, caja, stock con triggers) cuestan más CPU y bajarían el techo.
- Es DEV. **El techo de PROD no se midió** (no se corre carga contra PROD) y depende de su compute.
- Ninguna consulta se despega de las demás: en cada escalón todas tienen un p95 parecido. Si hace falta más
  margen, la palanca es el **compute** (más CPU y un pool más grande), no optimizar una consulta puntual.

### Capacidad estimada de PROD (2026-09-14) — cuántos usuarios a la vez

**Qué tiene cada proyecto.** ⚠️ Corregido el mismo día: la primera lectura miró solo `max_connections`, que es
60 tanto en Nano como en Micro, y concluyó que PROD = DEV. No es así. La organización está en plan **Pro**, pero **el
tamaño de instancia es por proyecto** y Supabase no lo sube solo al pasar de Free a Pro (lo reinicia):

| | `effective_cache_size` | `shared_buffers` | `work_mem` | Instancia que corresponde |
|---|---|---|---|---|
| DEV | 768 MB | 256 MB | 3,5 MB | **Micro** (1 GB, 2-core ARM compartido) |
| PROD hasta el 2026-09-15 | 384 MB | 224 MB | 2,2 MB | **Nano** (hasta 0,5 GB, CPU compartida) |
| **PROD desde el 2026-09-15** | 768 MB | 256 MB | — | **Micro** — GO lo cambió desde Settings → Compute and Disk ("Free Upgrade", mismo precio); verificado por configuración y por el reinicio de Postgres a las 03:01 UTC |

Según la documentación de Supabase, en una organización paga **una Nano se cobra igual que una Micro**, así que el
cambio no costó más. Ninguna de las dos tiene CPU dedicada: la dedicada empieza en **Large** (2-core, 8 GB, ~USD
110/mes); Small (~USD 15) y Medium (~USD 60) suman RAM y conexiones, con CPU compartida. **Con PROD en Micro, el techo
de E2 medido en DEV aplica a PROD.** Antes del reinicio se verificó que Kalken (cliente real) no estuviera usando la app.

**Cuánto consume un usuario** — medido manejando la app real con Playwright contra DEV:

| Qué hace | Requests |
|---|---|
| Pestaña abierta en el POS sin tocar nada | **0,59 req/s** (35/min: `caja_sesiones` cada 15 s, contadores de alertas cada 30 s, notificaciones, autorizaciones) |
| Pestaña abierta en el Dashboard sin tocar nada | 0,49 req/s |
| Cambiar de pantalla | **~64 requests por pantalla** (3,7 req/s navegando) |
| Una venta completa, del carrito vacío al cobro | 30 requests |

**La cuenta**, contra un techo de ~170 req/s y operando al ~70 % (~120 req/s) para absorber picos:

| Perfil | Por usuario | Usuarios a la vez |
|---|---|---|
| Hora pico: una venta cada 2 min y un cambio de pantalla cada 2 min | ~1,4 req/s | **~85** (techo duro ~120) |
| Uso tranquilo: app abierta, una venta y una pantalla cada 10 min | ~0,75 req/s | **~160** (techo duro ~225) |

Con 2 usuarios por negocio (dueño + cajero) son **~40 negocios en hora pico** u **~80 en uso tranquilo**.
Pasado ese punto no se cae (E2: 0 errores hasta 400 sesiones), **se pone lenta**.

**Supuestos que hay que tener presentes:** el techo se midió solo con lecturas y con la base chica de DEV; las
escrituras (ventas con triggers de stock y caja) y el volumen real cuestan más CPU, y la instancia Micro es de CPU
compartida. Tomarlo como orden de magnitud, no como garantía.

**Palancas, de la más barata a la más cara:**
1. **Navegación**: cada pantalla vuelve a pedir la sesión, el usuario, el negocio y las sucursales (32
   `GET /auth/v1/user` en 8 cambios de pantalla). Cachearlo baja una parte grande de esas ~64 requests.
2. **Polling**: el POS pregunta por las cajas abiertas cada 15 s y el badge de alertas hace 6 conteos cada 30 s.
   Espaciarlos o dispararlos por evento baja el consumo en reposo.
3. **Compute**: ✅ PROD ya pasó de Nano a Micro (2026-09-15, mismo precio). Si hace falta más: Small (~USD 15/mes, 2 GB) o Medium (~USD 60, 4 GB) suman RAM y conexiones con CPU compartida;
   Large (~USD 110, 8 GB) es la primera con **CPU dedicada**. Es la palanca directa sobre el techo, porque ninguna
   consulta individual se destaca. Precios de la documentación de Supabase al 2026-09-14; confirmar en Billing.

Revisar cuando haya ~30 negocios activos o si el p95 de la API empieza a subir en el dashboard de Supabase.

### E3 — volumen: el resultado ES el hallazgo

La base **entera** de DEV (los 10 tenants juntos) tiene 881 productos, 821 ventas, 2.026 ítems de
venta y 1.657 movimientos de stock. Un comercio real hace 821 ventas en dos semanas. **Nunca se probó
nada a escala real**, así que todos los números de arriba son un piso optimista.

### E4 — consultas caras: dos hallazgos, uno arreglado

**✅ E4-h1 — `ventas` ordenada por fecha (mig 395).** Para devolver **20** ventas el plan leía **las
662 del tenant** y recién después ordenaba: el `LIMIT` no podía cortar antes porque el orden se
resuelve después del filtro de RLS. O(n) sobre el historial completo, en cada carga del dashboard.
`ventas` tenía 13 índices y ninguno servía para ese orden — que usan **14 lugares del frontend**.
Con el compuesto `(tenant_id, created_at DESC)`: **17,0 ms → 1,14 ms**, leyendo 20 filas en vez de
662 (deja de crecer con el historial). End-to-end: `ventas` p50 **277 → 78 ms**, p95 **435 → 96 ms**,
y el total pasó de 35,8 a **49,8 req/s** con la misma concurrencia.

**✅ E4-h2 — `venta_items` castigaba a los usuarios restringidos por sucursal (CERRADO, migs 397-399).**
`venta_items` no tenía `sucursal_id`, así que su policy resolvía la sucursal con un `EXISTS` contra
`ventas`, y Postgres lo convertía en un **hashed SubPlan que materializa TODAS las ventas visibles del
tenant** antes de devolver la primera fila. Mismo query, distinto usuario: **DUEÑO 2,1 ms · CAJERO
48,0 ms (24×)** — el DUEÑO cortocircuita en `auth_ve_todas_sucursales()` y nunca ejecuta el subplan.
Era el causante del p95 de 1,4 s a 20 concurrentes, y escalaba O(ventas del tenant) por query.

> ⚠ **Medirlo con el DUEÑO da 2 ms y parece sano.** Cualquier prueba de performance con RLS hay que
> hacerla con el rol restringido. Mismo criterio que la Tanda F — ver
> [[wiki/architecture/guards-server-side]].

**El camino hasta el fix, incluida la hipótesis descartada** (vale la pena dejarlo escrito):

1. **Mig 397 — índice de cobertura sobre `ventas`. NO funcionó**: 48 ms → **107 ms**, peor. Un Bitmap
   Index Scan *siempre* va al heap para el recheck, y además el costo real no era el acceso al índice
   sino el `Filter` evaluándose fila por fila. Índice inútil con costo de escritura → la 398 lo borra.
2. **Mig 398 — denormalizar `sucursal_id` en `venta_items`** (la sucursal de una venta no cambia
   después de crearse): columna + backfill + trigger de sincronía + trigger de propagación. Bajó poco
   (51 ms) porque se dejó el `EXISTS` original como red de seguridad… y las **39 ventas globales**
   (`sucursal_id IS NULL`) del tenant caían en esa rama y forzaban igual el subplan.
3. **Mig 399 — sacar el `EXISTS` residual.** Con la columna en sincronía es redundante:
   `vi.sucursal_id IS NULL ⟺ venta global ⟹ visible para todo el tenant`, que es lo mismo que decía el
   EXISTS. **48,0 ms → 4,62 ms** y el SubPlan desaparece del plan.

**Correctitud verificada, no supuesta**: el CAJERO ve **565 ítems** con la policy nueva y **565** con
la lógica vieja calculada aparte — mismo conjunto exacto. Backfill completo (0 filas desincronizadas),
y la spec 141 tiene un test permanente que vuelve a chequear esa sincronía: si la columna se desfasa,
la RLS decidiría con un dato viejo.

**Efecto end-to-end con 20 sesiones concurrentes** (`npm run stress:lectura`):

| | Antes | Después |
|---|---|---|
| Throughput | 86,3 req/s | **173,9 req/s** |
| p95 global | 1.461 ms | **193 ms** |
| p95 `ítems de venta` | 1.637 ms | **181 ms** |
| Errores | 0 | 0 |

### Corrección de documentación encontrada de paso

`pg_cron` y `pg_net` **están habilitados** en DEV y PROD (1.6.4 / 0.20.0), con 3 jobs activos en DEV.
Eso explica el `tn-fulfillment-worker` que corría "133 veces por día sin que nadie lo mire": es el job
`tn-fulfillment-sync`, `*/5 * * * *`, `active=true`. El wiki ya lo tenía bien
([[wiki/development/supabase-dev-vs-prod]]); lo que estaba mal era la memoria del asistente.

---

## Tanda D completa — D2 a D5 (2026-09-06) · spec `142_resiliencia_backend_degradado`

Primera spec del repo que **intercepta la red del browser** (`page.route`, `context.setOffline`) en
vez de necesitar un backend roto de verdad: determinista, sin carga extra sobre DEV y sin depender de
que algo esté caído. Verificado con grep que ninguna spec usaba esas APIs — la capa no existía.

**El resultado es buena noticia: la app se porta bien en condiciones degradadas.** El caso anómalo era
D1, y estaba en auth-js, no en la capa de React Query.

| Escenario | Qué se verifica | Medido |
|---|---|---|
| **D2** | Refresh token inválido (400 `invalid_grant`) → cae en `/login` sola y deja de pedir | ≤1 refresco extra tras llegar a login |
| **D3** | 503 sostenido en todas las consultas, 30 s de pantalla quieta | **0 requests** (techo 20) |
| **D4** | Sin red no martilla; al volver **se recupera sola, sin recargar** | **0** offline · >0 al reconectar |
| **D5** | Pestaña dormida y reanudada: revalida sin tormenta | **14 requests** al despertar (techo 60) |

**Hallazgo de D4**: React Query usa `networkMode: 'online'` por default, así que sin red **pausa** las
queries en lugar de dispararlas y verlas fallar — exactamente lo contrario de lo que hacía auth-js en
D1. Queda afirmado como propiedad para que nadie lo rompa sin darse cuenta.

Los techos son **barandas anti-regresión**, no la descripción de un problema: saltan si alguien saca el
`retry: 1` global, cambia el `networkMode` o mete un `refetchInterval` agresivo. Se calibraron
corriendo la spec con los presupuestos en 0, para conocer el margen real.

> ⚠ **Método a repetir en toda spec de condiciones degradadas**: cada presupuesto va con un control
> **anti-falso-verde** (`toBeGreaterThan(0)`) que prueba que el intercept se activó. Sin eso, un
> intercept mal escrito hace pasar el test **por vacío** — pasó escribiendo esta misma spec.

## Lo que sigue abierto

- **Tanda E**: ✅ E2 medido en DEV el 2026-09-14 (techo ~170 req/s de lectura, cuello = pool de PostgREST + CPU,
  0 errores hasta 400 sesiones). Queda abierto: el techo con **escrituras** y el de **PROD** (no se corre carga
  contra PROD).
- **Tanda F**: F2 (matriz completa por rol) y el **umbral del SUPERVISOR** server-side, que necesita
  antes mover la aplicación de autorizaciones a un RPC — ver [[wiki/architecture/guards-server-side]].

## Contexto de infraestructura

DEV estaba en compute **NANO** teniendo plan **Pro pagado**. El plan y el tamaño de la máquina son ejes
**separados** en Supabase: Pro sube cupos y trae un crédito de compute, pero la instancia sigue en la más
chica hasta que alguien la cambia. **MICRO figuraba como "Free Upgrade" al mismo precio** ($9,68/mes), con
1 GB y 2 cores dedicados vs 0,5 GB con CPU compartida. La CPU compartida de `t4g.nano` funciona con créditos
de ráfaga (rinde un rato, se le acaban, la estrangulan), lo que explica el patrón de caídas intermitentes.

⚠ Anotado aparte: `tn-fulfillment-worker` corre **133 veces por día contra DEV** sin que nadie lo mire. No
era la causa del incidente, pero es carga constante sobre un proyecto de desarrollo.

---

Ver también: [[wiki/features/autenticacion-onboarding]] · [[wiki/development/testing]] ·
[[wiki/architecture/escalabilidad]] · `tests/specs/uat-app.md`
