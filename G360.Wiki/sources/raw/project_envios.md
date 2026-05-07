---
name: modulo_envios
description: Módulo de gestión de envíos con seguimiento, cotizador de couriers y generación de remitos
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Estado

- ✅ DEV implementado (v1.3.0)
- ⏳ PROD pendiente deploy (PR junto con v1.3.0)

## Respuestas del usuario (decisiones de diseño)

1. **Dirección clientes**: opcional, guardada en `cliente_domicilios` (tab "Domicilios" en ficha cliente, migration 074). Al crear envío el cajero elige un domicilio guardado o ingresa manualmente.
2. **Origen**: todos los canales. MELI Full y TN Envíos propios NO generan envío en G360. Filtrar por canal.
3. **Nivel**: A (tracking) + B (full automation) — combinación.
4. **Couriers**: sin contratos aún (OCA, Correo Argentino, Andreani, DHL Express).
5. **Ticket**: remito simple G360 + etiqueta oficial del courier en base64. Un formato por courier.
6. **Rate shopping**: comparar tarifas entre couriers con peso/dim/CP → usuario elige la mejor → genera el envío.

## Lo implementado

### EnviosPage (`/envios`)
- Nav: Send icon, cajeroVisible: true (OWNER/SUPERVISOR/CAJERO)
- CAJERO_ALLOWED incluye /envios

**Tab Envíos:**
- Tabla: #envío, fecha, cliente, courier, estado badge, canal, ciudad destino, entrega acordada
- Filtros: estado, courier, canal, fechas, búsqueda libre (cliente/número/tracking)
- Click fila → expandible con: destinatario completo, courier+tracking+dimensiones, productos de la venta
- Botones: avanzar estado (RefreshCw), editar (Pencil), cancelar (X), generar remito PDF, ver tracking externo, ver venta

**Estados y flujo:**
`pendiente` → `despachado` → `en_camino` → `entregado`
También: `devolucion`, `cancelado`

**Tab Cotizador:**
- Inputs: CP origen, CP destino, peso (kg), dimensiones (largo/ancho/alto cm)
- Botón "Comparar tarifas" → llama EF `courier-rates` (hoy retorna mock con 4 couriers)
- Aviso claro: "Tarifas reales disponibles cuando configures credenciales con cada courier"

**Modal Nuevo/Editar envío:**
- Buscar venta por número → autocompleta cliente y canal
- Domicilios del cliente: radio buttons desde `cliente_domicilios` o texto manual
- Courier (OCA/CorreoAR/Andreani/DHL/Otro), servicio, tracking number, URL tracking
- Canal (POS/MELI/TiendaNube/MP), costo cotizado, zona de entrega
- Fecha y hora de entrega acordada, dimensiones (peso/largo/ancho/alto)
- Notas

**Remito PDF** (jsPDF + autoTable):
- Header: empresa, #envío, fecha
- Datos courier: nombre, servicio, tracking
- Remitente (tenant) y destinatario (cliente + domicilio)
- Tabla de productos: nombre, cantidad
- Notas

## Schema (migration 075)

```sql
CREATE TABLE envios (
  id UUID PK,
  tenant_id UUID → tenants,
  sucursal_id UUID → sucursales,
  venta_id UUID → ventas (nullable),
  numero INT AUTO (trigger set_envio_numero),
  courier TEXT,
  servicio TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  estado TEXT CHECK(pendiente|despachado|en_camino|entregado|devolucion|cancelado),
  canal TEXT,  -- POS|MELI|TiendaNube|MP
  destino_id UUID → cliente_domicilios (nullable),
  destino_descripcion TEXT,
  peso_kg DECIMAL(8,3),
  largo/ancho/alto_cm DECIMAL(8,2),
  costo_cotizado DECIMAL(12,2),
  costo_real DECIMAL(12,2),
  fecha_entrega_acordada DATE,
  hora_entrega_acordada TIME,
  zona_entrega TEXT,
  etiqueta_url TEXT,  -- bucket etiquetas-envios
  notas TEXT,
  created_by UUID → public.users,
  created_at/updated_at TIMESTAMPTZ
);

-- Bucket privado: etiquetas-envios (5MB, pdf/jpg/png)
```

### `cliente_domicilios` (migration 074, prerequisito)
```sql
CREATE TABLE cliente_domicilios (
  id UUID PK,
  tenant_id UUID → tenants,
  cliente_id UUID → clientes ON DELETE CASCADE,
  nombre TEXT,  -- alias: "Casa", "Trabajo"
  calle TEXT NOT NULL,
  numero TEXT,
  piso_depto TEXT,
  ciudad TEXT,
  provincia TEXT,
  codigo_postal TEXT,
  referencias TEXT,  -- para el courier
  es_principal BOOLEAN DEFAULT FALSE
);
```

Tab "Domicilios" en `ClientesPage` (sub-tab dentro del detalle expandible):
- CRUD completo, marcar principal (⭐), referencias para courier

## Fase 2 pendiente (cuando haya contratos couriers)

Edge Function `courier-rates`:
- Input: `{ cp_origen, cp_destino, peso_kg, largo, ancho, alto, tenant_id }`
- Consultas paralelas a APIs de: OCA, Correo Argentino, Andreani, DHL Express
- Retorna: `[{ courier, servicio, precio, dias_estimados }]`
- Cada courier requiere API key configurada en `supabase secrets`

Cuando existan contratos:
- OCA: endpoint cotizador SOAP/REST
- Correo Argentino: API REST (requiere registro)
- Andreani: API REST pública para cotización
- DHL Express: Rate API (requiere account ID + key)
