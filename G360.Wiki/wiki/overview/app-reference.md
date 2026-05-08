---
title: Referencia completa de funcionalidades — Genesis360
category: overview
tags: [referencia, módulos, funcionalidades, procesos, flujos]
updated: 2026-05-08
---

# Genesis360 — Referencia completa de funcionalidades

> Documento de contexto para IA y equipo. Describe todos los módulos, acciones, flujos y relaciones de la app.
> Actualizar cada vez que se agregue o modifique una funcionalidad relevante.

---

## 1. Concepto general

Genesis360 es el **sistema operativo del negocio físico**. No solo muestra datos: indica qué hacer y cuándo. Orientado a comercios con stock, ventas presenciales, múltiples empleados y/o múltiples sucursales.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Multi-tenant:** cada negocio tiene datos completamente aislados via RLS
- **Multi-sucursal:** cada módulo operativo filtra por sucursal activa
- **Versión actual:** v1.8.3 PROD / v1.8.4 DEV

---

## 2. Navegación y estructura de la app

### Sidebar izquierdo — orden real y permisos

| # | Ruta | Label | Acceso mínimo |
|---|------|-------|---------------|
| 1 | `/dashboard` | Dashboard | Contador+ |
| 2 | `/ventas` | Ventas | Cajero+ |
| 3 | `/gastos` | Gastos | Contador+ |
| 4 | `/caja` | Caja | Cajero+ |
| 5 | `/productos` | Productos | Depósito+ |
| 6 | `/inventario` | Inventario | Depósito+ |
| 7 | `/clientes` | Clientes | Cajero+ |
| 8 | `/envios` | Envíos | Cajero+ |
| 9 | `/facturacion` | Facturación | Owner only |
| 10 | `/proveedores` | Prov./Servicios | Owner only |
| 11 | `/recursos` | Recursos | Owner only |
| 12 | `/recepciones` | Recepciones | Supervisor+ / Depósito |
| 13 | `/biblioteca` | Biblioteca | Owner only |
| 14 | `/alertas` | Alertas | Depósito+ (con badge) |
| 15 | `/rrhh` | RRHH | Owner only (plan Pro+) |
| 16 | `/historial` | Historial | Supervisor+ / Contador (plan Básico+) |
| 17 | `/reportes` | Reportes | Contador+ (plan Básico+) |
| 18 | `/sucursales` | Sucursales | Owner only |
| 19 | `/usuarios` | Usuarios | Owner only |
| 20 | `/configuracion` | Configuración | Owner only |

### Rutas adicionales (fuera del sidebar)
| Ruta | Descripción |
|------|-------------|
| `/movimientos` | Ingresos y rebajes de stock (acceso desde Inventario) |
| `/metricas` | Dashboard de métricas avanzadas |
| `/recomendaciones` | Panel de recomendaciones IA |
| `/rentabilidad` | Análisis de rentabilidad de ventas |
| `/grupos-estados` | Grupos de estados de inventario |
| `/importar/productos` | Carga masiva de catálogo |
| `/importar/inventario` | Carga masiva de stock |
| `/importar/master` | Carga masiva de datos maestros |
| `/mi-cuenta` | Perfil y configuración personal |
| `/suscripcion` | Gestión de plan y pagos |
| `/ayuda` | Centro de soporte |
| `/admin` | Panel de administración de plataforma (solo ADMIN global) |
| `/onboarding` | Flujo de registro inicial |

### Header (izquierda → derecha)
- **Selector de sucursal**: dropdown con sucursales + "Todas las sucursales". Visible solo para usuarios con `puedeVerTodas = true`. Usuarios restringidos ven el nombre fijo de su sucursal asignada (sin selector).
- **Refresh manual**: recarga datos de la página actual sin recargar la SPA
- **Asistente IA** (ícono chat): panel flotante de chat con Groq/Llama 3.1 (gratis, 14.400 req/día). Responde preguntas sobre la app, guía al usuario por los módulos. Tiene flujo de bug report que envía la conversación formateada al admin por email.
- **Campana de notificaciones**: muestra alertas de stock crítico y cuotas de CC vencidas. Badge con contador de no leídas.
- **Dark/Light mode**
- **Botón ayuda** (ícono `?`): abre `/ayuda`
- **Configuración** (ícono engranaje): acceso rápido a `/configuracion`
- **Avatar / dropdown**: Mi cuenta (`/mi-cuenta`), cerrar sesión

---

## 3. Módulos principales

---

### 3.1 Dashboard (`/dashboard`)

Vista de control general del negocio.

**Secciones:**
- **KPIs del día**: ventas del día, cantidad de transacciones, ticket promedio, margen estimado
- **Alertas activas**: productos con stock crítico (≤ stock mínimo), cuotas de CC vencidas
- **Gráfico de ventas**: evolución diaria/semanal/mensual (Recharts)
- **Últimas ventas**: listado con monto, cliente, fecha
- **Top productos**: más vendidos del período

**Relaciones:** consume datos de ventas, inventario, clientes (CC), notificaciones.

---

### 3.2 Ventas / POS (`/ventas`)

Caja registradora principal. Permite ventas, presupuestos y devoluciones.

**Tabs:**
- **Nueva venta** (POS activo)
- **Historial**: ventas pasadas filtradas por sucursal activa, fecha, estado
- **Presupuestos**: ventas en estado borrador/presupuesto pendientes de confirmar

**Pantalla POS — componentes:**
- **Selector de grupo de estados** (encima del buscador, visible solo si hay grupos configurados): botones por grupo (ej: "Disponible", "Promoción"). El grupo default se preselecciona automáticamente (★). Botón "Todos" para ver sin filtro. Filtra qué LPNs se consideran para stock disponible.
- **Buscador de productos** (barra superior): busca por nombre, SKU o código de barras. Muestra stock disponible en la sucursal activa según el grupo de estados activo.
- **Toggle galería/lista**: cambia la vista de los resultados
- **Carrito** (panel derecho o inferior en mobile): líneas con producto, cantidad editable, precio unitario, descuento por línea individual
- **Descuento global**: campo sobre el subtotal (% o valor fijo)
- **Selector de cliente**: busca cliente existente o crea uno nuevo inline con nombre + teléfono
- **Medios de pago**: uno o múltiples simultáneos — Efectivo, Tarjeta, Transferencia, MercadoPago, Cheque, Cuenta Corriente, Seña. Cada uno con monto asignable. Muestra vuelto calculado automáticamente cuando supera el total.
- **Modo venta**: Venta / Presupuesto / Reserva
- **Notas**: texto libre asociado a la venta
- **Botón "Confirmar venta"** (parte inferior derecha): ejecuta la venta

**Al confirmar venta:**
1. Trigger DB asigna número de venta (`ventas.numero`) — nunca incluir en INSERT
2. Rebaje de stock según regla del producto (FIFO/FEFO/LEFO/LIFO/Manual)
3. Si hay sesión de caja abierta: registra movimiento de ingreso por medio de pago
4. Si medio = Cuenta Corriente: genera deuda en CC del cliente
5. Si integración TN/ML activa: actualiza stock en marketplace

**Acciones en historial (panel expandido):**
- Ver ítems, medios de pago, cliente, notas
- **Imprimir ticket** → PDF (jsPDF)
- **Emitir factura AFIP** → genera comprobante A/B/C con QR
- **Registrar devolución** → parcial o total con selección de ítems
- **Anular venta** → requiere confirmación

**Escaneo en POS:** ícono cámara en buscador → lee código de barras → agrega producto al carrito automáticamente.

**Kits/Combos en POS:** si el producto es un kit (`es_kit = true`), se explota en sus componentes al agregarlo al carrito.

**Relaciones:** descuenta Inventario. Registra en Caja. Actualiza CC de Clientes. Puede generar Envío. Puede generar Factura AFIP.

---

### 3.3 Gastos (`/gastos`)

Registro y seguimiento de todos los gastos del negocio.

**Tabs:**
- **Gastos**: listado de gastos variables del período (filtrado por sucursal activa)
- **Fijos**: gastos recurrentes configurados (alquiler, servicios, etc.)
- **OC**: órdenes de compra pendientes de pago (filtradas por sucursal activa via `ordenes_compra.sucursal_id`)
- **Historial**: todos los gastos con filtro de rango de fechas

**Gastos variables — acciones:**
- **+ Nuevo gasto** (esquina superior derecha): modal con título, monto, categoría de gasto, proveedor opcional, fecha, notas, medio de pago, sucursal
- **Registrar en caja**: asocia el gasto a la sesión de caja activa (egreso)
- **Editar / Eliminar**
- Gastos creados desde Recepciones tienen `recepcion_id` visible (trazabilidad de costo de mercadería)

**Gastos fijos:**
- CRUD de gastos recurrentes (nombre, monto mensual, categoría)
- Solo informativos — no se registran automáticamente en caja

**Tab OC:**
- Lista de OC activas (no canceladas) filtradas por sucursal
- Botón "Registrar pago" inline por OC

**Relaciones:** Recepciones generan gastos automáticos. Caja egresa gastos en efectivo. OC enlaza con Proveedores.

---

### 3.4 Caja (`/caja`)

Gestión del flujo de efectivo y medios de pago del negocio.

**Tabs:**
- **Caja**: operativa — estado actual de la caja seleccionada
- **Historial**: sesiones cerradas (filtrado por sucursal activa)
- **Caja Fuerte**: safe vault del negocio
- **Configuración**: crear y nombrar nuevas cajas

**Selector de caja** (superior): dropdown con todas las cajas operativas. Ícono verde = sesión abierta. Recuerda la última caja usada por usuario (localStorage).

**Con sesión cerrada muestra:**
- Botón **Abrir caja**: ingresa monto inicial. Un CAJERO con sesión ya abierta no puede abrir otra.

**Con sesión abierta muestra:**
- Saldo actual desglosado por medio de pago
- Listado de movimientos del día (ventas ingresadas + movimientos manuales)
- Total de ventas en la sesión
- Botones de acción:
  - **+ Movimiento**: ingreso o egreso manual con motivo y monto
  - **Arqueo**: conteo manual del efectivo en caja en un momento dado (registra diferencia)
  - **Traspaso**: enviar dinero a otra caja operativa (ambas deben estar abiertas)
  - **Cerrar caja**: ingresa monto real contado, muestra diferencia vs. esperado, confirma cierre con notas

**Caja Fuerte:**
- Sesión permanente (nunca se cierra)
- Solo acepta traspasos desde/hacia cajas operativas
- Muestra saldo acumulado histórico

**Historial:** sesiones cerradas con fecha, usuario que abrió/cerró, monto apertura, monto real, diferencia, movimientos detallados (expandible por sesión).

**Relaciones:** Ventas registran ingresos automáticamente. Gastos pueden egresarse. Traspasos mueven dinero entre cajas o a la caja fuerte.

---

### 3.5 Productos (`/productos`)

Catálogo base del negocio. **Global** — mismo catálogo en todas las sucursales.

**Tabs:**
- **Productos**: listado con búsqueda por nombre/SKU/código de barras
- **Estructuras**: definición de estructuras de embalaje escalonadas (unidad → caja → pallet) con dimensiones y pesos

**Listado — fila expandida al hacer clic:**
- Badge de stock disponible para venta (filtrado por sucursal activa, calculado desde `inventario_lineas`)
- Badge rojo con AlertTriangle si stock ≤ stock mínimo
- Precio de venta, precio de costo
- Categoría, SKU, código de barras
- Ícono carrito → agrega a Orden de Compra rápida
- Link "Editar" → `/productos/:id/editar`

**Acciones principales:**
- **+ Nuevo producto** (esquina superior derecha): va a `/productos/nuevo`
- **Escanear** (ícono cámara): busca por código
- **Importar** → `/importar/productos`
- **Bulk actions** (aparece al seleccionar con checkbox):
  - Cambiar precio (porcentaje o valor fijo a todos los seleccionados)
  - Cambiar proveedor asignado
  - Reactivar productos desactivados

**Formulario de producto** (`ProductoFormPage`):
- Nombre, SKU (auto-generado `calcularSiguienteSKU()` o manual), código de barras
- Categoría, proveedor
- Precio de venta, precio de costo, moneda (ARS/USD), alícuota IVA (0 / 10.5 / 21 / 27%)
- **Precios mayoristas**: tiers por cantidad mínima (ej: ≥10 unidades → $X)
- Unidad de medida (unidad, kg, g, litro, ml, metro, cm, caja, pack, docena)
- Stock mínimo global + stock mínimo por sucursal (override individual)
- Imagen: upload a Supabase Storage
- Regla de inventario: FIFO / FEFO / LEFO / LIFO / Manual
- Flags: tiene series, tiene lote, tiene vencimiento
- TiendaNube: habilitar sync, SKU TN
- MercadoLibre: habilitar sync

**Tab Estructuras — detalle:**
Cada producto puede tener una o más estructuras de embalaje. Una estructura define 3 niveles escalonados:
- **Unidad**: peso (kg), alto/ancho/largo (cm)
- **Caja**: unidades por caja, peso (kg), alto/ancho/largo (cm)
- **Pallet**: cajas por pallet, peso (kg), alto/ancho/largo (cm)

Se requieren mínimo 2 niveles activos. Se puede marcar una estructura como default. Las estructuras se asignan también a los LPNs desde el modal de acciones del LPN. Sirve para logística (cálculo de volumen, peso de embarques).

> ⚠️ Las estructuras NO son combos/kits. Los combos (bundles promocionales) se configuran en `/configuracion` → tab Combos. Los kits de armado se gestionan en Inventario → tab Kits.

**Relaciones:** base de Ventas, Inventario, Recepciones, OC. Estructuras usadas en LPNs para logística.

---

### 3.6 Inventario (`/inventario`)

Gestión integral del stock físico a nivel de LPN (License Plate Number = unidad de carga), filtrado por sucursal activa.

**Tabs:**
- **Inventario**: vista de todas las líneas de stock (LPNs) activas. Filtros: estado, ubicación, categoría, proveedor, alerta de stock crítico.
- **Agregar**: modal de ingreso de stock (= MovimientosPage en modo ingreso)
- **Quitar**: modal de rebaje de stock (= MovimientosPage en modo rebaje)
- **Kits**: gestión de armado/desarmado de kits
- **Conteo**: conteos cíclicos de inventario
- **Historial**: todos los movimientos de stock del tenant filtrados por sucursal
- **Autorizaciones**: solicitudes pendientes de aprobación (para rol DEPOSITO)

**Tab Inventario — acciones globales (esquina superior derecha):**
- **Agregar Stock**: abre tab Agregar con modal de ingreso
- **Rebaje masivo / Ingreso masivo**: `MasivoModal` — carga N productos en grilla. Soporta tanto ingreso como rebaje. El rebaje aplica FIFO/FEFO automáticamente.
- **Escanear** (ícono cámara): lee código de barras → busca LPN o producto

**Tab Inventario — acciones por LPN (modal LpnAccionesModal, 5 tabs internos):**
- **Editar**: modifica lpn, cantidad (si no tiene series), estado, ubicación, proveedor, lote, fecha de vencimiento. Si rol = DEPOSITO y cambia cantidad → crea solicitud de autorización en lugar de ejecutar.
- **Mover**: traslado parcial a otra ubicación o sucursal. Ingresa cantidad a mover + destino → crea nuevo LPN con esa cantidad.
- **Series**: para productos con series. Agregar, editar o eliminar números de serie individuales. Ver cuáles están reservadas.
- **Estructura**: asignar una de las estructuras de embalaje del producto a este LPN.
- **Eliminar**: baja del LPN. Si rol = DEPOSITO → crea solicitud de autorización. Si tiene reservas, advierte antes de eliminar.

> ⚠️ Si el LPN tiene `cantidad_reservada > 0`, solo se muestra el tab Mover (para no romper reservas activas).

**Tab Kits:**
- Definir receta de un kit (producto componente + cantidad por componente)
- **Armar kit**: consume los componentes del inventario → genera stock del kit ensamblado
- **Desarmar kit**: proceso inverso, devuelve componentes al inventario

**Tab Conteo:**
- Crear conteo cíclico (seleccionar productos a contar)
- Registrar cantidades físicamente contadas
- Ver diferencias vs. stock en sistema
- Aprobar ajuste (genera movimientos de ajuste)

**Tab Historial:**
- Todos los `movimientos_stock` filtrados por sucursal activa
- Filtros: categoría, rango de fechas, tipo de movimiento
- Muestra: producto, cantidad, tipo, usuario, LPN, fecha

**Tab Autorizaciones:**
- Lista de solicitudes pendientes generadas por usuarios DEPOSITO
- Tipos: cambio de cantidad, eliminación de LPN, cambio de serie
- Acciones: Aprobar / Rechazar (roles OWNER, SUPERVISOR, ADMIN)

**Relaciones:** Ventas consumen stock de aquí. Recepciones agregan stock. Movimientos registra cada cambio. ProductosPage calcula badge de stock disponible desde `inventario_lineas`.

---

### 3.7 Clientes (`/clientes`)

CRM básico + cuenta corriente.

**Listado:** búsqueda por nombre, email, teléfono o DNI.

**Datos de cliente:** nombre, email, teléfono, DNI/CUIT, domicilios múltiples (para envíos), CC habilitada, límite de crédito.

**Acciones principales:**
- **+ Nuevo cliente**: modal inline (nombre, email, teléfono, DNI)
- **Editar**: formulario completo con domicilios
- **Ver compras**: historial de ventas del cliente
- **WhatsApp** (ícono): abre WhatsApp con plantilla pre-cargada (número normalizado a formato internacional)
- **Gestionar CC**: panel de cuenta corriente del cliente

**Cuenta corriente:**
- Lista de deudas con fecha de vencimiento y estado
- **Registrar cobro**: asigna pago a una deuda específica
- Historial de todos los movimientos (débitos de ventas + créditos de cobros)
- Cron diario 09:00 AR detecta cuotas vencidas → notificación en campana

**Relaciones:** Ventas crea deudas en CC. Cobros reducen saldo. Envíos usan domicilios del cliente.

---

### 3.8 Envíos (`/envios`)

Gestión de despachos filtrado por sucursal activa.

**Datos de envío:** venta asociada, cliente, domicilio de entrega, método de envío, estado, número de tracking, costo, notas.

**Estados:** `pendiente → preparando → despachado → entregado → devuelto`

**Acciones:**
- **+ Nuevo envío**: desde venta existente o independiente
- **Actualizar estado**: registra cambio con timestamp
- **Imprimir etiqueta**: PDF con datos del destinatario

**Relaciones:** enlazado a Ventas. Usa domicilios de Clientes.

---

### 3.9 Facturación (`/facturacion`)

Módulo de facturación electrónica AFIP.

**Tabs:**
- **Panel**: estado de las integraciones AFIP y resumen de comprobantes emitidos
- **Emitir**: formulario para emitir comprobante manual (tipo, punto de venta, receptor, ítems, IVA)
- **Libros**: libro de IVA ventas y compras por período
- **Liquidación**: liquidación de tributos estimada (disclaimer: valores estimados)

**Tipos de comprobante:** Factura A (RI a RI), Factura B (RI a CF/Monotributista), Factura C (Monotributista emisor)

**Configuración requerida:** certificado digital .p12 + clave, CUIT, punto de venta AFIP (en `/configuracion` → tab AFIP).

**Emisión desde ventas:** también se puede emitir desde el historial de ventas directamente (acceso rápido).

**NC (Nota de Crédito):** se emite desde el flujo de devoluciones vinculadas a ventas con factura.

**Relaciones:** Ventas (emite comprobantes). Configuración (certificados y puntos de venta). Devoluciones (genera NC).

---

### 3.10 Proveedores (`/proveedores`)

Directorio de proveedores + órdenes de compra.

**Tabs:**
- **Proveedores**: listado con búsqueda
- **Órdenes de compra**: listado de OC con filtros de estado

**Datos de proveedor:** nombre, email, teléfono, CUIT, moneda de compra, días de plazo de pago, CC proveedor habilitada.

**Órdenes de compra:**
- **+ Nueva OC**: seleccionar proveedor, agregar ítems (producto + cantidad + precio unitario + notas)
- **Estados OC**: `borrador → enviada → parcialmente_recibida → recibida → cancelada`
- **Estado de pago**: `pendiente → pagado_parcial → pagado`
- **Registrar pago**: fecha, monto, medio de pago → actualiza `estado_pago` y `monto_pagado`
- **Imprimir OC**: PDF con todos los ítems
- **Generar recepción**: desde OC en estado enviada/recibida → abre RecepcionesPage precompletado

**Cuenta corriente proveedor:** historial de deudas y pagos hacia el proveedor. Balance deudor/acreedor.

**Relaciones:** OC genera Recepciones. Recepciones ingresan stock. Gastos pueden referenciar OC.

---

### 3.11 Recepciones (`/recepciones`)

Ingreso físico de mercadería, filtrado por sucursal activa.

**Listado:** proveedor, OC vinculada, fecha, estado, sucursal.

**Formulario de recepción:**
- Proveedor + OC opcional (pre-carga ítems esperados con cantidades)
- Por ítem: cantidad esperada vs. recibida (editable), precio de costo actualizable
- Campos adicionales si aplica: número de lote, fecha de vencimiento, números de serie
- Ubicación de destino en el depósito
- Sucursal destino
- Notas generales

**Al confirmar recepción:**
1. Crea `inventario_lineas` (stock físico agregado)
2. Crea `movimientos_stock` tipo ingreso
3. Si viene de OC: actualiza estado a `parcialmente_recibida` o `recibida`
4. Crea **Gasto automático** (`gastos.recepcion_id`) con el costo total de la mercadería recibida

**Relaciones:** consume OC de Proveedores. Alimenta Inventario. Genera Gasto de compra automático.

---

### 3.12 Recursos (`/recursos`)

Registro del patrimonio y activos del negocio, filtrado por sucursal activa.

**Categorías:** muebles, equipos, vehículos, tecnología, instalaciones, otros.

**Datos:** nombre, descripción, categoría, valor de adquisición, valor actual, fecha de adquisición, proveedor (opcional), sucursal, notas.

**Acciones:** + Nuevo recurso, Editar, Desactivar. Vista de valorización total del patrimonio.

---

### 3.13 Biblioteca (`/biblioteca`)

Gestor de documentos y archivos del negocio. Solo OWNER.

**Tipos de archivos:** certificado_afip_crt, certificado_afip_key, contrato, factura_proveedor, manual, otro.

**Acciones:** subir archivo (Supabase Storage), buscar por nombre, filtrar por tipo, descargar, eliminar.

**Uso principal:** almacenar certificados AFIP, contratos con proveedores, facturas recibidas, manuales.

---

### 3.14 Alertas (`/alertas`)

Centro de alertas del negocio pendientes de resolver.

**Tipos de alerta:**
- **Stock crítico**: productos con stock disponible ≤ stock mínimo → botón "Crear OC rápida"
- **Reservas viejas**: `inventario_lineas` en estado reservado por más de 3 días → botón "Revisar"
- **Productos sin categoría**: catálogo incompleto → botón "Asignar categoría"
- **Próximos a vencer**: lotes con fecha de vencimiento en los próximos días → botón "Revisar"

**Acciones:** marcar alerta como resuelta (oculta de la lista).

**Badge en sidebar:** muestra el conteo de alertas activas no resueltas.

**Relaciones:** Stock → Inventario/Productos. Reservas → Inventario. Categorías → Productos. Vencimientos → Inventario.

---

### 3.15 RRHH (`/rrhh`)

Gestión de recursos humanos. Solo OWNER (plan Pro o superior).

**Tabs:**
- **Empleados**: listado con nombre, DNI, cargo, fecha de ingreso, sucursal, sueldo base, estado
- **Nómina**: liquidaciones por período
- **Asistencia**: entradas/salidas del personal
- **Vacaciones**: solicitudes y aprobaciones
- **Capacitaciones**: registro de cursos y certificaciones
- **Feriados**: calendario de feriados configurables por país

**Empleados:** CRUD completo. Upload de documentos (contratos, certificados). Historial de cambios salariales.

**Nómina:** generar liquidación individual o masiva. Ítems: sueldo base, horas extra, descuentos, SAC. Exportar a PDF.

**Asistencia:** check-in/check-out manual. Reporte de ausencias.

**Relaciones:** independiente de los otros módulos operativos. Los empleados pueden o no tener acceso al sistema.

---

### 3.16 Historial de actividad (`/historial`)

Auditoría completa de cambios en el sistema. Acceso: Supervisor+ / Contador (plan Básico+).

**Filtros:** entidad (producto, inventario_linea, venta, gasto, usuario, etc.), acción (crear/editar/eliminar/cambio_estado), usuario, rango de fechas, texto libre.

**Muestra:** quién hizo qué, cuándo, en qué entidad, valor anterior → valor nuevo.

**Entidades auditadas:** productos, inventario, ventas, clientes, proveedores, gastos, ubicaciones, estados, categorías, usuarios, combos.

---

### 3.17 Reportes (`/reportes`)

Generador de reportes exportables. Acceso: Contador+ (plan Básico+).

**Tipos de reporte:**
- **Stock actual**: existencias por producto con precio de costo y valorización
- **Movimientos**: todos los movimientos de stock en un período
- **Ventas**: detalle de ventas con ítems, medios de pago, clientes
- **Críticos**: productos bajo stock mínimo
- **Rotación**: índice de rotación de inventario por período
- **Valorizado**: valor total del inventario a precio de costo
- **Ficha de productos**: catálogo con todos los atributos

**Formatos de exportación:** XLSX (xlsx), PDF (jsPDF + autoTable).

**Configuración:** fecha desde/hasta para todos los reportes basados en período.

---

### 3.18 Sucursales (`/sucursales`)

CRUD de sucursales del negocio. Solo OWNER.

**Datos:** nombre, dirección, teléfono, activo.

**Al crear/modificar/eliminar:** recarga `loadUserData()` para sincronizar el selector del header. Cada integración (TN, MP, ML) tiene credenciales independientes por sucursal.

---

### 3.19 Usuarios (`/usuarios`)

Gestión de accesos. Solo OWNER y ADMIN.

**Listado:** nombre, email, rol, sucursal asignada, fecha de creación. Filtro por rol.

**Por usuario (acciones inline):**
- **Selector de rol**: dropdown. Al cambiar, actualiza `puede_ver_todas` automáticamente según el nuevo rol.
- **Ícono Globe**: toggle `puede_ver_todas`. Azul = puede ver todas las sucursales. Gris = restringido. Solo visible cuando el tenant tiene sucursales.
- **Selector de sucursal** (aparece cuando Globe está gris): asigna la sucursal asignada al usuario.
- **Ícono Sliders**: modal de permisos granulares por módulo (No ver / Ver / Editar) para ese usuario.
- **Ícono Trash**: desactiva usuario (sin eliminar datos).

**Invitar usuario:** email + rol → envía email con link (Resend).

**Roles del sistema:**
| Rol | Descripción | `puedeVerTodas` por defecto |
|-----|-------------|--------------------------|
| OWNER | Dueño — acceso total | Siempre sí (hardcoded) |
| ADMIN | Administrador — acceso total | Siempre sí (hardcoded) |
| SUPERVISOR | Inventario y movimientos | Sí (configurable) |
| CONTADOR | Dashboard, gastos y reportes | Sí (configurable) |
| CAJERO | Solo ventas y caja | No (debe tener sucursal) |
| DEPOSITO | Productos e inventario | No (debe tener sucursal) |
| RRHH | Gestión de empleados | No (debe tener sucursal) |

**Roles personalizados:** sección colapsable al final. Nombre libre + permisos por módulo. Se aplican como overlay sobre el rol base.

**Relaciones:** controla acceso a todos los módulos. `puedeVerTodas` controla el selector del header y el filtro de datos en todos los módulos.

---

### 3.20 Configuración (`/configuracion`)

Setup completo del negocio y sus parámetros. Solo OWNER.

**Tabs:**
- **Negocio**: nombre, logo, tipo de comercio, CUIT, datos fiscales, contacto, moneda principal
- **Categorías**: CRUD de categorías de productos
- **Ubicaciones**: CRUD de ubicaciones del depósito. Flag `disponible_surtido`: si `false`, el stock de esa ubicación NO se considera para venta.
- **Estados de inventario**: CRUD de estados (Disponible, Cuarentena, Devuelto, etc.). Flags: `es_disponible_venta` (si ese stock puede venderse), `es_disponible_tn` (si sincroniza con TiendaNube).
- **Motivos de movimiento**: CRUD de motivos para movimientos de caja (ej: "Pago proveedor") y stock (ej: "Merma").
- **Métodos de pago**: activar/desactivar cuáles aparecen en el POS (Efectivo, Tarjeta, etc.)
- **Combos**: crear bundles promocionales para el POS. Un combo = N productos juntos con un descuento (% o monto fijo). Ej: "Combo familiar: producto A + producto B con 20% off". Se seleccionan en el POS como si fuera un ítem más. Distinto de Kits (que son ensamblados en inventario físico).
- **Integraciones**:
  - **TiendaNube**: OAuth, conectar tienda, sincronizar stock, mapear productos
  - **MercadoPago**: OAuth, conectar cuenta, gestionar suscripción Genesis360
  - **MercadoLibre**: OAuth, conectar cuenta, mapear publicaciones
  - **AFIP**: subir certificado .p12, ingresar clave privada, CUIT, puntos de venta
- **API**: generar y revocar API keys para integración de sistemas externos (solo lectura)

---

## 4. Módulos secundarios y utilidades

---

### 4.1 Movimientos de stock (`/movimientos`)

Registro directo de ingresos y rebajes. Acceso desde el módulo Inventario.

**Modalidades:**
- **Ingreso**: selecciona producto (o escanea), cantidad, estado de inventario, ubicación, proveedor (opcional), precio de costo, lote, vencimiento, series si aplica.
- **Rebaje**: selecciona producto → selecciona LPN → ingresa cantidad a rebajar → motivo.

**Características especiales:**
- Usa `useGruposEstados()` para filtrar estados disponibles según el grupo activo
- Al ingresar con series: campo para ingresar N números de serie (uno por unidad)
- Validación: no puede rebajar más que el stock disponible en ese LPN
- Integra `useSucursalFilter()` para filtrar LPNs disponibles

**Relaciones:** escribe en `inventario_lineas` + `movimientos_stock`. Referencia productos, ubicaciones, estados.

---

### 4.2 Métricas (`/metricas`)

Dashboard de métricas avanzadas con períodos flexibles.

**Períodos:** 7 días, 30 días, 90 días, mes actual, personalizado (desde/hasta).

**Métricas disponibles:**
- Ventas totales y cantidad de transacciones
- Ticket promedio
- Productos más vendidos (con filtro por categoría)
- Evolución de ventas (gráfico de barras Recharts)
- Stock valorizado
- Margen estimado

**Acceso:** Contador+. Link desde Dashboard.

---

### 4.3 Rentabilidad (`/rentabilidad`)

Análisis de rentabilidad de ventas.

**Períodos:** 7d, 30d, 90d, mes actual.

**KPIs mostrados:** ingresos, costo de ventas, margen bruto, margen %, comparativa vs. período anterior (tendencia ↑↓).

**Gráfico:** rentabilidad por producto o categoría (barras Recharts).

**Acceso:** Contador+. Link desde Dashboard o Métricas.

---

### 4.4 Recomendaciones (`/recomendaciones`)

Panel de recomendaciones inteligentes generadas por el sistema.

**Tipos (por criticidad):**
- 🔴 `danger`: acciones urgentes (stock en 0, deudas vencidas críticas)
- 🟡 `warning`: acciones preventivas (stock bajo, rotación lenta)
- 🟢 `success`: confirmaciones positivas (buenos márgenes, tendencias)
- 🔵 `info`: información de contexto

**Categorías:** stock, ventas, rentabilidad, clientes, datos, operaciones.

**Filtros:** por tipo de criticidad y por categoría.

**Acción por tarjeta:** botón de acción contextual que lleva al módulo correspondiente.

---

### 4.5 Grupos de estados (`/grupos-estados`)

Configuración de grupos de estados de inventario. Permiten filtrar visualmente qué stock es surtible en el POS y en movimientos.

**Concepto:** un grupo agrupa N estados de inventario. Al activar un grupo en el POS, el sistema solo considera stock de LPNs cuyos estados pertenezcan a ese grupo (intersectado con los estados que tienen `es_disponible_venta = true`).

**Datos:** nombre, descripción, `es_default` (el POS arranca con este grupo preseleccionado, marcado con ★), activo, lista de estados incluidos.

**Acciones:** CRUD completo, marcar como default (Star), activar/desactivar.

**Integración con el POS:**
- Si hay grupos configurados, en el POS aparece una fila de botones sobre el buscador: uno por grupo + botón "Todos".
- Al arrancar el POS se preselecciona el grupo default.
- Cambiar de grupo recarga los productos con el nuevo filtro de stock.
- "Todos" muestra stock de todos los estados disponibles para venta (sin filtro de grupo).

**Integración con Movimientos (rebaje):** el selector de grupo también aparece en el tab Quitar del inventario para filtrar desde qué estados se puede rebajar.

**Relaciones:** VentasPage (selector de grupo en POS), InventarioPage tab Quitar, MovimientosPage.

---

### 4.6 Importar Productos (`/importar/productos`)

Carga masiva del catálogo desde Excel (.xlsx).

**Columnas soportadas:** nombre, SKU, código de barras, categoría, proveedor, precio venta, precio costo, moneda (ARS/USD), alícuota IVA (0/10.5/21/27), unidad de medida, stock mínimo, regla inventario (FIFO/FEFO/LEFO/LIFO/Manual), tiene series, tiene lote, tiene vencimiento, estructura (cajas, pallets, peso, dimensiones).

**Modos:** Crear nuevos / Actualizar existentes por SKU / Ambos.

**Flujo:** subir archivo → previsualización con validaciones → columna de estado por fila (ok/error) → confirmar importación.

---

### 4.7 Importar Inventario (`/importar/inventario`)

Carga masiva de stock desde Excel.

**Columnas:** SKU, cantidad, precio de costo, ubicación, estado de inventario, proveedor (opcional), número de lote, fecha de vencimiento, LPN (opcional), motivo, números de serie (separados por coma).

**Validaciones:** producto debe existir, ubicación y estado deben existir en configuración, fecha en múltiples formatos.

**Flujo:** igual que importar productos — previsualización con errores por fila → importar.

---

### 4.8 Importar datos maestros (`/importar/master`)

Carga masiva de entidades de configuración.

**Tipos soportados:** categorías, proveedores, ubicaciones, estados de inventario, motivos de movimiento, combos, aging profiles, grupos de estados.

Cada tipo tiene su plantilla de ejemplo descargable con las columnas requeridas.

---

### 4.9 Mi Cuenta (`/mi-cuenta`)

Perfil y configuración personal del usuario.

**Secciones:**
- **Perfil**: avatar (upload a Storage), nombre de display, email, método de autenticación (email/password o Google OAuth)
- **Cambiar contraseña**: solo disponible para usuarios con login email/password
- **Plan actual**: muestra plan contratado, límites de usuarios y productos, porcentaje de uso
- **Zona peligrosa**: eliminar cuenta (requiere confirmación)

---

### 4.10 Suscripción (`/suscripcion`)

Gestión del plan de pago.

**Planes:** Free, Básico ($4.900/mes), Pro ($9.900/mes), Enterprise (a consultar).

**Acciones:**
- Suscribirse a un plan → genera link de pago MercadoPago (modelo preapproval). Redirige al checkout de MP. Al volver con `?status=approved`, verifica el pago.
- Comprar add-on de movimientos adicionales
- Cancelar suscripción

---

### 4.11 Ayuda (`/ayuda`)

Centro de soporte. **Estado actual: en desarrollo (placeholder)**.

Secciones planificadas (todas con badge "Próximamente"):
- Preguntas frecuentes
- Chat de soporte
- Buenas prácticas de uso
- Reportar un problema
- Guías interactivas
- Cursos y recursos

Por ahora solo muestra link a email de soporte.

---

### 4.12 Admin (`/admin`)

Panel de administración de la plataforma. **Solo para el rol ADMIN del sistema** (no OWNER de tenant).

**Funciones:**
- Listado de todos los tenants registrados
- Filtro por estado de suscripción (trial, active, inactive, cancelled)
- Búsqueda por nombre de negocio
- Estadísticas por tenant: cantidad de usuarios, cantidad de productos
- Editar tenant: `subscription_status`, `max_users`, `trial_days`

**No accesible** para ningún rol de tenant regular (OWNER, CAJERO, etc.).

---

### 4.13 Onboarding (`/onboarding`)

Flujo de registro inicial para nuevos tenants.

**Paso 1 — Cuenta** (se omite si viene de Google OAuth):
- Email, contraseña, nombre de display

**Paso 2 — Negocio:**
- Razón social del negocio, tipo de comercio (lista configurable), país (AR/CL/UY/MX/CO/PE), teléfono
- Opción de tipo personalizado si no está en la lista

**Al completar:** crea el tenant, inicializa grupos de estados por defecto, redirige al Dashboard.

---

## 5. Flujos y procesos transversales

### 5.1 Proceso de venta completa

```
[POS /ventas]
  Buscar producto → Verificar stock disponible por sucursal (inventario_lineas filtrado)
  Agregar al carrito → Cantidad + Precio + Descuento por línea
  Seleccionar cliente (opcional, requerido para CC)
  Elegir medios de pago (1 o múltiples) → Calcular vuelto
  Confirmar venta
    ↳ Trigger DB asigna ventas.numero
    ↳ Rebaje de stock según regla del producto (FIFO/FEFO/LIFO/etc.)
    ↳ Si sesión de caja abierta → registra movimiento de ingreso por medio de pago
    ↳ Si medio = Cuenta Corriente → genera deuda en CC del cliente
    ↳ Si integración TN/ML activa → actualiza stock en marketplace
  Opcional: Emitir factura AFIP → /facturacion
  Opcional: Crear envío → /envios
```

### 5.2 Proceso de compra (OC → Recepción → Stock)

```
[Proveedores /proveedores]
  Crear OC → Proveedor + ítems (producto/cantidad/precio)
  Estado: borrador → enviada
  Registrar pago parcial/total (opcional en este punto)

[Recepciones /recepciones]
  Vincular a OC → Pre-carga ítems esperados
  Ajustar cantidades recibidas + precios actualizados
  Asignar ubicación en depósito + sucursal destino
  Confirmar recepción
    ↳ Crea inventario_lineas (stock físico agregado)
    ↳ Crea movimientos_stock tipo ingreso
    ↳ Actualiza estado OC (parcialmente_recibida / recibida)
    ↳ Crea Gasto automático con gastos.recepcion_id (trazabilidad costo)

[Gastos /gastos]
  Gasto aparece en tab Gastos con referencia a la recepción
  Registrar pago de la OC → actualiza estado_pago en ordenes_compra
```

### 5.3 Proceso de devolución

```
[Ventas /ventas] Historial → Expandir venta → Botón "Devolución"
  Seleccionar ítems a devolver (parcial o total)
  Ingresar motivo
  Definir destino del stock → estado de inventario al volver
  Confirmar devolución
    ↳ Actualiza inventario_lineas (devuelve stock)
    ↳ Crea movimientos_stock tipo ingreso-devolucion
    ↳ Si venta tenía factura → opción de generar NC electrónica AFIP
    ↳ Ajusta saldo CC del cliente si aplica
    ↳ Ajusta ingreso en caja si aplica
```

### 5.4 Apertura / cierre de caja

```
[Caja /caja]
  Seleccionar caja operativa → Abrir sesión con monto inicial

  Durante el día (automático):
    Ventas confirmadas → ingresos por medio de pago
  
  Durante el día (manual):
    + Movimiento → ingreso o egreso manual con motivo
    Arqueo → conteo físico vs. esperado
    Traspaso → mover dinero a otra caja o a caja fuerte

  Cerrar sesión
    ↳ Ingresar monto real contado
    ↳ Ver diferencia (faltante/sobrante)
    ↳ Notas de cierre
    ↳ Sesión pasa a "cerrada" y aparece en tab Historial
```

### 5.5 Cuenta corriente (cliente)

```
[Ventas] Venta con medio "Cuenta Corriente"
  → Requiere cliente con CC habilitada
  → Genera deuda (monto + fecha de vencimiento)

[Cron pg_cron diario 09:00 AR]
  → fn_notificar_cc_vencidas() detecta cuotas vencidas
  → Crea notificación en tabla notificaciones

[Header] Campana
  → Muestra badge con cuotas vencidas

[Clientes /clientes] → Gestionar CC del cliente
  → Ver lista de deudas con estados
  → Registrar cobro → reduce saldo deudor
  → Historial completo de movimientos
```

### 5.6 Control de acceso por sucursal

```
authStore.loadUserData():
  Si rol = OWNER o ADMIN → puedeVerTodas = true (hardcoded)
  Si otro rol → puedeVerTodas = users.puede_ver_todas (DB)
  Si !puedeVerTodas → sucursalId = users.sucursal_id (ignora localStorage)

Header:
  Si puedeVerTodas → muestra selector dropdown con "Todas las sucursales"
  Si !puedeVerTodas && sucursalId → muestra nombre fijo sin dropdown
  Si !puedeVerTodas && !sucursalId → muestra "Sin sucursal" en naranja

Módulos filtrados por sucursal (usan applyFilter):
  Inventario, Movimientos, Ventas, Gastos, OC en Gastos,
  Caja (sesiones), Recepciones, Envíos, Recursos, Productos (stock badge)

Módulos globales (sin filtro):
  Catálogo Productos, Categorías, Proveedores, Clientes (directorio compartido)
```

---

## 6. Sistema de inventario avanzado (WMS)

### Modelo de datos

```
productos (catálogo)
  └── inventario_lineas (LPN = unidad física de stock)
        ├── producto_id → producto
        ├── ubicacion_id → ubicaciones
        ├── estado_id → estados_inventario
        ├── sucursal_id → sucursales
        ├── cantidad / cantidad_reservada
        ├── nro_lote / fecha_vencimiento
        └── inventario_series[] (si tiene_series)
              └── id_serie, activo, reservado
```

### Kits vs. Combos vs. Estructuras — distinción importante

| Concepto | Dónde se gestiona | Qué es |
|----------|------------------|--------|
| **Kit** (`es_kit = true`) | Inventario → tab Kits | Producto ensamblado físicamente desde componentes. Implica movimiento de inventario: consume componentes, genera stock del producto kit. |
| **Combo** | Configuración → tab Combos | Bundle promocional para POS. No implica movimiento físico. Solo define precio especial para N productos vendidos juntos (descuento % o monto). |
| **Estructura** | Productos → tab Estructuras | Embalaje logístico (unidad/caja/pallet con dimensiones y pesos). No implica stock ni precio. |

### Reglas de rebaje (orden de consumo al vender)
- **FIFO**: primer LPN creado se consume primero (por `created_at`)
- **FEFO**: LPN con vencimiento más próximo se consume primero
- **LEFO**: LPN con vencimiento más lejano se consume primero
- **LIFO**: último LPN creado se consume primero
- **Manual**: el operador elige qué LPN usar (picker en POS)

### Stock disponible para venta
Solo se computa desde LPNs donde:
- `inventario_lineas.activo = true`
- `inventario_lineas.estado_id` tiene `es_disponible_venta = true`
- `ubicaciones.disponible_surtido = true`
- Filtrado por `sucursal_id` si hay sucursal activa

### Stock que aparece en TiendaNube
LPNs donde `estado_id` tiene `es_disponible_tn = true`.

---

## 7. Sistema de alertas y notificaciones

### Campana del header
- `notificaciones` tabla: registros por tenant con `leido`, `tipo`, `mensaje`
- Badge = conteo de no leídas
- Al hacer clic → panel desplegable con listado. Marcar como leída/todas.

### Alertas automáticas (pg_cron)
| Cron | Frecuencia | Función |
|------|------------|---------|
| `notif-cc-vencidas` | Diario 09:00 AR | Detecta cuotas CC vencidas → genera notificaciones |
| `tn-stock-sync` | Cada 5 min | Sincroniza stock disponible con TiendaNube |
| `meli-stock-sync` | Cada 5 min | Sincroniza stock con MercadoLibre |

### Página Alertas (`/alertas`)
Alertas operativas sin resolver: stock crítico, reservas antiguas, productos sin categoría, próximos a vencer. Cada alerta tiene acción contextual y botón "Resolver".

---

## 8. Integraciones activas

### TiendaNube
- OAuth por sucursal. Sync stock bidireccional (cron + webhook desde TN).
- Ventas de TN se registran en `ventas_externas_logs` (no como ventas normales).
- Mapeo producto G360 ↔ producto TN en `tn_product_mappings`.
- Estados con `es_disponible_tn = true` determinan qué stock se publica.

### MercadoLibre
- OAuth por sucursal. Sync stock (cron cada 5 min).
- Mapeo publicación ML ↔ producto G360 en `meli_listings`.

### MercadoPago
- OAuth por sucursal. Procesamiento de pagos en POS.
- Gestión de suscripciones Genesis360 (modelo preapproval — `init_point` construido en frontend).

### Resend
- Invitaciones de usuario, notificaciones de sistema.
- Template `bug_report`: conversación del asistente IA → email al admin.
- FROM pendiente configurar a `noreply@genesis360.pro`.

### AFIP (parcial)
- Configuración de certificados en `/configuracion`.
- Generación de PDF con QR AFIP (RG 4291) desde ventas.
- Worker de emisión electrónica: pendiente completar.

### API externa
- `api_keys` table: claves generadas en `/configuracion` → tab API.
- `data-api` Edge Function: permite consultas de datos por sistemas externos (solo lectura).

---

## 9. Planes y límites

| Plan | Usuarios | Productos | Features extra | Precio |
|------|----------|-----------|----------------|--------|
| Free | 1 | 50 | — | $0 |
| Básico | 2 | 500 | Historial, Reportes | $4.900/mes |
| Pro | 10 | 5.000 | + RRHH, Métricas avanzadas | $9.900/mes |
| Enterprise | ∞ | ∞ | Todo incluido | A consultar |

- `usePlanLimits()`: hook que calcula límites y porcentajes de uso
- `<UpgradePrompt />`: bloquea el módulo con un CTA de upgrade cuando se alcanza el límite
- Early returns con `<UpgradePrompt />` siempre DESPUÉS de todos los hooks del componente

---

## 10. Seguridad y autenticación

### Autenticación
- **Email/contraseña**: registro directo o por invitación (link en email)
- **Google OAuth**: `loadUserData()` se llama ANTES de `navigate('/dashboard')` para que Zustand tenga los datos del tenant

### Onboarding
- Paso 1: crear cuenta (omitido con Google OAuth)
- Paso 2: crear negocio → genera tenant, crea user con rol OWNER, inicializa estados por defecto

### RLS (Row Level Security)
- Todas las tablas: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- Helper functions `SECURITY DEFINER`: `is_admin()`, `is_rrhh()`
- 7 warnings de Security Advisor aceptados por diseño (documentados)

### Control de acceso por rol
```
OWNER/ADMIN: acceso total
SUPERVISOR: sin /configuracion, /usuarios, /sucursales, /rrhh
CONTADOR: solo /dashboard, /gastos, /reportes, /historial, /metricas
CAJERO: solo /ventas, /caja, /clientes, /envios
DEPOSITO: solo /inventario, /productos, /alertas, /recepciones
```
Permisos granulares por módulo overrideables por usuario individual (Sliders en Usuarios).

### Session timeout
- `useInactivityTimeout()`: bloquea la app por inactividad. Muestra modal de re-autenticación.

---

*Última actualización: 2026-05-08 — v1.8.4 DEV / v1.8.3 PROD*
