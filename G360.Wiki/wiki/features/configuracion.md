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

> [!NOTE] **Guardado consolidado (v1.67.0):** todas las cards de un tab que editan la config del negocio comparten el mismo `handleSaveBiz` (guarda todo el estado), así que ya **no hay un botón "Guardar" por card** — hay **un solo botón por tab**. Se consolidó en Envíos (11→1) y Ventas→Operativa (5→1). Al agregar una card nueva a uno de esos tabs, **no** agregues otro botón Guardar: el del final del tab ya la cubre.

### Grupo: Negocio

| Tab | Contenido |
|-----|-----------|
| **Mi negocio** | Nombre, tipo de comercio, timeout de sesión, plan actual, marketplace |
| **Ventas** | Sub-tabs: Métodos de pago · Descuentos y combos · Operativa |
| **Caja** | Contraseña maestra, umbral bóveda |
| **Clientes** | Placeholder — próximamente |
| **Inventario** | Sub-tabs: Reglas de stock · Categorías · Ubicaciones · Estados · Motivos · Unidades · Atributos (🟡 EN DEV) |
| **Envíos** | Costo por km, plantilla WhatsApp |
| **Facturación** | CUIT, condición IVA, razón social, domicilio fiscal, umbral factura B, token AFIP, certificados, puntos de venta |
| **RRHH** | Asistencia/tardanzas, Nómina, Documentos (v1.81.x, H4) |

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
| Redondeo de precios | `tenants.precio_redondeo` | none / $10 / $50 / $100 / $500 / $1.000 — ✅ **aplicado (v1.82.0, H4)**: redondea el precio unitario efectivo del POS al múltiplo más cercano. Helper puro `redondearPrecio` (round-half-up, fail-safe, default none) en el punto canónico `precioTierEfectivo` → subtotal/IVA/`venta_items.precio_unitario`/factura derivan todos del mismo valor redondeado. No toca precios ya guardados del catálogo. |
| Timeout de sesión | `tenants.session_timeout_minutes` | Cierre automático por inactividad |

> [!NOTE] **Email legal QUITADO (H4, 2026-06-22):** el campo `email_legal` se removió del frontend — `tenants.email` ya cubre comprobantes y emails salientes; la columna DB queda inerte.

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
  - **CAJERO** (y demás roles operativos): **100% bloqueado** de descuentos (regla C3/G3). El campo `descuento_max_cajero_pct` se **quitó** del frontend en H4 (2026-06-22) — era un tope ilusorio; la columna DB queda inerte.
  - `tenants.descuento_max_supervisor_pct`: límite para SUPERVISOR (vacío = sin límite). Se valida el **% efectivo** (los descuentos en $ se convierten a % → no esquivan el tope, lib `validarDescuentosPorRol`).
  - DUEÑO/ADMIN nunca tienen límite. Sobre el tope: con clave maestra configurada se autoriza (override); sin clave, bloquea.

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
| Contraseña maestra | `tenants.clave_maestra` — requerida para cerrar caja ajena, abrir con diferencia, anular, dar de baja incobrable, pago OC/courier sobre umbral. **Guardada HASHEADA (bcrypt, mig 233)** — se setea vía el RPC `set_clave_maestra` (solo DUEÑO, mínimo 6 chars, con campo de confirmación); se verifica con `verificar_clave_maestra`. No se compara nunca en el cliente. |
| Umbral bóveda | `tenants.boveda_umbral_caja` — desde **H4 (2026-06-22)** genera una **alerta no-bloqueante**: cuando una caja operativa abierta tiene efectivo sobre este monto → "conviene depositar a la Caja Fuerte". Aparece en el badge del sidebar (`useAlertas`) y en `AlertasPage`. No mueve plata. Helper `cajasSobreUmbralBoveda` (`lib/cajaSaldo.ts`). |

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

### Sub-tab: Atributos (✅ PROD desde v1.134.0, 2026-07-18)

Catálogo configurable de valores para talle/color/encaje/formato/sabor·aroma (mig 273, tabla
`atributos_variante_valores`). CRUD por atributo (tabs), soft-delete `activo=false` (patrón Motivos).
Alimenta `AtributoValorSelect` en Recepciones/Ingreso manual y el picker de rebaje en VentasPage.
Detalle: [[wiki/features/atributos-variante]].

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

## RRHH (H4 — v1.81.x, 2026-06-22)

Tab construido para configurar los flags `rrhh_*` que RrhhPage lee pero antes no tenían UI (eran "placeholder vacío"). Los otros flags de RRHH (doble validación, portal del empleado, notificaciones, aviso/remanente de vacaciones) **ya se configuran dentro de RRHH** en su sección.

| Sección | Campo | DB | Descripción |
|---------|-------|-----|-------------|
| Asistencia/tardanzas | Tratamiento de la tardanza | `tenants.rrhh_tardanza_modo` | `registrar` (no descuenta) / `proporcional` (descuenta todos los minutos) / `umbral` (descuenta lo que excede la tolerancia) — afecta la liquidación |
| Asistencia/tardanzas | Tolerancia (min) | `tenants.rrhh_tardanza_tolerancia_min` | Minutos que no se descuentan. Solo aplica al modo `umbral`. |
| Asistencia/tardanzas | Horas/mes base | `tenants.rrhh_horas_mes_base` | Divisor para el valor hora a partir del sueldo bruto (default 200) |
| Asistencia/tardanzas | Horas extra requieren aprobación | `tenants.rrhh_horas_extra_requiere_aprobacion` | Bool |
| Nómina | SUPERVISOR puede aprobar la nómina | `tenants.rrhh_nomina_supervisor_aprueba` | Cuenta como 2ª validación (si la doble validación está activada en RRHH → Nómina) |
| Documentos | Avisar vencimientos con (días) | `tenants.rrhh_doc_alerta_dias` | Anticipación para marcar un documento como "por vencer" (default 30) |

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
