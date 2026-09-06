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
| UPDATE | `PATCH` con el **mismo valor** que ya tiene la fila | `[]` = RLS bloqueó · fila devuelta = RLS dejó escribir |
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

## 🟥 Lo que NO protege — huecos medidos

**De las 152 policies del esquema, solo 14 miran el rol.** `productos`, `ventas`, `gastos`,
`metodos_pago` y compañía filtran por tenant y sucursal, nada más. Con un token válido de cualquier
rol se puede, por REST directo:

| # | Hueco | Estado |
|---|---|---|
| F1-h1 | **Cerrar un período contable salteando el RPC** | ✅ **CERRADO — mig 394** |
| F1-h2 | Cambiar el **precio de venta** de un producto | 🔴 abierto |
| F1-h3 | Editar el **monto** de un gasto | 🔴 abierto |
| F1-h4 | Dar de alta productos | 🔴 abierto |
| F1-h5 | Crear / renombrar medios de pago | 🔴 abierto |

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

### Por qué h2-h5 siguen abiertos

No es pereza: **un guard genérico rompe ventas reales.** `VentasPage` actualiza
`productos.stock_actual` **desde el cliente** en devoluciones y anulaciones, así que una regla
"CAJERO no escribe `productos`" corta un flujo legítimo del cajero. El guard correcto es un trigger
`BEFORE UPDATE` que mire **solo las columnas de precio** (mismo patrón que `fn_ventas_writeoff_rol_guard`).

Y antes hay que resolver los **roles custom** (`rol_custom_id`): la UI respeta permisos a medida por
módulo, y un chequeo server-side por `rol` a secas los ignoraría — un CAJERO con un rol custom que le
habilita Productos quedaría bloqueado. Eso es exactamente la **F3** de la tanda, todavía sin abrir.

CLAUDE.md pide guard por guard, cada uno probado en DEV, porque es el hot-path de plata. **Decisión
pendiente de GO.**

### Cómo quedan anotados los huecos en la suite

Con `test.fail()`: la aserción está escrita **correcta** (la DB debería bloquear), hoy falla, y
Playwright la reporta en verde mientras el hueco siga abierto — pero **hace fallar la corrida el día
que el guard se implemente**, que es cuando hay que sacarle el `test.fail()`. Así el hueco queda
medido y no se olvida, sin dejar la suite en rojo permanente ni escribir una aserción que afirme lo
contrario de lo que se quiere.

---

Ver también: [[wiki/architecture/multi-tenant-rls]] · [[wiki/architecture/resiliencia]] ·
[[wiki/development/testing]] · `tests/specs/uat-app.md` (Tanda F)
