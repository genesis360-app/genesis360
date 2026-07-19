# Grupos de variantes de producto

Permite agrupar múltiples SKUs que son variantes de un mismo artículo (ej: Remera S/M/L en Azul/Rojo). Cada SKU sigue siendo un producto normal con su propio stock, precio y LPNs.

> [!NOTE] **No confundir con "Atributos de variante"** (`tiene_talle`/`tiene_color`/etc. en ProductoFormPage → Trazabilidad) — ese es un sistema DISTINTO donde el talle/color es un dato descriptivo **dentro del mismo SKU** (no un producto separado). Este documento cubre "Grupo de variantes" (SKU separado). Ver [[wiki/features/atributos-variante]] (✅ PROD, las 4 rondas) para el otro sistema.

> [!WARNING] **🐛 Bug real de duplicado + fix (✅ PROD, v1.135.0, 2026-07-19).** GO reportó que al
> crear el grupo "Remera Los Redondos" se le duplicó — 2 filas
> idénticas en `producto_grupos`, una con los 9 productos-variante reales enganchados y otra vacía
> (0 productos), creadas 5 segundos aparte. **Causa raíz (código, no adivinada):** en
> `ProductoGrupoModal.guardarGrupo()`, la condición INSERT-vs-UPDATE era `if (isEditing &&
> grupoId)` — pero `isEditing` es una constante derivada del prop `grupo` con el que se abrió el
> modal (`const isEditing = !!grupo`), que **nunca cambia** dentro de la misma sesión del modal, ni
> siquiera después de un primer guardado exitoso (que sí actualiza `grupoId` vía
> `setGrupoId(data.id)`). Si dentro del mismo modal (sin cerrarlo) se guarda una segunda vez —
> típicamente al clickear **"Generar variantes" más de una vez**, ya que ese flujo llama a
> `guardarGrupo()` internamente y **NO cierra el modal** (a diferencia de "Crear grupo", que sí
> cierra tras guardar) — la condición seguía dando `false` y hacía un INSERT nuevo en vez de un
> UPDATE, duplicando el grupo. **Fix:** la condición pasó a `if (grupoId)` a secas (sin
> `isEditing`) — una línea.
>
> **El grupo duplicado real de GO ("Remera Los Redondos") sigue sin resolver a propósito** — pedirle
> a GO que use el botón "Eliminar grupo" (ver abajo) sobre el duplicado vacío ("0 variantes").
> Durante las pruebas del fix, un script de test con selector ambiguo desactivó por error el grupo
> BUENO (el de los 9 productos) en vez del vacío — detectado y revertido al toque, sin pérdida de
> datos por ser soft-delete.

> [!NOTE] **🟡 Auto-sufijo de nombre al vincular + aclaración de por qué el ingreso NO pide talle
> (EN DEV, sin commitear, 2026-07-19).** GO preguntó por qué al hacer ingreso de inventario de
> "Remera Básica" (vinculada a un grupo con Talle=S) no le pedía el talle. **Es el comportamiento
> correcto por diseño, no un bug**: acá cada talle es un SKU SEPARADO (a diferencia de "Atributos de
> variante", donde el talle se pide por LPN dentro del MISMO SKU — ver
> [[wiki/features/atributos-variante]]) — el SKU que el operador elige al ingresar YA ES esa
> variante, no hay ambigüedad que resolver. El detalle real que faltaba: en NINGÚN lado de
> Inventario/Ventas/tickets se muestra un badge de variante (eso solo existe en el panel de "Grupos"
> dentro de ProductosPage) — el **nombre del producto es el único lugar** donde se distingue la
> variante en esas pantallas, y "Remera Básica" a secas no lo reflejaba. **Causa raíz:** "Generar
> variantes" (alta automática desde el modal del grupo) sí arma el nombre como `Grupo — Valor`, pero
> **vincular un producto YA EXISTENTE** a un grupo (el flujo que usó GO, desde `ProductoFormPage`) no
> aplicaba ese sufijo. **Fix:** `ProductoFormPage.tsx` — al guardar un producto vinculado a un grupo
> con valores de variante cargados, el nombre se auto-completa con `— <valor>` (mismo criterio que
> "Generar variantes"); si el usuario cambia de valor (ej. S → M) se despega el sufijo viejo antes de
> agregar el nuevo. El registro de prueba de GO ("Remera Básica", SKU-00092) fue renombrado a mano a
> "Remera Básica — S" para reflejarlo de inmediato. Sin migración. Ver `log.md` 2026-07-19.

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
- **Vista agrupada**: productos sin grupo bajo "Productos individuales" (colapsable), grupos como secciones expandibles con tabla de variantes (Nombre/SKU | Variante | Precio | Stock), botones **"Editar grupo"** y **"Eliminar"**.
- **Vista plana (default)**: badge `• Parte de "X"` bajo el nombre cuando `grupo_id` tiene valor.
- **Eliminar grupo (2026-07-19, nuevo, ✅ PROD v1.135.0):** hasta esta sesión no existía
  NINGUNA forma de sacar un grupo no deseado (ni en la UI ni en el código — confirmado grepeando
  todo `src/`). Botón "Eliminar" en cada tarjeta de grupo → modal de confirmación → soft-delete
  (`producto_grupos.activo = false`, mismo patrón que Motivos/Estados, mutación
  `eliminarGrupoMut`). **No borra ni desvincula los productos** — quedan como productos sueltos
  (con su `grupo_id` apuntando a un grupo inactivo), simplemente dejan de listarse agrupados en esa
  vista. Sin migración nueva (la columna `activo` ya existía en `producto_grupos`).

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
