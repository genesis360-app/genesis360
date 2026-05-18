# Grupos de variantes de producto

Permite agrupar múltiples SKUs que son variantes de un mismo artículo (ej: Remera S/M/L en Azul/Rojo). Cada SKU sigue siendo un producto normal con su propio stock, precio y LPNs.

## Schema (migration 120)

```sql
-- Tabla: producto_grupos
id, tenant_id, nombre, descripcion, imagen_url,
precio_base NUMERIC,    -- precio base heredable
categoria_id UUID,      -- categoría compartida
atributos JSONB,        -- [{"nombre":"Talle","valores":["S","M","L"]},...]
activo BOOLEAN

-- productos (columnas agregadas)
grupo_id UUID NULL REFERENCES producto_grupos(id)
variante_valores JSONB NULL  -- {"Talle":"M","Color":"Azul"}
```

RLS: `tenant_isolation` con `USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))`.

## Componentes

### `src/components/ProductoGrupoModal.tsx`

Modal para crear/editar un grupo. Secciones:
- **Datos básicos**: nombre (required), descripción, categoría, precio base
- **Atributos de variante**: lista editable de `{nombre, valores[]}`. Tag-input nativo (Enter/coma agregan, Backspace elimina último). Chips de sugerencias rápidas: Talle, Color, Sabor, Formato, Encaje.
- **Variantes existentes** (solo al editar): lista compacta con badges de `variante_valores`, link a editar cada una.
- **Generar combinaciones**: producto cartesiano de atributos. Preview de combinaciones. Botón "Generar N variantes" → guarda grupo primero → crea productos que no existen (SKU = `PREFIX-RAND-SUFIJO`). Toast con creadas vs ya existentes.

### `src/pages/ProductosPage.tsx`

- **Botón "Grupos"** en barra de acciones → abre panel lateral (drawer) con lista de grupos y botón "Nuevo grupo".
- **Toggle "Agrupar variantes"** (ícono Layers) junto al search bar. Alterna entre `viewMode: 'flat' | 'grouped'`.
- **Vista agrupada**: productos sin grupo bajo "Productos individuales" (colapsable), grupos como secciones expandibles con tabla de variantes (Nombre/SKU | Variante | Precio | Stock), botón "Editar grupo".
- **Vista plana (default)**: badge `• Parte de "X"` bajo el nombre cuando `grupo_id` tiene valor.

### `src/pages/ProductoFormPage.tsx`

Nueva card **"Grupo de variantes"** (entre Tracking y Marketplace):
- Sin grupo: botón "Vincular a un grupo" → dropdown selector de grupos existentes o "Nuevo grupo". Al vincular, aparecen inputs por atributo.
- Con grupo: badge "Variante de: nombre", selects/inputs por atributo del grupo, badges con valores actuales, lista de otras variantes del grupo con link a editar, botón "Desvincular del grupo".
- Guardado: incluye `grupo_id` y `variante_valores` en INSERT/UPDATE.

## Flujo típico

1. Crear grupo (desde "Grupos" en ProductosPage o desde ProductoFormPage).
2. Definir atributos (ej: Talle con S/M/L, Color con Azul/Rojo).
3. Generar combinaciones → crea 6 productos (3 talles × 2 colores).
4. Cada producto puede editarse individualmente con su precio, imagen, stock.
5. En ProductosPage vista agrupada → ver y gestionar todas las variantes juntas.

## Notas técnicas

- El grupo no tiene stock propio; solo agrupa SKUs.
- `variante_valores` es JSONB libre — no hay restricción a los atributos del grupo (permite ediciones futuras).
- SKU auto-generado al crear variantes: `PREFIX(4)-RAND(4)-SUFVAR` (ej: `REME-0341-SAZ`).
- `staleTime: 0` en todas las queries (comportamiento global de la app).
