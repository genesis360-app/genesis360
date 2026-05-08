---
title: Referencia completa de funcionalidades — Genesis360
category: overview
tags: [referencia, módulos, funcionalidades, procesos, flujos]
updated: 2026-05-08
---

# Genesis360 — Referencia completa de funcionalidades

> Documento de contexto para IA y equipo. Describe todos los módulos, acciones, flujos y relaciones entre partes de la app.
> Actualizar cada vez que se agregue o modifique una funcionalidad relevante.

---

## 1. Concepto general

Genesis360 es el **sistema operativo del negocio físico**. No solo muestra datos: indica qué hacer y cuándo. Está orientado a comercios con stock, ventas presenciales, múltiples empleados y/o múltiples sucursales.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Multi-tenant:** cada negocio (tenant) tiene datos completamente aislados via RLS
- **Multi-sucursal:** cada módulo operativo filtra por sucursal activa

---

## 2. Navegación y estructura de la app

### Sidebar izquierdo (orden real)
| Ítem | Ruta | Módulo |
|------|------|--------|
| Dashboard | `/dashboard` | Métricas y alertas |
| Inventario | `/inventario` | Stock por LPN/ubicación |
| Productos | `/productos` | Catálogo de productos |
| Ventas | `/ventas` | POS / caja registradora |
| Clientes | `/clientes` | CRM + cuenta corriente |
| Proveedores | `/proveedores` | Proveedores + OC |
| Recepciones | `/recepciones` | Ingreso de mercadería |
| Gastos | `/gastos` | Gastos operativos |
| Caja | `/caja` | Gestión de caja |
| Envíos | `/envios` | Logística de envíos |
| Recursos | `/recursos` | Activos del negocio |
| RRHH | `/rrhh` | Empleados y nómina |
| Configuración | `/configuracion` | Setup del negocio |

### Header
- **Selector de sucursal** (izquierda): dropdown con todas las sucursales + "Todas las sucursales". Solo visible para usuarios con `puedeVerTodas = true`. Usuarios restringidos ven el nombre fijo de su sucursal.
- **Refresh manual**: recarga datos de la página actual
- **Asistente IA**: panel flotante de chat (Groq/Llama 3.1, gratis). Responde preguntas sobre la app y guía al usuario. Tiene flujo de bug report que envía email al admin.
- **Campana de notificaciones**: alertas de stock crítico y cuentas corrientes vencidas
- **Dark/Light mode**
- **Botón ayuda** (`/ayuda`): FAQ y guías
- **Configuración** (engranaje): acceso rápido a `/configuracion`
- **Avatar / dropdown**: perfil, cerrar sesión

---

## 3. Módulos

---

### 3.1 Dashboard (`/dashboard`)

Vista de control general del negocio.

**Secciones:**
- **KPIs del día**: ventas del día, cantidad de transacciones, ticket promedio, margen estimado
- **Alertas activas**: productos con stock crítico (≤ stock mínimo), cuotas de cuentas corrientes vencidas
- **Gráfico de ventas**: evolución diaria/semanal/mensual (recharts)
- **Últimas ventas**: listado con monto, cliente, fecha
- **Top productos**: más vendidos del período

**Relaciones:** consume datos de ventas, inventario, clientes (CC), notificaciones.

---

### 3.2 Inventario (`/inventario`)

Gestión del stock físico a nivel de LPN (License Plate Number = unidad de carga).

**Tabs:**
- **Stock**: vista por producto → stock disponible para venta, stock total, stock mínimo, alertas
- **LPNs**: listado de todas las líneas de inventario activas con filtros por estado, ubicación, producto

**Acciones principales:**
- **Agregar Stock** (esquina superior derecha): modal de ingreso de stock. Selecciona producto, cantidad, estado, ubicación, lote/vencimiento/series si aplica. Crea `inventario_lineas` + `movimientos_stock`.
- **Rebaje Manual**: reducir stock de un LPN. Selecciona cantidad a rebajar, motivo.
- **Mover LPN**: cambiar ubicación y/o sucursal de un LPN.
- **Dividir LPN**: partir una línea de inventario en dos (útil para despacho parcial).
- **Transferir entre sucursales**: mover stock de una sucursal a otra (crea movimiento de salida + entrada).
- **Escanear**: modal de cámara para leer código de barras/QR y buscar el LPN o producto.
- **Ingreso masivo**: `MasivoModal` — carga N productos de una vez (CSV o grilla).
- **Acciones LPN** (botón expandido por LPN): ver historial, ajustar, dividir, mover, transferir.

**Filtros disponibles:** sucursal activa, estado de inventario, categoría, producto, ubicación, alerta de stock.

**Relaciones:** Ventas consume stock de aquí. Recepciones agrega stock aquí. Movimientos registra cada cambio.

---

### 3.3 Productos (`/productos`)

Catálogo base del negocio. Global (no filtra por sucursal — mismo catálogo en todas las sucursales).

**Tabs:**
- **Productos**: listado con búsqueda, badge de stock disponible, badge rojo si crítico
- **Estructuras**: combos/kits — define qué productos componen un producto estructurado

**Vista de producto (expandido al hacer clic):**
- Stock disponible para venta (filtrado por sucursal activa)
- Precio de venta / precio de costo
- Categoría, SKU, código de barras
- Botón carrito → agregar a Orden de Compra rápida

**Acciones principales:**
- **+ Nuevo producto** (esquina superior derecha): va a `/productos/nuevo`
- **Editar** (link en fila expandida): va a `/productos/:id/editar`
- **Bulk actions** (selección múltiple):
  - Cambiar precio (% o valor fijo)
  - Cambiar proveedor
  - Reactivar productos desactivados
- **Escanear código de barras**: busca producto por código
- **Importar CSV**: carga masiva de productos

**Formulario de producto** (`/productos/:id/editar` o `/productos/nuevo`):
- Datos básicos: nombre, SKU (auto-generado o manual), código de barras, categoría, proveedor
- Precios: precio de venta, precio de costo, moneda (ARS/USD), alícuota IVA
- Precios mayoristas: tiers por cantidad (ej: 10+ unidades → precio X)
- Stock: stock mínimo, stock mínimo por sucursal (override)
- Control de inventario: regla (FIFO/FEFO/LEFO/LIFO/Manual), tiene series, tiene lote, tiene vencimiento
- Imagen: upload a Supabase Storage
- Unidad de medida
- TiendaNube: habilitar sincronización, SKU TN
- MercadoLibre: habilitar sincronización

**Relaciones:** base de Ventas, Inventario, Recepciones, OC. Estructura define kits/combos.

---

### 3.4 Ventas / POS (`/ventas`)

Caja registradora principal. Permite hacer ventas, presupuestos y gestionar devoluciones.

**Tabs:**
- **Nueva venta** (pantalla principal de POS)
- **Historial**: listado de ventas filtrado por sucursal activa, fecha, estado
- **Presupuestos**: ventas en estado borrador/presupuesto

**Pantalla de POS:**
- **Buscador de productos** (superior): busca por nombre, SKU o código de barras. Muestra stock disponible por sucursal activa. Filtro por grupo/estado de inventario.
- **Galería / lista**: toggle de vista de productos
- **Carrito** (derecha o inferior): líneas con producto, cantidad, precio unitario, descuento por línea
- **Descuento global**: campo de descuento sobre el total (% o monto fijo)
- **Cliente**: buscador/selector de cliente. Botón "+" para crear cliente nuevo inline
- **Medios de pago**: múltiples medios (Efectivo, Tarjeta, Transferencia, MercadoPago, Cheque, Cuenta Corriente, Seña). Cada uno con monto asignable → calcula vuelto automáticamente.
- **Notas**: campo libre por venta
- **Modo venta**: Venta normal / Presupuesto / Solo reserva
- **Confirmar venta**: genera número automático (trigger DB), descuenta stock según regla (FIFO/FEFO/etc.), registra en caja si hay sesión abierta.

**Acciones en historial:**
- Ver detalle (panel expandido): ítems, medios de pago, datos del cliente, número de venta
- Imprimir ticket PDF
- Emitir factura AFIP (A/B/C)
- Registrar devolución parcial o total
- Anular venta

**Venta a cuenta corriente:** si se usa medio "Cuenta Corriente", genera deuda en `ventas.es_cuenta_corriente`. El cliente debe tener CC habilitada.

**Escaneo en POS:** botón de cámara → lee código → agrega producto al carrito automáticamente.

**Relaciones:** descuenta stock en Inventario. Genera movimiento en Caja (si hay sesión). Actualiza saldo de CC del cliente. Puede generar Envío asociado. Puede generar Factura AFIP.

---

### 3.5 Clientes (`/clientes`)

CRM básico + gestión de cuentas corrientes.

**Tabs:**
- **Clientes**: listado con búsqueda por nombre/email/teléfono/DNI
- **Cuenta corriente** (por cliente): historial de deudas y pagos

**Datos de cliente:**
- Nombre, email, teléfono, DNI/CUIT
- Dirección/domicilios (múltiples, para envíos)
- Cuenta corriente habilitada (toggle)
- Límite de crédito

**Acciones principales:**
- **+ Nuevo cliente**: modal inline con nombre, email, teléfono, DNI
- **Editar cliente**: formulario completo
- **Ver historial de compras**: ventas asociadas al cliente
- **Gestionar CC**: registrar pago, ver saldo, historial de movimientos
- **Enviar WhatsApp**: abre WhatsApp con plantilla pre-cargada (número normalizado)

**Cuenta corriente:**
- Lista de cuotas/deudas con fecha de vencimiento
- Alerta automática (pg_cron diario 09:00 AR) cuando hay cuotas vencidas → notificación en campana
- Registrar cobro: asocia pago a deuda específica

**Relaciones:** Ventas crea/consulta clientes. CC se actualiza con ventas y pagos. Envíos usan domicilios del cliente.

---

### 3.6 Proveedores (`/proveedores`)

Directorio de proveedores + gestión de órdenes de compra.

**Tabs:**
- **Proveedores**: listado con búsqueda
- **Órdenes de compra** (`/ordenes-compra`): listado de OC con estados

**Datos de proveedor:**
- Nombre, email, teléfono, CUIT
- Moneda de compra, condiciones de pago (días plazo)
- Cuenta corriente proveedor (habilitada/no)

**Órdenes de compra:**
- Crear OC: seleccionar proveedor, agregar ítems (producto + cantidad + precio unitario)
- Estados: `borrador → enviada → parcialmente_recibida → recibida → cancelada`
- Estado de pago: `pendiente → pagado_parcial → pagado`
- Registrar pagos al proveedor (con fecha y monto)
- Imprimir OC en PDF
- Al recibir → genera Recepción automáticamente o manual

**Cuenta corriente proveedor:**
- Historial de deudas y pagos hacia el proveedor
- Balance deudor/acreedor

**Relaciones:** OC genera Recepciones. Recepciones ingresan stock en Inventario. Gastos pueden vincularse a una OC (trazabilidad).

---

### 3.7 Recepciones (`/recepciones`)

Recepción de mercadería contra órdenes de compra o sin OC.

**Vista lista:** historial de recepciones filtrado por sucursal activa, con proveedor, fecha, estado.

**Formulario de recepción:**
- Seleccionar proveedor y OC opcional (pre-carga los ítems esperados)
- Por cada ítem: cantidad esperada vs. cantidad recibida, precio de costo actualizable
- Campos adicionales: número de lote, fecha de vencimiento, series (si el producto lo requiere)
- Seleccionar ubicación de destino en el depósito
- Sucursal destino
- Notas

**Al confirmar recepción:**
1. Crea líneas en `inventario_lineas` (agrega stock)
2. Crea `movimientos_stock` tipo ingreso
3. Si viene de OC: actualiza estado de la OC
4. **Crea Gasto automático** (migration 090): registra el costo de la mercadería como gasto con trazabilidad `gastos.recepcion_id`

**Relaciones:** consume OC de Proveedores. Alimenta Inventario. Genera Gasto automático.

---

### 3.8 Gastos (`/gastos`)

Registro y seguimiento de gastos del negocio.

**Tabs:**
- **Gastos**: listado de gastos variables del período (filtrado por sucursal activa)
- **Fijos**: gastos recurrentes del negocio (alquileres, servicios, etc.)
- **OC**: órdenes de compra pendientes de pago (filtrado por sucursal activa)
- **Historial**: todos los gastos con filtro de fecha

**Gastos variables:**
- Crear gasto: título, monto, categoría, proveedor (opcional), fecha, notas, medio de pago
- Gastos creados automáticamente desde Recepciones tienen `recepcion_id` (trazabilidad)
- Registrar en caja: asocia el gasto a la sesión de caja activa

**Gastos fijos:**
- CRUD de gastos recurrentes con monto mensual
- No se registran automáticamente en caja

**Tab OC (órdenes de compra):**
- Lista de OC pendientes de pago filtradas por sucursal activa
- Registrar pago directo desde esta vista

**Relaciones:** Recepciones crean gastos automáticos. Caja puede registrar pagos de gastos. OC enlaza con Proveedores.

---

### 3.9 Caja (`/caja`)

Gestión del flujo de efectivo y medios de pago del negocio.

**Tabs:**
- **Caja** (operativa): estado actual de la caja seleccionada
- **Historial**: sesiones cerradas (filtrado por sucursal activa)
- **Caja Fuerte**: depósitos y retiros al safe vault del negocio
- **Configuración**: crear nuevas cajas, configurar nombres

**Selector de caja:** dropdown con todas las cajas operativas de la sucursal activa. Muestra indicador verde si está abierta.

**Sesión de caja:**
- **Abrir caja**: monto de apertura (dinero inicial). Un CAJERO no puede abrir segunda caja si ya tiene una abierta.
- **Cerrar caja**: monto real en caja, notas de cierre. Muestra diferencia vs. monto esperado.
- **Movimientos**: ingresos/egresos manuales (ej: pagar proveedor en efectivo, cambio de caja)
- **Arqueo**: conteo manual del efectivo en caja en un momento dado
- **Traspaso**: enviar dinero de una caja a otra (ambas deben estar abiertas)

**Durante sesión abierta muestra:**
- Saldo actual por medio de pago (Efectivo, Tarjeta, etc.)
- Lista de movimientos del día
- Total de ventas registradas

**Caja Fuerte:**
- Sesión permanente (siempre abierta)
- Solo acepta Depósito y Retiro (tipo traspaso desde/hacia cajas operativas)
- Muestra saldo acumulado de traspasos

**Relaciones:** Ventas registran ingresos en caja automáticamente. Gastos pueden egresarse de caja. Traspasos mueven dinero entre cajas o hacia la caja fuerte.

---

### 3.10 Envíos (`/envios`)

Gestión de despachos y logística de los pedidos.

**Vista lista:** historial de envíos filtrado por sucursal activa.

**Datos de envío:**
- Venta asociada, cliente, domicilio de entrega
- Método de envío (correo, moto, retiro en local, etc.)
- Estado: `pendiente → preparando → despachado → entregado → devuelto`
- Número de tracking
- Costo de envío
- Notas

**Acciones:**
- **Nuevo envío**: crear desde una venta existente o independiente
- **Actualizar estado**: cambio de estado con fecha/hora
- **Imprimir etiqueta**: genera PDF con datos del destinatario

**Relaciones:** enlazado a Ventas (una venta puede tener un envío). Usa domicilios de Clientes.

---

### 3.11 Recursos (`/recursos`)

Registro del patrimonio y activos del negocio.

**Categorías de recursos:** muebles, equipos, vehículos, tecnología, instalaciones, otros.

**Datos de recurso:**
- Nombre, descripción, categoría
- Valor de adquisición, valor actual
- Fecha de adquisición
- Proveedor (opcional)
- Sucursal asignada
- Notas

**Acciones:**
- **+ Nuevo recurso**: formulario completo
- **Editar / Desactivar**
- Vista de valorización total del patrimonio

**Relaciones:** independiente. Se usa para reportes de activos.

---

### 3.12 RRHH (`/rrhh`)

Gestión de recursos humanos del negocio.

**Tabs:**
- **Empleados**: listado con nombre, cargo, sucursal, estado
- **Nómina**: liquidaciones de sueldo por período
- **Asistencia**: registro de entradas/salidas (manual o con código)
- **Vacaciones**: solicitudes y aprobación de vacaciones
- **Capacitaciones**: cursos y certificaciones del personal
- **Feriados**: calendario de feriados configurables

**Empleados:**
- Datos: nombre, DNI, cargo, fecha de ingreso, sucursal, sueldo base
- Documentos: upload de contratos, certificados
- Historial de cambios salariales

**Nómina:**
- Generar liquidación por empleado o masiva
- Ítems: sueldo base, horas extra, descuentos, SAC
- Medio de pago de nómina
- Exportar a PDF

**Asistencia:**
- Check-in / Check-out manual o con QR personal
- Reporte de ausencias

**Relaciones:** relativamente independiente. Los empleados pueden ser los mismos `users` del sistema o personas sin acceso al sistema.

---

### 3.13 Configuración (`/configuracion`)

Setup completo del negocio y sus parámetros.

**Tabs:**
- **Negocio**: nombre, logo, tipo de comercio, CUIT, datos fiscales, datos de contacto, moneda principal
- **Categorías**: CRUD de categorías de productos
- **Ubicaciones**: CRUD de ubicaciones del depósito (estanterías, zonas). Cada una tiene `disponible_surtido` (si se puede surtir venta desde ahí)
- **Estados de inventario**: CRUD de estados (Disponible, Cuarentena, Devuelto, etc.). Cada uno tiene flags: `es_disponible_venta`, `es_disponible_tn` (TiendaNube)
- **Motivos de movimiento**: CRUD de motivos para movimientos de caja y stock
- **Métodos de pago**: activar/desactivar medios de pago disponibles en POS
- **Combos/Kits**: crear productos compuestos (un combo = N productos)
- **Integraciones**:
  - **TiendaNube**: conectar tienda, sincronizar stock, mapear productos
  - **MercadoPago**: conectar cuenta, configurar suscripción del plan Genesis360
  - **MercadoLibre**: conectar cuenta, sincronizar publicaciones y stock
  - **AFIP**: configurar certificados digitales, puntos de venta, CUIT
- **API**: generar API keys para integración externa (pull de datos)

**Relaciones:** los datos configurados aquí se usan en todos los módulos (categorías → Productos, ubicaciones → Inventario, estados → Inventario, etc.).

---

### 3.14 Usuarios (`/usuarios`)

Gestión de accesos al sistema. Solo accesible para OWNER y ADMIN.

**Secciones:**
- **Listado de usuarios activos**: nombre, email, rol, sucursal asignada, fecha de creación
- **Roles personalizados**: crear roles con permisos granulares por módulo

**Acciones por usuario:**
- **Cambiar rol**: dropdown con todos los roles disponibles. Al cambiar, actualiza `puede_ver_todas` automáticamente según el rol.
- **Toggle Globe** (ícono): activa/desactiva vista global de sucursales para ese usuario. Azul = puede ver todas. Gris = restringido a su sucursal.
- **Selector sucursal** (aparece cuando Globe está desactivado): asignar la sucursal del usuario
- **Permisos por módulo** (ícono Sliders): override de permisos a nivel módulo para ese usuario específico. Cada módulo puede tener: No ver / Ver / Editar.
- **Desactivar usuario**: elimina el acceso (no borra datos)

**Invitar usuario:**
- Campo email + selector de rol
- Envía email de invitación (Resend) con link para crear contraseña

**Roles del sistema:**
| Rol | Descripción | Vista global por defecto |
|-----|-------------|--------------------------|
| OWNER | Dueño — acceso total | Sí (no configurable) |
| ADMIN | Admin — acceso total | Sí (no configurable) |
| SUPERVISOR | Inventario y movimientos | Sí (configurable) |
| CONTADOR | Dashboard, gastos y reportes | Sí (configurable) |
| CAJERO | Solo ventas y caja | No (debe tener sucursal asignada) |
| DEPOSITO | Productos e inventario | No (debe tener sucursal asignada) |
| RRHH | Gestión de empleados | No (debe tener sucursal asignada) |

**Roles personalizados:** nombre libre + permisos granulares por módulo. Se asignan como overlay sobre el rol base.

**Relaciones:** los roles controlan qué menú ve cada usuario (`AuthGuard`, `SubscriptionGuard`). `puedeVerTodas` controla el selector del header y el filtro de datos.

---

### 3.15 Sucursales (`/sucursales`)

CRUD de sucursales. Solo accesible para OWNER.

**Datos de sucursal:** nombre, dirección, teléfono, activo.

**Comportamiento:**
- Al crear/modificar/eliminar una sucursal, se recarga `loadUserData()` para sincronizar el selector del header.
- Cada integración (TN, MP, ML) tiene credenciales independientes por sucursal.

---

## 4. Flujos y procesos transversales

### 4.1 Proceso de venta completa

```
[POS] Buscar producto
  → Verificar stock disponible en inventario_lineas (filtrado por sucursal)
  → Agregar al carrito con cantidad y precio
  → Seleccionar cliente (opcional)
  → Elegir medios de pago (uno o múltiples)
  → Confirmar venta
    → Trigger DB asigna número de venta
    → Rebaje de stock (FIFO/FEFO/LIFO/Manual según regla)
    → Si hay sesión de caja abierta: registra movimiento de ingreso
    → Si medio de pago = Cuenta Corriente: genera deuda en CC del cliente
    → Si hay integración TN/ML: actualiza stock en marketplace
  → Opcional: emitir factura AFIP
  → Opcional: crear envío
```

### 4.2 Proceso de compra (OC → Recepción → Stock)

```
[Proveedores] Crear OC
  → Seleccionar proveedor
  → Agregar ítems (producto + cantidad + precio)
  → Estado: borrador → enviada
  → Opcional: registrar pago parcial/total

[Recepciones] Recepcionar mercadería
  → Vincular a OC (carga ítems esperados automáticamente)
  → Ajustar cantidades recibidas, precios actualizados
  → Asignar ubicación en depósito
  → Confirmar recepción
    → Crea inventario_lineas (agrega stock)
    → Crea movimientos_stock tipo ingreso
    → Actualiza estado de OC (parcialmente recibida / recibida)
    → Crea Gasto automático con recepcion_id (trazabilidad costo)
```

### 4.3 Proceso de devolución

```
[Ventas] Historial → Ver venta → Registrar devolución
  → Seleccionar ítems a devolver (parcial o total)
  → Motivo de devolución
  → Destino del stock: vuelve a inventario (en qué estado)
  → Genera NC (Nota de Crédito) AFIP si la venta tenía factura
  → Actualiza stock en inventario_lineas
  → Registra movimiento de stock tipo ingreso
  → Ajusta saldo de CC del cliente si aplica
```

### 4.4 Proceso de apertura/cierre de caja

```
[Caja] Abrir sesión
  → Ingresar monto inicial (efectivo en caja)
  → Queda registrado con usuario y timestamp

Durante el día:
  → Ventas generan ingresos automáticos por medio de pago
  → Gastos en efectivo generan egresos manuales
  → Movimientos manuales (retiros, cambio de caja)
  → Traspasos a/desde caja fuerte

[Caja] Cerrar sesión
  → Contar dinero real en caja
  → Sistema muestra diferencia vs. esperado
  → Cerrar con notas
  → Sesión queda en historial (tab Historial, filtrado por sucursal)
```

### 4.5 Proceso de cuenta corriente (cliente)

```
[Ventas] Venta con medio "Cuenta Corriente"
  → Genera deuda en ventas.es_cuenta_corriente = true
  → El cliente acumula saldo deudor

[Notificaciones] Cron diario 09:00 AR
  → fn_notificar_cc_vencidas() detecta cuotas vencidas
  → Genera notificación en campana para el OWNER/ADMIN

[Clientes] Gestionar CC
  → Ver saldo y deudas del cliente
  → Registrar cobro: reduce el saldo deudor
  → Historial de todos los movimientos de CC
```

### 4.6 Control de stock multi-sucursal

```
Inventario filtrado: todos los queries de stock usan applyFilter(query)
  → Si sucursalId activo: .eq('sucursal_id', sucursalId)
  → Si vista global: sin filtro (ve todo el tenant)

Módulos filtrados por sucursal:
  - Inventario (lineas y movimientos)
  - Ventas (historial + stock disponible en carrito)
  - Gastos (listado + OC)
  - Caja (sesiones abiertas, historial)
  - Recepciones (listado)
  - Envíos (listado)
  - Recursos (listado)
  - Productos (badge de stock disponible — calculado sobre inventario_lineas filtrado)

Módulos globales (sin filtro de sucursal):
  - Catálogo Productos (mismos productos en todas las sucursales)
  - Categorías, Proveedores, Clientes (directorio compartido)
```

---

## 5. Sistema de inventario avanzado (WMS)

### Modelo de datos
- **Producto**: catálogo base (precio, SKU, descripción)
- **inventario_lineas (LPN)**: unidad física de stock. Un producto puede tener N LPNs en N ubicaciones y estados.
- **ubicaciones**: lugares físicos del depósito. Cada uno tiene `disponible_surtido`.
- **estados_inventario**: estado del stock (Disponible, Cuarentena, etc.). Cada uno tiene `es_disponible_venta`.

### Reglas de rebaje (orden de consumo)
- **FIFO**: el primero en entrar es el primero en salir (por fecha de ingreso)
- **FEFO**: el que vence primero sale primero (requiere fecha de vencimiento)
- **LEFO**: el que vence último sale primero
- **LIFO**: el último en entrar sale primero
- **Manual**: el operador elige qué LPN usar

### Control de series
Productos con `tiene_series = true` requieren número de serie por unidad. Las series se rastrean individualmente en `inventario_series`.

### Control de lotes/vencimientos
Productos con `tiene_lote` o `tiene_vencimiento` agrupan unidades por lote o fecha de vencimiento.

---

## 6. Facturación AFIP (RG 4291)

- **Tipos de comprobante**: Factura A (1), B (6), C (11), NC-A (3), NC-B (8), NC-C (13)
- **QR AFIP**: generado en PDF con `btoa(JSON.stringify(payload))` → URL `https://www.afip.gob.ar/fe/qr/?p=<base64>`
- **Configuración**: certificado digital (.p12), clave privada, CUIT, puntos de venta
- **Emisión**: desde historial de ventas → botón "Emitir factura" → genera PDF A4 con todos los campos requeridos
- **NC electrónicas**: desde devoluciones vinculadas a ventas con factura

---

## 7. Integraciones activas

### TiendaNube
- Sincronización de stock bidireccional (pg_cron cada 5 min + webhook)
- Mapeo de productos G360 ↔ TN
- Ventas de TN se registran como `ventas_externas_logs`
- Credenciales por sucursal

### MercadoLibre
- Sincronización de stock (pg_cron cada 5 min)
- Mapeo de publicaciones ML ↔ productos G360
- Credenciales por sucursal

### MercadoPago
- Procesamiento de pagos en POS (link de pago)
- Gestión de suscripciones del plan Genesis360 (modelo preapproval)
- Credenciales por sucursal

### Resend (email)
- Envío de invitaciones de usuario
- Notificaciones automáticas
- Template `bug_report`: envía conversación del asistente IA al admin

### API externa (pull)
- `api_keys` table: claves para acceso externo de solo lectura
- Permite consultar datos desde sistemas externos vía `data-api` Edge Function

---

## 8. Sistema de alertas y notificaciones

### Campana (header)
- Alertas de stock crítico: productos por debajo del stock mínimo
- Alertas de CC vencidas: cuotas de cuentas corrientes con fecha de vencimiento pasada
- Las notificaciones se generan en tabla `notificaciones` y se marcan como leídas

### Alertas automáticas (pg_cron)
- `notif-cc-vencidas`: diario 09:00 AR → `fn_notificar_cc_vencidas()`
- `tn-stock-sync`: cada 5 min → sincroniza stock con TiendaNube
- `meli-stock-sync`: cada 5 min → sincroniza stock con MercadoLibre

---

## 9. Planes y límites

| Plan | Usuarios | Productos | Precio |
|------|----------|-----------|--------|
| Free | 1 | 50 | $0 |
| Básico | 2 | 500 | $4.900/mes |
| Pro | 10 | 5.000 | $9.900/mes |
| Enterprise | ∞ | ∞ | A consultar |

- Los límites se chequean con `usePlanLimits` y bloquean con `<UpgradePrompt />` cuando se alcanza el límite.
- El upgrade redirige al flujo de pago con MercadoPago (suscripción preapproval).

---

## 10. Seguridad y accesos

### RLS (Row Level Security)
- Todas las tablas tienen RLS habilitado
- Patrón: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- Helper functions `SECURITY DEFINER`: `is_admin()`, `is_rrhh()`

### Roles y visibilidad de menú
- El sidebar muestra/oculta ítems según el rol del usuario (AuthGuard)
- Los módulos con `ownerOnly: true` requieren OWNER o ADMIN
- Los módulos con `supervisorOnly: true` requieren OWNER, SUPERVISOR o ADMIN
- Permisos granulares por módulo overrideables por usuario individual

### Timeout de sesión
- Inactividad configurable (hook `useInactivityTimeout`)
- Bloquea la app y requiere re-autenticación

---

*Última actualización: 2026-05-08 — v1.8.4 DEV / v1.8.3 PROD*
