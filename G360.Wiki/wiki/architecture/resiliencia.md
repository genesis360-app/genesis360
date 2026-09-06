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

## Lo que sigue abierto

- **D2** — sesión vencida con pestaña abierta: debe llevar a login limpio, no a un bucle.
- **D3** — backend 5xx sostenido: la UI debe degradar con mensaje claro (esto cubre las **consultas de
  datos**, no solo el refresco de sesión).
- **D4** — red intermitente (online/offline/online): sin duplicar operaciones al reconectar.
- **D5** — pestaña dormida y reanudada tras horas.
- **Tanda E** (stress/carga) y **Tanda F** (roles server-side) — ver `tests/specs/uat-app.md`.

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
