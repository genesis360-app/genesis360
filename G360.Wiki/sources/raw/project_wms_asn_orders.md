---
name: arquitectura_asn_orders
description: Arquitectura de módulos ASN (recepciones) y Orders (despachos) — decisiones de diseño y separación de responsabilidades
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Decisión de arquitectura (confirmada 2026-04-19)

**Módulos separados pero vinculados** — OC en `/proveedores` y Recepciones en `/recepciones`.

```
Proveedor → OC (Orden de Compra) → Recepción/ASN → Inventario
Cliente   → Orden de Venta       → Picking        → Despacho → Inventario
```

**Why:** Roles diferentes. OC = compromiso financiero/comercial (OWNER/SUPERVISOR). Recepción = operación de almacén (DEPOSITO). La recepción puede ocurrir sin OC (compra spot, consignación, devolución de cliente). Mantener separación de responsabilidades.

**How to apply:**
- OC confirmada → botón "Recibir mercadería" navega a `/recepciones/nuevo?oc_id=XXX` pre-poblando ítems.
- En `/recepciones`, campo "Contra OC" opcional (dropdown de OCs confirmadas del mismo proveedor).
- Al confirmar recepción → genera ingreso en `inventario_lineas` (reutiliza lógica de `procesarMasivoIngreso`) + marca OC como `recibida_parcial` o `recibida`.
- Recepción sin OC → ingreso directo, proveedor opcional.
- **NO** hacer que las OC generen ingresos directamente.

## DB pendiente (migration 050)

```sql
-- Nuevos estados en ordenes_compra
ALTER TABLE ordenes_compra
  DROP CONSTRAINT ordenes_compra_estado_check,
  ADD CONSTRAINT ordenes_compra_estado_check
    CHECK (estado IN ('borrador','enviada','confirmada','cancelada','recibida_parcial','recibida'));

-- Tabla recepciones
CREATE TABLE recepciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  numero INT NOT NULL,  -- auto per tenant (trigger)
  oc_id UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,  -- opcional
  proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','confirmada','cancelada')),
  notas TEXT,
  sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabla recepcion_items
CREATE TABLE recepcion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id UUID NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  oc_item_id UUID REFERENCES orden_compra_items(id) ON DELETE SET NULL,
  cantidad_esperada DECIMAL(12,3) DEFAULT 0,  -- de la OC, 0 si sin OC
  cantidad_recibida DECIMAL(12,3) NOT NULL DEFAULT 0,
  estado_id UUID REFERENCES estados_inventario(id),
  ubicacion_id UUID REFERENCES ubicaciones(id),
  nro_lote TEXT,
  fecha_vencimiento DATE,
  lpn TEXT,
  series_txt TEXT,  -- series separadas por newline (para serializados)
  inventario_linea_id UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,  -- generada al confirmar
  precio_costo DECIMAL(14,2)
);
```

## UI `/recepciones` (ReceptionesPage)

**Lista**: tarjetas con número, proveedor, OC vinculada, fecha, estado, total ítems.
**Nueva recepción**:
  - Proveedor (obligatorio)
  - OC vinculada (opcional — dropdown OCs confirmadas del proveedor seleccionado; si se elige, pre-puebla ítems con cantidades esperadas)
  - Tabla de ítems: Producto / Cant. esperada / Cant. recibida / Estado / Ubicación / [▾ Lote/Vencimiento/LPN/Series]
  - Botón "Confirmar recepción" → procesa cada ítem → ingreso en inventario_lineas → actualiza estado OC.

**Roles con acceso**: OWNER · SUPERVISOR · DEPOSITO (ya está en `DEPOSITO_ALLOWED`).

## Estado actual (2026-04-19)

- `ordenes_compra` + `orden_compra_items` (migration 049) ✅ PROD
- Botón ASN conectado en InventarioPage → `/recepciones` (v0.82.0) ✅
- `recepciones` + `recepcion_items`: pendiente migration 050
- `ReceptionesPage.tsx`: pendiente implementar
- Botón "Recibir mercadería" en OC confirmada: pendiente
- Orders module (despachos): pendiente más largo plazo, se integra con WMS Fase 3
