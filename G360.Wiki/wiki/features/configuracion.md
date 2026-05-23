---
title: Módulo Configuración
category: features
tags: [configuracion, config, metodos-pago, ubicaciones, estados, categorias, sucursales]
sources: [CLAUDE.md]
updated: 2026-05-20
---

# Módulo Configuración

**Página:** `src/pages/ConfigPage.tsx` (`/configuracion`)  
**Acceso:** DUEÑO · ADMIN (lectura para otros roles según campo)

---

## Estructura de tabs (v1.8.33 — Fase 1)

La ConfigPage fue reorganizada de 10 tabs planas a **11 tabs temáticas** con separadores de grupo:

### Grupo: Negocio

| Tab | Contenido |
|-----|-----------|
| **Mi negocio** | Nombre, tipo de comercio, timeout de sesión, plan actual, marketplace |
| **Ventas** | Sub-tabs: Métodos de pago · Descuentos y combos · Operativa |
| **Caja** | Contraseña maestra, umbral bóveda |
| **Clientes** | Placeholder — próximamente |
| **Inventario** | Sub-tabs: Reglas de stock · Categorías · Ubicaciones · Estados · Motivos · Unidades |
| **Envíos** | Costo por km, plantilla WhatsApp |
| **Facturación** | CUIT, condición IVA, razón social, domicilio fiscal, umbral factura B, token AFIP, certificados, puntos de venta |
| **RRHH** | Placeholder — próximamente |

### Grupo: Sistema

| Tab | Contenido |
|-----|-----------|
| **Alertas** | Placeholder — próximamente |
| **Notificaciones** | Placeholder — próximamente |
| **Conectividad** | Sub-tabs: Integraciones (TN, MELI, MP, MODO) · API |

---

## Mi negocio (v1.8.34 · consolidado v1.8.38)

Configuración a nivel tenant — aplica a todo el negocio independientemente de la sucursal.

> [!NOTE] Los campos por sucursal (CP, email, horario, PV AFIP) fueron movidos al formulario de edición de **SucursalesPage** en v1.8.38. Config → Mi negocio ya no tiene sección "por sucursal".

| Campo | DB | Descripción |
|-------|-----|-------------|
| Nombre | `tenants.nombre` | Nombre del negocio |
| Tipo de comercio | `tenants.tipo_comercio` | Selector + campo libre "Otro" |
| Email legal | `tenants.email_legal` | Para notificaciones fiscales |
| Redondeo de precios | `tenants.precio_redondeo` | none / $10 / $50 / $100 / $500 / $1.000 |
| Timeout de sesión | `tenants.session_timeout_minutes` | Cierre automático por inactividad |

### Marketplace
Toggle activo + webhook URL (`tenants.marketplace_activo`, `tenants.marketplace_webhook_url`)

---

## Ventas

### Sub-tab: Métodos de pago

- **Lista de métodos**: toggle activo, color, nombre — cargados desde tabla `metodos_pago` (ISS-133)
- **Comisión % por método** (`metodos_pago.comision_pct`): el % que cobra la plataforma (MP cobra 5%, tarjeta 3%). Útil para calcular ganancia neta en Dashboard.
- **Agregar método personalizado**
- **Cuotas por banco** (`tenants.cuotas_bancos JSONB`): config por banco → planes de cuotas

### Sub-tab: Descuentos y combos

- **Combos de productos**: CRUD, 3 tipos de descuento (%, $ARS, USD), presets 3×2/2×1/2da unidad
- **Descuento máximo por rol**:
  - `tenants.descuento_max_cajero_pct`: límite para CAJERO sin autorización
  - `tenants.descuento_max_supervisor_pct`: límite para SUPERVISOR
  - DUEÑO nunca tiene límite

### Sub-tab: Operativa

- **Validez de presupuesto** (`tenants.presupuesto_validez_dias`): días antes de expirar
- **Cliente en POS**:
  - `cliente_obligatorio`: siempre / solo reservas / nunca
  - `cliente_datos_minimos`: nombre / nombre+DNI / nombre+DNI+email / todos
  - `cliente_consumidor_final` BOOLEAN: permite vender sin identificar al cliente
  - `cliente_creacion_inline` BOOLEAN: crear clientes desde el POS

---

## Caja (v1.8.34)

| Campo | DB |
|-------|-----|
| Contraseña maestra | `tenants.clave_maestra` — requerida para cerrar caja ajena |
| Umbral bóveda | `tenants.boveda_umbral_caja` — alertar cuando el saldo supera este monto |

---

## Inventario

### Sub-tab: Reglas de stock
- **Regla de inventario** (`tenants.regla_inventario`): FIFO / FEFO / LIFO / LEFO / Manual
- **Over-receipt** (`tenants.permite_over_receipt`): permite ingresar más cantidad que la OC

### Sub-tabs heredados
Todas estas secciones existían antes como tabs autónomas; ahora son sub-tabs de Inventario:
- **Categorías** → ABM de categorías de productos
- **Ubicaciones** → ABM con WMS (dimensiones, tipo, mono-SKU, surtido, devolución)
- **Estados** → ABM + Grupos de estados + Progresión (aging profiles)
- **Motivos** → ABM de motivos de movimiento (ingreso / rebaje / caja)
- **Unidades de medida** → ABM de unidades custom

---

## Envíos

| Campo | DB |
|-------|-----|
| Costo por km | `tenants.costo_envio_por_km` — para calcular delivery propio |
| Plantilla WhatsApp | `tenants.whatsapp_plantilla` — variables: Nombre_Cliente, Numero_Orden, etc. |

---

## Facturación (AFIP/ARCA)

| Campo | DB |
|-------|-----|
| Habilitada | `tenants.facturacion_habilitada` |
| CUIT | `tenants.cuit` |
| Condición IVA | `tenants.condicion_iva_emisor` |
| Razón social | `tenants.razon_social_fiscal` |
| Domicilio fiscal | `tenants.domicilio_fiscal` |
| Umbral factura B | `tenants.umbral_factura_b` (RG 5616) |
| Token AfipSDK | `tenants.afipsdk_token` — de afipsdk.com |
| Certificados | tabla `tenant_certificates` (crt + key) — upload via Storage |
| Puntos de venta | tabla `puntos_venta_afip` — número + nombre |

---

## Conectividad

### Sub-tab: Integraciones

Conectar cuentas externas por sucursal:

| Plataforma | OAuth | Modelo |
|---|---|---|
| TiendaNube | ✅ | Sync stock bidireccional + mapeo productos |
| MercadoLibre | ✅ | Sync stock + mapeo + precios |
| MercadoPago | ✅ | Credenciales de pago por sucursal |
| MODO | Credenciales | Merchant ID + API Key + ambiente (test/prod) |

### Sub-tab: API

- API de datos externa (solo lectura)
- Genera claves `g360_xxxxx` con hash SHA-256
- Endpoints: productos, clientes, proveedores, inventario
- Rate limit: 120 req/min

---

## Links relacionados

- [[wiki/features/gastos]]
- [[wiki/features/caja]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/integrations/roadmap-apis]]
