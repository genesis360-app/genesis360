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
| PRD-02 | **Stock disponible en la lista** (BUG histórico #2) | Producto con stock | Muestra cantidad real, **NO "0 disponible"** (no filtra `estado_id` en básico) | H | 🔴 | ✅ | *Auditado 2026-06-19: en básico `evIds=[]` → no aplica `.in('estado_id')` (ProductosPage.tsx:531-542)* |
| PRD-03 | Producto sin categoría | Alta sin categoría | Se crea; **dispara alerta "sin categoría"** (ver ALR-03) | B | 🟡 | ⬜ | |
| PRD-04 | Precio de venta / costo / margen | Editar precios | Calcula margen; costo visible solo a roles autorizados (G4) | H | 🟡 | ⬜ | |
| PRD-05 | `es_kit` + mayoristas gateados | Ver opciones en básico | Kit y precios mayoristas **ocultos** en básico (avanzado) | B | 🟢 | ⬜ | |
| PRD-06 | Editar producto | Cambiar nombre/precio | Persiste; no asume ubicación/estado | H | 🟡 | ⬜ | |
| PRD-07 | Baja lógica (activo=false) | Desactivar producto | Deja de aparecer en POS; histórico se conserva | B | 🟡 | ✅ | *Auditado 2026-06-19: bulk `activo:false` (ProductosPage.tsx:701-703); "no aparecen en ventas ni en el listado"* |
| PRD-08 | Eliminar producto **con stock** | Intentar borrar con stock>0 | Bloquea o advierte (no deja inventario huérfano) | E | 🔴 | ✅ | *Auditado 2026-06-19: por diseño NO hay hard-delete de productos en la UI (solo baja lógica) → no quedan líneas huérfanas* |
| PRD-09 | Eliminar producto **con ventas** | Borrar producto vendido | Bloquea (FK) o desactiva; no rompe histórico de ventas | E | 🔴 | ✅ | *Auditado 2026-06-19: solo baja lógica (no hard-delete) → el histórico de ventas nunca se rompe* |
| PRD-10 | SKU duplicado | Alta con SKU repetido | Rechaza con mensaje claro | E | 🟡 | ✅ | *Auditado 2026-06-19: check debounced `skuTaken` bloquea submit (ProductoFormPage.tsx:304-353) + 23505 DB "Ya existe un producto con ese SKU" (:437)* |
| PRD-11 | Precio negativo / 0 | Cargar precio <0 | Valida; rechaza negativo (0 puede ser válido para regalo) | E | 🟡 | ✅ | *Implementado 2026-06-19: `Math.max(0, parseFloat()\|\|0)` en precio_costo y precio_venta, alta y edición de variantes (ProductoFormPage.tsx). Un negativo tipeado a mano se clampa a 0* |
| PRD-12 | Importar productos (Excel/CSV) | Importar archivo | Crea en lote; reporta filas inválidas/duplicadas sin abortar todo | B | 🟡 | ⬜ | |
| PRD-13 | Buscar por nombre/SKU/código de barras | Búsqueda en lista/POS | Encuentra; escaneo de barcode resuelve | H | 🟡 | ⬜ | |
| PRD-14 | Stock mínimo por producto | Setear mínimo | Al caer bajo mínimo → alerta de stock bajo | B | 🟡 | ⬜ | |
| PRD-15 | **Alícuota IVA 10,5% se guarda Y se muestra al reabrir** (BUG sesión 2026-06-18) | Editar producto → Alícuota IVA = 10,5% → Guardar → reabrir | Persiste `10.50` en DB; al reabrir el `<select>` muestra **10,5% seleccionado** (no en blanco). El numeric `"10.50"` se normaliza a `"10.5"` para matchear la opción | B | 🔴 | ⬜ | |
| PRD-16 | **Producto Exento (0%) NO se guarda como 21%** (BUG sesión 2026-06-18) | Alícuota IVA = Exento (0%) → Guardar | Persiste `0` (no 21). Antes `parseFloat||21` convertía `0→21` (IVA fantasma) | E | 🔴 | ⬜ | |
| PRD-17 | Alícuotas 21% / 27% se guardan y muestran bien | Setear 21% y 27%, reabrir | `21.00`/`27.00` en DB; select muestra la opción correcta (normalización `String(parseFloat())`) | B | 🟡 | ⬜ | |

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
| VEN-21 | **Envío en básico = solo costo** (v1.78.0; módulo Envíos oculto) | Agregar envío a la venta en básico | Solo un **campo de costo** (`ventas.costo_envio`); **se ocultan** transporte/courier/km/dirección; **NO crea registro en `envios`** (gateado por `modoAvanzado`). En avanzado: km×$/km + transporte sin cambios | H | 🔴 | ⬜ | |
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
| VEN-35 | **Costo de envío del POS visible en ticket Y factura** (v1.78.0) | Vender con costo de envío → ver ticket → emitir factura | El costo aparece en el ticket **y** entra a la factura como ítem (ver FAC-23). `ventas.total` NO incluye el envío (va aparte en `costo_envio`); `monto_pagado` = total + envío (no se duplica) | H | 🔴 | ⬜ | |
| VEN-36 | **Selector de caja en la venta: excluye Caja Fuerte + autopreselecciona** (v1.78.3) | Vender con 1 sola caja operativa abierta | El selector NO lista la Caja Fuerte (solo cajas operativas); con 1 caja, se usa esa sola sin pedir selección (antes la sesión permanente de la bóveda inflaba el conteo y obligaba a elegir) | H | 🔴 | ✅ | *Auditado por código 2026-06-19: `.filter(s => !s.cajas?.es_caja_fuerte)` (VentasPage.tsx:577) + autopreselect de única (`sesionesAbiertas.length===1` :627)* |

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
| CAJ-22 | **Caja Fuerte: 2 tarjetas** (v1.78.2) | Ver header de la bóveda (rol con acceso) | "En la caja fuerte" (`fuerteSaldo`, sube al depositar) + "Capital total del negocio" (`capitalTotal`). Degradé violeta→cian | H | 🟡 | ✅ | *Auditado por código 2026-06-19: CajaPage.tsx:1984-1994, gateadas por `puedeExtraerBoveda`* |
| CAJ-23 | **Capital cuenta el efectivo de ventas/gastos** (v1.78.2, mig 226) | Vender/gastar en efectivo → ver Capital por cuenta | El efectivo sin `cuenta_origen_id` (ventas/gastos) se atribuye a la cuenta Efectivo. **Las aperturas (`monto_apertura`) NO se cuentan — DECISIÓN DE DISEÑO (no bug), ver CAJ-28** | B | 🔴 | ✅ | *Auditado 2026-06-19: vista mig 226 atribuye los movimientos no-informativos sin cuenta a Efectivo (`COALESCE`); el gap de aperturas se resolvió como Opción A (ver CAJ-28)* |
| CAJ-24 | **Ingreso a Caja Fuerte: selector de cuenta destino** (v1.78.2) | Ingresar a la bóveda | Selector de cuenta de origen (default Efectivo) → permite ingresar a otra cuenta; antes era siempre Efectivo | H | 🟡 | ✅ | *Auditado por código 2026-06-19: CajaPage.tsx:2195-2202 (`depositoCuentaId`, default Efectivo)* |
| CAJ-25 | **Básico: caja-origen del depósito bloqueada** (v1.78.2) | Depositar a bóveda en modo básico | El selector de Caja de origen queda fijado a la caja activa (no se elige) | B | 🟡 | ✅ | *Auditado por código 2026-06-19: `disabled={!modoAvanzado}` (CajaPage.tsx:2179)* |
| CAJ-26 | **Arqueo repetible** (v1.78.4) | Hacer un 2º arqueo parcial en la misma sesión | Se permite (sin constraint ni guard); el botón dice "Arqueo" + tooltip "podés hacer varios por sesión" | H | 🟡 | ✅ | *Auditado por código 2026-06-19: `realizarArqueo` (CajaPage.tsx:1148) solo inserta, sin guard; botón "Arqueo"+tooltip :1737* |
| CAJ-27 | **Efectivo por default en alta de tenant** (v1.78.2, mig 225) | Crear un tenant nuevo | Nace con la Cuenta de Origen Efectivo (tipo efectivo, en su moneda) + 5 métodos default con Efectivo vinculado | H | 🔴 | ✅ | *Verificado en DEV 2026-06-19: 9/9 tenants con cuenta Efectivo, 0 métodos Efectivo sin link* |
| CAJ-28 | **Capital inicial vía "Ingreso externo" + las aperturas NO se cuentan** (decisión 2026-06-19) | Ver tooltip de la tarjeta Capital; ingresar capital inicial real | Las aperturas (`monto_apertura`) NO se suman al capital (evita doble conteo del arrastre, que ya viene de ventas registradas). El capital inicial real (plata propia/aporte de socio nunca asentada) se registra **una vez** como "Ingreso externo (sin caja)" a la bóveda → entra al capital. El tooltip ℹ️ de la tarjeta lo explica | B | 🟡 | ✅ | *Implementado 2026-06-19: tooltip CajaPage.tsx:1989 + nota del modal :2216. Vista sin cambios (Opción A elegida por GO). Ver [[reference_caja_fuerte_capital_efectivo]]* |
| CAJ-29 | **Capital total con cuentas multi-moneda suma SIN convertir** (HALLAZGO 2026-06-19) | Tenant con cuentas en ARS **y** USD → ver "Capital total del negocio" | ⚠️ Hoy `capitalTotal` suma los saldos de todas las cuentas activas sin mirar `moneda` (CajaPage.tsx:223) → mezcla ARS+USD en un solo número. **Real en DEV: Almacén Jorgito (ARS+USD).** Pendiente decisión de diseño (sumar solo moneda principal / mostrar por moneda / convertir con cotización) | B | 🔴 | ❌ | *Hallazgo capa código 2026-06-19. No es regresión (preexistía); afecta solo tenants multi-moneda. Ver Hallazgos* |

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
| GAS-10 | **Fiscal — Monotributista/Exento** (v1.79.0) | Tenant Mono/Exento → cargar gasto | El selector de comprobante NO ofrece Factura A (solo B/C/Ticket); el monto es el **total**; NO se muestran IVA crédito ni "Deducir de Ganancias" | H | 🔴 | ✅ | *Auditado por código 2026-06-19: `comprobantesGasto` excluye Factura A si `!esRI` (GastosPage.tsx:167); IVA gateado por `esRI && tipo_comprobante==='Factura A'` :1643; Ganancias por `esRI &&` :1680; nota explicativa :1635* |
| GAS-11 | **Fiscal — RI + Factura A** (v1.79.0) | Tenant RI → comprobante Factura A | Muestra **Alícuota de IVA** (default **21%**, 10.5/27/custom) + Neto + **IVA crédito** calculado automático; se persiste `iva_monto` | H | 🔴 | ✅ | *Auditado 2026-06-19: default 21% al elegir Factura A (:1625); preview Neto/IVA crédito :1664; persiste `iva_monto` vía `calcularIVA` :1117. `tipo_iva` es clave de texto (no sufre el bug numeric→string de AFIP)* |
| GAS-12 | **Fiscal — RI + Factura B/C/Ticket** (v1.79.0) | Tenant RI → comprobante B/C/Ticket | Input = monto total; **`iva_monto`=0** (no discrimina crédito). "Deducir de Ganancias" disponible | H | 🔴 | ⚠️ | *Auditado 2026-06-19: al elegir ≠Factura A se limpia `tipo_iva`/`iva_deducible` (:1626) → IVA crédito oculto. "Deducir de Ganancias" se muestra para RI siempre, PERO default **OFF** (FORM_VACIO:129), no ON como decía la nota v1.79.0. Ver GAS-17* |
| GAS-13 | **Guard server-side de IVA crédito** (v1.79.0, mig 227) | Forzar `iva_monto` sin RI+Factura A (bundle viejo / insert directo) | El trigger `fn_gastos_iva_guard` **sanea** `iva_monto`/`iva_deducible` a 0/NULL salvo RI+Factura A, y `deduce_ganancias` salvo RI. Verificado en DB: RI+A permite, RI+B sanea | E | 🔴 | ✅ | *Auditado 2026-06-19: trigger BEFORE INSERT OR UPDATE, SECURITY DEFINER, default Mono (mig 227:36-52)* |
| GAS-14 | Condición no seteada → Monotributista | Tenant sin `condicion_iva_emisor` | Default conservador: se comporta como Monotributista (sin IVA crédito ni Ganancias) | B | 🟡 | ✅ | *Auditado 2026-06-19: UI `condicion_iva_emisor || 'Monotributista'` (:164) + trigger `COALESCE(NULLIF(...,''),'Monotributista')`* |
| GAS-15 | Gasto fijo también respeta la condición | Crear gasto fijo (RI/Mono) | La sección fiscal (`renderFiscal` compartido) aplica igual; al materializarse en `gastos` el guard re-sanea | B | 🟡 | ✅ | *Auditado 2026-06-19: `renderFiscal` usado en ambos forms (:2407, :2752); "Generar gasto desde fijo" copia `tipo_comprobante`+IVA (:1539) e inserta en `gastos` → trigger sanea. Materialización es user-triggered (no cron)* |
| GAS-16 | **Cambiar la condición del tenant con gastos ya cargados** (borde, 2026-06-19) | Tenant RI con gastos Factura A (con `iva_monto`) → cambiar a Monotributista | Los gastos **viejos conservan** su `iva_monto`/`deduce_ganancias`. **RESUELTO: by design — NO se hace re-saneo masivo.** Un re-saneo retroactivo borraría el IVA crédito **legítimo** de gastos cargados cuando el tenant SÍ era RI (con Factura A válida) → falsearía el historial fiscal. El comportamiento correcto es conservar lo histórico y aplicar la condición nueva solo a lo que se cree/edite a partir del cambio (que es lo que ya hace el trigger) | B | 🟡 | ✅ | *Resuelto by-design 2026-06-19: integridad del registro fiscal histórico. Si un gasto puntual quedó mal, se corrige editándolo (el guard lo re-sanea)* |
| GAS-17 | **Default de "Deducir de Ganancias" según condición** (2026-06-19) | Tenant RI → gasto nuevo; tenant no-RI → gasto nuevo | RI → checkbox arranca **ON**; cualquier otra condición → **OFF**. `abrirNuevo`/`abrirNuevoFijo` setean `deduce_ganancias: esRI` | B | 🟡 | ✅ | *Implementado 2026-06-19: GastosPage.tsx:920/980 (`{ ...FORM_VACIO, deduce_ganancias: esRI }`)* |

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
| FAC-01 | **Emitir Factura C** (monotributo) desde venta | Vender → Emitir factura | CAE real homologación; **C sin IVA** (`ImpNeto=ImpTotal`, `ImpIVA=0`); venta queda `facturada` | H | 🔴 | ✅ | *Auditado 2026-06-19: `sinIVA` para C/NC-C → todo a neto, sin array Iva (index.ts:184,193-196). CAE real verificado vía e2e 21* |
| FAC-02 | `ImpTotal = ImpNeto + ImpIVA` | Emitir | Evita error AFIP 10048 | H | 🔴 | ✅ | *Auditado 2026-06-19: `impTotal = totalNeto + totalIVA` (index.ts:225)* |
| FAC-03 | Auto-detección A/B/C contempla **Exento** | Emisor Exento | Emite **C** (no A/B) | B | 🔴 | ✅ | *Auditado 2026-06-19: guard `emisorSoloC` incluye Exento (index.ts:81); `detectarTipoComprobante` en facturacionLogic* |
| FAC-04 | **Factura A sin CUIT** | Cliente CF, elegir A | Botón A **deshabilitado** + aviso; degrada a B | E | 🔴 | ✅ | *Auditado 2026-06-19: UI deshabilita (VentasPage:7051) + EF lanza "Para Factura A se requiere CUIT" (index.ts:176)* |
| FAC-05 | **Factura B ≥ umbral a Consumidor Final sin DNI/CUIT** | Total ≥ ~$68.305 sin ID | **Bloquea** emisión (RG AFIP) + aviso | E | 🔴 | ⬜ | |
| FAC-06 | Descargar / Imprimir / Email factura | Acciones post-emisión | PDF correcto; imprimir vía iframe (sin popup-blocker); email autocompleta `clientes.email` | H | 🔴 | ⬜ | |
| FAC-07 | PDF de factura completo | Ver PDF | Logo, IIBB, Inicio Act, N° con letra, domicilio receptor, Cód. SKU, "Comprobante Autorizado", QR, Ley 27.743 (en B), datos bancarios/leyenda | H | 🟡 | ⬜ | |
| FAC-08 | Emitir factura desde el detalle (si se saltó el prompt) | Detalle de venta → Emitir | Botón disponible si no facturada | B | 🟡 | ⬜ | |
| FAC-09 | QR de pago MercadoPago en factura con saldo | Factura con saldo + MP conectado | QR "Pagá con MercadoPago" (`external_reference=venta_id`); graceful si no hay MP | B | 🟡 | ⬜ | |
| FAC-10 | **Emitir Nota de Crédito electrónica** (vía Devolver) | Devolver venta facturada → Emitir NC | CAE NC; **letra derivada de la factura original y fija** (C→NC-C); `CbtesAsoc` a la original; badge `NC-C #N` | H | 🔴 | ✅ | *Auditado 2026-06-19: `CbtesAsoc` referencia la factura original (index.ts:304, evita AFIP 10197); `sinIVA` cubre NC-C* |
| FAC-11 | NC: Descargar/Imprimir/Email | Acciones del badge NC | PDF "NOTA DE CRÉDITO" (COD/QR con código AFIP de NC); email | H | 🔴 | ⬜ | |
| FAC-12 | Emitir NC sin factura previa (sin CAE) | Intentar NC de venta no facturada | Bloquea: "no se puede emitir NC sin CAE original" | E | 🔴 | ⬜ | |
| FAC-13 | **Anular venta CON CAE** | Intentar Anular factura emitida | **Bloqueado**: oculta "Anular" + "Cambiar cliente"; solo "Devolver→NC" | E | 🔴 | ⬜ | |
| FAC-14 | Error de AFIP al emitir | Forzar rechazo (dato inválido) | Muestra **error real** (`error.context.json`), no genérico "non-2xx" | E | 🟡 | ⬜ | |
| FAC-15 | CbteFch date-only | Emitir | Factura sin hora (solo fecha) | 🟢 | 🟢 | ⬜ | |
| FAC-16 | Módulo Facturación oculto si no habilitada | Tenant sin facturación | No aparece en nav | B | 🟡 | ⬜ | |
| FAC-17 | Libros IVA / reporte de comprobantes | Ver libros | Lista emitidos con totales | 🟡 | 🟡 | ⬜ | |
| FAC-18 | Chunk viejo tras deploy (SW) | Bundle viejo cacheado | `vite:preloadError` + ErrorBoundary recupera (no "reading 'default'") | E | 🟡 | ⬜ | |
| FAC-19 | Reimprimir factura ya emitida (idempotente) | Re-descargar | Regenera PDF desde snapshot; no re-emite CAE | B | 🔴 | ⬜ | |
| FAC-20 | **Restricción de tipos por emisor en el POS** (v1.78.0) | Emisor Monotributista → abrir modal de factura en Ventas | Ofrece **solo Factura C** (`tiposComprobantePermitidos`→`['C']`); A y B **no se renderizan**; default = C | H | 🔴 | ⬜ | |
| FAC-21 | Restricción de tipos por emisor en Facturación | Emisor Monotributista → modal Emitir en Facturación | El `<select>` lista **solo C**; emisor RI → solo A/B (nunca C) | H | 🔴 | ⬜ | |
| FAC-22 | **Guard server-side en la EF `emitir-factura`** (sesión 2026-06-18) | Forzar `tipo='B'` con emisor Monotributista (bundle viejo / API directa) | EF responde **400** "Un emisor Monotributista solo puede emitir tipo C"; RI forzando C → 400. Ya no depende solo de ocultar el botón en la UI | E | 🔴 | ✅ | *Auditado 2026-06-19: guard en index.ts:80-91 (Mono/Exento→solo C, RI→nunca C); usa `letra` que ignora prefijo NC-/ND-* |
| FAC-23 | **Costo de envío entra a la factura** (v1.78.0) | Venta con `costo_envio>0` → emitir factura | Ítem **"Costo de Envío"** + suma al `ImpTotal`; **Concepto=3** + `FchServDesde/Hasta/VtoPago`; alícuota del flete = predominante de los productos (en A sigue al producto, en C va a neto); PDF con línea + total. `ImpTotal = venta.total + costo_envio` (no duplica) | H | 🔴 | ✅ | *Auditado 2026-06-19: index.ts:144-161 (predominante por subtotal), :170 (total+envío), :284 (Concepto=3)* |
| FAC-24 | Courier pagado directo por el cliente | Venta con `costo_envio=0` (courier cobra al cliente) | **No** entra a la factura (correcto); sin ítem de envío | B | 🔴 | ✅ | *Auditado 2026-06-19: `envioFacturado = !esNC && costoEnvio > 0` (index.ts:145)* |
| FAC-25 | **Alícuota 10,5% en Factura A/B → Id AFIP 4** (BUG GRAVE sesión 2026-06-18) | Emisor RI → producto a 10,5% → emitir A o B | Array `Iva` con **`Id:4`** (10,5%) y `Importe` a la tasa real. Antes el numeric `"10.50"` no matcheaba `ALICUOTA_ID` → caía a `Id:5` (21%) → **AFIP rechazaba (error 10051)** o clasificaba mal | E | 🔴 | ✅ | *Auditado 2026-06-19: `ALICUOTA_ID['10.5']=4` (:19) + `String(parseFloat("10.50"))="10.5"` (:205)* |
| FAC-26 | Alícuotas 0%/Exento y 27% en A/B → Id correcto | Emisor RI → producto 0%/exento y otro 27% → emitir A/B | `"0.00"/exento`→**`Id:3`**, `"27.00"`→**`Id:6`** (no 21%). El ítem de envío toma la alícuota predominante de los productos | E | 🔴 | ✅ | *Auditado 2026-06-19: `'0':3,'27':6,'exento':3` (:18-22); exento usa `tasaStr` directo (parseFloat daría NaN)* |
| FAC-27 | **Factura B ≥ umbral sin DNI/CUIT — guard server-side** (HALLAZGO→FIX 2026-06-19) | Forzar emisión de B ≥ umbral a CF sin ident (bundle viejo / API directa) | La EF responde **400** "Factura B por $X o más: AFIP exige identificar al cliente con DNI o CUIT" antes de llamar a AFIP. Espeja `requiereIdentFacturaB` del POS (consistente con el guard de tipo FAC-22) | E | 🟡 | ✅ | *Implementado 2026-06-19: index.ts:186-190; EF deployada a DEV (v13). Falta deploy a PROD (OK de GO, cambio fiscal)* |

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
| SCAN-01 | Escanear barcode en POS | Lector/cámara → código EAN | Agrega el producto al carrito (match por `codigo_barras`) | H | 🔴 | ✅ | `procesarScan` match por barcode/SKU; cámara + lector físico (modo manual) |
| SCAN-02 | Código GS1 compuesto | Escanear código con AI (GTIN + cantidad/lote/venc.) | Resuelve el producto por GTIN + aplica cantidad si viene (AI 30) | B | 🟡 | ✅ | `resolverScanCompuesto` (GTIN + `cantidad`) |
| SCAN-03 | Código no encontrado | Escanear un código inexistente | Aviso "producto no encontrado"; no agrega nada | E | 🟡 | ✅ | toast "No se encontró ningún producto con código…" |
| SCAN-04 | Escanear para sumar cantidad | Escanear el mismo producto 2 veces | Suma a la línea existente (no crea 2 líneas) | H | 🟡 | ✅ | suma con tope `maxDisp`; cola anti-dup |
| SCAN-05 | Escanear en alta de stock | Inventario → ingreso por escaneo | Encuentra el producto y precarga | B | 🟢 | ✅ | `handleBarcodeScan` en InventarioPage |
| SCAN-06 | Buscar manual por SKU/nombre | Tipear en el buscador del POS | Filtra y permite agregar; autoFocus en el campo | H | 🟢 | ✅ | match `codigo_barras.eq OR sku.eq` |

---

## 26. PWA / offline / mobile

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| PWA-01 | Instalar como app | "Instalar" desde el navegador | Se instala (manifest + SW); abre standalone | B | 🟢 | ⬜ | |
| PWA-02 | Operar con conexión intermitente | Cortar internet a mitad de venta | Degrada con aviso; no deja venta a medias (ver NEG-02) | E | 🔴 | ⬜ | |
| PWA-03 | Reconexión | Volver online | Reintenta / refresca datos (staleTime 0) | B | 🟡 | ⬜ | |
| PWA-04 | POS en mobile | Operar en celular | Layout usable; selector de sucursal con tap; botones no se salen (ActionMenu) | H | 🟡 | ⬜ | |
| PWA-05 | Update de bundle (SW) | Deploy nuevo con pestaña abierta | Recupera el chunk nuevo (`vite:preloadError` + ErrorBoundary); sin "reading 'default'" | E | 🔴 | ✅ | `main.tsx` handler + red de seguridad + guard anti-bucle; `ErrorBoundary` detecta `reading 'default'` |

---

## 27. Notificaciones (campana)

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| NOT-01 | Badge sidebar == página de Alertas | Comparar el "N" del badge con la lista | Coinciden (mode-aware; ver ALR-03) | E | 🔴 | ✅ | Fix v1.74.1; campana es sistema aparte |
| NOT-02 | Notificación de evento | Margen negativo / muchas devoluciones / stock bajo | Llega notificación a los roles de ventas | B | 🟡 | ⚠️→✅ | **Estaba roto: RLS bloqueaba el INSERT cross-user → nunca llegaba.** Fix mig 219 (pase 3). Falta confirmar end-to-end en runtime |
| NOT-03 | Marcar leída / limpiar | Abrir campana → marcar | Baja el contador; persiste | B | 🟢 | ✅ | `markRead`/`markAllRead` + invalidate |
| NOT-04 | Aislamiento de notificaciones | Notif de otro usuario | Cada usuario ve solo las suyas (`notif_user` por `auth.uid()`) | E | 🔴 | ✅ | Verificado impersonando: cajero ve 0 ajenas (mig 219 mantiene SELECT solo propias) |

---

## 28. Listas, export, integraciones-edge y teclado

| ID | Escenario | Pasos | Resultado esperado | Tipo | Pri | Estado | Resultado real / Nota |
|---|---|---|---|---|---|---|---|
| LIST-01 | Listas grandes | Tenant con cientos de productos/ventas | Lista paginada/scrolleable sin colgarse | B | 🟡 | ⬜ | |
| LIST-02 | Filtros y búsqueda | Filtrar por estado/fecha/sucursal | Resultados correctos; filtros por sucursal aplican | H | 🟡 | ⬜ | |
| LIST-03 | Export Excel/PDF/CSV | Exportar un listado | Genera el archivo con los datos filtrados | H | 🟡 | ⬜ | |
| CLI-17 | Importar clientes (lote) | Importar archivo de clientes | Crea en lote; reporta filas inválidas/duplicadas | B | 🟡 | ⬜ | |
| INT-08 | Webhook de venta externa duplicado | Mismo evento MP/TN/MeLi 2 veces | **Idempotente**: no duplica venta ni doble descuento de stock (`webhook_external_id`) | E | 🔴 | ✅ | Doble guard: `webhook_external_id` + UNIQUE (mig 060) + dedup por `tracking_id` |
| INT-09 | Conflicto de stock multicanal | Vendido en POS y marketplace casi a la vez | El stock no queda negativo; el segundo falla/avisa | E | 🔴 | 🔍 | Carrera real → necesita lock DB; runtime (= NEG-03) |
| KBD-01 | Atajos de teclado POS | Enter cobra · ESC cierra modal visible (stack) | Enter dispara el cobro; ESC cierra el modal de arriba, de a uno | B | 🟡 | ✅ | `useModalKeyboard` (stack ESC) |
| KBD-02 | Doble-Enter / Enter + click en cobrar | Enter rápido x2 | No duplica la venta (`savingRef`, ver VEN-22) | E | 🔴 | ✅ | `savingRef` (fix VEN-22, pase 1) |

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

---

# 📋 RESULTADOS DE LA AUDITORÍA — Pase 3 (§25-28: escaneo · PWA · notificaciones · listas/webhooks/teclado)

> Auditoría por código del batch ampliado que quedó pendiente tras los pases 1-2.

## 🐞 Hallazgos

| ID UAT | Sev | Hallazgo | Evidencia | Fix |
|---|---|---|---|---|
| **NOT-02 / NOT-04** | 🔴 | **La RLS de `notificaciones` bloquea el INSERT cross-user → las notificaciones in-app nunca se crean.** TODAS las notificaciones in-app del código apuntan a OTROS usuarios (cajero → supervisores/dueño): solicitud de Caja Fuerte, diferencia de apertura/cierre de caja, alertas de venta (margen negativo, muchas devoluciones). El estado real de la DB estaba **desincronizado y roto en ambos entornos**: PROD tenía `notif_user FOR ALL USING (user_id = auth.uid())` (sin `WITH CHECK` propio → el INSERT hereda el USING → rechaza `user_id != auth.uid()`); DEV tenía `notif_select`+`notif_update` aplicadas **fuera de banda** (no están en ninguna migración) y **ninguna policy de INSERT** → todo insert client-side rechazado. La de Caja Fuerte además hace `if (error) throw error` → **abortaba la solicitud del cajero** (flujo de plata bloqueado). | `CajaPage.tsx:605/:798/:1116`, `VentasPage.tsx:240`; policy mig 084 + drift en DEV; verificado con `SELECT … pg_policies` en ambos proyectos | **Mig 219**: normaliza ambos entornos — SELECT/UPDATE/DELETE = propias (aislamiento NOT-04 intacto), INSERT = mismo tenant (`tenant_id = get_user_tenant_id()`). Validado en DEV impersonando cajero: insert cross-user OK, lee ajenas = 0, cross-tenant bloqueado |

## ✅ Confirmado correcto (capa código) — §25-28

| Área | IDs | Nota |
|---|---|---|
| Escaneo POS | SCAN-01/02/03/04/06 | `procesarScan` mode-safe (no usa filtros WMS que rompen básico); cola anti-duplicados (`scanQueueRef`); GS1 vía `resolverScanCompuesto` (GTIN + AI cantidad 30) con `.eq('activo',true)`; suma a línea existente con tope de stock; "no encontrado" avisa. `BarcodeScanner` = cámara (BarcodeDetector→zbar→ZXing DataMatrix) + **modo manual = lector físico USB/BT** |
| Notificaciones (resto) | NOT-01/03 | badge Alertas vs página = mode-aware (v1.74.1); campana (`notificaciones`) es sistema aparte; `markRead`/`markAllRead` invalidan query; generación de eventos presente (`notificarRolesVentas`) |
| Webhooks idempotencia | INT-08 | doble guard: `webhook_external_id` (check) + UNIQUE `(tenant,integracion,webhook_external_id)` (mig 060) + dedup de venta por `tracking_id` antes de crear (TN). MP/MeLi/Modo igual patrón |
| PWA / chunk viejo | PWA-05 | `vite:preloadError` + red de seguridad (`ChunkLoadError`/`Failed to fetch dynamically`) → recarga 1 vez con guard `sessionStorage` anti-bucle; `ErrorBoundary` detecta `reading 'default'` |
| Teclado anti-duplicado | KBD-02 | cubierto por VEN-22 (`savingRef` en `registrarVenta`, pase 1) |
| Export / Import | LIST-03, CLI-17 | XLSX/CSV presentes en 15 páginas; import en `ImportarMasterPage`/`ImportarProductosPage` |

## 🔍 Cobertura pendiente (capa C / runtime)
INT-09 (carrera real multicanal con stock=1 → necesita lock DB, mismo riesgo que NEG-03, runtime), PWA-01/02/03/04 (instalar/offline/reconexión/mobile = runtime), NOT-02 end-to-end (verificar que el supervisor RECIBE el aviso tras el fix, click-through en PROD).

**e2e agregados (capa C parcial):** `tests/e2e/25_notificaciones.spec.ts` (NOT-01/03: campana abre, panel renderiza, marcar leídas) + `tests/e2e/24_presupuesto_despacho_mutante.spec.ts` (§22: modo Presupuesto alcanzable + guard de cliente obligatorio). Ambos verdes. El convert PRES-08 y NOT-02 cross-user end-to-end siguen para click-through manual (requieren datos sembrados / 2 sesiones).

## Resumen pase 3
- **1 hallazgo 🔴** (NOT-02/NOT-04: RLS rompía TODAS las notificaciones in-app + abortaba la solicitud de Caja Fuerte; PROD y DEV además estaban desincronizados). Fix = **mig 219**.
- El resto del batch §25-28 auditable por código quedó **verde**.

## ✅ Fixes aplicados (pase 3 — v1.77.0)

| Hallazgo | Fix aplicado | Archivos |
|---|---|---|
| **NOT-02 / NOT-04** | **Mig 219** `219_fix_rls_notificaciones_insert.sql`: policies explícitas por comando — `notif_select`/`notif_update`/`notif_delete` (solo propias) + `notif_insert` (mismo tenant). Aplicada DEV + verificada (impersonación cajero). Sin cambios de frontend (el código ya insertaba bien). | `supabase/migrations/219_*.sql` |

typecheck + **746 unit** + build verdes. Sin cambios de frontend (solo `APP_VERSION` + migración).

---

## ✅ Fixes aplicados (sesión 2026-06-18 — facturación: tipos por emisor + alícuotas + envío)

Disparado por dos reportes de GO en homologación (Almacén Jorgito, monotributista): (1) "me deja hacer Factura B siendo monotributista" y (2) "puse IVA 10,5% al producto y la factura lo tomó como 21%". La revisión a fondo del flujo de facturación (incl. envío) encontró **4 bugs**, uno grave y latente.

| Hallazgo | Severidad | Fix aplicado | Archivos | Cubierto por |
|---|---|---|---|---|
| **Alícuota ≠ 21% se mandaba a AFIP como 21%** — el numeric de Postgres llega como `"10.50"/"0.00"/"27.00"` y no matcheaba `ALICUOTA_ID` (`"10.5"/"0"/"27"`) → caía al default `Id:5` (21%). Importe a la tasa real + Id 21% → **AFIP rechaza (10051)**. Latente: todo lo probado era 21% + los monotributistas emiten C | 🔴 GRAVE (fiscal) | Normalizar la clave con `String(parseFloat(tasaStr))` antes del lookup, en la EF y en el espejo | `supabase/functions/emitir-factura/index.ts`, `src/lib/facturacionLogic.ts` | unit FAC-IVA-08/09/10 · UAT FAC-25/26 |
| **Tipo de comprobante no validado server-side** — la restricción A/B/C por emisor era solo UI; un bundle viejo / API directa podía emitir B siendo monotributista (pasó en ventas #222 y #224) | 🔴 (fiscal) | Guard en la EF: Monotributista/Exento → solo C; RI → nunca C; si no, **400** | `supabase/functions/emitir-factura/index.ts` | UAT FAC-20/21/22 |
| **Producto Exento (0%) se guardaba como 21%** — `parseFloat(form.alicuota_iva) || 21` convierte `0→21` | 🔴 | `Number.isFinite(...) ? ... : 21` (preserva el 0) | `src/pages/ProductoFormPage.tsx` | UAT PRD-16 |
| **Select de alícuota no reflejaba el valor guardado** — cargaba `"21.00"/"10.50"` (no matchea las opciones `"21"/"10.5"`) → campo en blanco al editar; daba la sensación de que el 10,5 "no quedaba" | 🟠 (UX/confianza) | Normalizar al cargar con `String(parseFloat(...))` | `src/pages/ProductoFormPage.tsx` | UAT PRD-15/17 |

**Flujo de envío + factura auditado y confirmado correcto:** `ventas.total` = suma de ítems (no incluye envío); `costo_envio` aparte; la EF arma `impTotal = venta.total + costo_envio` desde los ítems + la línea de envío → **no duplica** (verificado con datos reales en DEV). Cubierto por UAT VEN-21/35 + FAC-23/24.

typecheck + **753 unit** (4 de regresión de alícuota nuevos) + build verdes. **Pendiente deploy:** EF `emitir-factura` (lleva el guard + el fix de alícuota) a DEV → test homologación → PROD con OK de GO. Frontend (ProductoForm + facturacionLogic) va por el flujo normal `dev`.

---

## ✅ Fixes/features aplicados (sesión 2026-06-18 — tanda 2: caja, gastos, branding) — v1.78.2 → v1.79.0

| Tema | Versión | Qué cambió | Cubierto por |
|---|---|---|---|
| **Gastos — automatización fiscal** | v1.79.0 (mig 227) | `tipo_comprobante` (gastos+gastos_fijos) + trigger `fn_gastos_iva_guard` (RI+Factura A discrimina IVA crédito; Mono/Exento total sin crédito ni Ganancias; default Monotributista). UI condicional en ambos forms. | GAS-10→15 |
| **Efectivo por default en alta de tenant** | v1.78.2 (mig 225) | Trigger de onboarding crea cuenta Efectivo (en moneda del tenant) + 5 métodos default con Efectivo vinculado + backfill. | CAJ-27 |
| **Capital bóveda cuenta el efectivo** | v1.78.2 (mig 226) | `vw_boveda_cuentas` atribuye el efectivo sin cuenta a la cuenta Efectivo. Gap: aperturas no se cuentan. | CAJ-23 |
| **Caja Fuerte UI** | v1.78.2 | 2 tarjetas (bóveda + capital total) + selector de cuenta destino en el ingreso + lock de caja-origen en básico. | CAJ-22/24/25 |
| **Selector de caja en la venta** | v1.78.3 | Excluye la sesión permanente de la Caja Fuerte; autopreselecciona la única caja operativa. | VEN-36 |
| **Arqueo repetible** | v1.78.4 | Varios arqueos por sesión (siempre se pudo; era descubribilidad). Botón "Arqueo" + tooltip. | CAJ-26 |
| **Caja a pantalla completa (2 columnas)** | v1.78.2 | Layout full-width; saldo+acciones / movimientos+arqueos+cierre. | — (visual) |
| **Degradé de marca violeta→cian** | v1.78.2 | Single-source en `src/index.css` (`--color-accent` + `--color-accent-2`); `bg-accent`→degradé en botones/barras/pills. | — (visual) |
| **Logo/iconos nuevos** | v1.78.2 | favicon + PWA (192/512 + maskable) + apple-touch + sidebar + login. | — (visual) |

**A verificar visualmente en PROD** (no se pudieron ver renderizados; revertibles): degradé global, layout de Caja 2-col, logo, form de Gastos según condición del tenant.

**Patrón de bugs de esta sesión (para no repetir):** (1) **drift de dato de tenant** — un campo de condición (`condicion_iva_emisor`) que cambia y afecta varios módulos a la vez (facturación + gastos); (2) **sesión permanente de la bóveda** que se cuela en queries de "cajas abiertas"; (3) **`numeric` de Postgres llega como string** (`"21.00"`/`"10.50"`) y rompe lookups por igualdad de string (alícuota AFIP) — normalizar con `parseFloat`; (4) **movimientos de efectivo sin `cuenta_origen_id`** que no entran a las vistas de capital; (5) **defaults server-side** (guards/trigger) además de la UI, porque la UI se puede cachear/bypassear.

---

## 🔎 Pase de auditoría 2026-06-19 (capa código) — Caja Fuerte / capital + selector de caja

Auditados **por código** (no runtime) los escenarios agregados en v1.78.2→v1.79.0 que estaban ⬜:

| Escenario | Resultado | Evidencia |
|---|---|---|
| CAJ-22 (2 tarjetas) | ✅ | CajaPage.tsx:1984-1994, gateadas por `puedeExtraerBoveda` |
| CAJ-23 (capital cuenta efectivo) | ✅ | vista mig 226 (`COALESCE` atribuye no-informativos sin cuenta a Efectivo) |
| CAJ-24 (selector cuenta destino) | ✅ | CajaPage.tsx:2195-2202 |
| CAJ-25 (caja-origen bloqueada en básico) | ✅ | `disabled={!modoAvanzado}` :2179 |
| CAJ-26 (arqueo repetible) | ✅ | `realizarArqueo` :1148 sin guard; botón+tooltip :1737 |
| CAJ-27 (Efectivo default en alta) | ✅ | DEV: 9/9 tenants con cuenta Efectivo, 0 métodos sin link |
| VEN-36 (selector excluye bóveda) | ✅ | `.filter(!es_caja_fuerte)` VentasPage.tsx:577 + autopreselect :627 |

**Decisión cerrada (CAJ-28):** el gap de "aperturas no se cuentan en el capital" se resolvió como **Opción A** — NO sumar `monto_apertura` (evita doble conteo del arrastre, que ya está en las ventas registradas); el capital inicial real se asienta una vez como "Ingreso externo" a la bóveda. Solo UX (tooltip + nota), sin migración.

**🐞 Hallazgo nuevo (CAJ-29) — capital total multi-moneda suma sin convertir:** `capitalTotal` (CajaPage.tsx:223) hace `reduce(+saldo)` sobre todas las cuentas activas **ignorando `moneda`** → un tenant con cuentas ARS+USD muestra un único número que mezcla ambas. **Real en DEV: Almacén Jorgito (ARS+USD).** No es regresión (preexistía a esta sesión) y solo afecta tenants multi-moneda, pero el número es engañoso. **Pendiente decisión de diseño con GO:** (a) sumar solo la moneda principal del tenant; (b) mostrar el capital discriminado por moneda; (c) convertir con cotización (requiere fuente de tipo de cambio). Hasta definir, no se toca la semántica.

### Gastos — automatización fiscal (GAS-10→15) auditados por código

| Escenario | Resultado | Evidencia |
|---|---|---|
| GAS-10 (Mono/Exento) | ✅ | `comprobantesGasto` sin Factura A si `!esRI` (GastosPage.tsx:167); IVA/Ganancias gateados por `esRI` :1643/:1680 |
| GAS-11 (RI + Factura A) | ✅ | default 21% :1625; preview Neto/IVA crédito :1664; persiste `iva_monto` :1117 |
| GAS-12 (RI + B/C/Ticket) | ⚠️ | IVA crédito oculto + `iva_monto`=0 OK; pero "Deducir de Ganancias" default **OFF** (no ON como decía la nota) → GAS-17 |
| GAS-13 (guard server-side) | ✅ | trigger BEFORE INSERT/UPDATE, SECURITY DEFINER (mig 227) |
| GAS-14 (sin condición → Mono) | ✅ | UI :164 + trigger `COALESCE(NULLIF(...))` |
| GAS-15 (gasto fijo respeta condición) | ✅ | renderFiscal compartido; "Generar desde fijo" copia tipo_comprobante :1539 → trigger sanea |

**Casos nuevos agregados:** GAS-16 (cambiar condición del tenant con gastos viejos: conservan crédito hasta editar) · GAS-17 (decisión: default de "Deducir de Ganancias" para RI — hoy OFF, la nota decía ON).

**Nota:** el agente `general-purpose` lanzado para esta auditoría falló por error 529 (sobrecarga del servidor) sin producir output; se hizo inline.

### Baseline de la suite + fixes de selectores e2e (2026-06-19)

`test-runner`: **unit 753/753 ✅**. **e2e 161/164** → arreglados los 3 rojos (regresiones de test, no de lógica), re-corridos en verde:
- **e2e 20 (caja apertura/cierre):** el botón de arqueo pasó a decir "Arqueo" (v1.78.4); el locator buscaba `/Arqueo parcial/`. Fix: `/^Arqueo$/`.
- **e2e 21 (facturación mutante, CAE real):** el tenant de e2e (Almacén Jorgito) quedó en **RI** → no ofrece "Factura C" (RI emite A/B), el locator `/^Factura C$/` no existía. Fix: el test ahora toma el **primer tipo de comprobante habilitado** (adaptable a la condición del tenant) y verifica el CAE con esa letra. Emitió CAE real de homologación.
- **e2e 23 (inventario ingreso mutante):** NO era dominó — el selector del resultado de producto (`div.flex-1 button`) no matcheaba y su fallback page-wide agarraba un botón detrás del backdrop del modal. Fix: selector scopeado al modal (`button.w-full.text-left` dentro del `div.fixed.inset-0` del buscador).

Tras los fixes: **e2e 164/164 ✅** (verificados puntualmente los 3 + corrida completa).

### §11 Facturación AFIP — auditado por código (EF `emitir-factura` + `facturacionLogic`)

✅ FAC-01 (C sin IVA), FAC-02 (`ImpTotal=Neto+IVA`), FAC-03 (Exento→C), FAC-04 (A sin CUIT: UI+EF), FAC-10 (NC `CbtesAsoc`), FAC-22 (guard tipo 400 server-side), FAC-23 (envío: Concepto=3 + predominante + no dup), FAC-24 (courier directo afuera), FAC-25 (`'10.5'→Id 4` + normalización), FAC-26 (`0/exento→3`, `27→6`).

🐞 **FAC-27 (nuevo) — Factura B ≥ umbral sin DNI/CUIT: guard solo UI.** El bloqueo vive en el POS (`requiereIdentFacturaB`); la EF emite con CF y depende de que AFIP rechace (RG 5616). No es silencioso, pero espejarlo server-side sería consistente con FAC-22. Pendiente decidir con GO.

Pendientes capa C (runtime/PDF, no code-auditable): FAC-06/07/08/09/11/14/15/17/18/19.

### §3 Productos — auditado por código

✅ PRD-02 (stock disponible mode-aware: básico no filtra `estado_id`), PRD-07 (baja lógica), PRD-08/09 (no hay hard-delete de productos en la UI → sin líneas huérfanas ni histórico roto, por diseño), PRD-10 (SKU dup: check debounced + 23505 DB).

⚠️ **PRD-11 — precio negativo:** inputs con `min=0` pero `parseFloat()||0` no rechaza un negativo tipeado directo (sin validación nativa de form). Gap menor → guard `Math.max(0, …)` al guardar. Pendiente decidir.

### §5 Ventas/POS — auditado por código (`registrarVenta` + validaciones pre-submit)

✅ VEN-01 (efectivo→`ingreso` awaited + toast si falla, VentasPage:2807), VEN-03 (sin `numero` en el insert, lo pone el trigger :2498), VEN-05 (no-efectivo→`ingreso_informativo` con cuenta :2819), VEN-06 (mixto: `serializeMediosPago` + `monto_pagado`), VEN-07 (`validarMediosPago` exige cubrir el total :2459-2467), VEN-08/09 (CC exige cliente + CC habilitada :2406-2409), VEN-10 (seña efectivo→`ingreso_reserva` awaited :2839), VEN-13/14 (despacho re-valida stock: `throw "Stock insuficiente"` :2713 + **rollback** de la venta :2928), VEN-22 (savingRef anti doble-submit :2333/2492), VEN-28 (seña obligatoria/mínima :2445), VEN-30/E2 (crédito a favor: exige cliente, no supera saldo :2437), VEN-31/32 (morosidad `bloqueo_total`/`bloqueo_cc` + límite CC :2410-2436), VEN-36 (selector caja, ya auditado).

Cubiertos en pases previos (v1.74.0 efectivo↔caja / v1.76.0): VEN-11/12 (reserva/despacho asienta efectivo), VEN-19 (sin caja → fallback a única + nunca pierde el asiento), VEN-24 (anular restaura stock). **Sin bugs nuevos** — la capa de plata/stock del POS está sólida. Runtime/UX no code-auditable: VEN-23 (concurrencia real), VEN-26 (ESC cierra modal del stack).

### §10 Devoluciones — auditado por código (`procesarDevolucion`)

✅ DEV-01/02 (reingreso + egreso proporcional), DEV-03 (egreso awaited + **fallback a caja única** + toast si falla, VentasPage:3509-3528 — fix bug #26), DEV-04/11/12 (aplica a deuda CC FIFO sin efectivo :3530-3550), DEV-08 (reingreso con `sucursal_id` correcta, no NULL :3455), DEV-09 (**consolida** en la línea existente + bump manual de `stock_actual` :3441-3447), DEV-13/14 (crédito a favor → `cliente_creditos` origen `devolucion` :3557-3568, exige cliente), DEV-15 (cap re-devolución + "nada para devolver" :3109). Reingreso **mode-aware** (:3458 básico sin ubicación/estado). DEV-05/06/07/16/17 cubiertos por los fixes v1.76.0 (CAJ-18/DEV-07). **Sin bugs nuevos** — el módulo de devoluciones (zona histórica de bugs) quedó sólido tras los pases v1.74/v1.76.

### §4 Inventario — auditado por código

✅ INV-06 (ajuste: `stock_antes/despues` con `Math.max(0,…)`, InventarioPage:728), INV-07 (rebaje > disponible → `throw "Stock disponible insuficiente"` :1170; nunca negativo), INV-01/03/04/05 (ingreso/rebaje/masivo **mode-aware**: en básico stock sin ubicación/estado — fixes v1.59.x, ver [[reference_basico_stock_null_ubicacion_estado]]; consistente con el stock-disponible-map de §3), INV-10/11/13 (columnas/tabs WMS — Kits/Autorizaciones — gateados por `modoAvanzado`). **Sin bugs nuevos.**

---

## ✅ Balance de finalización del UAT (2026-06-19)

**Auditado por código (capa A) — esta sesión:** §3 Productos, §4 Inventario, §5 Ventas/POS, §6 Caja, §7 Gastos, §8 Clientes (CC), §9 Proveedores (CC), §10 Devoluciones, §11 Facturación AFIP. Cubren TODA la superficie 🔴 de plata/stock/fiscal.

**§8 Clientes / §9 Proveedores (CC) — verificado:** CLI-04/05 (cobranza CC efectivo exige caja ANTES de saldar — `requiereCaja` en cobranzaCC.ts:77-80; sin sesión no se reduce la deuda), CLI-06 (no-efectivo no exige caja), CLI-14 (FIFO `planificarCobranzaFIFO`, oldest-first, con unit tests en ccLogic), CLI-08/13 (crédito a favor → `cliente_creditos`, redención en venta). PROV-03 (servicio recurrente vencido → gasto) cubierto por el cron-sweeps EF (v1.73.0); PROV-06 (pago CC proveedor) por `proveedor_cc_movimientos`. **Sin bugs nuevos.**

**Cubierto por pases previos (no re-auditado, ya verde):**
- §14 Roles/permisos + §20 matriz rol×módulo → v1.57.0 (matriz + e2e DEPOSITO/CONTADOR) + e2e 17/18 verdes hoy.
- §15 Sucursales/RLS → **v1.75.0** (RLS por sucursal a nivel servidor, 23 tablas, validado impersonando — ver [[reference_rls_por_sucursal]]).
- §27 Notificaciones → **v1.77.0** mig 219 (RLS de `notificaciones`, INSERT cross-user) + mig 220 (anti-drift).
- §25 Escaneo / §28 export-teclado → pase 3 v1.77.0 (§25-28 verde).

**Hallazgos — todos resueltos:** CAJ-29 (✅ capital por moneda), GAS-17 (✅ default Ganancias por condición), FAC-27 (✅ guard B≥umbral en la EF, deployado a DEV — falta PROD con OK de GO), PRD-11 (✅ clamp de precio ≥ 0), GAS-16 (✅ resuelto by-design: no re-saneo retroactivo, por integridad fiscal histórica).

**Pendiente SOLO capa C (click-through manual / runtime — NO code-auditable):** PDFs e impresión (FAC-06/07/19, §23 comprobantes), config UI (§2 parcial), integraciones reales TN/MeLi/MP/courier (§17 — couriers bloqueados por cuentas B2B), i18n, concurrencia real (VEN-23), PWA/offline (§26), auth/sesión runtime (§1 AUTH-05/06/08). Estos requieren ejecutar la app y un humano; no se pueden cerrar leyendo código.

**Conclusión:** el code-audit del UAT está **completo para todo lo automatizable/auditable por código**. Lo que resta es exclusivamente verificación manual en runtime (capa C), que es un click-through, no una auditoría de código.

---

# 🧾 §29 — Matriz fiscal por condición del emisor (RI / Monotributista / Exento)

> **Para probar en la próxima sesión.** El campo `tenants.condicion_iva_emisor` (Config → Facturación)
> gobierna **a la vez** Facturación (qué comprobantes se emiten y cómo) y Gastos (IVA crédito + Ganancias).
> Valores posibles: **RI** · **Monotributista** · **Exento** (no hay otros). Cada condición DEBE comportarse
> distinto y de forma consistente entre módulos. Probar cambiando la condición del tenant y recorriendo
> ambos módulos. **Recordatorio:** Almacén Jorgito (DEV) se usó en RI para pruebas y se volvió a Monotributista.

### 29.A — Facturación (POS + módulo Facturación + EF `emitir-factura`)

| ID | Condición emisor | Escenario | Resultado esperado | Pri | Estado |
|---|---|---|---|---|---|
| MF-01 | **RI** | Tipos ofrecidos en el POS/Facturación | Solo **A** y **B** (nunca C). Default = el auto-detectado según el cliente | 🔴 | ⬜ |
| MF-02 | **RI** | Emitir **Factura A** a cliente con CUIT | Discrimina IVA: array `Iva` con Id por alícuota (0→3, 10.5→4, 21→5, 27→6); `ImpNeto`+`ImpIVA`=`ImpTotal`; CAE | 🔴 | ⬜ |
| MF-03 | **RI** | Factura A a cliente **sin CUIT** | Bloqueado (UI deshabilita + EF lanza "Para Factura A se requiere CUIT") | 🔴 | ⬜ |
| MF-04 | **RI** | Factura **B** a Consumidor Final | Discrimina IVA (B); CAE. Ley 27.743 en el PDF (B) | 🔴 | ⬜ |
| MF-05 | **RI** | Factura **B ≥ umbral** (~$68.305) sin DNI/CUIT | **Bloqueado**: UI (`requiereIdentFacturaB`) + EF 400 (FAC-27) | 🔴 | ⬜ |
| MF-06 | **RI** | Forzar **C** (bundle viejo / API directa) | EF responde **400** "RI no puede emitir tipo C" | 🔴 | ⬜ |
| MF-07 | **Monotributista** | Tipos ofrecidos | **Solo C** (A y B no se renderizan); default C | 🔴 | ⬜ |
| MF-08 | **Monotributista** | Emitir **Factura C** | **Sin IVA**: `ImpNeto=ImpTotal`, `ImpIVA=0`, **sin** array `Iva`; CAE | 🔴 | ⬜ |
| MF-09 | **Monotributista** | Forzar **A o B** (bundle viejo / API directa) | EF responde **400** "Un emisor Monotributista solo puede emitir tipo C" | 🔴 | ⬜ |
| MF-10 | **Exento** | Tipos ofrecidos + emisión | **Igual que Monotributista**: solo C, sin IVA; forzar A/B → EF 400 (`emisorSoloC` incluye Exento) | 🔴 | ⬜ |
| MF-11 | **(sin setear)** | Intentar habilitar facturación | **Bloquea** (CFG-07): exige condición IVA + CUIT antes de activar | 🔴 | ⬜ |
| MF-12 | **cualquiera** | NC vía Devolver | La NC hereda la letra de la factura original (C→NC-C, A→NC-A, B→NC-B) + `CbtesAsoc`; respeta el mismo guard de condición | 🔴 | ⬜ |
| MF-13 | **RI** | Envío cobrado en Factura A/B | Ítem "Costo de Envío" con alícuota predominante de los productos; Concepto=3 | 🟡 | ⬜ |
| MF-14 | **Monotributista/Exento** | Envío cobrado en Factura C | Ítem "Costo de Envío" va a neto (C sin discriminar); Concepto=3 | 🟡 | ⬜ |

### 29.B — Gastos (form variable + gasto fijo + trigger `fn_gastos_iva_guard`)

| ID | Condición emisor | Escenario | Resultado esperado | Pri | Estado |
|---|---|---|---|---|---|
| MG-01 | **RI** | Comprobantes ofrecidos al cargar gasto | **Factura A, B, C, Ticket** | 🔴 | ⬜ |
| MG-02 | **RI** | Gasto con **Factura A** | Muestra **Alícuota IVA** (default 21%, 10.5/27/custom) + **Neto** + **IVA crédito**; persiste `iva_monto` + `iva_deducible=true` | 🔴 | ⬜ |
| MG-03 | **RI** | Gasto con **B / C / Ticket** | Monto = total; **`iva_monto`=0/NULL** (sin crédito) | 🔴 | ⬜ |
| MG-04 | **RI** | "Deducir de Ganancias" | **Disponible, default ON** (GAS-17); con sub-opción negocio/personal | 🟡 | ⬜ |
| MG-05 | **RI** | Forzar `iva_monto` con comprobante ≠ Factura A (API/insert directo) | Trigger **sanea** `iva_monto`/`alicuota_iva`/`tipo_iva`→NULL + `iva_deducible`=false | 🔴 | ⬜ |
| MG-06 | **Monotributista** | Comprobantes ofrecidos | **B, C, Ticket** (sin Factura A) | 🔴 | ⬜ |
| MG-07 | **Monotributista** | Cargar gasto | Monto = total; **NO** se muestran IVA crédito ni "Deducir Ganancias"; nota "el monto es el total" | 🔴 | ⬜ |
| MG-08 | **Monotributista** | "Deducir de Ganancias" default | **OFF** (no aplica); el trigger fuerza `deduce_ganancias=false` | 🟡 | ⬜ |
| MG-09 | **Monotributista** | Forzar `iva_monto`/`deduce_ganancias` (insert directo) | Trigger los **sanea** a 0/NULL/false | 🔴 | ⬜ |
| MG-10 | **Exento** | Comprobantes + IVA + Ganancias | **Igual que Monotributista**: sin Factura A, sin IVA crédito, sin Ganancias | 🔴 | ⬜ |
| MG-11 | **(sin setear)** | Cargar gasto | Default conservador = **Monotributista** (sin crédito ni Ganancias); trigger `COALESCE(NULLIF(...),'Monotributista')` | 🟡 | ⬜ |
| MG-12 | **cualquiera** | **Gasto fijo** (plantilla) | La sección fiscal aplica igual (`renderFiscal` compartido); al **materializar** en `gastos` ("Generar desde fijo") el trigger re-sanea según la condición vigente | 🟡 | ⬜ |
| MG-13 | **RI → Monotributista** | Cambiar la condición con gastos viejos cargados | Los gastos **históricos NO se tocan** (conservan su IVA crédito legítimo); solo lo nuevo usa la condición nueva (GAS-16 by-design) | 🟡 | ⬜ |

### 29.C — Consistencia cross-módulo

| ID | Escenario | Resultado esperado | Pri | Estado |
|---|---|---|---|---|
| MX-01 | Cambiar `condicion_iva_emisor` en Config | Cambia **a la vez** el comportamiento de Facturación (tipos A/B/C) **y** de Gastos (IVA crédito/Ganancias), sin desfasaje | 🔴 | ⬜ |
| MX-02 | Guards server-side en ambos | EF `emitir-factura` (tipo + B≥umbral) **y** trigger `fn_gastos_iva_guard` aplican aunque la UI esté cacheada/bypasseada | 🔴 | ⬜ |
| MX-03 | `numeric` de PG en alícuotas | `"21.00"/"10.50"/"0.00"` se normalizan con `parseFloat` antes de mapear a Id AFIP / opción del select (facturación y gastos) | 🔴 | ⬜ |

**Nota de implementación verificada (2026-06-19):** todo lo de arriba está implementado y auditado por código en esta sesión; esta matriz es para la **verificación en runtime** (emisión real con CAE en homologación + carga real de gastos) cambiando la condición del tenant. Fuentes: `src/lib/facturacionLogic.ts` (`tiposComprobantePermitidos`/`detectarTipoComprobante`), `supabase/functions/emitir-factura/index.ts`, `src/pages/GastosPage.tsx` (`renderFiscal`), `supabase/migrations/227_*.sql` (`fn_gastos_iva_guard`).

---

# ✅ Code-audit 2026-06-20 (cierre de la capa código)

Re-confirmación y cierre del code-audit tras la auditoría de paridad DEV↔PROD (mig 231).

**§29 fiscal — re-confirmado:**
- **MX-03/MF-02** mapeo de alícuota: `facturacionLogic.ts:105` usa `String(parseFloat(tasaStr))` para normalizar `"21.00"/"10.50"/"0.00"` antes de `ALICUOTA_ID` (0→3, 10.5→4, 21→5, 27→6); exento/sin_iva → 3. El bug GRAVE de v1.78.1 (alícuota ≠21 mandada como 21) sigue arreglado. Espejado en la EF.
- **Guards server-side de `emitir-factura` (REGLA #0 #3) — todos presentes y deployados en PROD:** MF-06 (RI no C → 400), MF-09/MF-10 (`emisorSoloC` = Monotributista||Exento → ≠C → 400), MF-03 (Factura A exige CUIT del cliente → throw), MF-05/FAC-27 (B ≥ `umbral_factura_b` ≈68305.16 sin DNI/CUIT → 400), MF-08 (C/NC-C no discrimina IVA), MX-02 (independientes de la UI). Anti-doble-emisión: venta con CAE / devolución con NC → throw.

**Autorización de ajustes por rol (v1.80.0, mig 228) — code-audit ✅ + 🐞 hallazgo:**
- `ajusteAutorizacion.ts` (`modoAjusteRol`/`requiereAuthAjuste`) correcto; 3 consumidores: Conteo (`ajuste_conteo`), LPN modal (`eliminar_lpn`/`ajuste_cantidad`) y **edición masiva (`bulk_edit`)**.
- 🐞 **El `bulk_edit` inserta `linea_id: null` y DEV lo rechazaba** (`autorizaciones_inventario.linea_id` había quedado `NOT NULL` en DEV; mig 103 lo dejó nullable para bulk). La edición masiva con aprobación (rol ≠ DUEÑO) **estaba rota en DEV** (0 filas bulk_edit; los +9 unit tests son lógica pura → no lo veían). PROD estaba OK. **Arreglado por mig 231** (DROP NOT NULL en DEV). Ver [[reference_drift_dev_prod_paridad]].
- RLS `aut_inv_tenant` (`FOR ALL`, tenant-scoped, CHECK=NULL→usa el USING): INSERT del solicitante + UPDATE del aprobador (otro usuario, mismo tenant) pasan; **sin** el bug cross-user de `notificaciones`.

**Onboarding / primer uso (PU-01/02/03) — code-audit ✅** (ver `tests/specs/uat-primer-uso.plan.md`): `provisionNegocio` correcto (UUID en cliente, rollback, dedup por `users.id` PK, `loadUserData` antes de navegar, seed que falla-fuerte); PU-03 seed verificado en DB.

**Balance:** el **code-audit de ambos UAT (modo básico + primer uso) está COMPLETO**. Lo que resta es exclusivamente **capa C / runtime** (emisión CAE real por condición, PDFs/impresión, integraciones B2B, PWA, click-through de UI, verificación visual en PROD) + la **suite e2e** (que por decisión de GO se ejecuta junto con la re-corrida de paridad al **cerrar el desarrollo**).

---

# ✅ §30 — Validación e2e MUTANTE por click-through (capa C/runtime, 2026-06-20/21)

Se manejó la app como usuario (Playwright vs DEV, tenant Almacén Jorgito) cubriendo los flujos REGLA #0 que faltaban de la capa C. **Metodología:** aserción POSITIVA del resultado (toast/efecto) + **verificación de la mutación en DB** con `execute_sql` (nunca solo `.not.toBeVisible()` = falso-verde). Todos **VERDE + verificados en DB**.

| # | Spec | Escenario (Given/When/Then) | Invariante REGLA #0 verificado en DB |
|---|------|------------------------------|--------------------------------------|
| CHQ-E2E-01 | `31_cheque_gasto_rechazo` | Gasto pendiente → pago con medio "Cheque" → en Gastos→Cheques se marca **Rechazado** | El cheque propio rechazado **revierte el pago**: gasto `monto_pagado` 700→0, `estado_pago` pendiente; cheque `rechazado` vinculado |
| CFU-E2E-01 | `32_caja_fuerte_deposito` | Depositar $50 de una caja operativa a la Bóveda | **2 patas balanceadas**: `egreso_traspaso` en Caja1 + `ingreso_traspaso` en la Bóveda (mismo concepto) |
| DEVP-E2E-01 | `33_devolucion_proveedor` | Devolver 1 u. de una OC recibida con forma "Crédito en CC" | Rebaja stock FIFO (251→250) + `stock_actual` 254→253 + `ajuste_rebaje`; `nota_credito` −1000 en CC del proveedor; `devoluciones_proveedor` confirmada |
| OC-E2E-01 | `34_oc_creacion` | Crear OC (proveedor + producto + cantidad) → Guardar | OC `borrador` + ítem persistidos. *Gotcha: `openNewOC` ya trae 1 línea vacía → NO "Agregar línea".* |
| OC-E2E-02 | `35_recepcion_oc_vinculada` | "Recibir mercadería" de una OC confirmada → confirmar recepción | Sube stock (Elite 134→139) + la OC pasa a **`recibida`** por el acumulado B5 (`estadoOCdesdeRecibido`) |
| CONT-E2E-01 | `36_conteo_ajuste` | Conteo "Por producto" con diferencia +1, finalizar (DUEÑO) | Ajuste **directo** (modo `directo`, mig 228): `reconciliarDelta` → Elite 139→140 + `ajuste_ingreso` "Conteo de inventario"; conteo `finalizado` |
| RH-E2E-01 | `37_rrhh_nomina_gasto` | "Generar nómina del mes" → "Generar gasto" de una liquidación | Gasto "Sueldo … — período" categoría **Sueldos**, monto=neto, pendiente, `rrhh_salarios.gasto_id` vinculado; `deduce_ganancias` saneado a false (Monotributista, mig 227) |
| ENV-E2E-01 | `38_envio_combustible_gasto` | Envío propio con vehículo → "Registrar combustible" | Gasto categoría **Combustible** $5000 pagado + `envios.gasto_combustible_id` vinculado |
| CC-E2E-01 | `39_cc_condonacion` | Condonar una venta CC (write-off, sin clave) | Venta `monto_pagado`=total + tag **'Condonación CC'** (excluido de ingresos) |
| CC-E2E-02 | `40_cc_incobrable_clave_maestra` | "Incobrable" → motivo + **clave maestra** → Confirmar baja | Salda toda la deuda CC pendiente (tag 'Incobrable') + gasto "Deudor incobrable: …" categoría "Deudores incobrables" ($1557) |
| SEG-E2E-01 | `41_clave_maestra_set_hash` | Config→Caja → setear clave maestra + **confirmación** → Guardar | Persiste **hasheada (bcrypt)** vía RPC `set_clave_maestra` (mig 233): hash nuevo + `verificar_clave_maestra` OK |
| NC-E2E-01 | `42_nc_fiscal` | Devolución de venta facturada (fixture) → **"Emitir NC"** → confirmar | NC electrónica con **`CbtesAsoc`** (referencia la Factura C original) → **CAE real de AFIP homologación**; `devoluciones.nc_cae` poblado (NC-C #2 `8625045927…`, #3 `8625045929…`, numeración consecutiva, sin error 10197/10040) |
| PRD-E2E-01 | `43_producto_creacion` | Alta de producto por UI con alícuota **10,5%** → Crear | `productos.alicuota_iva = 10.5` (NO 21) — el camino del bug fiscal v1.78.1 (`0 \|\| 21` / numeric mal normalizado) cubierto end-to-end |
| PRES-E2E-01 | `44_presupuesto_convertir` | Crear presupuesto con cliente (no toca stock/caja) → Historial → **"Finalizar (rebaja stock)"** → medio no-efectivo | Presupuesto `pendiente` sin movimiento de stock/caja; al convertir despacha con **rebaje real** (PRES-08): Coca Cola Norte 250→247 (3 ciclos), ventas 241/242/243 desde presupuestos 15/16/17 con su `rebaje` |

**Fixtures DEV (data de prueba, no migración):** método de pago "Cheque" (CHQ-E2E-01), OC #14 confirmada Mayorista MAX/Elite x5 (OC-E2E-02, saltea el gate de pago de OC), recurso "Moto Reparto Test" en envío #15 (ENV-E2E-01), **devolución fixture sobre venta #239 sin nc_cae (NC-E2E-01; su happy-path monetario es frágil → se siembra por SQL; lo que valida #6 es la EMISIÓN FISCAL de la NC).** Clave maestra del tenant de prueba = **12345678**.

**🔐 SEG-E2E-01 / mig 233 — clave maestra hasheada (✅ EN PROD v1.80.2):** la clave estaba en TEXTO PLANO; ahora se guarda con bcrypt + setter server-side `set_clave_maestra` (solo DUEÑO, mín 6) + campo de confirmación en ConfigPage (anti-error). La app no truncaba a 6 (el hueco real era falta de confirmación + texto plano).

**⚠️ Escenario NEGATIVO a documentar (gotcha UX, PRES-E2E-01):** convertir un presupuesto a despachada **desde el Historial** con **2+ cajas operativas abiertas y sin caja preferida** dispara "Hay varias cajas abiertas. Seleccioná en cuál registrar" (`cambiarEstado`) pero ese modal **no expone selector de caja** → callejón sin salida. Bloquea con seguridad (no es bug de plata/stock) pero impide finalizar hasta setear caja preferida o cerrar una caja. *Workaround en el e2e: seleccionar caja en el POS antes de cambiar a modo Presupuesto. Fix sugerido: exponer el selector de caja en el modal de saldo del convert.*

**✅ CERRADO #6/#10/#11 (2026-06-21, v1.80.2 EN PROD):** NC fiscal (spec 42), Productos alícuota (spec 43), Presupuestos crear→convertir (spec 44). **▶ Próximo norte: AUDITORÍA DE COBERTURA — ver `tests/specs/uat-cobertura.plan.md`** (inventario de funcionalidades + matriz de ~140 flags de `tenants` con/sin + decisión de estructura UAT). Parciales pendientes: autorización de conteo por rol ≠ DUEÑO, RRHH pagar nómina/recibo/liquidación final, gate de pago de OC, brazo OC del rechazo de cheque, formas efectivo/reposición de devolución.

---

# 🎨 §31 — Auditoría de CONTRASTE / VISIBILIDAD de botones y estados (UI, reusable)

**Objetivo:** ningún botón, badge o CTA puede quedar **invisible** (texto del mismo color que su fondo, o fondo del mismo color que la superficie donde está), y todos deben verse **con los colores de la marca** (violeta `--color-accent` → cian `--color-accent-2`; oscuro `--color-primary`). Correr esta auditoría **cada vez que se toquen pantallas con fondo oscuro** (`bg-brand-gradient-dark`: Login, Suscripción, Onboarding, Landing) o se agregue/cambie un estado de botón.

**Método (barato, repetible):**
1. **Grep de combinaciones peligrosas** sobre `src/`:
   - `bg-white` + `text-white` en el mismo `className` (el bug clásico) → `rg "bg-white[^\"]*text-white|text-white[^\"]*bg-white" src`.
   - Botón/badge con `bg-white`/`bg-gray-*` dentro de una tarjeta translúcida (`bg-white/10`, `bg-white/[0.0x]`) sobre página oscura → revisar a mano.
   - Estados condicionales `${cond ? A : B}` en botones: verificar que **ambas ramas** contrasten (el bug de "Plan actual" estaba solo en la rama `else`, la del plan NO destacado).
2. **Verificación visual** (Playwright screenshot de la pantalla en cada estado; ver `_shot_tmp.mjs` pattern) con el ojo puesto en: hover, `disabled` (opacity), y estados que cambian el label (ej. `Suscribirme` → `✓ Plan actual`, `Comprar` → `Redirigiendo…`).

**Checklist por pantalla de fondo oscuro (marcar OK / 🐞):**
| Pantalla | Elemento / estado | Regla | Estado |
|---|---|---|---|
| Suscripción | Badge **`✓ Plan actual`** en plan **no destacado** (tarjeta oscura) | NO `bg-white text-white`; usar `bg-accent/25 text-white border-accent/50` | ✅ **fix v1.111.0** (era blanco/blanco → invisible) |
| Suscripción | CTA `Suscribirme` / `Contactar` (destacado vs no destacado) | destacado `bg-primary text-white`; no destacado `bg-white text-primary` (ambos contrastan) | ✅ |
| Suscripción | Botones de resultado (`Reintentar`/`Verificar de nuevo`) en el card blanco | `bg-primary text-white` + links `text-gray-500` | ✅ (+ espaciado v1.111.0) |
| Suscripción | Configurador add-ons in-app (tarjetas seleccionadas/no) | seleccionada = degradé de marca + texto blanco; no = `border-white/10 text-gray-300` | ✅ v1.111.0 |
| Landing | Configurador "Armá tu plan" (packs, toggle, CTA) | activo = degradé marca + badge ✓; CTA `bg-accent text-white` | ✅ v1.111.0 |
| Login / Onboarding | Botones primarios/secundarios sobre degradé oscuro | primario `bg-accent text-white`; secundario con borde/texto legible | ⬜ revisar en próxima corrida |

**🐞 Hallazgo semilla (fix v1.111.0):** en `SuscripcionPage`, al pasar a `active` el CTA del plang no destacado se reemplazaba por el badge `✓ Plan actual` con `bg-white … text-white` → **texto blanco sobre fondo blanco, ilegible**. El plan destacado (fondo blanco) sí se veía (verde). Arreglado a `bg-accent/25 text-white border-accent/50` (tinte de marca, legible sobre la tarjeta oscura). **Lección:** cuando un botón/badge cambia según un booleano (`destacado`, `esActual`, `disabled`), auditar **todas** las ramas, no solo la que se ve primero.
