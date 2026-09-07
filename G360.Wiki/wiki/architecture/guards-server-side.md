# Guards server-side por rol — qué protege de verdad la DB

> Capa abierta el **2026-09-06** (Tanda F de `tests/specs/uat-app.md`). Hasta entonces **toda** la
> cobertura por rol era **por UI**: las specs 13/15/16/17/18 verifican qué rutas entran, cuáles
> redirigen y qué links del sidebar no se ven. Eso choca de frente con el hallazgo **H1** del UAT
> ("controles financieros SOLO client-side") y con la **obligación #3 de la REGLA #0**: los guards
> tienen que estar server-side **además** de en la UI, porque la UI se cachea y se bypassea.
> Un usuario con su token real y `curl` no pasa por ningún componente React.

Cobertura: `tests/e2e/141_roles_server_side_matriz.spec.ts` (API-only, sin browser).

---

## Cómo se mide sin romper nada

Las sondas de la spec son **no mutantes** a propósito (corre contra un tenant compartido):

| Operación | Sonda | Cómo se lee el resultado |
|---|---|---|
| UPDATE (RLS) | `PATCH` con el **mismo valor** que ya tiene la fila | `[]` = bloqueó · fila devuelta = dejó escribir |
| UPDATE (guard por columna) | `PATCH` con un valor **DISTINTO**, y después se verifica que el dato quedó intacto | con el mismo valor el trigger NO se dispara → falso verde |
| INSERT | `POST` con una **clave única duplicada** | `42501` = RLS bloqueó · `23505` = pasó la RLS (y no insertó nada) |
| RPC de cierre | pedir el **mes en curso**, que la regla rechaza siempre | distingue un rechazo por **rol** de uno por regla de negocio |

> ⚠ **Medir siempre con el rol restringido, no con el DUEÑO.** El DUEÑO cortocircuita casi todos los
> chequeos (`auth_ve_todas_sucursales()`), así que una medición hecha con su token da verde o rápido
> y no dice nada. Esto mordió también en la Tanda E — ver [[wiki/architecture/resiliencia]], E4-h2.

## Lo que SÍ protege la DB (verificado en CAJERO, DEPÓSITO, RRHH y CONTADOR)

- Configuración del negocio (`tenants`) — solo DUEÑO/ADMIN.
- Escalada de privilegios editando `users` — solo DUEÑO/ADMIN.
- Caja Fuerte (`boveda_retiros`, `boveda_arqueos`, `boveda_conversiones_usd`) — ni se leen.
- `set_clave_maestra` — solo DUEÑO.
- `marcar_incobrable` — rol + clave maestra, server-side.
- `cerrar_periodo` — DUEÑO/SUPERVISOR/CONTADOR/SUPER_USUARIO/ADMIN (CONTADOR **sí**, a propósito).
- **Aislamiento por sucursal cruzado con rol**: ningún rol operativo de Sucursal Norte ve `ventas`,
  `caja_sesiones` ni `gastos` de Sucursal Sur. (La spec 94 solo cubría SUPERVISOR.)

## 🟥 Los huecos que había — todos cerrados el 2026-09-06

**De las 152 policies del esquema, solo 14 miraban el rol.** `productos`, `ventas`, `gastos`,
`metodos_pago` y `roles_custom` filtraban por tenant y sucursal, nada más: con un token válido de
cualquier rol se podía, por REST directo, hacer todo esto que la UI esconde.

| # | Hueco | Estado |
|---|---|---|
| F1-h1 | **Cerrar un período contable salteando el RPC** | ✅ **CERRADO — mig 394** |
| F1-h2 | Cambiar el **precio de venta** de un producto | ✅ **CERRADO — mig 396** |
| F1-h3 | Editar el **monto** de un gasto | ✅ **CERRADO — mig 396** |
| F1-h4 | Dar de alta productos | ✅ **CERRADO — mig 396** |
| F1-h5 | Crear / renombrar medios de pago | ✅ **CERRADO — mig 396** |
| F1-h6 | **Auto-otorgarse permisos editando `roles_custom`** | ✅ **CERRADO — mig 396** |

### F1-h1 — cerrado (mig 394)

El caso más grave, y el más didáctico: **el guard existía y se esquivaba escribiendo la tabla.**
`cerrar_periodo()` valida el rol ("Tu rol (CAJERO) no puede cerrar periodos contables"), pero la
policy de `cierres_contables` era `FOR ALL` por tenant a secas. Un CAJERO podía hacer
`POST /rest/v1/cierres_contables` directo y **congelar un mes contable entero** — los triggers de
período cerrado bloquean después toda edición de gastos y ventas de ese mes.

Fix: la tabla pasó a ser **solo lectura** vía RLS. El único camino de escritura son
`cerrar_periodo()` / `reabrir_periodo()`, que son `SECURITY DEFINER` (bypassean RLS) y ya validan
rol, orden de períodos y que solo se reabra el último. **Ni el DUEÑO la escribe a mano**: los totales
congelados los calcula la función, escribirla a mano falsearía el cierre.

Riesgo verificado **antes** de aplicar: el frontend solo hace `SELECT` sobre esa tabla, ninguna Edge
Function la toca, y `service_role` no pasa por RLS. Verificado **después**: el CAJERO recibe 42501, la
lectura sigue intacta, y el DUEÑO cierra y reabre por RPC sin problema.

### F1-h6 — el que hacía inútiles a los demás (hallazgo nuevo)

`roles_custom` tenía una policy `FOR ALL` por tenant a secas: **cualquier usuario del tenant podía
editar los permisos de cualquier rol custom**. Alguien con un rol custom asignado podía auto-otorgarse
`'editar'` sobre cualquier módulo y saltear todos los guards de abajo — que justamente consultan
`roles_custom.permisos`. **Un guard que confía en un dato que el atacante controla no es un guard**, así
que la mig 396 cierra esta tabla PRIMERO y recién después instala los demás.

### Cómo se cerraron h2-h5 sin romper nada (mig 396)

Ninguno se podía cerrar con RLS a secas, y ese es el punto: **`VentasPage` actualiza
`productos.stock_actual` DESDE EL CLIENTE** en devoluciones y anulaciones, así que un "CAJERO no escribe
`productos`" corta ventas reales. Y en Gastos el CAJERO edita legítimamente por debajo de su umbral.

- **`productos`** → trigger `BEFORE INSERT OR UPDATE` que mira **solo las columnas de precio**
  (`precio_venta`, `precio_costo`, `precio_marketplace`, `precio_usd`, `precio_costo_usd`,
  `margen_objetivo`). Un UPDATE de `stock_actual` pasa; uno que mueve el precio, no.
- **`gastos`** → se enforcea el **umbral del CAJERO** (espejo exacto de `evaluarUmbralGasto`), más el
  bloqueo de los roles que no operan Gastos (DEPÓSITO/RRHH/Lector) y del alta para CONTADOR, que sí
  edita campos fiscales de un gasto ya creado.
- **`metodos_pago`** → configuración: lectura para todo el tenant (el POS lista los medios), escritura
  solo para gestión.
- **Roles custom** → el helper `auth_puede_editar_modulo()` espeja `puedeEditarModulo` del frontend, así
  que un rol custom en `'ver'`/`'no_ver'` queda bloqueado **aunque su rol base pudiera**. Es la primera
  cobertura real de **F3**.

**Sin sesión de usuario (`auth.uid() IS NULL`) el helper devuelve `true` a propósito**: service_role,
Edge Functions y pg_cron tienen que seguir pasando. Verificado que todas las EF usan
`SUPABASE_SERVICE_ROLE_KEY`, no un token de usuario.

#### Lo que sigue abierto

El **umbral del SUPERVISOR** queda deliberadamente fuera del guard: el supervisor es quien **aplica** la
autorización de un cajero, y enforzarlo server-side rompería una aprobación legítima cuando el monto
pedido supera también su propio umbral. Cerrarlo requiere antes mover la aplicación de autorizaciones a
un RPC `SECURITY DEFINER` (mismo patrón que las migs 236/237/238).

### La trampa que casi da un falso verde

La primera verificación de la mig 396 dijo que el guard de precios **no funcionaba**… y era la sonda la
que estaba mal: hacía `PATCH` con **el mismo valor**, y sin cambio de precio el trigger no debe
dispararse. **Toda sonda de un guard por columna tiene que mandar un valor distinto.** La segunda
trampa fue al revés: `cajero1@local.com` tiene el rol custom `GO_Cajero` con `inventario: 'ver'`, así
que el bloqueo que parecía un falso positivo era el guard funcionando por la rama de rol custom.

### Cómo quedan anotados los huecos en la suite

Mientras estuvieron abiertos vivieron con `test.fail()`: la aserción escrita **correcta**, reportada en
verde mientras el hueco siguiera abierto y **roja el día que el guard se implementara**. Al cerrarlos
(mig 396) se les sacó el `test.fail()` y pasaron al bloque de guards.

Además hay 5 tests **positivos** — los que valen oro, porque detectan un guard pasado de estricto: el
CAJERO sigue escribiendo `stock_actual`, un UPDATE que no cambia el precio pasa, DUEÑO/SUPERVISOR sí
cambian precios (y el precio queda restaurado), el CONTADOR sigue editando campos de un gasto, y
`venta_items.sucursal_id` sigue sincronizada.

## 🔴 F2 — la matriz de LECTURA (donde aparecieron los hallazgos más serios)

La Tanda F empezó mirando solo **qué escribe** cada rol. La otra mitad es **qué lee**. De 18 tablas
sensibles auditadas, **solo 4 tienen alguna policy que mire el rol**.

| Tabla · columna | Antes | Ahora |
|---|---|---|
| `mercadopago_credentials.access_token` + `refresh_token` | 🔴 lo leían **todos** los roles | ✅ 403 (mig 400) |
| `tiendanube_credentials.access_token` | 🔴 todos | ✅ 403 (mig 400) |
| `whatsapp_credentials.access_token` | 🔴 sin protección | ✅ 403 (mig 400) |
| `emisores_fiscales.afipsdk_token` | 🔴 todos | 🔴 abierto |
| `rrhh_salarios.basico/neto` · `empleados.salario_bruto/cbu/dni_rut` | 🔴 sueldos, CBU y DNI visibles para cualquier rol | ✅ **cerrado (mig 401)** |
| `tenant_certificates.cert_key_path` | 🟠 ruta de la clave AFIP | 🟠 abierto |
| `ai_tenant_memoria`, `boveda_retiros` | ✅ solo DUEÑO | ✅ |

Con el token de Mercado Pago se opera la cuenta del comercio **desde afuera de Genesis360**. El
comentario del código decía *"access_token nunca expuesto al frontend"*, y era cierto **en la interfaz
TypeScript** — que no es un control de acceso. PostgREST devuelve la columna que le pidas.

**Fix (mig 400): privilegios a nivel COLUMNA.** Se revoca el SELECT de tabla y se re-otorga columna por
columna salteando los secretos — en PostgreSQL no se puede "restar" una columna de un grant de tabla.
Impacto cero verificado: las tres consultas de `ConfigPage.tsx` usan listas explícitas sin el token, y
`service_role` queda intacto para las Edge Functions.

> ⚠ Con `select('*')` PostgREST expande a todas las columnas y devuelve **403**. Si alguna pantalla
> futura usa `select('*')` sobre estas tablas, se rompe — hay un test que cubre justamente eso.

### Visibilidad de RRHH (mig 401) — regla aprobada por GO

> **DUEÑO / ADMIN / SUPER_USUARIO / RRHH ven todo · SUPERVISOR ve su equipo · cada empleado ve lo
> suyo · las pantallas de COSTOS leen agregados.**

Acá **no servía** el truco de la mig 400: los privilegios de columna son por rol de **base de datos**
(`authenticated`), no por rol de la app — revocar `salario_bruto` se lo sacaría también a RRHH. El gate
correcto es RLS por fila, más dos funciones `SECURITY DEFINER` para lo que el resto de la app sí
necesita:

- **`fn_empleados_basico()`** → nombre, apellido, teléfono y cumpleaños. Sin sueldo, CBU ni DNI. La usan
  el panel de repartidores y los recordatorios de cumpleaños.
- **`fn_sueldos_agregado(desde, hasta, hasta_exclusivo)`** → total neto pagado + empleados liquidados.
  La usan Dashboard, Rentabilidad y Cierres contables, que **solo sumaban**. Gateada a los roles que ya
  ven reportes de plata; un CAJERO recibe 403.

**Abierto**: `emisores_fiscales.afipsdk_token` — el panel hace `select('*')` y además edita el token, así
que hay que pasar a listas explícitas de columnas antes de revocar.

---

Ver también: [[wiki/architecture/multi-tenant-rls]] · [[wiki/architecture/resiliencia]] ·
[[wiki/development/testing]] · `tests/specs/uat-app.md` (Tanda F)
