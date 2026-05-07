# Genesis360 — Documento de UAT (User Acceptance Testing)

> Última actualización: 2026-04-17  
> Ambiente de prueba: DEV (`gcmhzdedrkmmzfzfveig.supabase.co`)

## Usuarios de prueba (DEV)

| Rol | Email | Contraseña | Spec E2E |
|-----|-------|-----------|----------|
| OWNER | `e2e@genesis360.test` | `test123` | `auth.setup.ts` |
| CAJERO | `cajero1@local.com` | `123` | `auth.cajero.setup.ts` · `13_rol_cajero.spec.ts` |
| RRHH | `rrhh1@local.com` | `123` | `auth.rrhh.setup.ts` · `16_rol_rrhh.spec.ts` |
| SUPERVISOR | `supervisor@test.com` | `1234` | `auth.supervisor.setup.ts` · `15_rol_supervisor.spec.ts` |

> Credenciales OWNER reales en `tests/e2e/.env.test.local` (no en repo).

---

## Módulo: Inventario — Eliminación de LPN y actualización de stock

### UAT-INV-01: Eliminar LPN actualiza `stock_actual` en ProductosPage

**Contexto:** Al eliminar un LPN desde la pestaña Inventario, el stock del producto debe actualizarse inmediatamente en la página de Productos sin recargar la app.

**Pre-condición:** Existe un producto con al menos un LPN con stock > 0 (cantidad > 0, activo = true).

**Pasos:**
1. Ir a `/inventario` → tab Inventario
2. Expandir el producto objetivo. Anotar su `stock_actual` (ej: 10 u.)
3. Hacer clic en el engranaje (acciones) del LPN
4. Ir a tab Eliminar → confirmar eliminación
5. Ir a `/productos`
6. Verificar que el stock del producto refleja el nuevo valor (ej: 0 u.)

**Resultado esperado:** `stock_actual` en ProductosPage = valor previo − cantidad del LPN eliminado.

**Resultado a verificar en tests:** `invalidateQueries(['productos'])` después del delete; trigger recalcula correctamente porque el UPDATE incluye `cantidad: 0`.

---

## Módulo: Inventario — Rebaje masivo

### UAT-INV-02: Rebaje masivo con productos sin reservas

**Contexto:** El rebaje masivo debe descontar stock correctamente para productos que no tienen reservas activas.

**Pre-condición:** Existe al menos un producto no serializado con stock > 0 y sin reservas (`cantidad_reservada = 0`).

**Pasos:**
1. Ir a `/inventario` → tab Movimientos → "Rebaje masivo"
2. Buscar y agregar el producto
3. Ingresar una cantidad válida (≤ stock_actual)
4. Confirmar operación

**Resultado esperado:** Toast "Rebaje masivo registrado". El stock del producto decrece. Se registra movimiento en historial.

**Resultado a verificar en tests:** El modal se puede abrir; el producto aparece en el buscador; el botón Confirmar se habilita al ingresar cantidad válida.

---

### UAT-INV-03: Rebaje masivo respeta stock disponible (cantidad − reservada)

**Contexto:** Si un producto tiene `cantidad_reservada > 0`, el rebaje masivo no debe permitir consumir el stock reservado ni violar el CHECK constraint.

**Pre-condición:** Producto con `cantidad = 10`, `cantidad_reservada = 6` (disponible = 4).

**Pasos:**
1. Abrir Rebaje masivo, agregar el producto
2. Intentar ingresar cantidad = 8 (> disponible)
3. Confirmar

**Resultado esperado:** Error "stock insuficiente en líneas disponibles" o similar. El stock en DB no cambia.

---

## Módulo: Gastos — Medio de pago sin default

### UAT-GAS-01: Formulario de nuevo gasto abre sin medio de pago preseleccionado

**Contexto:** El formulario de gastos no debe pre-seleccionar "Efectivo" para evitar registros erróneos cuando el pago se hizo con otro medio.

**Pasos:**
1. Ir a `/gastos`
2. Hacer clic en "Nuevo gasto"
3. Observar el campo "Medio de pago"

**Resultado esperado:** El select muestra el placeholder "Elegir método…" (valor vacío), no "Efectivo".

**Resultado a verificar en tests:** `select[value=""]` o placeholder "Elegir método" visible al abrir el form.

---

### UAT-GAS-02: Gasto sin medio de pago se guarda correctamente

**Pasos:**
1. Abrir formulario de nuevo gasto
2. Completar descripción y monto. Dejar medio de pago vacío.
3. Guardar

**Resultado esperado:** Gasto creado con `medio_pago = null`. No aparece bloqueo de caja (ese bloqueo es solo para efectivo).

---

## Módulo: Configuración — Eliminar ubicación

### UAT-CFG-01: No se puede eliminar una ubicación con inventario activo

**Contexto:** Una ubicación con stock (`cantidad > 0, activo = true`) no debe poder eliminarse.

**Pre-condición:** Existe una ubicación con al menos una línea de inventario activa y con stock.

**Pasos:**
1. Ir a `/configuracion` → tab Ubicaciones
2. Intentar eliminar la ubicación que tiene stock

**Resultado esperado:** Toast de error "No se puede eliminar: tiene inventario activo. Vacíala primero."

---

### UAT-CFG-02: Eliminar ubicación sin inventario desvincula referencias

**Contexto:** Si una ubicación no tiene stock activo pero sí tiene productos o líneas inactivas referenciándola, la eliminación debe proceder con una advertencia y nullificar esas referencias.

**Pasos:**
1. Tener una ubicación con productos que la referencian pero sin stock activo
2. Hacer clic en eliminar
3. Leer el mensaje de confirmación → confirmar

**Resultado esperado:** El confirm muestra cuántas referencias se desvincularán. Tras confirmar: ubicación eliminada, productos y líneas con `ubicacion_id = null`.

---

### UAT-CFG-03: Eliminar ubicación completamente libre funciona sin avisos extra

**Pasos:**
1. Crear una ubicación nueva sin asociar ningún producto ni LPN
2. Eliminarla

**Resultado esperado:** Confirm simple "¿Eliminar esta ubicación?" → ubicación eliminada sin mensajes de desvinculación.

---

## Módulo: Clientes — Importación masiva

### UAT-CLI-01: Plantilla descargada incluye columna DNI

**Pasos:**
1. Ir a `/clientes`
2. Abrir sección de importación
3. Descargar la plantilla Excel

**Resultado esperado:** El archivo tiene columnas: `nombre`, `dni`, `telefono`, `email`, `notas` (en ese orden).

---

### UAT-CLI-02: Importar archivo con columna DNI funciona correctamente

**Pre-condición:** Archivo Excel con columnas `nombre, dni, telefono, email, notas` y filas con datos válidos.

**Pasos:**
1. Ir a `/clientes` → Importar
2. Subir el archivo
3. Revisar preview → Confirmar importación

**Resultado esperado:** Los clientes se crean con `dni` correctamente asignado. Ningún error de constraint.

---

### UAT-CLI-03: Importar sin columna DNI inserta clientes con dni = null

**Contexto:** Compatibilidad retroactiva — archivos sin DNI deben importar igual (dni queda null en DB).

**Pasos:**
1. Subir un archivo con columnas `nombre, telefono, email, notas` (sin dni)
2. Revisar preview → Confirmar

**Resultado esperado:** Los clientes se crean con `dni = null`. No hay error. El usuario puede editar cada cliente luego y completar el DNI.

---

## Resumen de cobertura

| ID | Módulo | Bug origen | Estado | Test automatizado |
|----|--------|-----------|--------|-------------------|
| UAT-INV-01 | Inventario | LPN delete no actualiza stock | ✅ Fix aplicado | E2E `02_inventario.spec.ts` |
| UAT-INV-02 | Inventario | Rebaje masivo no funciona | ✅ Fix aplicado | E2E `03_movimientos.spec.ts` |
| UAT-INV-03 | Inventario | Rebaje masivo ignora reservas | ✅ Fix aplicado | manual (requiere datos específicos) |
| UAT-GAS-01 | Gastos | Default efectivo causa errores | ✅ Fix aplicado | E2E `06_gastos.spec.ts` |
| UAT-GAS-02 | Gastos | Gasto sin medio | ✅ Fix aplicado | E2E `06_gastos.spec.ts` |
| UAT-CFG-01 | Configuración | Ubicación con stock no borrable | ✅ Fix aplicado | E2E `10_configuracion.spec.ts` |
| UAT-CFG-02 | Configuración | Ubicación sin stock → desvincula | ✅ Fix aplicado | manual |
| UAT-CFG-03 | Configuración | Ubicación libre → borrado simple | ✅ Fix aplicado | manual |
| UAT-CLI-01 | Clientes | Plantilla sin DNI | ✅ Fix aplicado | E2E `08_clientes.spec.ts` |
| UAT-CLI-02 | Clientes | Import sin DNI falla | ✅ Fix aplicado | manual (requiere archivo) |
| UAT-CLI-03 | Clientes | Retrocompatibilidad sin DNI | ✅ Fix aplicado | manual |
