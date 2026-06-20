# UAT — Primer uso de un tenant NUEVO (out-of-the-box) + paridad DEV↔PROD

> **Objetivo (pedido GO, 2026-06-20):** un usuario que **recién registra su negocio** y hace las
> **primeras acciones** debe poder operar un sistema básico **sin configurar NADA** y **sin un solo
> error**. La app trae todos los defaults bien armados desde el alta. Disparado por una **mala
> experiencia real**: un amigo se registró y chocó con (1) "email rate limit", (2) RLS al crear el
> negocio, (3) `caja_movimientos_tipo_check` al ingresar a Caja Fuerte.
>
> **Causa raíz de los 3 = la app no estaba probada en un tenant FRESCO en PROD:**
> - **Drift DEV≠PROD** (el CHECK de `caja_movimientos` estaba viejo en PROD; en DEV se había
>   dropeado → los tests en DEV no lo veían). **Esta es la clase de bug más peligrosa.**
> - **Defaults/flujos de alta** no ejercitados de punta a punta en PROD (Confirm email ON, seed).
>
> **Por eso este UAT tiene DOS capas:** (A) **paridad DEV↔PROD** (que la DB de PROD sea idéntica a
> la de DEV donde se prueba) y (B) **smoke de primer uso** sobre un **tenant recién creado** (no uno
> existente con datos), en **ambos** entornos.

---

## A. Auditoría de PARIDAD DEV↔PROD (la causa raíz — correr SIEMPRE antes de un alta de cliente)

La regla: **lo que se prueba en DEV tiene que ser idéntico en PROD.** Cualquier diferencia es un bug
latente que va a explotar recién con un usuario real en PROD.

| ID | Chequeo | Cómo | Esperado |
|---|---|---|---|
| PAR-01 | **CHECK constraints idénticos** | comparar `pg_get_constraintdef` de todos los CHECK en `public` entre DEV y PROD (ver SQL abajo) | Mismo set, misma definición. *(El bug de hoy: `caja_movimientos_tipo_check` difería.)* |
| PAR-02 | **Policies RLS idénticas** | `md5(string_agg(...))` de `pg_policies` por tabla, DEV vs PROD | Mismo hash global (regla del CLAUDE.md). |
| PAR-03 | **Columnas idénticas** | comparar `information_schema.columns` (tabla, columna, tipo, default, nullable) | Sin diferencias en tablas operativas. |
| PAR-04 | **Triggers + funciones idénticos** | comparar `pg_trigger` + `pg_proc` (nombres) de `public` | Mismo set (incl. `fn_seed_tenant_defaults`, guards). |
| PAR-05 | **Defaults del alta idénticos** | crear un tenant de prueba en DEV y en PROD y comparar lo seedeado (ver §B PU-03) | Mismo set de filas default. |

**SQL de comparación de CHECK constraints (correr en cada env, diffear el resultado):**
```sql
SELECT conrelid::regclass::text AS tabla, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype = 'c'
ORDER BY 1, 2;
```
> **Acción si hay diff:** traducir a una **migración versionada** (NUNCA SQL suelto) y aplicar en
> DEV **y** PROD. Causa del drift histórico: DDL aplicado fuera de banda (dashboard / quick-fix del
> Security Advisor / `execute_sql`). Ver REGLA anti-drift del CLAUDE.md.

---

## B. Smoke de PRIMER USO (tenant recién creado, CERO configuración)

**Setup:** registrar un negocio nuevo de punta a punta (no reutilizar un tenant existente). Probar
las dos vías de alta. Hacer las primeras acciones **sin entrar a Configuración**.

| ID | Escenario | Pasos | Resultado esperado (CERO config) | Pri | Estado |
|---|---|---|---|---|---|
| PU-01 | **Alta email/password (Confirm email ON)** | Registro → datos del negocio → "revisá tu email" → confirmar | Tras confirmar, el negocio se crea solo y entra al dashboard. Sin error de RLS. (v1.80.1) | 🔴 | ⬜ |
| PU-02 | **Alta Google OAuth** | Login Google → datos del negocio | Crea tenant + usuario DUEÑO; entra al dashboard | 🔴 | ⬜ |
| PU-03 | **Seed del alta verificado** | Tras el alta, mirar la DB del tenant nuevo | Nace con: **modo básico**, **Sucursal 1**, **Caja Principal**, **estados** (Disponible/Bloqueado), **11 motivos**, **categorías de gasto**, **cuenta Efectivo** + **5 métodos de pago** con Efectivo vinculado, trial 14d. Suficiente para operar sin configurar | 🔴 | ⬜ |
| PU-04 | **Dashboard sin datos** | Entrar al dashboard recién creado | Carga sin error, sin badges/alertas fantasma (cero "1" en Alertas) | 🟡 | ⬜ |
| PU-05 | **Abrir caja** | Caja → abrir (monto 0 o el que sea) | Abre la sesión sin pedir configurar nada | 🔴 | ⬜ |
| PU-06 | **Crear producto mínimo** | Productos → nuevo (solo nombre + precio) | Se crea; SKU autogenerado; sin exigir categoría/estructura | 🔴 | ⬜ |
| PU-07 | **Agregar stock (básico)** | Inventario → Agregar | Crea línea sin ubicación/estado (NULL); stock visible (no "0 disponible") | 🔴 | ⬜ |
| PU-08 | **Venta efectivo** | POS → producto → cobrar Efectivo | Rebaja stock + `ingreso` en caja; ticket | 🔴 | ⬜ |
| PU-09 | **Venta NO-efectivo** (tarjeta/transfer) | POS → cobrar Tarjeta | `ingreso_informativo` en caja (¡este tipo estaba roto en PROD por el drift del CHECK!) | 🔴 | ⬜ |
| PU-10 | **Registrar gasto efectivo** | Gastos → nuevo, pago efectivo | `egreso` en caja; imputado a una categoría seedeada | 🔴 | ⬜ |
| PU-11 | **Ingresar a Caja Fuerte** | Caja → Caja Fuerte → Ingresar dinero | `ingreso_traspaso` OK (era el error `caja_movimientos_tipo_check`) | 🔴 | ⬜ |
| PU-12 | **Reserva con seña** | POS → reservar + seña efectivo | `ingreso_reserva` OK (estaba roto en PROD por el drift) | 🔴 | ⬜ |
| PU-13 | **Devolución** | Devolver una venta efectivo | `egreso`/`egreso_devolucion_sena` OK (drift) | 🔴 | ⬜ |
| PU-14 | **Arqueo + cierre de caja** | Caja → arqueo → cerrar | Calcula diferencia, cierra; sin error | 🔴 | ⬜ |
| PU-15 | **Facturación sin datos fiscales** | Sin cargar CUIT/condición | El módulo no aparece / o avisa "configurá tus datos fiscales"; **nunca rompe** | 🟡 | ⬜ |
| PU-16 | **Cada módulo del básico abre con cero datos** | Recorrer Clientes/Proveedores/Alertas/Reportes/Dashboard | Todos cargan sin error y sin estados rotos | 🟡 | ⬜ |
| PU-17 | **Cobranza CC en efectivo** | (si se hizo una venta CC) cobrar efectivo | Exige caja abierta antes de saldar; `ingreso` OK | 🟡 | ⬜ |

---

## C. Cómo se ejecuta

1. **Paridad (A):** correr el SQL de PAR-01 en DEV y PROD y diffear; ídem PAR-02..05. Cualquier
   diferencia → migración versionada (DEV+PROD). **Es lo primero** (la causa de los bugs).
2. **Smoke (B):** crear un tenant descartable (email real para PU-01) y recorrer PU-03→PU-17 **en
   PROD** (es donde fallan los drifts) y en DEV. Marcar cada fila.
3. Registrar hallazgos acá y, si son de DB, como migración. Re-correr hasta verde.

## D. Hallazgos / fixes ya aplicados (origen de este plan)
- ✅ **SMTP de Auth → Resend** (era "email rate limit" del SMTP integrado). 2026-06-20.
- ✅ **Onboarding soporta "Confirm email" ON** (v1.80.1) — el negocio se crea al confirmar; antes
  fallaba la RLS de `tenants` (signUp sin sesión).
- ✅ **mig 229** — `caja_movimientos_tipo_check` re-sincronizado (CHECK por prefijo
  `^(ingreso|egreso)(_[a-z]+)*$`), DEV+PROD. Desbloquea Caja Fuerte, señas, ventas no-efectivo y
  devoluciones de seña en PROD (estaban rotas por el drift).
- ✅ **mig 230 — PAR-01 (paridad de CHECKs) CERRADO.** El escaneo encontró 5 CHECKs en PROD que NO
  estaban en DEV. Dos eran landmines: **`ventas_estado_check`** sin `'devuelta'` (rompía la
  devolución total en PROD) y **`notificaciones_tipo_check`** que rechazaba las claves de evento
  (`diferencia_apertura_caja`/`diferencia_cierre_caja` → abrir/cerrar caja con diferencia rompía).
  mig 230 deja **DEV == PROD** (mismo hash `565c8f0…`, 97 CHECKs): ventas con set completo,
  notificaciones sin CHECK (es clave de evento), y caja_sesiones/motivos agregados a DEV;
  inventario_lineas_cantidad_check eliminado (redundante con chk_cantidad_no_negativa).
- ⏳ **Pendiente del plan (próxima sesión):** PAR-02..05 (policies/columnas/triggers/defaults) + el
  smoke de primer uso PU-01→PU-17 sobre un tenant nuevo real, en PROD.
