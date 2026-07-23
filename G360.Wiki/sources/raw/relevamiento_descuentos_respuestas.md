---
name: relevamiento_descuentos_respuestas
description: Respuestas de GO (para revisar con Fede) sobre reglas de descuentos — tope acumulado por período, descuento por método de pago con selector de días, descuento por estado de inventario, y autorización granular de cambios en Inventario. Todavía NO implementado — capturado en medio de la sesión de Pedidos, pendiente de retomar.
type: project
---

# Relevamiento Descuentos — respuestas de GO (pendiente de implementar)

> Capturado 2026-07-22 en medio de la sesión de arranque del módulo Pedidos — GO pasó estas
> respuestas "de paso" desde un artefacto HTML armado para revisar con Fede. **Prioridad explícita
> de GO: terminar 100% el módulo Pedidos primero, sin parar.** Esto queda anotado para no perderlo,
> sin implementar todavía. Los puntos 1-7 refieren a preguntas del artefacto que no se conservaron
> literalmente en este documento (se perdieron con el `/clear` de contexto) — solo las RESPUESTAS de
GO, tal como las pasó.

## Puntos 1 y 2 — Tope de descuento (acumulado + período) y descuento por método de pago por día

- **Sí**, además del tope acumulado por venta, agregar tope de descuento **por período** (ej. por
  mes) para el mismo cliente — ambos criterios conviven a la vez (tope por venta Y tope por mes).
  Objetivo: evitar que un cliente abuse de un descuento/promo día tras día hasta volar el
  presupuesto destinado a descuentos.
- Confirma que sí quiere agregar **descuentos por % en métodos de pago**, pero no encuentra hoy el
  selector de días (ej. "descuento en efectivo todos los lunes").
- **Diseño pedido explícitamente por GO** para el selector de días + descuento por método de pago:
  - Sección aparte, **debajo** de la lista de métodos de pago (sacar el campo de descuento de la
    edición individual de cada método de pago actual).
  - En esa sección nueva: elegir qué métodos de pago tienen descuento (checkbox), y para cada uno
    elegir con checkboxes los **días de la semana** en que está habilitado el descuento — por
    default los 7 días vienen tildados al agregar el método con descuento.
  - Ahí mismo se define el **% de descuento** de ese método+día.

## Punto 3 — Descuento por estado de inventario (ampliación de lo ya construido en mig 284/285)

- El descuento debe poder ser **en % o en $** (hoy — verificar contra el código real de mig 284/285
  cuál de los dos soporta hoy, puede que falta el otro).
- **Pregunta 1 (en qué estados aplica)**: podría agregarse en **cualquier estado** (aunque por
  default todos van sin descuento). Caso de uso explícito: productos en estado "Próximo a vencer"
  con descuento automático para venderlos más rápido antes de que venzan.
- **Pregunta 2 (autorización para aplicarlo en la venta)**: se aplica solo en la venta **sin
  necesidad de contraseña ni permiso de supervisor** — pero **solo el DUEÑO** puede configurar/
  otorgar estos descuentos por estado (el permiso de *configurar* es exclusivo de OWNER, el permiso
  de *aplicar* en la venta ya viene dado por el estado del producto, no requiere override adicional).
- **Pedido nuevo, fuera de descuentos, para Config → Inventario**: agregar checkboxes para pedir
  autorización (aprobación de SUPERVISOR/DUEÑO) en cada uno de estos cambios por separado:
  - cambiar fecha de vencimiento
  - cambios de estado (de inventario)
  - ajustes de cantidad
  - proveedor
  - sucursal
  - estructura
  - eliminar
  
  Y que los **roles de usuario** tengan esta configuración por rol (qué rol necesita autorización
  para cuál de estos cambios y cuál no) — mismo patrón que ya existe hoy en
  Config → Inventario → Reglas de stock → "¿Quién puede ajustar stock sin autorización?"
  (`tenants.ajuste_autorizacion_roles`, mig 228 — ver [[reference_autorizacion_ajustes_por_rol]]).
  Este pedido amplía esa tabla/UI existente a más tipos de cambio, no solo cantidad.
- **Pregunta 3 (orden de aplicación cuando se combinan descuentos)**: se **suman** los descuentos
  (producto + método de pago), pero el orden importa: primero se aplica el descuento del
  **producto**, y el descuento por **método de pago** se calcula sobre el monto YA descontado (no
  sobre el precio original) — nunca se aplican ambos descuentos independientemente sobre el mismo
  total. Ejemplo de GO: producto de $100 con 30% off → $70; método de pago con 10% off se calcula
  sobre $70 (= -$7), no sobre $100 (que hubiera sido -$10). **Este desglose tiene que quedar
  explícito en tickets y facturación** (para no generar dudas/reclamos del cliente sobre el cálculo).

## Punto 4 y 7 — Pendiente

GO pidió explícitamente revisar mejor antes de responder. Sin respuesta todavía.

## Punto 5 — OK

Confirmado sin objeciones (el contenido puntual de la pregunta 5 no se conservó en este documento
por el `/clear` de contexto — retomar desde el artefacto HTML original si hace falta el detalle).

## Punto 6 — Pendiente

GO pidió explícitamente revisar mejor antes de responder. Sin respuesta todavía.

---

## Estado de este documento

**Nada de esto está implementado todavía.** Cuando se retome: releer este archivo +
`wiki/features/ventas-pos.md` (sección descuentos/C3/G3) + migraciones 284/285 (`estados_inventario_descuento`,
`venta_descuento_estado`) para ver qué de esto ya existe parcialmente vs. qué es 100% nuevo. El
punto de autorización granular en Inventario es una ampliación de
`tenants.ajuste_autorizacion_roles` (mig 228) — no una tabla nueva desde cero.
