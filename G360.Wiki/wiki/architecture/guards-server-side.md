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
| `meli_credentials.access_token` + `refresh_token` (Mercado Libre) | 🔴 lo leían **todos**, y `anon` | ✅ **cerrado (mig 403)** |
| `modo_credentials.api_key` · `courier_credenciales.credenciales` | 🔴 ídem | ✅ **cerrado (mig 403)** |
| `rrhh_salario_items` · `rrhh_anticipos` (detalle de la liquidación) | 🔴 26 filas visibles para un CAJERO | ✅ **cerrado (mig 403)** |
| `tiendanube_credentials.access_token` | 🔴 todos | ✅ 403 (mig 400) |
| `whatsapp_credentials.access_token` | 🔴 sin protección | ✅ 403 (mig 400) |
| `emisores_fiscales.afipsdk_token` | 🔴 todos | ✅ **cerrado (mig 402)** — ni el DUEÑO |
| `tenants.afipsdk_token` (copia legacy) | 🔴 todo el tenant vía `select('*')` | ✅ **vaciada + trigger la fuerza a NULL (mig 402)** |
| `rrhh_salarios.basico/neto` · `empleados.salario_bruto/cbu/dni_rut` | 🔴 sueldos, CBU y DNI visibles para cualquier rol | ✅ **cerrado (mig 401)** |
| `tenant_certificates.cert_key_path` | 🟠 ruta de la clave AFIP | 🟠 la ruta se ve, **el archivo ya no** (mig 402) |
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

### 🔴🔴 El núcleo fiscal (mig 402) — el hallazgo más grave de toda la tanda

Se abrió yendo a cerrar el pendiente chico (`afipsdk_token`). **`emisores_fiscales`,
`tenant_certificates` y `puntos_venta_afip` tenían UNA sola policy `FOR ALL` que miraba el tenant y
nada más.** Con el token de cualquier rol y `curl`:

| Objetivo | Lo que se podía hacer | Consecuencia fiscal |
|---|---|---|
| `PATCH /emisores_fiscales` | cambiar **CUIT**, **condición de IVA**, **umbral de Factura B** | facturas con el CUIT o la LETRA equivocada |
| ídem | prender **`afip_produccion`** | un cajero pasa el negocio a **CAE real e irreversible** |
| `DELETE /tenant_certificates` | borrar el certificado AFIP | se cae la facturación |
| `POST/DELETE /puntos_venta_afip` | tocar los puntos de venta | numeración fiscal |
| `GET storage/certificados-afip/…key` | **bajarse la CLAVE PRIVADA AFIP** | firmar el WSAA y facturar como ese CUIT desde afuera |

Lo del bucket es lo peor y el código lo daba por cerrado: el comentario de `generar-csr/index.ts` dice
*"bucket certificados-afip, service_role-only"* — y no lo era. Su policy de INSERT era
`auth.uid() IS NOT NULL` **a secas** (mig 043): se podía escribir en la carpeta de **otro tenant**.

**Cómo se cerró**: cada policy se parte en **SELECT para todo el tenant** (el POS necesita leer el
emisor y sus puntos de venta para facturar — cerrarlo rompía la venta) **+ escritura solo
DUEÑO/ADMIN/SUPER_USUARIO**, el mismo trío de la mig 396. Las 3 policies del bucket se reescriben con
carpeta-del-propio-tenant + rol de gestión.

**El token, ahora sí**: es un **secreto de solo escritura**. No lo lee nadie desde el browser, ni el
DUEÑO — lo usa `emitir-factura` con `service_role`. La UI lee la columna generada
`afipsdk_token_configurado` para decir "Configurado", el campo del form arranca vacío (**vacío = "no lo
toques"**, si no un guardado normal borraría el token que el browser ya no puede leer) y hay un botón
explícito para quitarlo.

> 🐛 **Efecto lateral que valía oro**: el gate `afipDatosListos` exigía CUIT **+ token AfipSDK** para
> pasar a producción AFIP. Los 9 tenants de PROD están en `afip_provider='propio'`, que firma con el
> **certificado** y no usa el token, y ninguno tiene token cargado → **nadie podía pasar a producción
> desde la UI**. Ahora el gate pide la credencial del circuito que corresponde.

### La auditoría completa del esquema (mig 403) — y lo que sigue abierto

Después de la 402, en vez de dar la tanda por cerrada, se repitió la auditoría **sobre todo el
esquema** en vez de sobre las tablas del hallazgo. La consulta que la hace:

```sql
select tablename,
       bool_or(coalesce(qual,'')||coalesce(with_check,'') ~ 'get_user_role|auth_puede_editar_modulo|auth_ve_todas|rol') as mira_rol
  from pg_policies where schemaname='public' group by tablename;
```

**111 de 152 tablas no mencionan el rol en ninguna cláusula.** La mayoría está bien así (catálogo,
clientes, datos operativos que todos necesitan). Lo que salió y se cerró en la **mig 403**:

- **Los secretos que la 400 dejó afuera**: Mercado Libre (`access_token`+`refresh_token`), MODO
  (`api_key`) y couriers (`credenciales`), los tres legibles también por `anon`.
- **El detalle de RRHH que la 401 dejó afuera**: con `rrhh_salarios` cerrada pero
  `rrhh_salario_items` abierta, **el sueldo se reconstruye sumando los conceptos**. Cerrar la
  cabecera y dejar el detalle es no cerrar nada.
- **La escritura de las credenciales**: la 400 solo había cerrado la lectura; un CAJERO podía
  **desconectar las integraciones del comercio**.

#### ✅ La matriz de ESCRITURA de plata, precios e inventario — CERRADA (mig 404)

Un CAJERO escribía por REST `cheques` (19 filas), `cliente_creditos` (3), `caja_traspasos` (2),
`producto_precios_mayorista` (68), `cupones` (70), `combos` (25), `sucursales` (2), `ubicaciones`
(102), `estados_inventario` (202), `canales_venta` (17), `cuentas_origen` (7), `kit_recetas` (11) y
`proveedor_cuentas_bancarias` (el **CBU al que se le paga a un proveedor**).

**Lo que hay que entender del diseño, porque es lo que hace difícil este tipo de guard:**

1. **`producto_precios_mayorista`, `combos` y `cupones` eran el precio de venta por la puerta de al
   lado.** La mig 396 puso un trigger sobre `productos.precio_*`, pero el mismo rol podía editar la
   lista mayorista, armar un combo o crear un cupón del 90 %. Un guard que se esquiva por otra tabla
   no es un guard.
2. **El corte va por OPERACIÓN, no por tabla.** Y esto casi rompe la venta: **el POS ESCRIBE
   `cupones_codigos` al canjear** (`VentasPage.tsx:3405`, claim atómico). No apareció en el primer
   barrido de escritores porque el `.update()` está en la **línea siguiente** al `.from()` —
   apareció al repetir el grep en **multilínea**. Método a repetir: buscar escritores con
   `multiline`, nunca línea por línea.

| Tabla | Leer | Escribir |
|---|---|---|
| `cuentas_origen`, `canales_venta`, `sucursales`, `motivos_movimiento`, `estados_inventario`, `ubicaciones`, `proveedor_cuentas_bancarias` | tenant | DUEÑO / ADMIN / SUPER_USUARIO |
| `producto_precios_mayorista`, `producto_stock_minimo_sucursal` | tenant | `auth_puede_editar_modulo('inventario')` |
| `combos`, `combo_items`, `cupones` | tenant | `auth_puede_editar_modulo('comercial')` (módulo nuevo en la 404) |
| `cupones_codigos` | tenant | INSERT/DELETE Comercial · **UPDATE abierto (el canje)**, con trigger que protege `codigo` y `cupon_id` |
| `kit_recetas` | tenant | inventario **+ DEPÓSITO** (arma kits) |
| `cliente_creditos` | tenant | **INSERT operativo** (la devolución lo necesita) · UPDATE/DELETE gestión |
| `cheques` | tenant | INSERT y cambio de **estado** operativos · **`monto`** por trigger de columna · DELETE gestión |
| `caja_traspasos` | tenant | INSERT operativo · **UPDATE** DUEÑO/SUPERVISOR (era el gate que `CajaPage` tenía solo en el cliente) |

> ⚠ **Cuando un test y un guard discrepan, preguntarse primero cuál de los dos está mal.** Acá un test
> propio falló porque había puesto a DEPÓSITO entre los que "no deben escribir `kit_recetas`" — y
> justamente es su trabajo. Mismo falso rojo que con RRHH en la mig 401. Las excepciones deliberadas
> van **escritas** en la spec, con su control positivo, no descubiertas.

#### ✅ El módulo GASTOS (mig 405) — y por qué el gate NO es el rol

Lo último que faltaba, y necesitaba una definición de negocio. GO (2026-09-08):

> *"¿Un cajero puede registrar un pago a proveedor? Sólo si por temas del custom role tiene acceso al
> módulo de Gastos. Por default un cajero no tiene acceso a ese módulo; ahora si el dueño le da
> permisos para acceder al mod de Gastos, entonces ahí sí."*

**No hizo falta estructura nueva.** `auth_puede_editar_modulo` ya mira **primero**
`roles_custom.permisos ->> '<modulo>'` y solo cae al allowlist de roles fijos si no hay permiso
explícito. La regla de GO **es** esa primera rama: el gate no es el rol, es el permiso.

| Quién | Puede escribir `proveedor_cc_movimientos`, `gastos_fijos`, `gasto_cuotas`, `cheques` |
|---|---|
| DUEÑO / ADMIN / SUPER_USUARIO | sí |
| SUPERVISOR, CONTADOR | sí (rol fijo — `/gastos` es ruta permitida para ambos) |
| CAJERO con Gastos en `'editar'`/`'supervisa'` por rol custom | **sí** ← la regla de GO |
| CAJERO por default, o con `'ver'` | no |
| DEPÓSITO, RRHH, LECTOR | no |
| cualquiera, **borrando un cheque** | no — eso es gestión |

⚠ **Sutileza de PostgreSQL, y es fácil equivocarse**: las policies **permisivas se combinan con OR**.
Un `FOR ALL` del módulo + una policy de DELETE "solo gestión" **no** restringe el borrado: lo suma.
Por eso `cheques` se escribe **comando por comando** (SELECT / INSERT / UPDATE / DELETE por separado).

De paso, la 405 **corrigió un supuesto de la 404**: ahí se dejaron los cheques abiertos porque
"un CAJERO crea cheques al cobrar" — falso, el POS no escribe `cheques` en ningún camino.

---

## 🛡️ Tanda G — auditoría de seguridad completa (2026-09-20, commit `f55fbf0f` en `dev`, SIN deploy a PROD)

A diferencia de la Tanda F (foco en RLS por rol), esta auditoría fue **de punta a punta**: RLS, aislamiento de
Storage, guards de las Edge Functions públicas (webhooks/sweeps), XSS en el frontend, política de contraseñas de
Auth y el estado real de los backups. Con pruebas ejecutadas contra PROD y DEV, no solo lectura de código.

### Lo que se verificó BIEN (con los números que dio la auditoría)

- **170 de 170 tablas de `public` con RLS activo. 234 policies.**
- Impersonando un usuario real de un negocio y recorriendo las **155 tablas con `tenant_id`**: **cero** filas de
  otro negocio, cero tablas inaccesibles por error (ni de más, ni de menos).
- Como `anon`: de 170 tablas, **55 ni siquiera accesibles** y las otras 115 devuelven cero filas, salvo `planes`
  (precios públicos, a propósito). **Solo 1 policy** en todo el esquema da acceso a `anon`, y es esa.
- Sin escalada de privilegios: un usuario rol DEPÓSITO no puede ascenderse a DUEÑO, ni mudarse de negocio, ni
  insertar en otro negocio — los tres vectores probados y bloqueados.
- **28 tablas** con policies por sucursal (ver la segunda capa en [[wiki/architecture/multi-tenant-rls]]).
- Las funciones SECURITY DEFINER sensibles tienen control interno propio, probado como `anon`:
  `fn_sueldos_agregado` responde "tu rol no puede ver el costo laboral", `fn_empleados_basico` devuelve 0 filas,
  `aprobar_cambio_estado_inventario` valida rol Y pertenencia al negocio.
- Las API keys propias de la app (`data-api`/marketplace): 192 bits, hasheadas SHA-256, la key en claro nunca se
  persiste, y el tenant sale del registro de la key, no de un parámetro. Todos los tokens de links públicos usan
  `crypto.randomUUID()`.
- `npm audit`: 0 vulnerabilidades. Cero `dangerouslySetInnerHTML`/`eval` en `src/`. Cero secretos en el bundle.
- Las 8 Edge Functions que reciben `tenant_id` por parámetro validan las 8 la pertenencia del usuario que llama.

### G1 — Aislamiento de Storage roto (mig 430, ✅ DEV, 🔴 FALTA EN PROD)

`archivos-biblioteca` tenía policies de **SELECT y DELETE con condición SIEMPRE TRUE** (nunca miraban `name`,
que es donde vive la carpeta del tenant): **un usuario del negocio A podía leer archivos del negocio B.** Fuga
de lectura real, verificada en DEV. Latente en PROD porque el bucket está vacío ahí — pero el hueco existía
igual.

`productos` tenía INSERT y UPDATE en `auth.uid() IS NOT NULL` a secas — cualquier usuario logueado (de
cualquier negocio) podía subir y pisar fotos de productos de otro tenant.

De paso, `fn_enqueue_tn_fulfillment_sync` (SECURITY DEFINER) sin `search_path` fijo — mismo patrón de riesgo que
ya se había cerrado en otras funciones de la Tanda F.

Verificado post-fix con 6/6 chequeos: los ataques quedan bloqueados y lo legítimo sigue funcionando igual.

### G2 — 15 sweeps/workers abiertos a internet (GUARD-CRON)

Las 15 Edge Functions que corren como sweeps/workers (reintentos de NC AFIP, recálculo de intereses de CC,
liberación de reservas de stock, etc.) solo estaban protegidas por `verify_jwt` — que se satisface con la **anon
key**, que es pública. Cualquiera podía dispararlas manualmente desde afuera y, por ejemplo, reintentar NC AFIP
de cualquier negocio, dejar negocios sin acceso, recalcular intereses de cuenta corriente o liberar reservas de
stock de todos los tenants a la vez.

**Fix**: ahora exigen el header `x-cron-secret` con `CRON_SECRET`, o la service key. Los 13 workflows de GitHub
Actions ya mandan ese header. ⚠️ **Antes de desplegar estas EFs hay que cargar `CRON_SECRET`** en los secrets de
Edge Functions (DEV y PROD) y en los secrets de GitHub — si no, los sweeps se caen en silencio.

### G3-G5 — Webhooks públicos que no validaban lo que decían validar

| EF | Antes | Ahora |
|---|---|---|
| `modo-webhook` | El comentario decía que validaba contra `modo_credentials` — **no había una sola línea que lo hiciera**. Cualquiera con el UUID de una venta la marcaba pagada por el importe que quisiera | Exige `MODO_WEBHOOK_SECRET`; el monto sale del total de NUESTRA venta, nunca del body (409 si hay discrepancia). GO pidió explícitamente conservar MODO, no eliminarlo |
| `tn-webhook` | No validaba nada — la rama `order/cancelled` dejaba cancelar ventas y liberar stock desde afuera | Valida el **HMAC-SHA256** de TiendaNube sobre el cuerpo crudo, con el secret `TN_CLIENT_SECRET` (ya existía) |
| `meli-webhook` | `resource` del body se concatenaba **crudo** a la URL de un fetch que lleva el `access_token` del vendedor — un `resource` con `@` desviaba la llamada (y el token) al servidor del atacante | Se valida contra `/^\/orders\/\d+$/` antes de usarlo |

> 🛑 **Un comentario que dice "valida X" no es una garantía de que valide** (mismo patrón que el add-on de CUIT
> de `v1.228.0`, o el comentario de `certificados-afip` que decía `service_role-only` y no lo era, mig 402). Se
> verifica leyendo el código, no el comentario.

### G6 — IA pública sin sesión

`scan-product` y `scan-ticket` no validaban nada — cualquiera podía llamarlas sin sesión y quemar la cuota de
`ANTHROPIC_API_KEY` del negocio. Ahora exigen sesión de usuario autenticado.

### G7 — XSS en impresión de etiquetas/QR

Las 4 pantallas de impresión (`LpnQR`, `ProductoQR`, `CodigoCompuestoModal`, `CodigoMasivoModal`) interpolaban
nombre/SKU/LPN sin escapar dentro de un `document.write` que hereda el **origin de la app** — y esos nombres
entran por el importador CSV y por el sync de ML/TiendaNube, o sea que un catálogo con un nombre de producto
malicioso podía ejecutar JS en la sesión de quien imprime la etiqueta. Fix: helper nuevo `src/lib/escaparHtml.ts`,
13 interpolaciones escapadas en las 4 pantallas. Ver [[wiki/features/inventario-stock]].

### G8 — Política de contraseñas de Auth (✅ YA ACTIVA en DEV y PROD, aplicada por API)

Mínimo **10 caracteres** + protección de contraseñas filtradas (HaveIBeenPwned) activada. Los mínimos del lado
cliente se alinearon a 10 en MiCuenta, Onboarding y Portal de Proveedores.

**NO se activó** `security_update_password_require_reauthentication`: se probó, pero la app cambia la clave con
`updateUser({password})` sin un paso de re-autenticación, así que activarlo habría roto el cambio de contraseña
en Mi Cuenta y en el Portal de Proveedores. Queda pendiente hasta implementar el flujo de nonce.

### 🟥 Hallazgos ABIERTOS — backlog de seguridad, sin cerrar

| # | Qué | Mitigación actual |
|---|---|---|
| 1 | `mp-webhook`: firma HMAC implementada pero en modo **LOG-ONLY** | Re-consulta la API de MP igual, así que no es explotable a ciegas — falta cargar `MP_WEBHOOK_SECRET` para hacerla bloqueante |
| 2 | `mp-ipn`: si el POST no trae `user_id`, hace `.limit(1)` y agarra una credencial de **CUALQUIER** tenant | Ninguna — debería devolver 400 |
| 3 | `cuenta_token` (estado de cuenta del cliente) no vence nunca y no se puede rotar desde la app | Comparar con `token_transportista`, que sí expira + limpia a 30 días |
| 4 | `verificar_otp_envio`: OTP de 6 dígitos con `random()` de Postgres (no criptográfico), invocable por `anon` sin límite de intentos | Ninguna |
| 5 | Rate limiting de las EFs públicas vive en memoria del isolate | Se resetea en cada cold start — no es un límite real bajo carga sostenida |
| 6 | SSL no forzado en conexiones directas a la base; base accesible desde **cualquier IP** (0.0.0.0/0) | Ninguna |
| 7 | Sin captcha en login/alta | Ninguna |
| 8 | 4 buckets públicos (`avatares`, `logos`, `productos`, `ayuda-recursos`) | Por diseño — cualquiera con la URL lee el archivo (son assets no sensibles) |

### Estado de deploy

Todo esto vive en `dev`, commit `f55fbf0f`, mig **430** solo en DEV. `APP_VERSION` sigue en `v1.228.0` — sin
release ni tag para esta tanda. Ver `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", 2026-09-20) para la lista
completa de pendientes antes de deployar (cargar `CRON_SECRET`/`MODO_WEBHOOK_SECRET`, aplicar la mig 430 en PROD,
redesplegar las EFs tocadas).

---

Ver también: [[wiki/architecture/multi-tenant-rls]] · [[wiki/architecture/resiliencia]] ·
[[wiki/architecture/edge-functions]] · [[wiki/architecture/infraestructura]] · [[wiki/development/testing]] ·
`tests/specs/uat-app.md` (Tanda F)
