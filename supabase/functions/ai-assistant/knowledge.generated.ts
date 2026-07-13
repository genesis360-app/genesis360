// ⚠ ARCHIVO GENERADO por scripts/build-ai-knowledge.mjs — NO EDITAR A MANO.
// Fuente: G360.Wiki/wiki/overview/app-reference.md (el wiki es la única fuente de verdad).
// Regenerar tras actualizar el wiki y redeployar la EF ai-assistant.

export interface KnowledgeSection {
  id: string
  titulo: string
  ruta: string | null
  keywords: string[]
  contenido: string
}

export const KNOWLEDGE_GENERATED_AT = "2026-07-13T17:31:23.671Z"

export const KNOWLEDGE_SECTIONS: KnowledgeSection[] = [
  {
    "id": "3.1",
    "titulo": "Dashboard",
    "ruta": "/dashboard",
    "keywords": [
      "dashboard",
      "inicio",
      "kpi",
      "resumen",
      "tablero",
      "metricas del negocio"
    ],
    "contenido": "Vista de control general del negocio, organizada en **áreas** (Todo + una por módulo), cada una con **5 sub-pestañas uniformes**. Un **filtro unificado de Período/Moneda** (arriba) gobierna las áreas con período. Filtra por sucursal activa con filtro inclusivo (sucursal seleccionada + datos históricos sin sucursal asignada).\n\n**Áreas:** Todo · Ventas · Gastos · Productos · Inventario · Clientes · Proveedores · Facturación · Envíos · Marketing (Envíos solo en modo avanzado).\n\n**Sub-pestañas por área** (landing = **Gráficos**):\n\n| Sub-pestaña | Contenido |\n|-------------|-----------|\n| **Gráficos** | Primera y por defecto: todos los gráficos del área. En \"Todo\" muestra General (La Balanza + Mix de Caja) + una sección por módulo |\n| **Insights** | Score de salud + reglas automáticas (cobertura crítica, margen bajo, día flojo, stock sin movimiento, cumpleaños…) |\n| **Métricas** | KPIs del área (ventas, ticket, margen neto, stock crítico, Posición IVA por CAE emitido, etc.) |\n| **Rentabilidad** | P&L / margen neto; en Todo, \"Detalle por venta\" paginado |\n| **Recomendaciones** | Recomendaciones scopeadas por categoría del área |\n\n**Contenido destacado por área (Gráficos/Métricas):** Ventas (funnel, heatmap días×horas, canales) · Gastos (burn rate, fijos vs. variables) · Productos (cuadrante scatter, pareto, tijera de precios) · Inventario (capital de trabajo, salud de depósito, aging) · Clientes (RFM, cohort, aging CC) · Proveedores (aging OC, evolución 6m) · Facturación (IVA débito/crédito por CAE, alícuotas, tope Monotributo con banner legal) · Envíos (funnel, subsidio/ganancia) · Marketing (POAS).\n\n> 🛑 REGLA #0 (display): toda la superficie de plata/fiscal fue auditada contra datos reales. Margen = (neto−costo)/neto con base `subtotal`; débito fiscal/Posición IVA = `cae IS NOT NULL` (Libro IVA autoritativo). Las estimaciones sintéticas quedaron diferidas por diseño.\n\n**Relaciones:** consume datos de ventas, inventario, clientes, gastos, envíos, OC. Reusa `RentabilidadPage` / `RecomendacionesPage` scopeadas por área.\n\n---"
  },
  {
    "id": "3.2",
    "titulo": "Ventas / POS",
    "ruta": "/ventas",
    "keywords": [
      "ventas",
      "venta",
      "vender",
      "pos",
      "cobrar",
      "cobro",
      "presupuesto",
      "reserva",
      "sena",
      "ticket",
      "carrito",
      "devolucion",
      "anular",
      "recurrente",
      "canal",
      "vuelto",
      "medio de pago",
      "qr"
    ],
    "contenido": "Caja registradora principal. Permite ventas, presupuestos y devoluciones.\n\n**Tabs:**\n- **Nueva venta** (POS activo)\n- **Historial**: ventas pasadas filtradas por sucursal activa, fecha, estado\n- **Presupuestos**: ventas en estado borrador/presupuesto pendientes de confirmar\n\n**Pantalla POS — componentes:**\n- **Selector de grupo de estados** (encima del buscador, visible solo si hay grupos configurados): botones por grupo (ej: \"Disponible\", \"Promoción\"). El grupo default se preselecciona automáticamente (★). Botón \"Todos\" para ver sin filtro. Filtra qué LPNs se consideran para stock disponible.\n- **Buscador de productos** (barra superior): busca por nombre, SKU o código de barras. Muestra stock disponible en la sucursal activa según el grupo de estados activo.\n- **Toggle galería/lista**: cambia la vista de los resultados\n- **Carrito** (panel derecho o inferior en mobile): líneas con producto, cantidad editable, precio unitario, descuento por línea individual\n- **Descuento global**: campo sobre el subtotal (% o valor fijo)\n- **Selector de cliente**: busca cliente existente o crea uno nuevo inline con nombre + teléfono\n- **Medios de pago**: uno o múltiples simultáneos — Efectivo, Tarjeta débito, Tarjeta crédito, Transferencia, MercadoPago, **MODO** (QR interoperable bancario), **Cuenta Corriente** (parcial o total, solo clientes con CC habilitada), Cheque, Otro. Cada uno con monto asignable. Muestra vuelto calculado automáticamente cuando supera el total.\n- **Modo venta**: Venta / Presupuesto / Reserva\n- **Canal de venta** (v1.8.22): selector antes del botón de confirmar — Presencial (default), Instagram, Facebook, WhatsApp, Otros. Se guarda en ventas.origen.\n- **Notas**: texto libre asociado a la venta\n- **Cuotas tarjeta de crédito** (v1.8.22): al seleccionar \"Tarjeta crédito\" con monto > 0, aparece picker de banco y cuotas. Muestra monto por cuota, total con interés, badge verde \"Sin interés\". Requiere configurar bancos en Configuración → Métodos de pago.\n- **Botón \"Confirmar venta\"** (parte inferior derecha): ejecuta la venta\n\n**Al confirmar venta:**\n1. Trigger DB asigna número de venta (ventas.numero global + ventas.numero_sucursal por sucursal). Display: \"S1-0001\" con sucursal activa, \"#N\" global sin sucursal. Código de sucursal configurable en SucursalesPage (v1.8.22).\n2. Rebaje de stock según regla del producto (FIFO/FEFO/LEFO/LIFO/Manual)\n3. Si hay sesión de caja abierta: registra movimiento de ingreso por medio de pago\n4. Si hay medio = Cuenta Corriente (parcial o total): genera deuda en CC del cliente por el monto CC. monto_pagado = total pagado en otros medios. Es_cuenta_corriente=true aunque sea pago mixto (v1.8.22 — reemplaza el toggle todo-o-nada anterior).\n5. Si integración TN/ML activa: actualiza stock en marketplace\n\n**Número de ticket por sucursal (v1.8.22):**\n- ventas.numero_sucursal: contador secuencial reiniciado por sucursal\n- Formato display: S1-0001 (con sucursal), #N (sin sucursal)\n- Código \"S1\" configurable en SucursalesPage → campo \"Código ticket\"\n\n**Validaciones y UX mejoradas (v1.8.21-22):**\n- Total incluye costo de envío en la validación de medios de pago\n- \"Falta asignar\" no parpadea mientras se escribe (actualiza en blur/Enter)\n- Badge \"Stock insuf. (X disp.)\" en ítems del carrito con stock insuficiente\n- Tag CC (verde) en historial de ventas cuando es_cuenta_corriente = true\n- Historial incluye ventas sin sucursal_id (retrocompatibilidad pre multi-sucursal)\n- Badge \"⚠ Error — Cancelar\" para ghost ventas CC sin items\n- Rollback automático: si falla por stock, la venta se elimina del DB\n\n**Acciones en historial (panel expandido):**\n- Ver ítems, medios de pago, cliente, notas\n- **Imprimir ticket** → PDF (jsPDF)\n- **Emitir factura AFIP** → genera comprobante A/B/C con QR\n- **Registrar devolución** → parcial o total con selección de ítems\n- **Anular venta** → requiere confirmación\n\n**Escaneo en POS:** ícono cámara en buscador → lee código de barras → agrega producto al carrito automáticamente.\n\n**Kits/Combos en POS:** si el producto es un kit (`es_kit = true`), se explota en sus componentes al agregarlo al carrito.\n\n**Relaciones:** descuenta Inventario. Registra en Caja. Actualiza CC de Clientes. Puede generar Envío. Puede generar Factura AFIP.\n\n---"
  },
  {
    "id": "3.3",
    "titulo": "Gastos",
    "ruta": "/gastos",
    "keywords": [
      "gastos",
      "gasto",
      "egreso",
      "cheque",
      "cuota",
      "gasto fijo",
      "categoria de gasto",
      "cierre contable"
    ],
    "contenido": "Registro y seguimiento de todos los gastos del negocio.\n\n**Tabs** (orden v1.116.0):\n- **Gastos variables**: listado de gastos variables del período (filtrado por sucursal activa)\n- **Gastos fijos**: gastos recurrentes configurados (alquiler, servicios, etc.)\n- **OC** (modo avanzado): órdenes de compra pendientes de pago (filtradas por sucursal activa via `ordenes_compra.sucursal_id`)\n- **Cheques**: cheques emitidos/recibidos (badge de próximos a cobrar)\n- **Historial**: todos los gastos con filtro de rango de fechas\n- **Reportes** (modo avanzado) · **Recursos** (modo avanzado) · **Autorizaciones** (roles aprobadores) · **Cierres contables** (según permiso)\n\n**Gastos variables — acciones:**\n- **+ Nuevo gasto** (esquina superior derecha): modal con título, monto, categoría de gasto, proveedor opcional, fecha, notas, medio de pago, sucursal\n- **Registrar en caja**: asocia el gasto a la sesión de caja activa (egreso)\n- **Editar / Eliminar**\n- Gastos creados desde Recepciones tienen `recepcion_id` visible (trazabilidad de costo de mercadería)\n- **Efectivo en gastos → caja específica**: al registrar gasto en efectivo, aparece selector de caja obligatorio con validación de saldo. Opción \"🔒 Caja Fuerte\" disponible (sin límite de saldo, registra como egreso_traspaso) (v1.8.21)\n- **Cuotas con tarjeta de crédito**: al seleccionar tarjeta de crédito como medio de pago, aparece panel de cuotas (N cuotas, interés %, sin interés). Solo en gastos variables.\n\n**Gastos fijos:**\n- CRUD de gastos recurrentes (nombre, monto mensual, categoría)\n- Solo informativos — no se registran automáticamente en caja\n\n**Tab OC:**\n- Lista de OC activas (no canceladas) filtradas por sucursal\n- OC pagadas aparecen al final con opacidad reducida\n- Filtros: estado de pago, proveedor\n- Al expandir: detalle en formato ticket (font mono, secciones separadas, ítems, totales, estado de pago, fecha vencimiento CC) (v1.8.26)\n- Comprobante de pago: botón \"Adjuntar comprobante\" por OC — upload PDF/imagen a Storage (v1.8.22)\n- Registrar pago: CC es un método de pago más (pago mixto posible, ej: 30% efectivo + 70% CC). Días de plazo aparecen solo cuando CC está en medios (v1.8.22)\n\n**Relaciones:** Recepciones generan gastos automáticos. Caja egresa gastos en efectivo. OC enlaza con Proveedores.\n\n---"
  },
  {
    "id": "3.4",
    "titulo": "Caja",
    "ruta": "/caja",
    "keywords": [
      "caja",
      "arqueo",
      "apertura",
      "cierre",
      "efectivo",
      "boveda",
      "caja fuerte",
      "turno",
      "ingreso de caja",
      "egreso de caja"
    ],
    "contenido": "Gestión del flujo de efectivo y medios de pago del negocio.\n\n**Tabs:**\n- **Caja**: operativa — estado actual de la caja seleccionada\n- **Historial**: sesiones cerradas (filtrado por sucursal activa)\n- **Caja Fuerte**: safe vault del negocio\n- **Configuración**: crear y nombrar nuevas cajas\n\n**Selector de caja** (superior): dropdown con todas las cajas operativas. Ícono verde = sesión abierta. Recuerda la última caja usada por usuario (localStorage). La caja predeterminada del usuario muestra ★ amarillo en el selector y en los botones rápidos. Se guarda en localStorage por usuario (v1.8.21).\n\n**Con sesión cerrada muestra:**\n- Botón **Abrir caja**: ingresa monto inicial. Un CAJERO con sesión ya abierta no puede abrir otra. Sugerido de monto inicial: usa monto_real_cierre del último cierre (si > 0) o monto_cierre calculado como fallback. Alerta de diferencia si el monto ingresado difiere del sugerido (v1.8.21).\n\n**Con sesión abierta muestra:**\n- Saldo actual desglosado por medio de pago\n- Listado de movimientos del día (ventas ingresadas + movimientos manuales)\n- Total de ventas en la sesión\n- Botones de acción:\n  - **+ Movimiento**: ingreso o egreso manual con motivo y monto\n  - **Arqueo**: conteo manual del efectivo en caja en un momento dado (registra diferencia)\n  - **Traspaso**: enviar dinero a otra caja operativa (ambas deben estar abiertas)\n  - **Cerrar caja**: ingresa monto real contado, muestra diferencia vs. esperado, confirma cierre con notas\n\n**Caja Fuerte:**\n- Sesión permanente (nunca se cierra)\n- \"Ingresar a Caja Fuerte\": selector de caja origen (cualquier caja con sesión abierta). Sin caja seleccionada = ingreso externo. Valida saldo de la caja de origen (v1.8.21).\n- \"Enviar a Caja\": selector de caja destino (sesiones abiertas).\n- Muestra saldo acumulado + historial de movimientos.\n- Acceso configurable por roles en tab Configuración.\n\n**Historial:** sesiones cerradas con fecha, usuario que abrió/cerró, monto apertura, monto real, diferencia, movimientos detallados (expandible por sesión).\n\n**Relaciones:** Ventas registran ingresos automáticamente. Gastos pueden egresarse. Traspasos mueven dinero entre cajas o a la caja fuerte.\n\n---"
  },
  {
    "id": "3.5",
    "titulo": "Productos",
    "ruta": "/productos",
    "keywords": [
      "productos",
      "producto",
      "sku",
      "codigo de barras",
      "catalogo",
      "precio",
      "combo",
      "kit",
      "variante",
      "categoria",
      "mayorista"
    ],
    "contenido": "Catálogo base del negocio. **Global** — mismo catálogo en todas las sucursales.\n\n**Tabs:**\n- **Productos**: listado con búsqueda por nombre/SKU/código de barras\n- **Estructuras**: definición de estructuras de embalaje escalonadas (unidad → caja → pallet) con dimensiones y pesos\n\n**Listado — fila expandida al hacer clic:**\n- Badge de stock disponible para venta (filtrado por sucursal activa, calculado desde `inventario_lineas`)\n- Badge rojo con AlertTriangle si stock ≤ stock mínimo\n- Precio de venta, precio de costo\n- Categoría, SKU, código de barras\n- Ícono carrito → agrega a Orden de Compra rápida\n- Link \"Editar\" → `/productos/:id/editar`\n\n**Acciones principales:**\n- **+ Nuevo producto** (esquina superior derecha): va a `/productos/nuevo`\n- **Escanear** (ícono cámara): busca por código\n- **Importar** → `/importar/productos`\n- **Bulk actions** (aparece al seleccionar con checkbox):\n  - Cambiar precio (porcentaje o valor fijo a todos los seleccionados)\n  - Cambiar proveedor asignado\n  - Reactivar productos desactivados\n\n**Formulario de producto** (`ProductoFormPage`):\n- Nombre, SKU (auto-generado `calcularSiguienteSKU()` o manual), código de barras\n- Categoría, proveedor\n- Precio de venta, precio de costo, moneda (ARS/USD), alícuota IVA (0 / 10.5 / 21 / 27%)\n- **Precios mayoristas**: tiers por cantidad mínima (ej: ≥10 unidades → $X)\n- Unidad de medida (unidad, kg, g, litro, ml, metro, cm, caja, pack, docena)\n- Stock mínimo global + stock mínimo por sucursal (override individual)\n- Imagen: upload a Supabase Storage\n- Regla de inventario: FIFO / FEFO / LEFO / LIFO / Manual\n- Flags: tiene series, tiene lote, tiene vencimiento\n- TiendaNube: habilitar sync, SKU TN\n- MercadoLibre: habilitar sync\n\n**Tab Estructuras — detalle:**\nCada producto puede tener una o más estructuras de embalaje. Una estructura define 3 niveles escalonados:\n- **Unidad**: peso (kg), alto/ancho/largo (cm)\n- **Caja**: unidades por caja, peso (kg), alto/ancho/largo (cm)\n- **Pallet**: cajas por pallet, peso (kg), alto/ancho/largo (cm)\n\nSe requieren mínimo 2 niveles activos. Se puede marcar una estructura como default. Las estructuras se asignan también a los LPNs desde el modal de acciones del LPN. Sirve para logística (cálculo de volumen, peso de embarques).\n\n> ⚠️ Las estructuras NO son combos/kits. Los combos (bundles promocionales) se configuran en `/configuracion` → tab Combos. Los kits de armado se gestionan en Inventario → tab Kits.\n\n**Relaciones:** base de Ventas, Inventario, Recepciones, OC. Estructuras usadas en LPNs para logística.\n\n---"
  },
  {
    "id": "3.6",
    "titulo": "Inventario",
    "ruta": "/inventario",
    "keywords": [
      "inventario",
      "stock",
      "lpn",
      "ubicacion",
      "rebaje",
      "ingreso de stock",
      "conteo",
      "movimiento",
      "deposito",
      "ajuste"
    ],
    "contenido": "Gestión integral del stock físico a nivel de LPN (License Plate Number = unidad de carga), filtrado por sucursal activa.\n\n**Tabs:**\n- **Inventario**: vista de todas las líneas de stock (LPNs) activas. Filtros: estado, ubicación, categoría, proveedor, alerta de stock crítico.\n- **Agregar**: modal de ingreso de stock (= MovimientosPage en modo ingreso)\n- **Quitar**: modal de rebaje de stock (= MovimientosPage en modo rebaje)\n- **Kits**: gestión de armado/desarmado de kits\n- **Conteo**: conteos cíclicos de inventario\n- **Historial**: todos los movimientos de stock del tenant filtrados por sucursal\n- **Autorizaciones**: solicitudes pendientes de aprobación (para rol DEPOSITO)\n\n**Tab Inventario — acciones globales (esquina superior derecha):**\n- **Agregar Stock**: abre tab Agregar con modal de ingreso\n- **Rebaje masivo / Ingreso masivo**: `MasivoModal` — carga N productos en grilla. Soporta tanto ingreso como rebaje. El rebaje aplica FIFO/FEFO automáticamente (filtros corregidos: incluye sucursal_id y excluye lineas sin ubicacion). Campo \"LPN o Lote preferido\" por ítem para consumir ese LPN primero. Preview en tiempo real de qué LPNs se van a consumir antes de confirmar (v1.8.23).\n- **Escanear** (ícono cámara): lee código de barras → busca LPN o producto\n\n**Tab Inventario — acciones por LPN (modal LpnAccionesModal, 5 tabs internos):**\n- **Editar**: modifica lpn, cantidad (si no tiene series), estado, ubicación, **sucursal** (para reasignar el LPN completo a otra sucursal), proveedor, lote, fecha de vencimiento. Si rol = DEPOSITO y cambia cantidad → crea solicitud de autorización en lugar de ejecutar.\n- **Mover**: traslado parcial a otra ubicación o sucursal. Ingresa cantidad a mover + destino → crea nuevo LPN con esa cantidad.\n- **Series**: para productos con series. Agregar, editar o eliminar números de serie individuales. Ver cuáles están reservadas.\n- **Estructura**: asignar una de las estructuras de embalaje del producto a este LPN.\n- **Eliminar**: baja del LPN. Si rol = DEPOSITO → crea solicitud de autorización. Si tiene reservas, advierte antes de eliminar.\n\n> ⚠️ Si el LPN tiene `cantidad_reservada > 0`, solo se muestra el tab Mover (para no romper reservas activas).\n\n**Shortcuts de teclado en InventarioPage:**\n- `ENTER` en tab Agregar → abre modal de ingreso\n- `ESC` en tab Agregar → limpia selección de producto\n- `ENTER` en tab Quitar → abre modal de rebaje\n- `ENTER` en tab Conteos (estado 1: sin conteo) → abre nuevo conteo\n- `ENTER` en tab Conteos (estado 2: conteo abierto) → carga stock de la ubicación/SKU seleccionada\n- `ENTER` en tab Conteos (estado 3: con filas cargadas) → finaliza y aplica ajustes\n- `ESC` con conteo activo → cancela el conteo\n- En el modal LPN: `ESC` cierra, `ENTER` guarda (según tab activo)\n\n**Bulk Edit de LPNs (selección múltiple):**\nBarra de acciones con LPNs seleccionados ofrece:\n- Cambiar estado\n- Cambiar ubicación\n- **Editar atributos** (sucursal, proveedor, lote, fecha vencimiento — cualquier combinación). DEPOSITO genera solicitud de autorización; otros roles aplican directo.\n- Combinar LPNs (solo mismo producto)\n\n**Tab Kits:**\n- Definir receta de un kit (producto componente + cantidad por componente)\n- **Armar kit**: consume los componentes del inventario → genera stock del kit ensamblado\n- **Desarmar kit**: proceso inverso, devuelve componentes al inventario\n\n**Tab Conteo:**\n- Crear conteo cíclico por ubicación o por producto\n- Registrar cantidades físicas (con carga automática de stock esperado)\n- Ver diferencias vs. stock en sistema\n- **Borrador**: guardar conteo sin finalizar. Los borradores aparecen en el historial con badge amarillo + botones \"Continuar\" (carga el form con los datos) y \"Eliminar\" (v1.8.23).\n- Al continuar un borrador: el form carga tipo, referencia, notas y filas. Al guardar/finalizar: actualiza el registro existente sin duplicar.\n- Aprobar ajuste: genera movimientos de ajuste en inventario_lineas y movimientos_stock\n\n**Tab Historial:**\n- Todos los `movimientos_stock` filtrados por sucursal activa\n- Filtros: categoría, rango de fechas, tipo de movimiento\n- Muestra: producto, cantidad, tipo, usuario, LPN, fecha\n\n**Tab Autorizaciones:**\n- Lista de solicitudes pendientes generadas por usuarios DEPOSITO\n- Tipos: cambio de cantidad, eliminación de LPN, cambio de serie\n- Acciones: Aprobar / Rechazar (roles DUEÑO, SUPERVISOR, ADMIN)\n\n**Relaciones:** Ventas consumen stock de aquí. Recepciones agregan stock. Movimientos registra cada cambio. ProductosPage calcula badge de stock disponible desde `inventario_lineas`.\n\n---"
  },
  {
    "id": "3.7",
    "titulo": "Clientes",
    "ruta": "/clientes",
    "keywords": [
      "clientes",
      "cliente",
      "cuenta corriente",
      "cc",
      "crm",
      "domicilio",
      "cumpleanos",
      "deuda",
      "cobranza"
    ],
    "contenido": "**Directorio global:** Clientes son compartidos por todas las sucursales del tenant. No hay selector de sucursal en /clientes ni filtro por sucursal en la query (v1.8.21).\n\nCRM básico + cuenta corriente.\n\n**Listado:** búsqueda por nombre, email, teléfono o DNI.\n\n**Datos de cliente:** nombre, email, teléfono, DNI/CUIT, domicilios múltiples (para envíos), CC habilitada, límite de crédito.\n\n**Acciones principales:**\n- **+ Nuevo cliente**: modal inline (nombre, email, teléfono, DNI)\n- **Editar**: formulario completo con domicilios\n- **Ver compras**: historial de ventas del cliente\n- **WhatsApp** (ícono): abre WhatsApp con plantilla pre-cargada (número normalizado a formato internacional)\n- **Gestionar CC**: panel de cuenta corriente del cliente\n\n**Cuenta corriente:**\n- Lista de deudas con fecha de vencimiento y estado\n- **Registrar cobro**: asigna pago a una deuda específica\n- Historial de todos los movimientos (débitos de ventas + créditos de cobros)\n- Cron diario 09:00 AR detecta cuotas vencidas → notificación en campana\n- **Cancelar deuda** (solo DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN): botón por venta en el tab CC. Marca monto_pagado = total, registra \"Cancelación CC\" en medios de pago con nombre del operador (v1.8.23).\n\n**Relaciones:** Ventas crea deudas en CC. Cobros reducen saldo. Envíos usan domicilios del cliente.\n\n---"
  },
  {
    "id": "3.8",
    "titulo": "Envíos",
    "ruta": "/envios",
    "keywords": [
      "envios",
      "envio",
      "courier",
      "reparto",
      "tracking",
      "remito",
      "entrega",
      "hoja de ruta",
      "flete"
    ],
    "contenido": "Gestión de despachos filtrado por sucursal activa.\n\n**Estados:** `pendiente → despachado → en_camino → entregado → devolucion → cancelado`\n\n**Tipos de envío al crear:**\n\n**Envío Propio (KM-based):**\n- Campo de dirección con Google Places Autocomplete (sugerencias mientras se escribe) + dropdown con domicilios guardados del cliente\n- KM calculado automáticamente via Distance Matrix API (sucursal activa → cliente)\n- Costo = KM × `sucursales.costo_km_envio` (configurado en SucursalesPage, no editable manualmente)\n- La dirección de entrega se pre-completa como destino del envío\n\n**Envío por Tercero (Courier):**\n- Selección de courier (OCA, Andreani, Correo Argentino, DHL, etc.)\n- Costo auto-completado desde `courier_tarifas` configuradas en SucursalesPage (editable como override)\n- Canal de venta: auto-populado desde `venta.origen` si viene de una venta (read-only)\n- Tracking number y URL\n\n**Acciones:**\n- **+ Nuevo envío** (esquina superior derecha): modal con selección de venta, tipo de envío y campos\n- **Agregar nueva dirección**: el formulario inline de nueva dirección funciona correctamente al seleccionar un cliente (fix Rules of Hooks v1.8.21).\n- **Avanzar estado**: botón contextual según estado actual\n- **Imprimir remito**: PDF (jsPDF)\n- **Ver tracking externo**: abre URL de tracking en nueva pestaña\n- **WhatsApp**: enviar mensaje al cliente con datos del envío\n\n**Nota:** el tab Cotizador fue eliminado. Los precios de couriers se configuran en SucursalesPage.\n\n**Relaciones:** enlazado a Ventas. Usa domicilios de Clientes. Google Maps API para distancia. Tarifas configuradas en Sucursales.\n\n---"
  },
  {
    "id": "3.9",
    "titulo": "Facturación",
    "ruta": "/facturacion",
    "keywords": [
      "facturacion",
      "factura",
      "afip",
      "arca",
      "cae",
      "nota de credito",
      "comprobante",
      "fiscal",
      "iva",
      "facturar"
    ],
    "contenido": "Módulo de facturación electrónica AFIP.\n\n**Tabs:**\n- **Panel**: estado de las integraciones AFIP y resumen de comprobantes emitidos\n- **Emitir**: formulario para emitir comprobante manual (tipo, punto de venta, receptor, ítems, IVA)\n- **Libros**: libro de IVA ventas y compras por período\n- **Liquidación**: liquidación de tributos estimada (disclaimer: valores estimados)\n\n**Tipos de comprobante:** Factura A (RI a RI), Factura B (RI a CF/Monotributista), Factura C (Monotributista emisor)\n\n**Configuración requerida:** certificado digital (**.crt + .key**, no .p12), CUIT, condición IVA y punto de venta AFIP — en `/configuracion` → tab **Facturación**. Un negocio puede facturar con **más de un CUIT** (multi-CUIT: sección \"Emisores fiscales\", cada emisor con su cert y sus PV; la venta usa el emisor de su sucursal o el principal). Si no tenés el certificado, el **asistente** genera la clave y el CSR por vos (Generar CSR → pegarlo en ARCA → subir el .crt); disponible tanto para el **CUIT principal** como para los adicionales.\n\n**Emisión desde ventas:** también se puede emitir desde el historial de ventas directamente (acceso rápido).\n\n**NC (Nota de Crédito):** se emite desde el flujo de devoluciones vinculadas a ventas con factura.\n\n**Relaciones:** Ventas (emite comprobantes). Configuración (certificados y puntos de venta). Devoluciones (genera NC).\n\n---"
  },
  {
    "id": "3.10",
    "titulo": "Proveedores",
    "ruta": "/proveedores",
    "keywords": [
      "proveedores",
      "proveedor",
      "orden de compra",
      "oc",
      "servicio",
      "compra"
    ],
    "contenido": "Directorio de proveedores + órdenes de compra.\n\n**Tabs:**\n- **Proveedores**: listado con búsqueda\n- **Órdenes de compra**: listado de OC con filtros de estado\n\n**Datos de proveedor:** nombre, email, teléfono, CUIT, moneda de compra, días de plazo de pago, CC proveedor habilitada.\n\n**Órdenes de compra:**\n- **+ Nueva OC**: seleccionar proveedor, agregar ítems (producto + cantidad + precio unitario + notas)\n- **Estados OC**: `borrador → enviada → parcialmente_recibida → recibida → cancelada`\n- **Estado de pago**: `pendiente → pagado_parcial → pagado`\n- **Registrar pago**: fecha, monto, medio de pago → actualiza `estado_pago` y `monto_pagado`\n- **Imprimir OC**: PDF con todos los ítems\n- **Generar recepción**: desde OC en estado enviada/recibida → abre RecepcionesPage precompletado\n\n**Cuenta corriente proveedor:** historial de deudas y pagos hacia el proveedor. Balance deudor/acreedor.\n\n**Relaciones:** OC genera Recepciones. Recepciones ingresan stock. Gastos pueden referenciar OC.\n\n---"
  },
  {
    "id": "3.11",
    "titulo": "Recepciones",
    "ruta": "/recepciones",
    "keywords": [
      "recepciones",
      "recepcion",
      "recibir mercaderia",
      "ingreso de mercaderia"
    ],
    "contenido": "Ingreso físico de mercadería, filtrado por sucursal activa.\n\n**Listado:** proveedor, OC vinculada, fecha, estado, sucursal.\n\n**Formulario de recepción:**\n- Proveedor + OC opcional (pre-carga ítems esperados con cantidades)\n- Por ítem: cantidad esperada vs. recibida (editable), precio de costo actualizable\n- Campos adicionales si aplica: número de lote, fecha de vencimiento, números de serie\n- Ubicación de destino en el depósito\n- Sucursal destino\n- Notas generales\n\n**Al confirmar recepción:**\n1. Crea `inventario_lineas` (stock físico agregado)\n2. Crea `movimientos_stock` tipo ingreso\n3. Si viene de OC: actualiza estado a `parcialmente_recibida` o `recibida`\n4. Crea **Gasto automático** (`gastos.recepcion_id`) con el costo total de la mercadería recibida\n\n**Relaciones:** consume OC de Proveedores. Alimenta Inventario. Genera Gasto de compra automático.\n\n---"
  },
  {
    "id": "3.12",
    "titulo": "Recursos",
    "ruta": "/recursos",
    "keywords": [
      "recursos",
      "recurso",
      "patrimonio",
      "activo fijo",
      "herramienta",
      "vehiculo"
    ],
    "contenido": "Registro del patrimonio y activos del negocio, filtrado por sucursal activa. Solo DUEÑO.\n\n**Tabs:**\n\n**Recursos activos**: listado de activos con estado activo/en reparación/dado de baja. Muestra: nombre, categoría, estado, valor, ubicación, proveedor, garantía, badge de recurrencia.\n\n**Recursos pendientes**: lista de adquisición (estado `pendiente_adquisicion`). Presupuesto estimado, botón \"Marcar como adquirido\".\n\n**Ubicaciones**: vista de todos los recursos agrupados por su campo `ubicacion`. Edición inline de la ubicación con clic en el lápiz. Banner de alerta si hay recurrentes vencidos/próximos.\n\n**Datos por recurso:** nombre, descripción, categoría, estado, valor, fecha de adquisición, proveedor (opcional), ubicación (texto libre), número de serie, garantía hasta, notas, sucursal.\n\n**Recursos recurrentes:** checkbox \"Recurso recurrente\" → define frecuencia (N días/semanas/meses/años) + fecha próxima compra (auto-calculada si se deja vacía). Badges en cards: 🔄 violeta (recurrente normal), ámbar (próximo ≤7 días), rojo (vencido).\n\n**Integración con Gastos:** al crear un recurso no-pendiente con valor → crea gasto automático. GastosPage → tab Recursos → sección \"Renovaciones pendientes\": muestra recursos recurrentes con próxima compra vencida o en ≤7 días, botón \"Registrar compra\" crea el gasto y avanza la fecha al siguiente ciclo.\n\n**Relaciones:** GastosPage (gastos de adquisición y renovaciones). DashInventarioArea (patrimonio de recursos).\n\n---"
  },
  {
    "id": "3.13",
    "titulo": "Biblioteca",
    "ruta": "/biblioteca",
    "keywords": [
      "biblioteca",
      "archivo",
      "documento"
    ],
    "contenido": "Gestor de documentos y archivos del negocio. Solo DUEÑO (modo avanzado).\n\n**Tipos de archivos:** certificado_afip_crt, certificado_afip_key, contrato, factura_proveedor, manual, otro.\n\n**Acciones:** subir archivo (Supabase Storage), buscar por nombre, filtrar por tipo, descargar, eliminar.\n\n**Uso principal:** almacenar certificados AFIP, contratos con proveedores, facturas recibidas, manuales.\n\n---"
  },
  {
    "id": "3.14",
    "titulo": "Alertas",
    "ruta": "/alertas",
    "keywords": [
      "alertas",
      "alerta",
      "notificacion",
      "aviso",
      "vencimiento",
      "stock bajo"
    ],
    "contenido": "Centro de alertas del negocio pendientes de resolver.\n\nTodas las secciones filtran por **sucursal activa**. Solo la sección de alertas de stock mínimo es global (la tabla `alertas` aún no tiene `sucursal_id`).\n\n**Tipos de alerta:**\n- **Stock crítico** (global): productos con stock disponible ≤ stock mínimo → botón \"Crear OC rápida\"\n- **Reservas viejas** (filtrada): ventas en estado reservada > 3 días → botón \"Ver venta\"\n- **LPNs vencidos** (filtrada): lotes con `fecha_vencimiento < hoy` → botón \"Ver en inventario\"\n- **LPNs sin ubicación** (filtrada): LPNs activos sin ubicación asignada\n- **LPNs sin proveedor** (filtrada): LPNs activos sin proveedor\n- **OC vencidas sin pagar** (filtrada): OC con `fecha_vencimiento_pago < hoy`\n- **OC próximas a vencer** (filtrada): OC con vencimiento en ≤3 días\n- **Clientes con deuda** (filtrada): clientes con saldo pendiente en CC\n- **Productos sin categoría** (global): catálogo incompleto\n\n**Acciones:** marcar alerta como resuelta (oculta de la lista).\n\n**Badge en sidebar:** muestra el conteo de alertas activas no resueltas.\n\n**Relaciones:** Stock → Inventario/Productos. Reservas → Inventario. Categorías → Productos. OC → Proveedores. CC → Clientes.\n\n---"
  },
  {
    "id": "3.15",
    "titulo": "RRHH",
    "ruta": "/rrhh",
    "keywords": [
      "rrhh",
      "empleado",
      "sueldo",
      "nomina",
      "asistencia",
      "vacaciones",
      "fichar",
      "recibo",
      "licencia"
    ],
    "contenido": "Gestión de recursos humanos. Solo DUEÑO / RRHH (plan Pro o superior).\n\n**Tabs:**\n- **Empleados**: listado con nombre, DNI, cargo, fecha de ingreso, sucursal, sueldo base, estado; puestos, departamentos y árbol organizacional\n- **Nómina**: liquidaciones por período (nómina **contable** con conceptos)\n- **Asistencia**: entradas/salidas del personal + **fichado por QR**\n- **Vacaciones**: solicitudes, aprobaciones y saldo anual\n- **Capacitaciones / Evaluaciones**: registro de cursos, certificaciones y evaluaciones de desempeño\n- **Feriados**: calendario de feriados configurables por país\n\n**Empleados:** CRUD completo. Upload de documentos (contratos, certificados) a Storage privado. Historial de cambios salariales.\n\n**Nómina:** liquidación individual o masiva. Ítems: sueldo base, horas extra, descuentos, SAC. **Doble validación server-side** del pago (con flag: solo DUEÑO/ADMIN, o SUPERVISOR si está habilitado); pago desde caja (efectivo → egreso asentado + verificación de saldo). Recibo de sueldo en PDF.\n\n**Asistencia:** check-in/check-out manual **o por QR** (portal público del empleado por token). Reporte de ausencias.\n\n**Fichado QR / Portal del empleado:** el empleado accede por un token (`/fichar/:token`) para registrar asistencia sin cuenta en la app. Los usuarios con acceso ven **Mi Portal** en el sidebar.\n\n**Supervisor Self-Service:** el SUPERVISOR ve y gestiona solo su equipo (asistencia + aprobar/rechazar vacaciones), restringido por RLS server-side.\n\n**Relaciones:** pago de nómina impacta Caja. Independiente del resto de módulos operativos.\n\n---"
  },
  {
    "id": "3.16",
    "titulo": "Historial de actividad",
    "ruta": "/historial",
    "keywords": [
      "historial",
      "actividad",
      "auditoria",
      "quien hizo"
    ],
    "contenido": "Auditoría completa de cambios en el sistema. Acceso: Supervisor+ / Contador (plan Básico+).\n\n**Filtros:** entidad (producto, inventario_linea, venta, gasto, usuario, etc.), acción (crear/editar/eliminar/cambio_estado), usuario, rango de fechas, texto libre.\n\n**Muestra:** quién hizo qué, cuándo, en qué entidad, valor anterior → valor nuevo.\n\n**Entidades auditadas:** productos, inventario, ventas, clientes, proveedores, gastos, ubicaciones, estados, categorías, usuarios, combos.\n\n---"
  },
  {
    "id": "3.17",
    "titulo": "Reportes",
    "ruta": "/reportes",
    "keywords": [
      "reportes",
      "reporte",
      "exportar",
      "excel",
      "pdf",
      "rentabilidad"
    ],
    "contenido": "Generador de reportes exportables. Acceso: Contador+ (plan Básico+).\n\n**Tipos de reporte predefinidos:**\n- **Stock actual**: existencias por producto con precio de costo y valorización\n- **Movimientos**: todos los movimientos de stock en un período\n- **Ventas**: detalle de ventas con ítems, medios de pago, clientes\n- **Críticos**: productos bajo stock mínimo\n- **Rotación**: índice de rotación de inventario por período\n- **Valorizado**: valor total del inventario a precio de costo\n- **Ficha de productos**: catálogo con todos los atributos\n\n**Formatos de exportación:** XLSX (xlsx), PDF (jsPDF + autoTable).\n\n**Configuración:** fecha desde/hasta para todos los reportes basados en período.\n\n**SQL Runner** (solo DUEÑO y SUPER_USUARIO):\n- Editor SQL con fondo oscuro/texto verde (estilo terminal)\n- `Ctrl+Enter` para ejecutar\n- Solo permite `SELECT` o `WITH` — bloquea INSERT/UPDATE/DELETE/DROP/etc.\n- SECURITY INVOKER: corre con los permisos del usuario → RLS activo → solo ve sus datos\n- Límite 500 filas, timeout 10 segundos\n- Referencia colapsable de tablas disponibles (click inserta en el editor)\n- Tabla de resultados dinámica (columnas auto-detectadas, scroll horizontal/vertical)\n- Exportar resultados a Excel (XLSX) o PDF\n\n---"
  },
  {
    "id": "3.18",
    "titulo": "Sucursales",
    "ruta": "/sucursales",
    "keywords": [
      "sucursales",
      "sucursal",
      "local",
      "deposito secundario",
      "tarifa de envio"
    ],
    "contenido": "CRUD de sucursales del negocio. Solo DUEÑO.\n\n**Datos por sucursal:**\n- **Nombre** (requerido)\n- **Dirección** (requerida — necesaria para calcular distancias de envíos)\n- **Teléfono** (opcional)\n- **Costo por km** (`costo_km_envio`): tarifa para envíos propios. Varía por sucursal. Se usa para calcular el costo automáticamente al crear un envío propio.\n- **Código ticket** (v1.8.22): código corto configurable (ej: \"S1\", \"CC\") — se usa como prefijo del número de ticket en ventas por sucursal. Máximo 5 caracteres, auto-uppercase.\n\n**Panel de tarifas de couriers** (expandible por sucursal):\n- Click en \"Couriers\" → lista de couriers con precio editable inline (Enter para guardar)\n- Se guardan en tabla `courier_tarifas(tenant_id, sucursal_id, courier, precio)`\n- Couriers disponibles: OCA, Correo Argentino, Andreani, DHL Express, FedEx, Otro\n\n**Al crear/modificar/eliminar:** recarga `loadUserData()` para sincronizar el selector del header.\nCada integración (TN, MP, ML) tiene credenciales independientes por sucursal.\n\n---"
  },
  {
    "id": "3.19",
    "titulo": "Usuarios",
    "ruta": "/usuarios",
    "keywords": [
      "usuarios",
      "usuario",
      "rol",
      "permiso",
      "invitar",
      "contrasena",
      "equipo"
    ],
    "contenido": "Gestión de accesos. Solo DUEÑO y ADMIN.\n\n**Listado:** nombre, email, rol, sucursal asignada, fecha de creación. Filtro por rol.\n\n**Por usuario (acciones inline):**\n- **Selector de rol**: dropdown. Al cambiar, actualiza `puede_ver_todas` automáticamente según el nuevo rol.\n- **Ícono Globe**: toggle `puede_ver_todas`. Azul = puede ver todas las sucursales. Gris = restringido. Solo visible cuando el tenant tiene sucursales.\n- **Selector de sucursal** (aparece cuando Globe está gris): asigna la sucursal asignada al usuario.\n- **Ícono Sliders**: modal de permisos granulares por módulo (No ver / Ver / Editar) para ese usuario.\n- **Ícono Trash**: desactiva usuario (sin eliminar datos).\n\n**Invitar usuario:** email + rol → envía email con link (Resend).\n\n**Roles del sistema:**\n| Rol | Descripción | `puedeVerTodas` por defecto | Restringible |\n|-----|-------------|--------------------------|-------------|\n| **DUEÑO** | Dueño — acceso total | Siempre sí (hardcoded) | ❌ No |\n| **SUPER_USUARIO** | Admin de sistemas | Sí por defecto | ✅ con `puede_ver_todas=false` en DB |\n| **SUPERVISOR** | Inventario y movimientos | Sí por defecto | ✅ con `puede_ver_todas=false` en DB |\n| **CONTADOR** | Dashboard, gastos y reportes | No | ✅ con `puede_ver_todas=true` en DB |\n| **CAJERO** | Solo ventas y caja | No (debe tener sucursal) | — |\n| **DEPOSITO** | Productos e inventario | No (debe tener sucursal) | — |\n| **RRHH** | Gestión de empleados | No (debe tener sucursal) | — |\n\n> ⚠️ El rol **OWNER** fue renombrado a **DUEÑO** en migration 100 (2026-05-13).\n\n**Roles personalizados:** sección colapsable al final. Nombre libre + permisos por módulo. Se aplican como overlay sobre el rol base.\n\n**Relaciones:** controla acceso a todos los módulos. `puedeVerTodas` controla el selector del header y el filtro de datos en todos los módulos.\n\n---"
  },
  {
    "id": "3.20",
    "titulo": "Configuración",
    "ruta": "/configuracion",
    "keywords": [
      "configuracion",
      "ajustes",
      "integracion",
      "tiendanube",
      "mercadolibre",
      "mercadopago",
      "metodo de pago",
      "certificado",
      "modo avanzado",
      "modo basico"
    ],
    "contenido": "Setup completo del negocio y sus parámetros. Solo DUEÑO.\n\n**Tabs:**\n- **Negocio**: nombre, logo, tipo de comercio, CUIT, datos fiscales, contacto, moneda principal\n- **Categorías**: CRUD de categorías de productos\n- **Ubicaciones**: CRUD de ubicaciones del depósito. Cada ubicación puede tener `sucursal_id` (específica de una sucursal) o ser \"Global\" (visible en todas). Badge azul o \"Global\" en la lista. Selector de sucursal en el formulario de edición. Flag `disponible_surtido`: si `false`, el stock de esa ubicación NO se considera para venta.\n- **Estados de inventario**: CRUD de estados (Disponible, Cuarentena, Devuelto, etc.). Flags: `es_disponible_venta` (si ese stock puede venderse), `es_disponible_tn` (si sincroniza con TiendaNube).\n- **Motivos de movimiento**: CRUD de motivos para movimientos de caja (ej: \"Pago proveedor\") y stock (ej: \"Merma\").\n- **Métodos de pago**: activar/desactivar cuáles aparecen en el POS (Efectivo, Tarjeta, etc.). Sección \"Cuotas por banco\": agregar bancos (nombre) con sus planes de cuotas (N cuotas, interés %, flag sin interés). Se usa en el POS al pagar con Tarjeta crédito. Config guardada en tenants.cuotas_bancos JSONB.\n- **Combos**: crear bundles promocionales para el POS. Un combo = N productos juntos con un descuento (% o monto fijo). Ej: \"Combo familiar: producto A + producto B con 20% off\". Se seleccionan en el POS como si fuera un ítem más. Distinto de Kits (que son ensamblados en inventario físico).\n- **Integraciones**:\n  - **TiendaNube**: OAuth, conectar tienda, sincronizar stock, mapear productos\n  - **MercadoPago**: OAuth, conectar cuenta, gestionar suscripción Genesis360\n  - **MercadoLibre**: OAuth, conectar cuenta, mapear publicaciones\n  - **AFIP (en el tab Facturación)**: cargar certificado (**.crt + .key**) o generarlo con el **asistente** (Generar CSR → ARCA → subir el .crt), CUIT, condición IVA, puntos de venta. Multi-CUIT: sección \"Emisores fiscales\" para facturar con más de una razón social (cada una con su cert y sus PV)\n  - **MODO** (v1.8.25): QR interoperable bancario. Configura Merchant ID + API Key + ambiente (test/prod). Al conectar: botón QR aparece en VentasPage al seleccionar \"MODO\" como medio de pago. Genera QR + deep link para compartir. Edge Function: modo-crear-pago.\n- **API**: generar y revocar API keys para integración de sistemas externos (solo lectura)\n- **Estados** (sub-tab): dentro del tab \"Estados\" hay 3 sub-tabs:\n  - **Estados**: CRUD de estados de inventario\n  - **Grupos**: grupos de estados para filtrar el POS\n  - **Progresión** (ex Aging Profiles): perfiles de progresión automática de estado según días hasta vencimiento. Botón \"**Procesar ahora**\" (procesa todos los perfiles del tenant). Botón \"**Procesar**\" por perfil individual (procesa solo ese perfil).\n- **SQL Runner**: ver módulo Reportes — disponible para DUEÑO y SUPER_USUARIO\n\n---"
  },
  {
    "id": "4.1",
    "titulo": "Movimientos de stock",
    "ruta": "/movimientos",
    "keywords": [
      "movimientos",
      "stock",
      "movimiento de stock",
      "kardex",
      "trazabilidad"
    ],
    "contenido": "Registro directo de ingresos y rebajes. Acceso desde el módulo Inventario.\n\n**Modalidades:**\n- **Ingreso**: selecciona producto (o escanea), cantidad, estado de inventario, ubicación, proveedor (opcional), precio de costo, lote, vencimiento, series si aplica.\n- **Rebaje**: selecciona producto → selecciona LPN → ingresa cantidad a rebajar → motivo.\n\n**Características especiales:**\n- Usa `useGruposEstados()` para filtrar estados disponibles según el grupo activo\n- Al ingresar con series: campo para ingresar N números de serie (uno por unidad)\n- Validación: no puede rebajar más que el stock disponible en ese LPN\n- Integra `useSucursalFilter()` para filtrar LPNs disponibles\n\n**Relaciones:** escribe en `inventario_lineas` + `movimientos_stock`. Referencia productos, ubicaciones, estados.\n\n---"
  },
  {
    "id": "4.2",
    "titulo": "Métricas",
    "ruta": "/metricas",
    "keywords": [
      "metricas",
      "analisis",
      "rotacion"
    ],
    "contenido": "Dashboard de métricas avanzadas con períodos flexibles.\n\n**Períodos:** 7 días, 30 días, 90 días, mes actual, personalizado (desde/hasta).\n\n**Métricas disponibles:**\n- Ventas totales y cantidad de transacciones\n- Ticket promedio\n- Productos más vendidos (con filtro por categoría)\n- Evolución de ventas (gráfico de barras Recharts)\n- Stock valorizado\n- Margen estimado\n\n**Acceso:** Contador+. Link desde Dashboard.\n\n---"
  },
  {
    "id": "4.3",
    "titulo": "Rentabilidad",
    "ruta": "/rentabilidad",
    "keywords": [
      "rentabilidad",
      "margen",
      "ganancia"
    ],
    "contenido": "Análisis de rentabilidad de ventas.\n\n**Períodos:** 7d, 30d, 90d, mes actual.\n\n**KPIs mostrados:** ingresos, costo de ventas, margen bruto, margen %, comparativa vs. período anterior (tendencia ↑↓).\n\n**Gráfico:** rentabilidad por producto o categoría (barras Recharts).\n\n**Acceso:** Contador+. Link desde Dashboard o Métricas.\n\n---"
  },
  {
    "id": "4.4",
    "titulo": "Recomendaciones",
    "ruta": "/recomendaciones",
    "keywords": [
      "recomendaciones",
      "recomendacion",
      "sugerencia",
      "insight"
    ],
    "contenido": "Panel de recomendaciones inteligentes generadas por el sistema.\n\n**Tipos (por criticidad):**\n- 🔴 `danger`: acciones urgentes (stock en 0, deudas vencidas críticas)\n- 🟡 `warning`: acciones preventivas (stock bajo, rotación lenta)\n- 🟢 `success`: confirmaciones positivas (buenos márgenes, tendencias)\n- 🔵 `info`: información de contexto\n\n**Categorías:** stock, ventas, rentabilidad, clientes, datos, operaciones.\n\n**Filtros:** por tipo de criticidad y por categoría.\n\n**Acción por tarjeta:** botón de acción contextual que lleva al módulo correspondiente.\n\n---"
  },
  {
    "id": "4.5",
    "titulo": "Grupos de estados",
    "ruta": "/grupos-estados",
    "keywords": [
      "grupos",
      "estados",
      "grupo de estados",
      "estado de stock"
    ],
    "contenido": "Configuración de grupos de estados de inventario. Permiten filtrar visualmente qué stock es surtible en el POS y en movimientos.\n\n**Concepto:** un grupo agrupa N estados de inventario. Al activar un grupo en el POS, el sistema solo considera stock de LPNs cuyos estados pertenezcan a ese grupo (intersectado con los estados que tienen `es_disponible_venta = true`).\n\n**Datos:** nombre, descripción, `es_default` (el POS arranca con este grupo preseleccionado, marcado con ★), activo, lista de estados incluidos.\n\n**Acciones:** CRUD completo, marcar como default (Star), activar/desactivar.\n\n**Integración con el POS:**\n- Si hay grupos configurados, en el POS aparece una fila de botones sobre el buscador: uno por grupo + botón \"Todos\".\n- Al arrancar el POS se preselecciona el grupo default.\n- Cambiar de grupo recarga los productos con el nuevo filtro de stock.\n- \"Todos\" muestra stock de todos los estados disponibles para venta (sin filtro de grupo).\n\n**Integración con Movimientos (rebaje):** el selector de grupo también aparece en el tab Quitar del inventario para filtrar desde qué estados se puede rebajar.\n\n**Relaciones:** VentasPage (selector de grupo en POS), InventarioPage tab Quitar, MovimientosPage.\n\n---"
  },
  {
    "id": "4.6",
    "titulo": "Importar Productos",
    "ruta": "/importar/productos",
    "keywords": [
      "importar",
      "productos",
      "importar productos",
      "carga masiva"
    ],
    "contenido": "Carga masiva del catálogo desde Excel (.xlsx).\n\n**Columnas soportadas:** nombre, SKU, código de barras, categoría, proveedor, precio venta, precio costo, moneda (ARS/USD), alícuota IVA (0/10.5/21/27), unidad de medida, stock mínimo, regla inventario (FIFO/FEFO/LEFO/LIFO/Manual), tiene series, tiene lote, tiene vencimiento, estructura (cajas, pallets, peso, dimensiones).\n\n**Modos:** Crear nuevos / Actualizar existentes por SKU / Ambos.\n\n**Flujo:** subir archivo → previsualización con validaciones → columna de estado por fila (ok/error) → confirmar importación.\n\n---"
  },
  {
    "id": "4.7",
    "titulo": "Importar Inventario",
    "ruta": "/importar/inventario",
    "keywords": [
      "importar",
      "inventario",
      "importar inventario",
      "carga masiva de stock"
    ],
    "contenido": "Carga masiva de stock desde Excel.\n\n**Columnas:** SKU, cantidad, precio de costo, ubicación, estado de inventario, proveedor (opcional), número de lote, fecha de vencimiento, LPN (opcional), motivo, números de serie (separados por coma).\n\n**Validaciones:** producto debe existir, ubicación y estado deben existir en configuración, fecha en múltiples formatos.\n\n**Flujo:** igual que importar productos — previsualización con errores por fila → importar.\n\n---"
  },
  {
    "id": "4.8",
    "titulo": "Importar datos maestros",
    "ruta": "/importar/master",
    "keywords": [
      "importar",
      "datos",
      "maestros",
      "importar datos maestros"
    ],
    "contenido": "Carga masiva de entidades de configuración.\n\n**Tipos soportados:** categorías, proveedores, ubicaciones, estados de inventario, motivos de movimiento, combos, aging profiles, grupos de estados.\n\nCada tipo tiene su plantilla de ejemplo descargable con las columnas requeridas.\n\n---"
  },
  {
    "id": "4.9",
    "titulo": "Mi Cuenta",
    "ruta": "/mi-cuenta",
    "keywords": [
      "cuenta",
      "mi cuenta",
      "perfil",
      "cambiar email",
      "cambiar contrasena",
      "eliminar cuenta"
    ],
    "contenido": "Perfil y configuración personal del usuario.\n\n**Secciones:**\n- **Perfil**: avatar (upload a Storage), nombre de display, email, método de autenticación (email/password o Google OAuth)\n- **Cambiar contraseña**: solo disponible para usuarios con login email/password\n- **Plan actual**: muestra plan contratado, límites de usuarios y productos, porcentaje de uso\n- **Zona peligrosa**: eliminar cuenta (requiere confirmación)\n\n---"
  },
  {
    "id": "4.10",
    "titulo": "Suscripción",
    "ruta": "/suscripcion",
    "keywords": [
      "suscripcion",
      "plan",
      "pago del plan",
      "addon",
      "pack",
      "upgrade",
      "ampliar plan",
      "comprobantes del plan"
    ],
    "contenido": "Gestión del plan de pago.\n\n**Planes:** Free, Básico ($4.900/mes), Pro ($9.900/mes), Enterprise (a consultar).\n\n**Acciones:**\n- Suscribirse a un plan → genera link de pago MercadoPago (modelo preapproval). Redirige al checkout de MP. Al volver con `?status=approved`, verifica el pago.\n- Comprar add-on de movimientos adicionales\n- Cancelar suscripción\n\n---"
  },
  {
    "id": "4.11",
    "titulo": "Ayuda",
    "ruta": "/ayuda",
    "keywords": [
      "ayuda",
      "soporte",
      "contacto"
    ],
    "contenido": "Centro de soporte. **La página `/ayuda` sigue siendo placeholder** — secciones con badge \"Próximamente\" (FAQ, chat, buenas prácticas, reportar problema, guías, cursos) + link a `soporte@genesis360.pro`.\n\n> ⚠️ Distinción importante: el flujo de soporte **que sí funciona** es el **Centro de Ayuda del header** (`AyudaModal`, ícono `?`), no esta página. Ahí, \"Reportar un problema\" invoca `send-email` (`type: 'bug_report'`) → ticket **server-side** a `soporte@genesis360.pro` (con user/tenant de `useAuthStore`, botón \"Enviando…\", aviso si falla). El Asistente IA del header también puede derivar la conversación a soporte por el mismo canal.\n\n---"
  },
  {
    "id": "4.12",
    "titulo": "Admin",
    "ruta": "/admin",
    "keywords": [
      "admin"
    ],
    "contenido": "Panel de administración de la plataforma **dentro de la app**. **Solo para el rol ADMIN del sistema** (staff Genesis360, no DUEÑO de tenant). Existe además una **plataforma de administración separada** en `admin.genesis360.pro` (repo aparte) para el soporte del staff.\n\n**Funciones:**\n- Listado de todos los tenants registrados\n- Filtro por estado de suscripción (trial, active, inactive, cancelled)\n- Búsqueda por nombre de negocio\n- Estadísticas por tenant: cantidad de usuarios, cantidad de productos\n- Editar tenant: `subscription_status`, `max_users`, `trial_days`\n\n**No accesible** para ningún rol de tenant regular (DUEÑO, CAJERO, etc.).\n\n---"
  },
  {
    "id": "4.13",
    "titulo": "Onboarding",
    "ruta": "/onboarding",
    "keywords": [
      "onboarding",
      "alta",
      "registro",
      "crear cuenta"
    ],
    "contenido": "Flujo de registro inicial para nuevos tenants.\n\n**Paso 1 — Cuenta** (se omite si viene de Google OAuth):\n- Email, contraseña, nombre de display\n\n**Paso 2 — Negocio:**\n- Nombre del negocio, tipo de comercio (lista configurable), país (AR/CL/UY/MX/CO/PE), teléfono\n- Opción de tipo personalizado si no está en la lista\n- **Consentimiento:** checkbox **T&C + Privacidad (requerido)** + marketing (opt-in separado, Ley 25.326). En \"confirm email ON\" viaja por el metadata del `signUp`. *(En DEV — mig 249; pendiente revisión legal antes de PROD.)*\n\n**Al completar:** crea el tenant (trial 7 días) + user DUEÑO + seed de defaults vía trigger `SECURITY DEFINER` (Sucursal 1, Caja Principal, unidades de medida, estados/grupos, categorías, caja fuerte) → `loadUserData()` → Dashboard. Ver [[autenticacion-onboarding]].\n\n---"
  },
  {
    "id": "5.1",
    "titulo": "Proceso de venta completa",
    "ruta": null,
    "keywords": [
      "proceso",
      "venta",
      "completa",
      "proceso de venta",
      "flujo de venta"
    ],
    "contenido": "```\n[POS /ventas]\n  Buscar producto → Verificar stock disponible por sucursal (inventario_lineas filtrado)\n  Agregar al carrito → Cantidad + Precio + Descuento por línea\n  Seleccionar cliente (opcional, requerido para CC)\n  Elegir medios de pago (1 o múltiples) → Calcular vuelto\n  Confirmar venta\n    ↳ Trigger DB asigna ventas.numero\n    ↳ Rebaje de stock según regla del producto (FIFO/FEFO/LIFO/etc.)\n    ↳ Si sesión de caja abierta → registra movimiento de ingreso por medio de pago\n    ↳ Si medio = Cuenta Corriente → genera deuda en CC del cliente\n    ↳ Si integración TN/ML activa → actualiza stock en marketplace\n  Opcional: Emitir factura AFIP → /facturacion\n  Opcional: Crear envío → /envios\n```"
  },
  {
    "id": "5.2",
    "titulo": "Proceso de compra (OC → Recepción → Stock)",
    "ruta": null,
    "keywords": [
      "proceso",
      "compra",
      "recepcion",
      "stock",
      "proceso de compra",
      "oc a recepcion",
      "flujo de compra"
    ],
    "contenido": "```\n[Proveedores /proveedores]\n  Crear OC → Proveedor + ítems (producto/cantidad/precio)\n  Estado: borrador → enviada\n  Registrar pago parcial/total (opcional en este punto)\n\n[Recepciones /recepciones]\n  Vincular a OC → Pre-carga ítems esperados\n  Ajustar cantidades recibidas + precios actualizados\n  Asignar ubicación en depósito + sucursal destino\n  Confirmar recepción\n    ↳ Crea inventario_lineas (stock físico agregado)\n    ↳ Crea movimientos_stock tipo ingreso\n    ↳ Actualiza estado OC (parcialmente_recibida / recibida)\n    ↳ Crea Gasto automático con gastos.recepcion_id (trazabilidad costo)\n\n[Gastos /gastos]\n  Gasto aparece en tab Gastos con referencia a la recepción\n  Registrar pago de la OC → actualiza estado_pago en ordenes_compra\n```"
  },
  {
    "id": "5.3",
    "titulo": "Proceso de devolución",
    "ruta": null,
    "keywords": [
      "proceso",
      "devolucion",
      "reembolso",
      "cambio de producto"
    ],
    "contenido": "```\n[Ventas /ventas] Historial → Expandir venta → Botón \"Devolución\"\n  Seleccionar ítems a devolver (parcial o total)\n  Ingresar motivo\n  Definir destino del stock → estado de inventario al volver\n  Confirmar devolución\n    ↳ Actualiza inventario_lineas (devuelve stock)\n    ↳ Crea movimientos_stock tipo ingreso-devolucion\n    ↳ Si venta tenía factura → opción de generar NC electrónica AFIP\n    ↳ Ajusta saldo CC del cliente si aplica\n    ↳ Ajusta ingreso en caja si aplica\n```"
  },
  {
    "id": "5.4",
    "titulo": "Apertura / cierre de caja",
    "ruta": null,
    "keywords": [
      "apertura",
      "cierre",
      "caja",
      "abrir caja",
      "cerrar caja",
      "flujo de caja"
    ],
    "contenido": "```\n[Caja /caja]\n  Seleccionar caja operativa → Abrir sesión con monto inicial\n\n  Durante el día (automático):\n    Ventas confirmadas → ingresos por medio de pago\n  \n  Durante el día (manual):\n    + Movimiento → ingreso o egreso manual con motivo\n    Arqueo → conteo físico vs. esperado\n    Traspaso → mover dinero a otra caja o a caja fuerte\n\n  Cerrar sesión\n    ↳ Ingresar monto real contado\n    ↳ Ver diferencia (faltante/sobrante)\n    ↳ Notas de cierre\n    ↳ Sesión pasa a \"cerrada\" y aparece en tab Historial\n```"
  },
  {
    "id": "5.5",
    "titulo": "Cuenta corriente (cliente)",
    "ruta": null,
    "keywords": [
      "cuenta",
      "corriente",
      "cliente",
      "cuenta corriente",
      "fiado",
      "plazo de pago"
    ],
    "contenido": "```\n[Ventas] Venta con medio \"Cuenta Corriente\"\n  → Requiere cliente con CC habilitada\n  → Genera deuda (monto + fecha de vencimiento)\n\n[Sweep externo/lazy — pg_cron NO habilitado]\n  → recálculo de intereses + detección de cuotas vencidas (EF cron-sweeps / al operar)\n  → Crea notificación en tabla notificaciones\n\n[Header] Campana\n  → Muestra badge con cuotas vencidas\n\n[Clientes /clientes] → Gestionar CC del cliente\n  → Ver lista de deudas con estados\n  → Registrar cobro → reduce saldo deudor\n  → Historial completo de movimientos\n```"
  },
  {
    "id": "5.6",
    "titulo": "Control de acceso por sucursal",
    "ruta": null,
    "keywords": [
      "control",
      "acceso",
      "sucursal",
      "acceso por sucursal",
      "ver todas las sucursales"
    ],
    "contenido": "```\nauthStore.loadUserData():\n  Si rol = DUEÑO o ADMIN → puedeVerTodas = true (hardcoded)\n  Si otro rol → puedeVerTodas = users.puede_ver_todas (DB)\n  Si !puedeVerTodas → sucursalId = users.sucursal_id (ignora localStorage)\n\nHeader:\n  Si puedeVerTodas → muestra selector dropdown con \"Todas las sucursales\"\n  Si !puedeVerTodas && sucursalId → muestra nombre fijo sin dropdown\n  Si !puedeVerTodas && !sucursalId → muestra \"Sin sucursal\" en naranja\n\nMódulos filtrados por sucursal (usan applyFilter):\n  Inventario, Movimientos, Ventas, Gastos, OC en Gastos,\n  Caja (sesiones), Recepciones, Envíos, Recursos, Productos (stock badge)\n\nMódulos globales (sin filtro):\n  Catálogo Productos, Categorías, Proveedores, Clientes (directorio compartido)\n```\n\n---"
  },
  {
    "id": "6.",
    "titulo": "Sistema de inventario avanzado (WMS)",
    "ruta": null,
    "keywords": [
      "sistema",
      "inventario",
      "avanzado",
      "wms",
      "fifo",
      "fefo",
      "kit",
      "combo",
      "estructura",
      "lote",
      "serie",
      "vencimiento"
    ],
    "contenido": "### Modelo de datos\n\n```\nproductos (catálogo)\n  └── inventario_lineas (LPN = unidad física de stock)\n        ├── producto_id → producto\n        ├── ubicacion_id → ubicaciones\n        ├── estado_id → estados_inventario\n        ├── sucursal_id → sucursales\n        ├── cantidad / cantidad_reservada\n        ├── nro_lote / fecha_vencimiento\n        └── inventario_series[] (si tiene_series)\n              └── id_serie, activo, reservado\n```\n\n### Kits vs. Combos vs. Estructuras — distinción importante\n\n| Concepto | Dónde se gestiona | Qué es |\n|----------|------------------|--------|\n| **Kit** (`es_kit = true`) | Inventario → tab Kits | Producto ensamblado físicamente desde componentes. Implica movimiento de inventario: consume componentes, genera stock del producto kit. |\n| **Combo** | Configuración → tab Combos | Bundle promocional para POS. No implica movimiento físico. Solo define precio especial para N productos vendidos juntos (descuento % o monto). |\n| **Estructura** | Productos → tab Estructuras | Embalaje logístico (unidad/caja/pallet con dimensiones y pesos). No implica stock ni precio. |\n\n### Reglas de rebaje (orden de consumo al vender)\n- **FIFO**: primer LPN creado se consume primero (por `created_at`)\n- **FEFO**: LPN con vencimiento más próximo se consume primero\n- **LEFO**: LPN con vencimiento más lejano se consume primero\n- **LIFO**: último LPN creado se consume primero\n- **Manual**: el operador elige qué LPN usar (picker en POS)\n\n### Stock disponible para venta\nSolo se computa desde LPNs donde:\n- `inventario_lineas.activo = true`\n- `inventario_lineas.estado_id` tiene `es_disponible_venta = true`\n- `ubicaciones.disponible_surtido = true`\n- Filtrado por `sucursal_id` si hay sucursal activa\n\n### Stock que aparece en TiendaNube\nLPNs donde `estado_id` tiene `es_disponible_tn = true`.\n\n---"
  },
  {
    "id": "7.",
    "titulo": "Sistema de alertas y notificaciones",
    "ruta": null,
    "keywords": [
      "sistema",
      "alertas",
      "notificaciones",
      "alerta",
      "notificacion",
      "campana"
    ],
    "contenido": "### Campana del header\n- `notificaciones` tabla: registros por tenant con `leido`, `tipo`, `mensaje`\n- Badge = conteo de no leídas\n- Al hacer clic → panel desplegable con listado. Marcar como leída/todas.\n\n### Tareas programadas (sin pg_cron)\n**pg_cron / pg_net NO están habilitados** en el proyecto → los jobs corren por **sweep lazy** (al operar) o por **cron externo** (GitHub Actions) que invoca la Edge Function `cron-sweeps`. Ejemplos: cuotas CC vencidas, liberar reservas vencidas (acredita seña−penalidad al saldo a favor), recalcular intereses de CC, cumpleaños de empleados. Ver [[pg_cron_no_habilitado]].\n\n### Página Alertas (`/alertas`)\nAlertas operativas sin resolver: stock crítico, reservas antiguas, productos sin categoría, próximos a vencer. Cada alerta tiene acción contextual y botón \"Resolver\".\n\n---"
  },
  {
    "id": "8.",
    "titulo": "Integraciones activas",
    "ruta": null,
    "keywords": [
      "integraciones",
      "activas",
      "integracion",
      "tiendanube",
      "mercadolibre",
      "mercadopago",
      "api externa"
    ],
    "contenido": "### TiendaNube\n- OAuth por sucursal. Sync stock bidireccional (cron + webhook desde TN).\n- Ventas de TN se registran en `ventas_externas_logs` (no como ventas normales).\n- Mapeo producto G360 ↔ producto TN en `tn_product_mappings`.\n- Estados con `es_disponible_tn = true` determinan qué stock se publica.\n\n### MercadoLibre\n- OAuth por sucursal. Sync stock (cron cada 5 min).\n- Mapeo publicación ML ↔ producto G360 en `meli_listings`.\n\n### MercadoPago\n- OAuth por sucursal. Procesamiento de pagos en POS.\n- Gestión de suscripciones Genesis360 (modelo preapproval — `init_point` construido en frontend).\n\n### Resend\n- Emails transaccionales (bienvenida, ventas, alertas) + tickets de soporte (`type: 'bug_report'` del Centro de Ayuda / Asistente IA → `soporte@genesis360.pro`).\n- **FROM = `noreply@genesis360.pro`** (dominio verificado, plantilla rebrandeada degradé violeta→cian). Ver [[resend-email]].\n\n### Cloudflare Email Routing\n- Recepción de correo (Resend solo envía): `soporte@` → Google Group `genesis360-soporte@googlegroups.com`; `hola@` → gmail de GO.\n\n### AFIP (en PROD, vía AfipSDK)\n- Configuración de certificados / condición fiscal / punto de venta en `/configuracion`.\n- Emisión electrónica **operativa**: `emitir-factura` (Edge Function) usa AfipSDK → CAE (Factura A/B/C, NC/ND). Flag `afip_produccion` por tenant (homologación ↔ producción).\n- PDF con QR AFIP (RG 4291) + Ley 27.743 en Factura B. Ver [[facturacion-afip]].\n- **Backlog:** migrar a WSFE 100% propio (sin AfipSDK).\n\n### API externa\n- `api_keys` table: claves generadas en `/configuracion` → tab API.\n- `data-api` Edge Function: permite consultas de datos por sistemas externos (solo lectura).\n\n### MODO (v1.8.25 — framework listo, pendiente credenciales)\n- Tabla modo_credentials por tenant (merchant_id, api_key, ambiente test/prod)\n- Edge Function modo-crear-pago: genera QR + deep link via MODO API\n- Integrado en VentasPage: \"MODO\" como medio de pago, botón QR morado, modal con QR escaneabile + link para compartir\n- Pendiente: conectar credenciales reales cuando MODO las provea\n\n---"
  },
  {
    "id": "9.",
    "titulo": "Planes y límites",
    "ruta": null,
    "keywords": [
      "planes",
      "limites",
      "plan",
      "limite",
      "precio del plan",
      "trial",
      "prueba gratis"
    ],
    "contenido": "| Plan | Usuarios | Productos | Features extra | Precio |\n|------|----------|-----------|----------------|--------|\n| Free | 1 | 50 | — | $0 |\n| Básico | 2 | 500 | Historial, Reportes | $4.900/mes |\n| Pro | 10 | 5.000 | + RRHH, Métricas avanzadas | $9.900/mes |\n| Enterprise | ∞ | ∞ | Todo incluido | A consultar |\n\n- `usePlanLimits()`: hook que calcula límites y porcentajes de uso\n- `<UpgradePrompt />`: bloquea el módulo con un CTA de upgrade cuando se alcanza el límite\n- Early returns con `<UpgradePrompt />` siempre DESPUÉS de todos los hooks del componente\n\n---"
  },
  {
    "id": "10.",
    "titulo": "Seguridad y autenticación",
    "ruta": null,
    "keywords": [
      "seguridad",
      "autenticacion",
      "login",
      "google",
      "sesion",
      "contrasena"
    ],
    "contenido": "### Autenticación\n- **Email/contraseña**: registro directo o por invitación (link en email)\n- **Google OAuth**: `loadUserData()` se llama ANTES de `navigate('/dashboard')` para que Zustand tenga los datos del tenant\n\n### Onboarding\n- Paso 1: crear cuenta (omitido con Google OAuth)\n- Paso 2: crear negocio → genera tenant, crea user con rol **DUEÑO**, seedea defaults (sucursal, caja, unidades, estados) vía trigger `SECURITY DEFINER`. Trial de 7 días.\n- Consentimiento en el alta: **T&C + Privacidad (requerido)** + marketing (opt-in separado, Ley 25.326) → columnas `terminos_aceptados_at` / `terminos_version` / `marketing_consent` (mig 249). *En DEV — pendiente revisión legal antes de PROD.* Ver [[autenticacion-onboarding]].\n\n### RLS (Row Level Security)\n- Todas las tablas: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`\n- Helper functions `SECURITY DEFINER`: `is_admin()`, `is_rrhh()`\n- 7 warnings de Security Advisor aceptados por diseño (documentados)\n\n### Control de acceso por rol\nRoles del tenant: **DUEÑO** · SUPER_USUARIO · SUPERVISOR · CAJERO · DEPOSITO · RRHH · CONTADOR · VIEWER. (**ADMIN** = staff Genesis360, no es del tenant.)\n```\nDUEÑO / ADMIN: acceso total\nSUPER_USUARIO: operación amplia, ve todas las sucursales por defecto\nSUPERVISOR: sin /configuracion, /usuarios, /sucursales, /rrhh\nCONTADOR: solo /dashboard, /gastos, /reportes, /historial, /metricas\nCAJERO: solo /ventas, /caja, /clientes, /envios (fijado a su sucursal)\nDEPOSITO: solo /inventario, /productos, /alertas, /recepciones\nVIEWER: solo lectura\n```\nConvención de flags: `ownerOnly` = DUEÑO+ADMIN · `supervisorOnly` = DUEÑO+SUPERVISOR+ADMIN. Permisos granulares por módulo overrideables por usuario individual (Sliders en Usuarios). El aislamiento por sucursal se aplica **server-side** (RLS, helpers `auth_ve_todas_sucursales()` / `auth_user_sucursal()`).\n\n### Session timeout\n- `useInactivityTimeout()`: bloquea la app por inactividad. Muestra modal de re-autenticación.\n\n---\n\n*Última actualización: 2026-07-01 — App v1.100.0 (PROD = DEV). Cifras de estado (versión/migraciones/tests) en `sources/raw/project_pendientes.md`.*"
  }
]
