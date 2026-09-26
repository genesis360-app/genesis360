---
name: plan_categorias_clientes_y_precio_programado
description: Plan de fases conjunto (2026-09-26) para Categorías de clientes (B-1..B-9) y lo que falta de Precio programado (C-1..C-7), a partir de las respuestas de GO del 25/09 y de relevar el código. Incluye 6 preguntas nuevas (PL-1..PL-6) que salen de cruzar las respuestas con lo que existe hoy.
type: plan
---

# Plan — Categorías de clientes + Precio programado (2026-09-26)

Fuentes: `relevamiento_categorias_clientes_respuestas.md` (Fede, 20/09), `relevamiento_precio_programado_respuestas.md`
(Fede, 20/09), `respuestas_puntos_abiertos_2026-09-25.md` (GO, B-1..B-9 y C-1..C-7). **Estado: PROPUESTA, sin código.**
GO decide el orden y responde PL-1..PL-6 (abajo) antes de arrancar las fases que dependen de ellas.

## Por qué van juntos

Los dos terminan en el mismo lugar: **el cálculo del precio**. Categorías agrega un mecanismo nuevo que compite con
el tier y el estado (B-2); Precio programado quiere programar tiers y combos (C-5), que la respuesta de GO ata a que
exista el **motor único** (B-1). Hoy hay DOS motores que tienen que dar el mismo número:

| Motor | Dónde | Quién lo usa | Sabe quién es el cliente |
|---|---|---|---|
| Cliente | `src/lib/tiers.ts` (`precioBlendedTier`, `mejorPrecioMayorista`) + combos/estado en `VentasPage` | POS, presupuestos | No |
| Servidor | `fn_precio_venta_efectivo` (espejo SQL, mig 330/367/440) | Pedidos → venta | No |

B-1 (GO): **un solo motor, en SQL; el POS lo consulta**. Es la pieza con más riesgo de plata del plan y la que
destraba todo lo demás del lado del precio.

## Lo que ya existe (no se rehace)

- **Precio programado Fases 1-3 EN PROD** (migs 422-424): tabla `precios_programados`, cron de cada minuto, modal
  "¿Desde cuándo rige?", pestaña Programados, etiqueta del repositor con anticipación configurable (default 1 h),
  aviso al cajero, alerta de etiquetas vencidas, aviso si ML/TN no toma el precio. Solo `precio_venta` en pesos.
- **Cuenta corriente por cliente**: `clientes.cuenta_corriente_habilitada / limite_credito / plazo_pago_dias`
  (override de 3 campos) + defaults del negocio en `tenants` (`limite_cc_default`, `cc_enforcement_politica`,
  `cc_interes_mensual_pct`, `cc_dias_vencimiento`…). Las leen **5 funciones SQL** (`fn_ventas_cc_guard`,
  `fn_pedido_generar_venta`, `fn_notificar_cc_vencidas`, `recalcular_intereses_cc[_all]`) y 5 pantallas.
- **Etiquetas de cliente** (`clientes.etiquetas text[]`): siguen para marketing, no se tocan.
- **Tope de descuento del supervisor**: `tenants.descuento_max_supervisor_pct` (solo descuento manual).

## Fases propuestas

Orden pensado para: (1) entregar valor rápido sin tocar el motor, (2) cumplir G1 de Fede ("primero la categoría con
cuenta corriente, después el precio"), (3) dejar el motor único ANTES de meterle mecanismos nuevos.

### Fase 1 — Precio programado: ajustes chicos (C-1, C-2, C-3) · chica · sin motor

> ✅ **C-1 y C-3 HECHOS en DEV el 2026-09-26** (mig 441, e2e 161, UAT §72). C-2 espera PL-4.
- **C-1 aprobación del repositor**: flag nuevo por negocio (default apagado = precio a la hora exacta, como hoy).
  Prendido: el cron aplica solo si llegó la hora **y** la tarea de etiqueta está hecha; sin tope de espera; aviso al
  dueño cuando pasan más de X horas (X configurable). El POS NO activa el precio por la hora en este modo.
- **C-2 la tarea se crea al programar**: nueva opción "apenas se programa" en la anticipación. ⚠️ ver **PL-4**.
- **C-3 cambio inmediato con un programado pendiente**: el modal avisa "hay un cambio programado para el X a $Y" y
  pregunta; default = cancelar el programado.
- Tests: extender `precioProgramado.test.ts` + e2e 151.

### Fase 2 — Categorías, etapa 1: la categoría con cuenta corriente (G1) · media · sin precio
- Entidad `categorias_cliente` (una por cliente, `clientes.categoria_id`), activar/desactivar, borrar solo si nunca se
  usó (C2). Pensada para ~20 por negocio (B-9).
- Condiciones de CC de la categoría: las 5 opcionales con "hereda / sí / no" (D3, D4).
- 🛑 **Una sola función** `fn_cc_condiciones_efectivas(cliente)` = Cliente > Categoría > Negocio (D1), y las 5
  funciones SQL + las pantallas pasan a leer de ahí. Es el riesgo de esta fase (plata): hoy cada lugar resuelve la
  herencia por su cuenta.
- Asignación individual (aviso si el cliente tiene valores propios, D2) y **masiva que se guarda al confirmar, en una
  operación, con resumen previo** (B-6), con la lista de "conservaron valores propios" editable ahí mismo.
- Permisos: DUEÑO por defecto, roles habilitables desde Config (E1, E2); override por cliente solo DUEÑO (E3, B-7: no
  se amplía más allá de los 3 campos).
- Auditoría completa (F1) + registro de quién asignó qué (E2). Aviso de impacto al editar el límite (D2).

### Fase 3 — Motor único de precio en SQL (B-1) · grande · SIN cambio de comportamiento
- `fn_precios_lineas(p_cliente_id, p_items jsonb)` → por línea: precio unitario efectivo, **mecanismo que ganó**
  (lista / tier / estado / —categoría en fase 4—) y el detalle de los que compitieron. Una ida por carrito (B-1).
- El POS y Pedidos pasan a usarlo; `tiers.ts` queda solo para mostrar (o se retira).
- 🛑 **Regla de esta fase: cero cambio de precios.** Se valida con una batería de casos compartida (los tests actuales
  de tiers + casos reales de DEV comparando motor viejo vs nuevo sobre los mismos carritos) antes de cambiar el POS.
- Incluye USD (tasa única BNA, D-1), empaque/presentaciones, redondeo del negocio, combos.
- Riesgo operativo: el POS depende de una ida al servidor para poner precio → hay que definir qué pasa sin red
  (**PL-5**).

### Fase 4 — Categorías, etapa 2: el precio · grande
- Lista por categoría: % **por producto** (B5), distinguiendo "sin cargar" de "0 % explícito" (C4); producto nuevo
  entra sin descuento + alerta de "sin cargar".
- **Importación por Excel** (B-3): por SKU, vista previa, producto inexistente = error en su fila, actualiza solo lo
  que trae. Reutiliza la plantilla con desplegables de D-3. Lotes de ≤ 1000 filas (tope de PostgREST) — pensado para
  10.000 productos por categoría (B-9).
- En el motor: categoría compite con tier y estado, **gana el precio más bajo, no se apilan** (B-2, casos A1/A2 del
  relevamiento como tests obligatorios en el motor). Clientes sin categoría: exactamente como hoy.
- Cada línea de venta guarda categoría, % y mecanismo (F2).
- **Tope de descuento acumulado** (A4/B-5) medido sobre el precio de lista, contando todo; se configura en
  Config → Ventas; **aplica también al DUEÑO, sin salteo**. ⚠️ ver **PL-1**.
- Cartel para el cajero con **texto de plantilla** (la IA va en la fase 5).
- Canales en orden B1: POS → Pedidos → Presupuestos. ML/TN no se tocan (B2). Sin cliente, sin precio de categoría (B4).
- Aviso de impacto al editar una categoría (C1): "afecta a N clientes; M presupuestos/pedidos conservan su precio".

### Fase 5 — IA del cartel + reporte · media
- B-4: la IA **redacta al guardar la promoción**, no en la venta; fallback = plantilla; se le manda producto, categoría
  y %, nunca datos del cliente, costos ni márgenes.
- F3: reporte de lo no facturado por descuentos de categoría (período, categoría, cliente), solo líneas donde ganó la
  categoría.

### Fase 6 — Precio programado sobre el motor (C-5) + cambios masivos · media
- Programar tramos mayoristas y combos (C-5), ahora que hay un solo motor.
- E1: programar por **lote** (una fecha/hora, N productos) — la tabla ya lo permite.

### Después (con dependencias externas)
- **C-6** precio programado con moneda explícita → cuando se haga la fase 1 de Multimoneda.
- **B-8** portal de clientes → cuando el portal permita armar pedidos (hoy no, ver **PL-3**).

## ❓ Preguntas nuevas para GO (salen de cruzar las respuestas con el código)

- **PL-1 · El tope cuando el que vende es el DUEÑO.** A4 dice "por encima del tope autoriza un supervisor o el DUEÑO";
  B-5 dice "el DUEÑO también tiene tope, sin salteo". Juntas: ¿**nadie** puede vender por encima del tope (se bloquea
  para todos), o el DUEÑO necesita que otro (supervisor) lo autorice? Propuesta: **se bloquea para todos**; para
  vender más barato hay que subir el tope en Config (queda auditado).
- **PL-2 · "Ventas recurrentes" no existen hoy.** B1 lista 5 pantallas (POS, Pedidos, Presupuestos, ventas
  recurrentes, portal). En el sistema no hay ventas recurrentes a clientes. Propuesta: sacarlas del alcance; si se
  construyen, nacen usando el motor.
- **PL-3 · El portal de clientes no arma pedidos.** `MiPortalPage` solo consulta. B-8 queda sin dónde aplicarse.
  Propuesta: diferir B-8 hasta que exista esa función (sería un proyecto aparte).
- **PL-4 · C-2 "la tarea se crea al programar" y los negocios que ya lo usan.** Hoy el default es "1 hora antes" y está
  en PROD. ¿El nuevo default aplica solo a negocios nuevos, o se cambia también a los que ya tienen configurado
  "1 hora" (que quizás lo eligieron a propósito)? Propuesta: **solo negocios nuevos** + agregar la opción para todos.
- **PL-5 · El POS sin red (fase 3).** Con el motor en SQL, el POS necesita el servidor para poner precio. Hoy calcula
  en el navegador. Propuesta: sin respuesta del servidor el producto **no entra al carrito** (mismo criterio que D5:
  no se inventa un precio), con reintento; ¿o prefieren un modo degradado a precio de lista con aviso?
- **PL-7 · C-1 con varias sucursales con góndola.** Implementado: el precio espera a que se confirme la etiqueta en
  **todas** (si no, la sucursal que no la puso cobraría distinto de lo que muestra). Contracara: mientras tanto, en la
  que sí la puso, la góndola muestra el precio nuevo y se cobra el viejo (el POS avisa igual que hoy con una etiqueta
  desactualizada). Alternativa: aplicar al confirmar la primera. ¿Se deja "todas"?
- **PL-6 · C-4 "ventas en espera" no existen.** El POS no tiene "poner en espera / retomar" una venta. C-4 no tiene
  dónde aplicarse. ¿Se construye "venta en espera" (sería una función nueva) o C-4 se da por cerrado?

## Riesgos (REGLA #0)
- **Fase 2**: la herencia de CC decide si una venta a cuenta corriente pasa o se bloquea y cuánto interés se cobra →
  e2e mutantes por cada nivel (cliente, categoría, negocio) en POS y Pedidos.
- **Fase 3**: cambiar el motor sin cambiar ningún precio → comparación viejo vs nuevo sobre carritos reales antes de
  conectar el POS; migración revisada por `migration-reviewer`.
- **Fase 4**: el tope y la competencia de mecanismos → los casos A1/A2 del relevamiento como tests del motor, y un
  test de que un cliente SIN categoría cobra exactamente lo mismo que antes.
