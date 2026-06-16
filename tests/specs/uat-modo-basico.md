# UAT — Modo Básico (Genesis360)

> **Propósito:** checklist de aceptación (UAT) exhaustiva para validar que el **modo básico**
> funciona al 100%, con todos los happy-flows, escenarios de borde, excepciones y "qué pasa si el
> usuario hace X". Es el **guion de la auditoría**: cada fila se ejecuta y se marca el resultado real.
>
> **Alcance (confirmado con GO, 2026-06-16):** TODA la superficie visible en básico — operativo +
> administración + integraciones + **facturación AFIP completa** (Kiosko es básico CON AFIP, donde
> aparecieron los bugs de devolución/NC). Modo avanzado/WMS queda **fuera** de este documento.
>
> **Qué es "básico":** mostrador simple. **El stock NO tiene `ubicacion_id` ni `estado_id`** (ambos
> NULL); no hay LPN, lotes, series, vencimientos, OC ni recepciones. Auto-FIFO al vender. Ver
> `reference_basico_stock_null_ubicacion_estado`. Clase de bug #1 (la más cara): queries de
> stock/venta que filtran por columnas WMS sin gatear por `modoAvanzado` → leen 0 / bloquean.

---

## 0. Convenciones, supuestos y setup

### 0.1 Leyenda
- **Tipo:** `H` = happy path · `B` = borde (límite/dato raro) · `E` = excepción/negativo ("qué pasa si…").
- **Prioridad:** 🔴 mueve plata/stock/fiscal (crítico) · 🟡 governance/datos/permisos · 🟢 UX/cosmético.
- **Estado:** ⬜ pendiente · ✅ pasó · ❌ falló · ⚠️ pasa con observación · ⛔ no aplica.
- **Resultado real / Nota:** se completa al ejecutar (qué hizo realmente el sistema).

### 0.2 Supuestos del entorno de prueba
- Tenant nuevo en **modo básico** (kill-switch `MODO_BASICO_ENABLED=true`). Recomendado: tenant tipo "Kiosco".
- Plan con trial activo (para que aparezcan features Pro como Reportes/RRHH si corresponde).
- 1 sucursal (caso típico). Variantes multi-sucursal se prueban en §15.
- Facturación AFIP en **homologación** (`afip_produccion=false`) con cert/token de prueba cargados.
- Seed de alta de tenant: Sucursal 1 + Caja Principal + 11 motivos de movimiento + 2 estados
  ('Disponible','Bloqueado', **ninguno `es_devolucion`**) + 0 ubicaciones + categorías de gasto.

### 0.3 Roles a usar
DUEÑO (admin total) · SUPERVISOR (encargado) · CAJERO (mostrador, `puede_ver_todas=false`) ·
CONTADOR (lectura+reportes+facturación) · VIEWER (solo lectura). DEPOSITO/RRHH existen pero son
marginales en básico mostrador (se cubren en la matriz §20).

### 0.4 Módulos visibles en básico (referencia)
Dashboard · Ventas · Gastos · Caja · Productos · Inventario · Clientes · Facturación *(si habilitada)* ·
Prov./Servicios · Alertas · Reportes *(si plan)* · RRHH *(si plan)* · Sucursales *(si >1)* · Usuarios · Configuración.
**Ocultos en básico** (`avanzadoOnly`): Envíos *(módulo — pero el envío vive dentro del POS)*, Recursos,
Recepciones, Biblioteca, Historial *(global — cada módulo tiene su propio historial)*.

---

## 1. Onboarding / Auth / Sesión

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Alta de negocio nuevo (email) | Registro → OnboardingPage → datos del negocio | Crea `tenants` → `users` rol DUEÑO → trial 14d → seed (Sucursal 1, Caja, estados, motivos, categorías gasto). Entra al dashboard | H | 🔴 | ⬜ | |
| AUTH-02 | Alta vía Google OAuth (tenant nuevo) | Login Google → onboarding | `loadUserData(userId)` ANTES de navegar a /dashboard; store con datos del tenant | H | 🔴 | ⬜ | |
| AUTH-03 | Nuevo tenant arranca en básico | Tras onboarding | `modo_operacion = basico`; nav muestra set básico, oculta WMS | H | 🟡 | ⬜ | |
| AUTH-04 | Login con credenciales inválidas | Email/clave incorrectos | Mensaje de error claro; no entra | E | 🟡 | ⬜ | |
| AUTH-05 | Sesión expira a mitad de operación | Dejar la pestaña; token vence; intentar guardar | Redirige a login o reintenta refresh; no rompe ni pierde datos en silencio | E | 🔴 | ⬜ | |
| AUTH-06 | Trial vencido | Forzar trial expirado | `SubscriptionGuard` redirige a pantalla de pago; bloquea operación | E | 🔴 | ⬜ | |
| AUTH-07 | Cerrar negocio / salir / eliminar cuenta | Usuario elimina su registro | Política DELETE permite (mig 113); verifica > 0 filas | B | 🟡 | ⬜ | |
| AUTH-08 | Recuperar contraseña | Flujo "olvidé mi clave" | Email de reset llega (Resend); link funciona | H | 🟡 | ⬜ | |

---

## 2. Configuración del negocio

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| CFG-01 | Editar datos del negocio | Config → Negocio → nombre, logo, etc. | Guarda; `setTenant(data)` re-sincroniza store (sin valores viejos al re-mount) | H | 🟡 | ⬜ | |
| CFG-02 | Nombre de la app = BRAND.name | Revisar header/títulos | Nunca hardcodeado; usa `BRAND.name` | 🟢 | 🟢 | ⬜ | |
| CFG-03 | Toggle modo básico↔avanzado | Config → Negocio (DUEÑO) | Avanzado gateado a plan Pro+; cambia visibilidad de nav; **nunca borra datos** | B | 🟡 | ⬜ | |
| CFG-04 | Config → Conectividad: sub-tab **API oculto** en básico | Abrir Conectividad | No muestra API; sí muestra Integraciones (TN/MeLi/MP) | B | 🟡 | ⬜ | |
| CFG-05 | Productos → **Estructura oculta** en básico | Ir a Productos | No hay tab/acción Estructura | B | 🟢 | ⬜ | |
| CFG-06 | Inventario en Config: solo categorías/motivos/unidades | Config → Inventario | Sin gobierno WMS (ubicaciones/estados avanzados) | B | 🟢 | ⬜ | |
| CFG-07 | Habilitar facturación **sin datos fiscales** | Toggle Facturación sin `condicion_iva_emisor`+`cuit` | **Bloquea**: exige condición IVA + CUIT guardados (un monotributista sin condición emitiría B en vez de C) | E | 🔴 | ⬜ | |
| CFG-08 | Habilitar facturación con datos completos | Cargar CUIT+condición IVA+PV → toggle | Habilita; aparece módulo Facturación en nav | H | 🔴 | ⬜ | |
| CFG-09 | "Datos para los comprobantes" | Config → Facturación | IIBB, Inicio Act, CBU/Alias/Banco, leyenda, sitio web, logo → salen en PDF | H | 🟡 | ⬜ | |
| CFG-10 | Guardado consolidado por tab | Config Envíos/Ventas | Un solo botón "Guardar" por tab (no 11) | 🟢 | 🟢 | ⬜ | |
| CFG-11 | Toggle facturación a producción (afip_produccion) | DUEÑO, con confirmación | Owner-only + confirmación + exige CUIT/token; default homologación | E | 🔴 | ⬜ | |
| CFG-12 | Métodos de pago + cuenta de origen | Config → métodos de pago | Cada método mapea a una cuenta de origen (decoupling método↔destino contable) | B | 🟡 | ⬜ | |
| CFG-13 | Categorías de gasto (alta/edición/baja) | Config → categorías de gasto | CRUD; usar en gastos; no romper gastos existentes al borrar | B | 🟡 | ⬜ | |
| CFG-14 | Unidades de medida | Config → unidades | Alta/edición; se usan en productos (unidad, kg, etc.) | B | 🟢 | ⬜ | |
| CFG-15 | Motivos de movimiento | Config → motivos | Seedeados (11); usar en ajustes de inventario | B | 🟢 | ⬜ | |
| CFG-16 | Clave maestra: configurar/cambiar | Config → seguridad → clave maestra | Setea hash; pide la actual para cambiar; anti-fuerza-bruta | E | 🔴 | ⬜ | |
| CFG-17 | Reglas de descuento por rol/canal | Config → ventas | `descuento_max_supervisor_pct`, máx por canal → se enforzan en POS | B | 🟡 | ⬜ | |
| CFG-18 | Reglas de CC (límite, morosidad, vencimiento) | Config → cuenta corriente | `limite_cc_default`, `cc_morosidad_politica`, `cc_dias_vencimiento` se aplican en venta | B | 🔴 | ⬜ | |

---

## 3. Productos

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| PRD-01 | Alta producto mínima | Solo `nombre` (categoría opcional) | Crea; SKU autogenerado o manual | H | 🟡 | ⬜ | |
| PRD-02 | **Stock disponible en la lista** (BUG histórico #2) | Producto con stock | Muestra cantidad real, **NO "0 disponible"** (no filtra `estado_id` en básico) | H | 🔴 | ⬜ | |
| PRD-03 | Producto sin categoría | Alta sin categoría | Se crea; **dispara alerta "sin categoría"** (ver ALR-03) | B | 🟡 | ⬜ | |
| PRD-04 | Precio de venta / costo / margen | Editar precios | Calcula margen; costo visible solo a roles autorizados (G4) | H | 🟡 | ⬜ | |
| PRD-05 | `es_kit` + mayoristas gateados | Ver opciones en básico | Kit y precios mayoristas **ocultos** en básico (avanzado) | B | 🟢 | ⬜ | |
| PRD-06 | Editar producto | Cambiar nombre/precio | Persiste; no asume ubicación/estado | H | 🟡 | ⬜ | |
| PRD-07 | Baja lógica (activo=false) | Desactivar producto | Deja de aparecer en POS; histórico se conserva | B | 🟡 | ⬜ | |
| PRD-08 | Eliminar producto **con stock** | Intentar borrar con stock>0 | Bloquea o advierte (no deja inventario huérfano) | E | 🔴 | ⬜ | |
| PRD-09 | Eliminar producto **con ventas** | Borrar producto vendido | Bloquea (FK) o desactiva; no rompe histórico de ventas | E | 🔴 | ⬜ | |
| PRD-10 | SKU duplicado | Alta con SKU repetido | Rechaza con mensaje claro | E | 🟡 | ⬜ | |
| PRD-11 | Precio negativo / 0 | Cargar precio <0 | Valida; rechaza negativo (0 puede ser válido para regalo) | E | 🟡 | ⬜ | |
| PRD-12 | Importar productos (Excel/CSV) | Importar archivo | Crea en lote; reporta filas inválidas/duplicadas sin abortar todo | B | 🟡 | ⬜ | |
| PRD-13 | Buscar por nombre/SKU/código de barras | Búsqueda en lista/POS | Encuentra; escaneo de barcode resuelve | H | 🟡 | ⬜ | |
| PRD-14 | Stock mínimo por producto | Setear mínimo | Al caer bajo mínimo → alerta de stock bajo | B | 🟡 | ⬜ | |

---

## 4. Inventario (sin WMS)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| INV-01 | **Agregar stock → Ingreso** | Inventario → Agregar → producto + cantidad | Crea `inventario_lineas` con `ubicacion_id`/`estado_id` **NULL**; trigger recalcula `stock_actual` | H | 🔴 | ⬜ | |
| INV-02 | Modal de ingreso: **sin UI WMS** | Abrir Agregar stock | No pide ubicación/estado/lote/vencimiento/serie | B | 🟡 | ⬜ | |
| INV-03 | **Quitar stock → Rebaje simple** | Inventario → Quitar → producto + cantidad | Rebaja; encuentra stock (no filtra `.not('ubicacion_id')` en básico) | H | 🔴 | ⬜ | |
| INV-04 | **Rebaje masivo** (BUG histórico #3) | Masivo (rebaje) varios productos | Encuentra stock en básico; rebaja correcto | H | 🔴 | ⬜ | |
| INV-05 | **Agregar stock masivo inline** | Masivo (ingreso) | Ingresa sin pedir ubicación; sin preview WMS | B | 🔴 | ⬜ | |
| INV-06 | Ajuste de inventario | Ajustar cantidad a un valor | Genera movimiento de ajuste; `stock_antes/despues` correctos (no 0) | H | 🔴 | ⬜ | |
| INV-07 | Rebajar más que el stock | Quitar cantidad > stock | Bloquea o deja en 0 con aviso; nunca stock negativo silencioso | E | 🔴 | ⬜ | |
| INV-08 | Historial de movimientos (por producto) | Ver tab Historial | `stock_antes/despues` reales; ESC cierra modal de detalle | 🟡 | 🟡 | ⬜ | |
| INV-09 | Conteo en básico | Iniciar conteo | No exige ubicación; ajusta diferencias | B | 🟡 | ⬜ | |
| INV-10 | Grilla sin columnas WMS | Ver Inventario | Sin Lote/Venc./Series/Estado/LPN; columna Cantidad bien alineada | 🟢 | 🟢 | ⬜ | |
| INV-11 | Tab Autorizaciones oculto en básico | Ver Inventario | No aparece | B | 🟢 | ⬜ | |
| INV-12 | Origen del ingreso visible | Inventario tras devolución/anulación | Cada línea muestra `notas` ("Devolución de venta #X") | 🟡 | 🟡 | ⬜ | |
| INV-13 | Kits ocultos en básico | Buscar tab Kits | No aparece (avanzado) | B | 🟢 | ⬜ | |

---

## 5. Ventas / POS

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| VEN-01 | **Venta directa efectivo** | Agregar producto → cobrar efectivo | Auto-FIFO (sin picker LPN) → rebaja stock + `movimientos_stock` + **caja `ingreso`** | H | 🔴 | ⬜ | |
| VEN-02 | Stock disponible al agregar al carrito | Buscar producto con stock | Muestra disponible correcto (no 0) | H | 🔴 | ⬜ | |
| VEN-03 | `ventas.numero` lo asigna el trigger | Confirmar venta | Número correlativo; **nunca** enviado en el INSERT | H | 🟡 | ⬜ | |
| VEN-04 | Cobro en efectivo con vuelto | Total $1500, paga $2000 | Calcula vuelto $500; caja registra ingreso por el total | H | 🔴 | ⬜ | |
| VEN-05 | Medio de pago no-efectivo (tarjeta/transferencia) | Cobrar con tarjeta | `ingreso_informativo` (no afecta saldo de caja) + cuenta de origen | H | 🔴 | ⬜ | |
| VEN-06 | Pago mixto (efectivo + tarjeta) | Cobrar dividido | `medio_pago` JSON `[{tipo,monto}...]`; suma = total | H | 🔴 | ⬜ | |
| VEN-07 | Pago mixto que NO suma el total | Cargar montos < total | Bloquea hasta cubrir el total; mensaje claro | E | 🔴 | ⬜ | |
| VEN-08 | **Venta fiada (CC)** | Cobrar "Cuenta corriente" | Genera deuda en CC cliente; exige cliente identificado | H | 🔴 | ⬜ | |
| VEN-09 | Venta a CC sin cliente | Intentar fiar sin cliente | Bloquea: fiar requiere cliente | E | 🔴 | ⬜ | |
| VEN-10 | **Reserva con seña** | Reservar + cobrar seña efectivo | Crea reserva; seña → caja `ingreso`; stock reservado | H | 🔴 | ⬜ | |
| VEN-11 | **Despacho de reserva** (cobra saldo) | Despachar reserva | Snapshot `stock_antes/despues` correcto (BUG #1); saldo efectivo → caja; rebaja stock | H | 🔴 | ⬜ | |
| VEN-12 | Cancelar reserva (reintegro seña) | Cancelar | Reintegra seña en efectivo → caja `egreso` (awaited + aviso si falla); libera stock | E | 🔴 | ⬜ | |
| VEN-13 | Vender producto **sin stock** | Agregar producto con stock 0 | Bloquea o avisa "sin stock"; no permite vender en negativo | E | 🔴 | ⬜ | |
| VEN-14 | Vender cantidad > stock | Cantidad 10, stock 3 | Bloquea/limita a 3 con aviso | E | 🔴 | ⬜ | |
| VEN-15 | Carrito vacío | Cobrar sin items | Botón deshabilitado / aviso | E | 🟡 | ⬜ | |
| VEN-16 | Cantidad 0 o negativa | Editar cantidad a 0/-1 | Rechaza | E | 🟡 | ⬜ | |
| VEN-17 | Editar precio en el POS | Cambiar precio de línea | Permitido según rol; recalcula total | B | 🟡 | ⬜ | |
| VEN-18 | **Descuentos solo DUEÑO/SUPERVISOR/ADMIN** | CAJERO intenta descuento | Bloqueado para CAJERO (G3) | E | 🟡 | ⬜ | |
| VEN-19 | Vender **sin caja abierta** (efectivo) | Cobrar efectivo sin sesión de caja | Resuelve caja única / pide abrir; el efectivo SIEMPRE se asienta (no se pierde) | E | 🔴 | ⬜ | |
| VEN-20 | Combo/descuento por cantidad | Vender cantidad que dispara combo | Aplica descuento del combo | B | 🟡 | ⬜ | |
| VEN-21 | **Envío dentro del POS** (módulo Envíos oculto) | Agregar envío a la venta | Permite envío; **`$/km` editable** (no hay Config→Envíos en básico); costo km×$/km recalcula; o monto fijo | H | 🔴 | ⬜ | |
| VEN-22 | Doble-click en "Cobrar" | Click rápido x2 | Idempotente: NO duplica venta ni doble rebaja de stock/caja | E | 🔴 | ⬜ | |
| VEN-23 | Concurrencia: 2 cajeros venden el último | Misma unidad simultánea | Uno gana; el otro recibe "sin stock" (re-chequeo fresco) | E | 🔴 | ⬜ | |
| VEN-24 | Anular venta despachada (sin CAE) | Anular | **Restaura stock** (reingreso mode-aware) + reintegra plata + cancela envíos pendientes | E | 🔴 | ⬜ | |
| VEN-25 | Cambiar cliente de una venta | Editar cliente | Permitido si no tiene CAE | B | 🟡 | ⬜ | |
| VEN-26 | Historial de ventas / detalle | Ver venta | Detalle correcto; ESC cierra el modal visible (stack) | 🟡 | 🟡 | ⬜ | |
| VEN-27 | Venta con cliente nuevo desde el POS | Crear cliente al vender | Crea cliente (default Consumidor Final) y lo asocia | H | 🟡 | ⬜ | |
| VEN-28 | Reserva sin seña / seña < mínima | Reservar con $0 o menos del % mínimo | Bloquea: "no se puede reservar sin seña" / "seña mínima X%" | E | 🔴 | ⬜ | |
| VEN-29 | Reserva vencida → liberación | Reserva pasa su fecha de vencimiento | Sweep lazy libera el stock reservado (re-disponible para venta) | B | 🔴 | ⬜ | |
| VEN-30 | Cancelar reserva con penalidad | Cancelar reserva con % penalidad | Retiene el % de la seña; devuelve el resto (efectivo o crédito a favor, según destino) | B | 🔴 | ⬜ | |
| VEN-31 | Cliente moroso intenta comprar/fiar | Cliente con deuda vencida | `bloqueo_total` impide la venta; `bloqueo_cc` impide solo la parte CC (cobrá por otro medio) | E | 🔴 | ⬜ | |
| VEN-32 | Límite de CC superado | Venta CC que excede el límite del cliente | Avisa o bloquea según `cc_enforcement_politica` | E | 🔴 | ⬜ | |
| VEN-33 | Crédito a favor aplicado en venta | Cliente con saldo a favor → usarlo | Descuenta del saldo; no puede aplicar más que el disponible | B | 🔴 | ⬜ | |
| VEN-34 | Descuento sobre el límite con clave maestra | CAJERO/SUPERVISOR excede el máx de descuento | Pide clave maestra para autorizar; sin clave → bloquea | E | 🟡 | ⬜ | |

---

## 6. Caja

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| CAJ-01 | Abrir caja con saldo inicial | Apertura | Crea sesión; saldo inicial registrado | H | 🔴 | ⬜ | |
| CAJ-02 | Abrir 2da caja con una ya abierta | Intentar 2da apertura | Bloquea o exige cerrar la anterior según regla | E | 🟡 | ⬜ | |
| CAJ-03 | Venta efectivo → ingreso | Tras VEN-01 | Aparece `ingreso` por el total efectivo | H | 🔴 | ⬜ | |
| CAJ-04 | Venta no-efectivo → informativo | Tras VEN-05 | `ingreso_informativo` (no suma al efectivo arqueable) | H | 🔴 | ⬜ | |
| CAJ-05 | Egreso manual / retiro | Registrar egreso | Resta del saldo; queda auditado | H | 🔴 | ⬜ | |
| CAJ-06 | Arqueo parcial | Arqueo intermedio | Compara esperado vs contado; registra diferencia | H | 🔴 | ⬜ | |
| CAJ-07 | Cierre con conteo | Cerrar caja contando | Calcula diferencia; cierra sesión; resumen | H | 🔴 | ⬜ | |
| CAJ-08 | Cierre con diferencia (faltante/sobrante) | Contar distinto al esperado | Registra y exige confirmación/justificación | E | 🔴 | ⬜ | |
| CAJ-09 | Bóveda / Caja Fuerte (se deja en básico) | Operar bóveda | `sucursal_id=NULL` (tenant-wide); visible | B | 🟡 | ⬜ | |
| CAJ-10 | Traspaso entre cajas | Mover efectivo caja→bóveda | Egreso en origen + ingreso en destino; cuadra | H | 🔴 | ⬜ | |
| CAJ-11 | Operar caja sin sesión abierta | Egreso/cobranza sin abrir | Pide abrir caja o usa fallback única abierta; nunca pierde el asiento | E | 🔴 | ⬜ | |
| CAJ-12 | Reportes de caja (vistas) | Ver resumen diario/mensual | `vw_caja_resumen_diario` / `vw_caja_mensual_por_sucursal` correctos | 🟡 | 🟡 | ⬜ | |
| CAJ-13 | **CAJERO no ve caja ajena** | CAJERO mira una caja abierta por otro usuario | No puede ver su contenido (gobernanza de caja) | E | 🔴 | ⬜ | |
| CAJ-14 | Cerrar caja abierta por otro | Intentar cerrar la sesión de otro usuario | Bloquea o exige permiso/clave | E | 🟡 | ⬜ | |
| CAJ-15 | Caja olvidada > 24h | Sesión propia abierta del día anterior | Aviso "caja abierta hace más de 24h" (A4) | B | 🟡 | ⬜ | |
| CAJ-16 | Arqueo/cierre con clave maestra | Operación que exige autorización | Pide clave maestra; sin clave configurada → bloquea | E | 🟡 | ⬜ | |
| CAJ-17 | Reabrir caja cerrada | Intentar operar sobre una sesión cerrada | Bloquea; hay que abrir una nueva | E | 🟡 | ⬜ | |
| CAJ-18 | Egreso supera el efectivo en caja | Retiro mayor al saldo | Avisa/bloquea según política (no deja caja negativa silenciosa) | E | 🔴 | ⬜ | |
| CAJ-19 | Movimiento informativo no afecta arqueo | Venta no-efectivo → `ingreso_informativo` | El arqueo de efectivo NO lo cuenta; sí figura en el detalle | B | 🔴 | ⬜ | |
| CAJ-20 | **Gasto efectivo > saldo de caja** | Pagar un gasto en efectivo mayor al saldo | **Bloquea**: "no hay suficiente efectivo en caja, hacé un ingreso o pagá por otro medio" (no deja caja negativa) | E | 🔴 | ⬜ | *Fix v1.76.0 (CAJ-18)* |
| CAJ-21 | Caja solo registra ingresos manuales | Buscar "egreso manual" en Caja | Por diseño no hay egreso manual en Caja: los egresos van por Gastos / traspaso / devolución | B | 🟢 | ⬜ | |

---

## 7. Gastos

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| GAS-01 | Alta de gasto + pago efectivo | Cargar gasto, pagar efectivo | **Egreso de caja** (awaited; valida saldo); queda imputado | H | 🔴 | ⬜ | |
| GAS-02 | Gasto no-efectivo (transferencia) | Pagar por banco | No toca efectivo de caja; cuenta de origen | H | 🔴 | ⬜ | |
| GAS-03 | Gasto fijo / recurrente | Crear gasto fijo | Se genera/repite según frecuencia | B | 🟡 | ⬜ | |
| GAS-04 | Categorías de gasto seedeadas | Ver categorías | Vienen del seed (SECURITY DEFINER mig 166) | H | 🟡 | ⬜ | |
| GAS-05 | Gasto efectivo sin caja abierta | Pagar efectivo sin sesión | Exige caja / fallback; no pierde el egreso | E | 🔴 | ⬜ | |
| GAS-06 | Tabs OC / Reportes-compras / Recursos ocultos | Ver Gastos en básico | Solo gastos simples; sin gobierno OC | B | 🟢 | ⬜ | |
| GAS-07 | Monto 0 / negativo | Cargar gasto inválido | Rechaza | E | 🟡 | ⬜ | |
| GAS-08 | **Gasto efectivo con caja: egreso awaited** | Pagar gasto efectivo con caja abierta | Egreso `await`eado; si el insert falla → toast (ya no fire-and-forget) | E | 🔴 | ⬜ | *Fix v1.76.0 (GAS-05)* |
| GAS-09 | **Gasto efectivo sin caja: avisa** | Pagar gasto efectivo sin sesión | El gasto se registra + **toast de aviso** "el egreso no se asentó en caja, registralo manual" (ya no silencioso) | E | 🔴 | ⬜ | *Fix v1.76.0* |

---

## 8. Clientes

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| CLI-01 | Alta cliente | Nombre + DNI/tel | Crea; default condición IVA = Consumidor Final | H | 🟡 | ⬜ | |
| CLI-02 | Cliente global (no por sucursal) | Crear en una sucursal | Visible desde todas (clientes es global) | B | 🟡 | ⬜ | |
| CLI-03 | Venta fiada → deuda en CC | Tras VEN-08 | La deuda aparece en la ficha del cliente | H | 🔴 | ⬜ | |
| CLI-04 | **Cobranza CC en efectivo** | Cobrar deuda efectivo (ficha/POS/Caja) | **Exige caja ANTES de saldar** (`requiereCaja`); ingreso de caja; baja la deuda | H | 🔴 | ⬜ | |
| CLI-05 | Cobranza CC sin caja abierta | Cobrar efectivo sin sesión | Bloquea hasta abrir caja (no saldar sin asentar el efectivo) | E | 🔴 | ⬜ | |
| CLI-06 | Cobranza CC no-efectivo | Cobrar por transferencia | Salda deuda; refleja en CC (no en efectivo de caja) | H | 🔴 | ⬜ | |
| CLI-07 | Saldo/deuda y estado de cuenta | Ver ficha + PDF | Saldo correcto; PDF de estado de cuenta | H | 🟡 | ⬜ | |
| CLI-08 | NC a favor / crédito del cliente | Generar crédito | Queda como saldo a favor; se puede redimir en venta | B | 🔴 | ⬜ | |
| CLI-09 | Eliminar cliente con deuda | Borrar deudor | Bloquea o advierte | E | 🔴 | ⬜ | |
| CLI-10 | DNI/CUIT duplicado | Alta repetida | Avisa duplicado | E | 🟡 | ⬜ | |
| CLI-11 | Cumpleaños / notificación | Cliente con fecha nac. | Cron de cumpleaños (GH Actions) genera saludo si configurado | B | 🟢 | ⬜ | |
| CLI-12 | Historial de compras del cliente | Ficha → historial | Lista las ventas del cliente con totales | H | 🟡 | ⬜ | |
| CLI-13 | Redimir crédito a favor en una venta | Cliente con saldo a favor → venta | Aplica el crédito; baja el saldo a favor | H | 🔴 | ⬜ | |
| CLI-14 | Cobranza CC parcial (FIFO) | Pagar menos que la deuda total | Salda las ventas más antiguas primero (FIFO); queda saldo | H | 🔴 | ⬜ | |
| CLI-15 | Condición IVA del cliente | Editar a RI / Monotributo / Exento / CF | Afecta el tipo de comprobante al facturar (A/B/C) | B | 🟡 | ⬜ | |
| CLI-16 | Domicilio del cliente | Cargar domicilio (tabla `cliente_domicilios`) | Sale en factura/remito; el alta no usa `clientes.direccion` | B | 🟢 | ⬜ | |

---

## 9. Proveedores y Servicios

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| PROV-01 | Alta proveedor | Crear proveedor | Crea; global (no por sucursal) | H | 🟡 | ⬜ | |
| PROV-02 | Servicio recurrente | Crear servicio recurrente | Programa; `proximo_at` | H | 🟡 | ⬜ | |
| PROV-03 | **Servicio recurrente vencido → genera gasto** | Disparar sweep lazy | Crea gasto NO pagado + avanza vencimiento | H | 🔴 | ⬜ | |
| PROV-04 | Tab OC y "comparar presupuestos" ocultos | Ver Proveedores en básico | No aparecen (avanzado) | B | 🟢 | ⬜ | |
| PROV-05 | Sub-toolbar Servicios (ActionMenu) | Toolbar | "⋯ Acciones" colapsa secundarias (no hover roto) | 🟢 | 🟢 | ⬜ | |
| PROV-06 | Pagar a proveedor (CC proveedor) | Registrar pago | Baja deuda CC proveedor | H | 🔴 | ⬜ | |

---

## 10. Devoluciones (NO fiscal y costuras) — **zona de bugs históricos**

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| DEV-01 | **Devolución total en efectivo** | Venta efectivo → Devolver todo | **Reingreso de stock** (mode-aware, sin ubicación/estado) + **egreso de caja awaited** + ticket interno | H | 🔴 | ⬜ | |
| DEV-02 | Devolución parcial | Devolver 1 de 3 unidades | Reingresa 1; egreso proporcional; venta queda parcial | H | 🔴 | ⬜ | |
| DEV-03 | **Egreso de devolución se asienta** (BUG #26) | Devolver efectivo $2000 | El egreso aparece en caja (awaited + fallback caja única + toast si falla); NO queda +2000 sin salida | E | 🔴 | ⬜ | |
| DEV-04 | Devolución de venta fiada (CC) | Devolver venta a CC | Revierte la deuda en CC (no egreso de efectivo) | H | 🔴 | ⬜ | |
| DEV-05 | Devolución sin caja abierta (efectivo) | Devolver efectivo sin sesión | Resuelve caja / avisa; no pierde el egreso | E | 🔴 | ⬜ | |
| DEV-06 | Devolver MÁS que lo comprado | Cantidad a devolver > vendida | Bloquea | E | 🔴 | ⬜ | |
| DEV-07 | Devolver una venta ya devuelta total | Segunda devolución total | Bloquea / no hay nada para devolver | E | 🔴 | ⬜ | |
| DEV-08 | Reingreso visible en Inventario | Tras DEV-01 | Línea nueva con `notas`="Devolución de venta #X" y sucursal correcta (no NULL) | H | 🟡 | ⬜ | |
| DEV-09 | Devolución consolida línea en básico | Devolver | Suma a la línea existente del producto (no 1 línea por unidad); `stock_actual` bumpeado | B | 🔴 | ⬜ | |
| DEV-10 | ESC en el ticket de devolución | Abrir ticket → ESC | Cierra el modal visible (no el de atrás) | 🟢 | 🟢 | ⬜ | |
| DEV-11 | **Devolver con cliente que TIENE deuda** | Cliente con deuda CC → devolver | Se aplica a **reducir la deuda** (FIFO, sin egreso de efectivo); banner "Se aplicarán $X a su deuda"; la deuda del cliente baja | H | 🔴 | ⬜ | *Fix v1.76.0 (DEV-04)* |
| DEV-12 | **Devolución > deuda** | Devolver monto mayor a la deuda | Aplica la deuda + el **excedente** se devuelve por el medio elegido (efectivo/otro/crédito) | B | 🔴 | ⬜ | *Fix v1.76.0* |
| DEV-13 | **Devolver sin deuda** | Cliente sin deuda (o CF) → devolver | Se puede devolver en efectivo / otro medio / **crédito a favor**, a elección | H | 🔴 | ⬜ | *Fix v1.76.0* |
| DEV-14 | **Crédito a favor como medio** | Elegir "Crédito a favor (saldo del cliente)" | Genera saldo a favor (`cliente_creditos`, origen `devolucion`); sin cliente → **bloquea** | B | 🔴 | ⬜ | *Fix v1.76.0* |
| DEV-15 | **Re-devolución parcial** | Devolver 1 de 3, reabrir devolución | El modal solo permite el **remanente** (vendido − ya devuelto); si ya se devolvió todo → "nada para devolver" + guard server-side | E | 🔴 | ⬜ | *Fix v1.76.0 (DEV-07)* |
| DEV-16 | A un cliente con deuda NO se le da efectivo | Cliente con deuda, intentar medio Efectivo por la parte de la deuda | Bloqueado: si la devolución se aplica completa a la deuda, exige medios vacíos (no hay devolución monetaria) | E | 🔴 | ⬜ | *Fix v1.76.0* |
| DEV-17 | **Devolución efectivo > saldo de caja** | Devolver en efectivo más de lo que hay en la caja | **Bloquea**: "no hay suficiente efectivo en caja, hacé un ingreso o devolvé por otro medio/crédito" | E | 🔴 | ⬜ | *Fix v1.76.0 (CAJ-18)* |

---

## 11. Facturación AFIP (homologación) — **zona de bugs históricos**

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| FAC-01 | **Emitir Factura C** (monotributo) desde venta | Vender → Emitir factura | CAE real homologación; **C sin IVA** (`ImpNeto=ImpTotal`, `ImpIVA=0`); venta queda `facturada` | H | 🔴 | ⬜ | |
| FAC-02 | `ImpTotal = ImpNeto + ImpIVA` | Emitir | Evita error AFIP 10048 | H | 🔴 | ⬜ | |
| FAC-03 | Auto-detección A/B/C contempla **Exento** | Emisor Exento | Emite **C** (no A/B) | B | 🔴 | ⬜ | |
| FAC-04 | **Factura A sin CUIT** | Cliente CF, elegir A | Botón A **deshabilitado** + aviso; degrada a B | E | 🔴 | ⬜ | |
| FAC-05 | **Factura B ≥ umbral a Consumidor Final sin DNI/CUIT** | Total ≥ ~$68.305 sin ID | **Bloquea** emisión (RG AFIP) + aviso | E | 🔴 | ⬜ | |
| FAC-06 | Descargar / Imprimir / Email factura | Acciones post-emisión | PDF correcto; imprimir vía iframe (sin popup-blocker); email autocompleta `clientes.email` | H | 🔴 | ⬜ | |
| FAC-07 | PDF de factura completo | Ver PDF | Logo, IIBB, Inicio Act, N° con letra, domicilio receptor, Cód. SKU, "Comprobante Autorizado", QR, Ley 27.743 (en B), datos bancarios/leyenda | H | 🟡 | ⬜ | |
| FAC-08 | Emitir factura desde el detalle (si se saltó el prompt) | Detalle de venta → Emitir | Botón disponible si no facturada | B | 🟡 | ⬜ | |
| FAC-09 | QR de pago MercadoPago en factura con saldo | Factura con saldo + MP conectado | QR "Pagá con MercadoPago" (`external_reference=venta_id`); graceful si no hay MP | B | 🟡 | ⬜ | |
| FAC-10 | **Emitir Nota de Crédito electrónica** (vía Devolver) | Devolver venta facturada → Emitir NC | CAE NC; **letra derivada de la factura original y fija** (C→NC-C); `CbtesAsoc` a la original; badge `NC-C #N` | H | 🔴 | ⬜ | |
| FAC-11 | NC: Descargar/Imprimir/Email | Acciones del badge NC | PDF "NOTA DE CRÉDITO" (COD/QR con código AFIP de NC); email | H | 🔴 | ⬜ | |
| FAC-12 | Emitir NC sin factura previa (sin CAE) | Intentar NC de venta no facturada | Bloquea: "no se puede emitir NC sin CAE original" | E | 🔴 | ⬜ | |
| FAC-13 | **Anular venta CON CAE** | Intentar Anular factura emitida | **Bloqueado**: oculta "Anular" + "Cambiar cliente"; solo "Devolver→NC" | E | 🔴 | ⬜ | |
| FAC-14 | Error de AFIP al emitir | Forzar rechazo (dato inválido) | Muestra **error real** (`error.context.json`), no genérico "non-2xx" | E | 🟡 | ⬜ | |
| FAC-15 | CbteFch date-only | Emitir | Factura sin hora (solo fecha) | 🟢 | 🟢 | ⬜ | |
| FAC-16 | Módulo Facturación oculto si no habilitada | Tenant sin facturación | No aparece en nav | B | 🟡 | ⬜ | |
| FAC-17 | Libros IVA / reporte de comprobantes | Ver libros | Lista emitidos con totales | 🟡 | 🟡 | ⬜ | |
| FAC-18 | Chunk viejo tras deploy (SW) | Bundle viejo cacheado | `vite:preloadError` + ErrorBoundary recupera (no "reading 'default'") | E | 🟡 | ⬜ | |
| FAC-19 | Reimprimir factura ya emitida (idempotente) | Re-descargar | Regenera PDF desde snapshot; no re-emite CAE | B | 🔴 | ⬜ | |

---

## 12. Alertas (mode-aware)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| ALR-01 | Stock bajo mínimo | Producto bajo mínimo | Alerta en badge + página | H | 🟡 | ⬜ | |
| ALR-02 | Deuda CC vencida | Cliente con CC vencida | Alerta | H | 🟡 | ⬜ | |
| ALR-03 | **Sin categoría: badge == página** (BUG histórico) | Producto sin categoría | Badge muestra "1" **y** la página lista ese producto (scoping mode-aware, no INNER join a ubicaciones) | E | 🔴 | ⬜ | |
| ALR-04 | Alertas WMS NO aparecen en básico | Revisar alertas | Sin LPN vencidos / OC vencidas / sin ubicación-proveedor (gateadas por modo) | B | 🟡 | ⬜ | |
| ALR-05 | Reservas vencidas | Reserva pasada de fecha | Alerta + sweep lazy libera | B | 🟡 | ⬜ | |

---

## 13. Dashboard y Reportes

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| DSH-01 | Dashboard sin chip Envíos en básico | Ver dashboard | No muestra widget de Envíos (avanzado) | B | 🟢 | ⬜ | |
| DSH-02 | Banner sugerencia modo avanzado | Rubro que sugiere WMS | Banner descartable (`sugiereModoAvanzado`) | 🟢 | 🟢 | ⬜ | |
| DSH-03 | Métricas de ventas/caja del día | Ver dashboard | Cifras coinciden con operación real (por sucursal) | H | 🟡 | ⬜ | |
| DSH-04 | Reportes (si plan) | Abrir Reportes | Export Excel/PDF/CSV; filtrado por sucursal | H | 🟡 | ⬜ | |
| DSH-05 | Reportes locked sin plan | Plan sin `puede_reportes` | Item en gris / upgrade prompt | B | 🟡 | ⬜ | |

---

## 14. Usuarios / Roles / Permisos

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| USR-01 | Invitar usuario | DUEÑO invita | Crea usuario con rol; en básico **NO ofrece Super Usuario** | H | 🟡 | ⬜ | |
| USR-02 | Roles fijos (DUEÑO/SUPERVISOR/CAJERO/CONTADOR/VIEWER) | Asignar rol | Cada rol ve su set de módulos (ver §20) | H | 🟡 | ⬜ | |
| USR-03 | **Rol LECTOR (VIEWER) no puede editar** | VIEWER intenta mutar | Solo lectura en TODOS los módulos (`permisosModulo.ts`); ve operación+reportes | E | 🔴 | ⬜ | |
| USR-04 | Roles personalizados gateados a Pro+ | Crear rol custom en básico | Card con candado + CTA "Ver planes" (básico = solo roles fijos) | B | 🟡 | ⬜ | |
| USR-05 | CAJERO accede a ruta /configuracion directa | Pegar URL | Bloqueado (no autorizado) | E | 🔴 | ⬜ | |
| USR-06 | Rol custom `'ver'` no muta | Permiso 'ver' en un módulo | Lectura, sin botones de mutación (Ventas/Caja/Inventario/Productos/Gastos/Clientes) | E | 🔴 | ⬜ | |
| USR-07 | Eliminar usuario | DUEÑO elimina a otro | Política DELETE owner (mig 113); confirma > 0 filas | B | 🟡 | ⬜ | |
| USR-08 | Autofill de clave en modal | Abrir modal de clave maestra | No autocompleta email detrás del modal (autoComplete off) | 🟢 | 🟢 | ⬜ | |
| USR-09 | **CONTADOR ve y usa Facturación** | Login CONTADOR (facturación habilitada) | Ve el módulo Facturación en el nav y puede operarlo (coherente con su rol "lectura+reportes+facturación") | H | 🟡 | ⬜ | *Fix v1.76.0 (contadorVisible)* |

---

## 15. Sucursales y aislamiento (RLS por sucursal v1.75.0)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| SUC-01 | Básico con 1 sucursal: selector oculto | Operar | Sucursal fijada; **selector del header oculto** (`sucursalUnicaBasico`); nunca "Todas" | H | 🟡 | ⬜ | |
| SUC-02 | Módulo Sucursales aparece solo si >1 | Tenant 1 sucursal | Item Sucursales oculto en básico | B | 🟢 | ⬜ | |
| SUC-03 | **Usuario restringido (CAJERO) solo ve SU sucursal** | Cajero `puede_ver_todas=false` con multi-sucursal | RLS: ve ventas/caja/stock/gastos solo de su sucursal + NULL; NO ve la otra (ni por API) | E | 🔴 | ⬜ | |
| SUC-04 | DUEÑO ve todas las sucursales | DUEÑO multi-sucursal | Sin restricción; ve todo el tenant | H | 🔴 | ⬜ | |
| SUC-05 | **Usuario restringido SIN sucursal asignada** | `puede_ver_todas=false` + `sucursal_id` NULL | ⚠️ Bajo RLS ve solo filas NULL → riesgo de "ve nada". Debe detectarse/backfillear (gotcha conocido) | E | 🔴 | ⬜ | |
| SUC-06 | Cambio de sucursal limpia carrito | (multi-sucursal, rol global) | Cambiar sucursal vacía el carrito; queries refrescan | B | 🟡 | ⬜ | |
| SUC-07 | Reingreso/devolución hereda sucursal | Devolver/anular | Líneas + movimientos con `sucursal_id` de la venta (no NULL) | B | 🔴 | ⬜ | |

---

## 16. Suscripción / Planes / Trial

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| SUB-01 | Trial activo da acceso | Tenant nuevo | 14 días; features Pro disponibles para probar | H | 🟡 | ⬜ | |
| SUB-02 | Feature locked por plan | Plan sin feature | UpgradePrompt; nav item en gris | B | 🟡 | ⬜ | |
| SUB-03 | Suscripción MP (preapproval) | Suscribirse | `init_point` construido en frontend; no `POST /preapproval` por EF | H | 🟡 | ⬜ | |
| SUB-04 | Suscripción vencida/cancelada | Estado expirado | Redirige a pago; bloquea | E | 🔴 | ⬜ | |
| SUB-05 | UpgradePrompt tras hooks | Render early-return | `<UpgradePrompt/>` después de declarar todos los hooks (no rompe React) | E | 🟡 | ⬜ | |

---

## 17. Integraciones (TiendaNube / MeLi / MercadoPago / Email)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| INT-01 | Conectar TiendaNube (OAuth) | Config → Integraciones → TN | OAuth callback; credenciales por sucursal | H | 🟡 | ⬜ | |
| INT-02 | Conectar MercadoLibre | OAuth MeLi | Idem; credenciales por sucursal | H | 🟡 | ⬜ | |
| INT-03 | Conectar MercadoPago | OAuth MP | Credenciales; habilita QR/links de pago | H | 🟡 | ⬜ | |
| INT-04 | Sync de venta externa → stock | Venta en marketplace | Descuenta stock; registra venta; logs | H | 🔴 | ⬜ | |
| INT-05 | Email saliente (Resend) | Enviar factura/OC por email | Llega (FROM noreply@genesis360.pro); con adjunto PDF | H | 🔴 | ⬜ | |
| INT-06 | Email falla (RESEND_API_KEY) | EF send-email non-2xx | Sospechar API key; mensaje claro, no silencioso | E | 🟡 | ⬜ | |
| INT-07 | Webhook de pago MP concilia venta | Pago vía QR factura | `mp-webhook` concilia por `external_reference` | H | 🔴 | ⬜ | |

---

## 18. Costuras cross-module (matriz de relaciones) — **alto riesgo**

| ID | Costura | Qué verificar | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|
| SEAM-01 | Venta efectivo → stock → caja | Rebaja stock + `ingreso` caja, atómico, `stock_antes/despues` reales | 🔴 | ⬜ | |
| SEAM-02 | Venta CC → deuda cliente | Genera CC; cobranza posterior cuadra | 🔴 | ⬜ | |
| SEAM-03 | Cobranza CC efectivo → caja | Exige caja antes de saldar; ingreso | 🔴 | ⬜ | |
| SEAM-04 | Gasto efectivo → caja egreso | Sesión imputable + valida saldo | 🔴 | ⬜ | |
| SEAM-05 | Devolución → reingreso stock + egreso caja + (NC si facturada) | Todo se asienta; awaited | 🔴 | ⬜ | |
| SEAM-06 | Anular venta → revierte stock + cancela envíos | Restaura stock; envíos pendientes cancelados | 🔴 | ⬜ | |
| SEAM-07 | Factura → venta (auto-facturada) | `ventas.facturada=true`; bloquea anular | 🔴 | ⬜ | |
| SEAM-08 | NC → devolución → factura original | `CbtesAsoc` correcto; letra heredada | 🔴 | ⬜ | |
| SEAM-09 | Servicio recurrente vencido → gasto | Sweep lazy genera gasto no pagado | 🔴 | ⬜ | |
| SEAM-10 | Reserva → seña caja → despacho saldo caja | Seña y saldo ambos asentados | 🔴 | ⬜ | |
| SEAM-11 | Pago con cheque (si aplica) → CC proveedor | Crea cheque; rechazo revierte pago | 🔴 | ⬜ | |
| SEAM-12 | Stock min → alerta → reposición | Alerta aparece/desaparece según stock | 🟡 | ⬜ | |

---

## 19. Escenarios transversales "imposibles" / negativos / borde

| ID | Escenario | Resultado esperado | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|
| NEG-01 | Doble submit en cualquier acción de dinero | Idempotente (no duplica venta/cobro/egreso) | 🔴 | ⬜ | |
| NEG-02 | Pérdida de conexión a mitad de cobro | No deja estado inconsistente (venta sin caja / stock sin venta) | 🔴 | ⬜ | |
| NEG-03 | Concurrencia de stock (último ítem) | Solo una venta gana; re-chequeo fresco | 🔴 | ⬜ | |
| NEG-04 | Navegar a ruta inexistente | 404/redirect, sin pantalla en blanco | 🟡 | ⬜ | |
| NEG-05 | Rol sin permiso pega URL directa de módulo no autorizado | Bloqueado server+client | 🔴 | ⬜ | |
| NEG-06 | Importar archivo corrupto/columnas mal | Reporta error por fila; no rompe todo | 🟡 | ⬜ | |
| NEG-07 | Campos con XSS / SQL en nombres | Sanitizado; sin inyección | 🔴 | ⬜ | |
| NEG-08 | Montos con decimales/miles/locale | Parseo correcto (coma vs punto) | 🟡 | ⬜ | |
| NEG-09 | Fechas límite (fin de mes, año, zona horaria) | `numero` de venta por sucursal correcto; sin off-by-one | 🟡 | ⬜ | |
| NEG-10 | Cantidades/precios muy grandes (overflow) | Maneja o limita; sin overflow numérico | 🟡 | ⬜ | |
| NEG-11 | RLS: usuario A intenta leer tenant B | Imposible (aislamiento tenant) | 🔴 | ⬜ | |
| NEG-12 | RLS: usuario restringido lee otra sucursal vía API directa | Imposible (RLS por sucursal v1.75.0) | 🔴 | ⬜ | |
| NEG-13 | Borrar entidad referenciada (categoría/cliente/producto en uso) | Bloquea o desactiva; no rompe FKs | 🔴 | ⬜ | |
| NEG-14 | Operar con caja de otro usuario/sucursal | Bloqueado | 🔴 | ⬜ | |
| NEG-15 | ESC con varios modales apilados | Cierra siempre el visible, de a uno (stack `useModalKeyboard`) | 🟡 | ⬜ | |
| NEG-16 | PWA offline / reconexión | Degrada con aviso; sincroniza al volver | 🟡 | ⬜ | |
| NEG-17 | Cambiar de modo básico↔avanzado con datos cargados | No pierde ni corrompe datos; solo cambia UI | 🔴 | ⬜ | |
| NEG-18 | Nombres muy largos / emojis / acentos | Producto/cliente con texto largo o `Ñ & 😀 <b>` | Se guarda y muestra sin romper UI ni PDF; sin inyección HTML | 🟡 | ⬜ | |
| NEG-19 | Montos con coma vs punto (locale es-AR) | Cargar `1.234,56` o `1234.56` | Parseo correcto; no confunde miles con decimales | 🟡 | ⬜ | |
| NEG-20 | Cantidad/precio enormes (overflow) | Cargar 9.999.999.999 | Maneja o limita; sin overflow ni `NaN` | 🟡 | ⬜ | |
| NEG-21 | Reserva y venta del mismo último stock (carrera) | Reservar y vender la última unidad casi simultáneo | Solo una prospera; la otra "sin stock" (re-chequeo fresco) | 🔴 | ⬜ | |
| NEG-22 | Cobranza CC + devolución del mismo cliente en simultáneo | Dos operaciones que tocan su deuda a la vez | No deja la deuda inconsistente (último gana, valores coherentes) | 🔴 | ⬜ | |
| NEG-23 | Editar venta/precio en período contable cerrado | Intentar modificar una venta de un período cerrado | Bloquea (`isPeriodoCerrado`) | 🔴 | ⬜ | |
| NEG-24 | Conteo wall-to-wall bloqueante activo | Vender/mover stock durante un conteo bloqueante | Bloquea reserva/despacho hasta cerrar el conteo (A2) | 🔴 | ⬜ | |
| NEG-25 | Timezone / fin de mes en el N° de venta | Vender a las 23:59 fin de mes | `numero` correlativo por sucursal correcto, sin saltos ni duplicados | 🟡 | ⬜ | |

---

## 20. Matriz Rol × Módulo (acceso esperado en básico)

> ✅ ve y opera · 👁 solo lectura · ❌ oculto/bloqueado. (Confirmar contra `navVisibility.ts` + `permisosModulo.ts`.)

| Módulo | DUEÑO | SUPERVISOR | CAJERO | CONTADOR | VIEWER |
|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ❌ | ✅ | 👁 |
| Ventas | ✅ | ✅ | ✅ | 👁 | 👁 |
| Caja | ✅ | ✅ | ✅ | 👁 | 👁 |
| Gastos | ✅ | ✅ | ❌ | 👁 | 👁 |
| Productos | ✅ | ✅ | ❌ | ❌ | 👁 |
| Inventario | ✅ | ✅ | ❌ | ❌ | 👁 |
| Clientes | ✅ | ✅ | ✅ | 👁 | 👁 |
| Alertas | ✅ | ✅ | ❌ | ❌ | 👁 |
| Facturación | ✅ | ❌ | ❌ | ✅ | ❌ |
| Prov./Servicios | ✅ | ❌ | ❌ | ❌ | ❌ |
| Reportes | ✅ | ✅ | ❌ | ✅ | 👁 |
| Sucursales | ✅ | ❌ | ❌ | ❌ | ❌ |
| Usuarios | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configuración | ✅ | ❌ | ❌ | ❌ | ❌ |

> ⚠️ Esta matriz es una **hipótesis a verificar** en la auditoría — los valores reales surgen de
> `navVisibility.ts` (allowlists `cajeroVisible`/`contadorVisible`/`VIEWER_MODULOS` + `ownerOnly`/
> `supervisorOnly`) y `permisosModulo.ts`. Marcar discrepancias.

---

## 21. Cómo se ejecuta la auditoría con este UAT
1. **Capa A (código):** por cada fila 🔴, rastrear el flujo en el código y confirmar que la
   respuesta del sistema es la esperada (especial foco en *mode-awareness* del stock y en que el
   efectivo SIEMPRE se asiente).
2. **Capa B (datos/SQL):** validar costuras con queries en DEV (impersonando roles para RLS).
3. **Capa C (click-through):** ejecutar manualmente las filas con un tenant básico real.
4. Completar `Estado` + `Resultado real / Nota` de cada fila. Cada ❌/⚠️ abre un bug a reparar
   antes de habilitar el módulo para un cliente.

---

## 22. Presupuestos (venta en estado `pendiente`)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| PRES-01 | Crear presupuesto | POS → "Guardar presupuesto" (estado `pendiente`) | **No toca stock ni caja**; numeración `PRES-NNNN`; no exige caja abierta | H | 🔴 | ⬜ | |
| PRES-02 | Presupuesto sin caja | Guardar presupuesto sin sesión de caja | Permitido (solo despacho/reserva exigen caja) | B | 🟡 | ⬜ | |
| PRES-03 | PDF A4 del presupuesto | Descargar / Imprimir presupuesto | PDF A4 (no ticket térmico); datos del negocio + ítems + validez | H | 🟡 | ⬜ | |
| PRES-04 | Convertir presupuesto → venta/reserva | Desde el presupuesto: despachar (cobra todo) o reservar (cobra seña) | Ahí SÍ exige caja + rebaja/reserva stock; el presupuesto pasa a despachada/reservada | H | 🔴 | ⬜ | |
| PRES-05 | Presupuesto vencido | Presupuesto con `validez_dias` superado | Se marca/avisa vencido; convertir exige renovar o avisa | E | 🟡 | ⬜ | |
| PRES-06 | Editar presupuesto antes de convertir | Cambiar ítems/cantidades/precios | Persiste; recalcula total; sin afectar stock | H | 🟡 | ⬜ | |
| PRES-07 | % Dto. por línea en presupuesto | Cargar descuento por ítem | Se refleja en el PDF (dato en `venta_items.descuento`) | B | 🟢 | ⬜ | |
| PRES-08 | Convertir presupuesto con producto sin stock | El producto quedó sin stock desde que se presupuestó | Bloquea/avisa al convertir (re-chequeo de stock) | E | 🔴 | ⬜ | |
| PRES-09 | Eliminar/anular presupuesto | Borrar un presupuesto | Se quita sin afectar stock/caja (nunca tocó nada) | B | 🟡 | ⬜ | |
| PRES-10 | Convertir presupuesto con stock OK | Presupuesto → despachar, hay stock | Rebaja correcto, asienta caja, pasa a despachada | H | 🔴 | ⬜ | *Fix v1.76.0 (PRES-08)* |

---

## 23. Comprobantes e impresión

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| COMP-01 | Ticket térmico de venta | Cobrar → ticket | Ticket con ítems, total, vuelto, medio de pago; imprime | H | 🟡 | ⬜ | |
| COMP-02 | Reimprimir ticket/venta desde historial | Detalle de venta → imprimir | Regenera desde snapshot (no guarda PDF en storage) | B | 🟡 | ⬜ | |
| COMP-03 | Remito (no fiscal) | Generar remito de una venta | PDF "Recibí conforme", no fiscal | B | 🟡 | ⬜ | |
| COMP-04 | Factura PDF A4 | Descargar factura emitida | Logo, datos fiscales, N° con letra, QR, "Comprobante Autorizado" | H | 🟡 | ⬜ | |
| COMP-05 | NC PDF | Descargar NC emitida | "NOTA DE CRÉDITO", COD/QR con código AFIP de NC | H | 🟡 | ⬜ | |
| COMP-06 | Email de comprobante | Enviar factura/NC por email | Modal con `clientes.email` precargado y editable; llega con PDF adjunto | H | 🔴 | ⬜ | |
| COMP-07 | Impresión sin popup-blocker | Imprimir desde acción post-venta | Vía iframe (no `window.open` bloqueado) | E | 🟡 | ⬜ | |
| COMP-08 | Estado de cuenta del cliente (PDF) | Ficha cliente → estado de cuenta | PDF con saldo + movimientos CC | H | 🟡 | ⬜ | |
| COMP-09 | Comprobante con caracteres especiales/nombre largo | Cliente "Ñoño & Cía. 😀" | PDF no rompe el layout ni corta mal | B | 🟢 | ⬜ | |

---

## 24. Ventas recurrentes (plantillas)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| REC-01 | Convertir venta en recurrente | Desde una venta → "Convertir en recurrente" | Crea plantilla (`ventas_recurrentes`) con snapshot de ítems + frecuencia + `proximo_at` | H | 🟡 | ⬜ | |
| REC-02 | Panel de recurrentes + badge vencidas | Ver panel | Lista plantillas; badge de las vencidas | H | 🟡 | ⬜ | |
| REC-03 | Generar desde recurrente | "Generar ahora" | Crea **presupuesto `pendiente`** (no toca stock/caja); avanza `proximo_at` | H | 🔴 | ⬜ | |
| REC-04 | Pausar / activar recurrente | Toggle activo | Deja de aparecer como vencida / vuelve | B | 🟢 | ⬜ | |
| REC-05 | Eliminar recurrente | Borrar plantilla | Se quita; no afecta ventas ya generadas | B | 🟢 | ⬜ | |

---

## 25. Escaneo y códigos de barra

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| SCAN-01 | Escanear barcode en POS | Lector/cámara → código EAN | Agrega el producto al carrito (match por `codigo_barras`) | H | 🔴 | ⬜ | |
| SCAN-02 | Código GS1 compuesto | Escanear código con AI (GTIN + cantidad/lote/venc.) | Resuelve el producto por GTIN + aplica cantidad si viene (AI 30) | B | 🟡 | ⬜ | |
| SCAN-03 | Código no encontrado | Escanear un código inexistente | Aviso "producto no encontrado"; no agrega nada | E | 🟡 | ⬜ | |
| SCAN-04 | Escanear para sumar cantidad | Escanear el mismo producto 2 veces | Suma a la línea existente (no crea 2 líneas) | H | 🟡 | ⬜ | |
| SCAN-05 | Escanear en alta de stock | Inventario → ingreso por escaneo | Encuentra el producto y precarga | B | 🟢 | ⬜ | |
| SCAN-06 | Buscar manual por SKU/nombre | Tipear en el buscador del POS | Filtra y permite agregar; autoFocus en el campo | H | 🟢 | ⬜ | |

---

## 26. PWA / offline / mobile

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| PWA-01 | Instalar como app | "Instalar" desde el navegador | Se instala (manifest + SW); abre standalone | B | 🟢 | ⬜ | |
| PWA-02 | Operar con conexión intermitente | Cortar internet a mitad de venta | Degrada con aviso; no deja venta a medias (ver NEG-02) | E | 🔴 | ⬜ | |
| PWA-03 | Reconexión | Volver online | Reintenta / refresca datos (staleTime 0) | B | 🟡 | ⬜ | |
| PWA-04 | POS en mobile | Operar en celular | Layout usable; selector de sucursal con tap; botones no se salen (ActionMenu) | H | 🟡 | ⬜ | |
| PWA-05 | Update de bundle (SW) | Deploy nuevo con pestaña abierta | Recupera el chunk nuevo (`vite:preloadError` + ErrorBoundary); sin "reading 'default'" | E | 🔴 | ⬜ | |

---

## 27. Notificaciones (campana)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| NOT-01 | Badge sidebar == página de Alertas | Comparar el "N" del badge con la lista | Coinciden (mode-aware; ver ALR-03) | E | 🔴 | ⬜ | |
| NOT-02 | Notificación de evento | Margen negativo / muchas devoluciones / stock bajo | Llega notificación a los roles de ventas | B | 🟡 | ⬜ | |
| NOT-03 | Marcar leída / limpiar | Abrir campana → marcar | Baja el contador; persiste | B | 🟢 | ⬜ | |
| NOT-04 | Aislamiento de notificaciones | Notif de otro usuario | Cada usuario ve solo las suyas (`notif_user` por `auth.uid()`) | E | 🔴 | ⬜ | |

---

## 28. Listas, export, integraciones-edge y teclado

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| LIST-01 | Listas grandes | Tenant con cientos de productos/ventas | Lista paginada/scrolleable sin colgarse | B | 🟡 | ⬜ | |
| LIST-02 | Filtros y búsqueda | Filtrar por estado/fecha/sucursal | Resultados correctos; filtros por sucursal aplican | H | 🟡 | ⬜ | |
| LIST-03 | Export Excel/PDF/CSV | Exportar un listado | Genera el archivo con los datos filtrados | H | 🟡 | ⬜ | |
| CLI-17 | Importar clientes (lote) | Importar archivo de clientes | Crea en lote; reporta filas inválidas/duplicadas | B | 🟡 | ⬜ | |
| INT-08 | Webhook de venta externa duplicado | Mismo evento MP/TN/MeLi 2 veces | **Idempotente**: no duplica venta ni doble descuento de stock (`webhook_external_id`) | E | 🔴 | ⬜ | |
| INT-09 | Conflicto de stock multicanal | Vendido en POS y marketplace casi a la vez | El stock no queda negativo; el segundo falla/avisa | E | 🔴 | ⬜ | |
| KBD-01 | Atajos de teclado POS | Enter cobra · ESC cierra modal visible (stack) | Enter dispara el cobro; ESC cierra el modal de arriba, de a uno | B | 🟡 | ⬜ | |
| KBD-02 | Doble-Enter / Enter + click en cobrar | Enter rápido x2 | No duplica la venta (`savingRef`, ver VEN-22) | E | 🔴 | ⬜ | |

---

*Fuentes: `auditoria-basico.plan.md`, wiki (multi-sucursal, facturacion-afip, caja, devoluciones,
ventas-pos, modo-basico-avanzado), y memorias `reference_basico_stock_null_ubicacion_estado`,
`reference_cobranza_efectivo_exige_caja`, `reference_alertas_badge_mode_aware`, `reference_rls_por_sucursal`.*

---

# 📋 RESULTADOS DE LA AUDITORÍA — Pase 1 (2026-06-16, capa código)

> Trazado del código real de los flujos 🔴 (plata/stock/fiscal) + negativos clave. Las capas
> B (SQL/runtime) y C (click-through manual) quedan para complementar. Evidencia = `archivo:línea`.

## 🐞 Hallazgos (a reparar / confirmar)

| ID UAT | Sev | Hallazgo | Evidencia | Fix sugerido |
|---|---|---|---|---|
| **DEV-07** | 🔴 | **Re-devolución sin tope.** El cap de cantidad a devolver es la cantidad **vendida** (`cantidad_original`), no `vendida − ya_devuelto`. En devoluciones parciales se puede reabrir y devolver de nuevo hasta el total vendido → **reingresa más stock del vendido y reembolsa de más** (vender 3 → devolver 3 → devolver 3 = 6 reingresadas). | `VentasPage.tsx:5835` (cap `Math.min(cantidad_original,…)`) + `:3053` (`cantidad_original = item.cantidad`); el "marcar devuelta" (`:3415`) no bloquea re-devoluciones | Calcular `ya_devuelto` por línea (sumar `devolucion_items` previos) y capar `cantidad_devolver ≤ vendido − ya_devuelto`; bloquear si la venta ya está `devuelta` |
| **GAS-01/05** | 🔴 | **Gasto en efectivo: egreso fire-and-forget + skip silencioso.** El asiento de caja es `.then()` (no `await`, error solo a consola) y si no hay caja abierta se saltea **sin avisar**. Mismo patrón del bug #26 (efectivo que no se asienta en silencio), arreglado en venta/devolución/cobranza pero **no en Gastos**. | `GastosPage.tsx:1216-1230` (alta principal) · `:1527-1537` (gasto fijo) · `:817-819` (pago OC, avanzado) | `await` el insert + `toast` si falla; manejar "sin caja" como cobranza CC (avisar/bloquear). Unificar el patrón v1.74.0 |
| **DEV-04** | ⚠️🔴 | **Devolver venta fiada (CC) no revierte la deuda.** `procesarDevolucion` reingresa stock + (si efectivo) egreso, pero **no reduce `cliente_cc` ni genera crédito a favor**. Una venta a CC no pagada, devuelta, deja la deuda intacta. | `VentasPage.tsx:3149-3473` (sin movimiento de CC / crédito en la devolución) | Confirmar flujo con GO: ¿devolver a CC reduce la deuda / genera nota de crédito a la CC? Implementar el reverso |
| **VEN-22 / NEG-01** | ⚠️ | **Doble-submit sin guard síncrono.** El botón Cobrar es `disabled={saving}` pero no hay `savingRef`; `setSaving(true)` ocurre tarde (tras awaits condicionales de CC). Un doble-click muy rápido o Enter+click depende del timing del re-render → posible venta duplicada. | `VentasPage.tsx:2465` (setSaving tardío) · `:5127` (`disabled={saving}`) · `:3137` (Enter handler) | `if (savingRef.current) return; savingRef.current = true` al inicio de `registrarVenta` (y reset en `finally`) |
| **USR / §20** | ⚠️ | **CONTADOR no ve Facturación** pese a que el rol se describe como "lectura + reportes + **facturación**". El item es `ownerOnly` sin `contadorVisible` → excluido. | `AppLayout.tsx:41` (`facturacion` ownerOnly, sin contadorVisible) + `navVisibility.ts:86` | Confirmar con GO: si CONTADOR debe facturar, agregar `contadorVisible: true` a Facturación |
| **ALR-03** | 🟢 | **Edge multi-sucursal básico:** el badge (`useAlertas`) cuenta "sin categoría" tenant-wide y la página la scopea por sucursal → en básico con >1 sucursal podrían diferir. En básico típico (1 sucursal) coinciden (fix v1.74.1 OK). | `useAlertas.ts:45` vs `AlertasPage.tsx:124-129` | Unificar scoping si se soporta básico multi-sucursal |

## ✅ Confirmado correcto (capa código)

| Área | IDs verificados | Nota |
|---|---|---|
| Ventas core | VEN-01/03/09/13/14/15/16/19 | stock mode-aware (`soloUbicado` + `vendibleIds=modoAvanzado?[]`); `numero` por trigger; caja obligatoria con fallback a única; cantidad/carrito validados |
| Venta → caja (ingreso/seña) | VEN-01/05/10/11, SEAM-01/10 | ingreso despacho + seña **awaited + toast si falla** (v1.74.0); no-efectivo → `ingreso_informativo` |
| Envío en POS | VEN-21 | `$/km` editable; auto-crea envío pendiente; costo saldado según despacho/propio |
| Anular venta | VEN-24, SEAM-06 | **restaura stock** mode-aware + consolida en básico + cancela envíos pendientes + seña con penalidad/crédito |
| Devoluciones | DEV-01/03/05/08/09 | reingreso básico directo (sin ubicación/estado); **egreso awaited + toast (bug #26)**; consolida línea; notas+sucursal correctas |
| Cobranza CC | CLI-04/05, SEAM-03 | efectivo **exige caja antes de saldar** (`requiereCaja`); resuelve sesión propia→única; FIFO |
| Facturación AFIP | FAC-01/02/03/04/05/10/12/13, CFG-07 | Factura C sin IVA; ImpTotal=Neto+IVA; Exento→C; A sin CUIT bloqueada; B≥umbral sin DNI bloqueada en POS; **NC con `cae`+`CbtesAsoc`**; NC sin factura bloqueada; **anular/cambiar-cliente ocultos con CAE**; toggle exige cuit+condición |
| Stock mode-aware | PRD-02, INV-04/07 | ProductosPage "0 disponible" fixed; MasivoModal rebaje fixed; rebaje no deja negativo |
| Productos baja | PRD-07/08/09 | soft-delete (desactivar), sin hard-delete → sin riesgo de FK |
| RLS por sucursal | SUC-03/04, NEG-11/12 | validado en vivo (sesión RLS v1.75.0): restringido solo ve su sucursal; DUEÑO ve todo |

## 🔍 Cobertura pendiente (otras capas — no es FAIL, es "falta verificar")

| Área | Cómo verificar |
|---|---|
| Caja apertura/arqueo/cierre (CAJ-01/06/07/08) | Cubierto por 57 unit tests (`cajaArqueo`/`cajaPermisos`); recomendado click-through C |
| Auth/Onboarding §1, Suscripción §16, Config §2, Dashboard/Reportes §13 | Click-through manual (riesgo medio/bajo) |
| Integraciones §17 (TN/MeLi/MP) | Requiere cuentas reales B2B; fuera de la capa código |
| NEG-02 (atomicidad ante caída), NEG-03 (concurrencia real), NEG-07 (XSS) | Pruebas runtime / e2e dedicadas |
| CAJ-02 (2da caja) | Multi-caja permitido por diseño; abrir la MISMA caja 2 veces sí se bloquea (`CajaPage.tsx:434`) |

## Resumen del pase 1
- **6 hallazgos**: 2 🔴 a reparar (DEV-07 over-return, GAS-01/05 efectivo silencioso), 1 ⚠️🔴 a confirmar (DEV-04 CC), 2 ⚠️ (VEN-22 doble-submit, CONTADOR-facturación), 1 🟢 edge.
- **Lo que se rompió antes (devolución/NC) está hoy correcto** — los fixes v1.70-v1.74 están presentes y verificados.

## ✅ Fixes aplicados (v1.76.0 — tras el pase 1)

| Hallazgo | Fix aplicado | Archivos |
|---|---|---|
| **DEV-07** | Cap de cantidad a devolver = `vendido − ya_devuelto` (UI) + **guard server-side** que re-chequea contra devoluciones previas + "nada para devolver" si está completa | `VentasPage.tsx` (`abrir`, `procesarDevolucion`) |
| **DEV-04** | Si el cliente **tiene deuda** → la devolución la **reduce FIFO** (sin efectivo); excedente por medio elegido. **Sin deuda** → efectivo/otro/**crédito a favor**. Banner en el modal + opción "Crédito a favor" + guards | `VentasPage.tsx` (estado `devDeudaCliente`, `abrir`, `procesarDevolucion`, modal) |
| **GAS-01/05** | Egreso de efectivo **awaited + toast si falla** + **aviso si no hay caja** (alta y gasto fijo); fin del fire-and-forget silencioso | `GastosPage.tsx` |
| **VEN-22** | `savingRef` síncrono anti doble-submit en `registrarVenta` | `VentasPage.tsx` |
| **CONTADOR/Facturación** | `contadorVisible: true` en el item Facturación → el CONTADOR ve y opera Facturación | `AppLayout.tsx` |

Nuevos escenarios agregados al UAT: **DEV-11..16** (devolución vs deuda/crédito), **GAS-08/09** (egreso efectivo robusto), **USR-09** (CONTADOR facturación). typecheck verde.

- Próximo: completar capas B/C (click-through manual + e2e) de las áreas pendientes y deployar v1.76.0.

---

# 📋 RESULTADOS DE LA AUDITORÍA — Pase 2 (lote ampliado §22-24 + extensiones)

## 🐞 Hallazgos

| ID UAT | Sev | Hallazgo | Evidencia | Fix sugerido |
|---|---|---|---|---|
| **PRES-08 / VEN-14** | 🔴 | **Convertir presupuesto/reserva → despachada (o reservada) NO valida stock suficiente.** `cambiarEstado` es mode-aware (`vendibleIdsCambio`, `soloUbicado`) pero, a diferencia del POS directo (`registrarVenta` lanza `if (stockDisp < cant)` y `if (restante > 0)`), los loops de consumo rebajan/reservan **lo que haya y siguen sin error**. Si el stock bajó desde el presupuesto, despacha con **rebaje parcial** y el `movimientos_stock` registra `cantidad: item.cantidad` (sobre-estima). | `VentasPage.tsx` `cambiarEstado`: rama `reservada` (loops `reservarEn` sin throw) y rama `despachada` (loops `consumir` sin throw, ~`restante` queda >0) | Agregar en ambas ramas: pre-check `stockDisp < cant → throw` + post-check `if (restante > 0.0001) throw` (espejo de `registrarVenta`) |
| **CAJ-18** | ⚠️ | **Egreso manual sin guard de saldo.** No se ve validación de que el egreso no supere el efectivo en caja → posible caja en negativo. Puede ser intencional (reflejar faltantes), pero conviene avisar. | `CajaPage.tsx` (no hay chequeo de saldo en el egreso) | Confirmar con GO: ¿avisar/bloquear egreso > saldo, o permitir negativo con aviso? |

## ✅ Confirmado correcto (capa código) — lote nuevo

| Área | IDs | Nota |
|---|---|---|
| Presupuestos | PRES-01, PRES-04, PRES-05 | `pendiente` no toca stock/caja; convert asienta caja **awaited+toast**; `isPresupuestoVencido` existe |
| Recurrentes | REC-03 | `generarDesdeRecurrente` crea `estado:'pendiente'` (no stock/caja) + avanza `proximo_at` |
| Ventas (reglas) | VEN-28, VEN-31, VEN-32, VEN-33, VEN-34 | seña mínima %; morosidad (`evaluarMorosidad`); límite CC (`evaluarLimiteCC`); crédito a favor; override descuento con clave maestra |
| Caja (gobernanza) | CAJ-13, CAJ-14, CAJ-19 (B2) | CAJERO no ve caja ajena (`cajaAjenaBloqueada`); clave maestra al cerrar caja ajena (B5); 1 sesión por CAJERO (B2); informativo no afecta arqueo |
| Clientes CC | CLI-13, CLI-14 | redimir crédito a favor; cobranza FIFO parcial |
| Negativos | NEG-23, NEG-24 | período contable cerrado (`isPeriodoCerrado`); conteo wall-to-wall bloqueante (A2) |

## 🔍 Cobertura pendiente (capa C / runtime) — lote nuevo
PRES-03/06/07/09 (PDF/edición/anular), COMP-01..09 (impresión/PDF/email — runtime), REC-02/04/05 (panel UI), CFG-12..18 (UI de config), CLI-12/15/16, NEG-18..22/25 (i18n, locale, overflow, concurrencia real, timezone).

## Resumen pase 2
- **1 hallazgo 🔴** (PRES-08: convert sin re-chequeo de stock — mismo riesgo que el POS pero en el camino de conversión) + **1 ⚠️** (CAJ-18 saldo en egreso).
- El resto del lote nuevo auditable por código quedó **verde**.

## ✅ Fixes aplicados (pase 2)

| Hallazgo | Fix aplicado | Archivos |
|---|---|---|
| **PRES-08** | `cambiarEstado` ahora **re-valida stock** al convertir presupuesto/reserva → reservada/despachada: pre-check (disponible estado-aware: reserva ya retuvo sus unidades) + post-check `restante > 0` → **lanza error** en vez de rebajar/reservar parcial silencioso | `VentasPage.tsx` (`cambiarEstado`, +`nombre` al select de items) |
| **CAJ-18** | **No se permite caja en negativo**: el egreso de efectivo (gasto + devolución) se **bloquea si supera el saldo** de la sesión. Helper puro `calcularSaldoEfectivo` + `saldoEfectivoSesion` (lib `cajaSaldo.ts`, 7 unit tests) | `GastosPage.tsx`, `VentasPage.tsx`, `lib/cajaSaldo.ts` |

Nuevos escenarios: **PRES-10** (convertir con stock OK), **CAJ-20** (gasto efectivo > saldo bloqueado), **DEV-17** (devolución efectivo > saldo bloqueada). typecheck + **746 unit** + build verdes.
