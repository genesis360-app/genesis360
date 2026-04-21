# Genesis360 — Roadmap RRHH

**Última actualización:** 18 de Abril, 2026 · **v0.77.0 en DEV · v0.76.0 en PROD**

> Stack, arquitectura y convenciones → [CLAUDE.md](CLAUDE.md) · Workflow de deploy → [WORKFLOW.md](WORKFLOW.md)

---

## Roles RRHH

```
OWNER  → Full access (incluye RRHH)
RRHH   → Gestión de empleados, nómina, vacaciones (acceso delegado)
```
Helper: `is_rrhh()` SECURITY DEFINER — devuelve TRUE si rol = 'RRHH' o 'OWNER'.

---

## ✅ Phase 1 — RRHH Básico (v0.26.0 · PROD)

**Migration:** `014_rrhh_empleados.sql`

- Tabla `empleados` (DNI/RUT, contacto, datos personales, laboral, supervisor, salario, soft delete)
- Tabla `rrhh_puestos` (nombre, salario_base_sugerido)
- Tabla `rrhh_departamentos` (nombre, descripción)
- `RrhhPage` con 4 tabs: Empleados · Puestos · Departamentos · Cumpleaños
- Auditoría con `logActividad()` · UNIQUE(tenant_id, dni_rut)

**Decisiones:**
- Tabla `empleados` separada de `users` (users = auth; empleados = RRHH data extensible)
- Página dedicada `RrhhPage` (no tab en Config — RRHH es módulo completo)
- Soft delete `activo=false`, nunca hard delete
- Nómina semi-automática (no full-auto — cada país tiene reglas distintas)

---

## ✅ Phase 2 — Nómina + Vacaciones (PROD)

### 2A · Nómina ✅ (migration 017, v0.32.0)
- `rrhh_salarios` (periodo, basico, haberes, descuentos, neto, pagado, medio_pago, caja_movimiento_id)
- `rrhh_conceptos` catálogo de haberes/descuentos por tenant
- `rrhh_salario_items` con trigger `fn_recalcular_salario`
- `pagar_nomina_empleado(salario_id, sesion_id, medio_pago)` SECURITY DEFINER — verifica saldo caja
- UI: tab "Nómina" en RrhhPage · selector mes/año · generar nómina · expandible por empleado · selector medio pago
- Migration 026 agrega `medio_pago` TEXT CHECK IN ('efectivo','transferencia_banco','mp')

### 2B · Vacaciones ✅ (migration 018, v0.33.0)
- `rrhh_vacaciones_solicitud` (estado pendiente/aprobada/rechazada, dias_habiles, aprobado_por)
- `rrhh_vacaciones_saldo` (dias_totales, remanente_anterior, dias_usados) UNIQUE per empleado×año
- `aprobar_vacacion()` / `rechazar_vacacion()` SECURITY DEFINER
- `calcular_dias_habiles(desde, hasta)` excluye DOW 0 y 6

### 2C · Cumpleaños automáticos ✅ (migration 022, v0.34.0)
- EF `birthday-notifications` corre en GitHub Actions cron `0 8 * * *`
- Tab Cumpleaños en RrhhPage con calendario · widget próximos feriados
- Feriados AR 2026 cargables con 1 click

---

## ✅ Phase 3 — Asistencia + Dashboard RRHH (PROD)

### 3A · Asistencia ✅ (migration 019, v0.33.0)
- `rrhh_asistencia` UNIQUE(tenant+empleado+fecha) · estados: presente/ausente/tardanza/licencia
- CRUD con filtro mes+empleado · badges por estado

### 3B · Dashboard RRHH ✅ (v0.35.0)
- KPIs: empleados activos, asistencia %, vacaciones pendientes, nómina período
- Breakdown por departamento · exportar Excel (asistencia + nómina histórica)

---

## ✅ Phase 4 — Documentos + Capacitaciones (PROD)

### 4A · Documentos ✅ (migration 022, v0.34.0)
- `rrhh_documentos` + bucket privado `empleados` (10 MB). URL firmada 300s para descarga.
- Tab "Documentos" en RrhhPage: upload, lista, Ver, Eliminar

### 4B · Capacitaciones ✅ (migration 023, v0.34.0)
- `rrhh_capacitaciones` (estado planificada/en_curso/completada/cancelada, certificado_path)
- Tab "Capacitaciones" en RrhhPage: filtro por estado · badge · Ver cert · edit · delete

---

## ✅ Phase 5 — Supervisor Self-Service (PROD)

(migration 024, v0.35.0)

- `get_supervisor_team_ids()` SECURITY DEFINER · RLS SUPERVISOR en asistencia/vacaciones/empleados
- Tab "Mi Equipo" en RrhhPage: KPIs asistencia hoy · vacaciones pendientes · aprobar/rechazar
- Árbol organizacional · tabs por rol (SUPERVISOR ve subconjunto)

---

---

## WMS — Almacenaje Dirigido y Picking Inteligente

> Visión: el sistema sugiere dónde almacenar cada SKU en base a dimensiones/peso, y genera
> listas de picking con tareas dirigidas que guían al operador exactamente a qué ubicación ir
> y qué cantidad tomar, respetando FIFO/FEFO/serie/lote.

### Fase 1 — Estructura de producto ✅ (migration 031, v0.57.0)

- Tabla `producto_estructuras`: niveles unidad / caja / pallet con peso (kg) y
  dimensiones alto/ancho/largo (cm). `unidades_por_caja`, `cajas_por_pallet`.
- Mínimo 2 niveles activos al crear. Un único default por SKU (partial unique index).
- Base de datos para calcular capacidades de almacenaje y armar listas de picking.

### Fase 2 — Dimensiones en ubicaciones ✅ (migration 032, v0.59.0)

Nuevos campos en tabla `ubicaciones` (todos opcionales):
- `alto_cm`, `ancho_cm`, `largo_cm` — dimensiones físicas del hueco/posición.
- `peso_max_kg` — peso máximo soportado.
- `tipo_ubicacion` TEXT CHECK: `picking` | `bulk` | `estiba` | `camara` | `cross_dock`.
- `capacidad_pallets INT` — para ubicaciones tipo estiba.

UI: sección colapsable "Dimensiones WMS" en ConfigPage → Ubicaciones. Badge tipo + medidas en lista.

**Almacenaje dirigido (putaway)**: al ingresar stock, el sistema sugiere ubicación óptima
comparando dimensiones de la caja/pallet del producto vs disponibilidad en ubicaciones.
Prioridad: tipo adecuado → capacidad suficiente → menor prioridad ocupada. *(Pendiente: lógica de sugerencia — Fase 3)*

### Fase 3 — Tareas WMS y listas de picking (migration futura)

Nueva tabla `wms_tareas`:
- `tipo` ENUM: `putaway` | `picking` | `replenishment` | `conteo`.
- `estado` ENUM: `pendiente` | `en_curso` | `completada` | `cancelada`.
- `usuario_asignado_id`, `prioridad INT`, `fecha_limite`.
- FK a `inventario_lineas`, `ubicaciones` (origen y destino), `ventas` (para picking de pedidos).

**Listas de picking**: agrupan tareas de tipo `picking` por pedido/despacho.
- El sistema calcula la ruta óptima dentro del depósito (prioridad de ubicaciones).
- Cada tarea indica: SKU · LPN · N/S o lote · ubicación origen · cantidad · ubicación destino.
- Respeta regla de inventario del SKU (FIFO/FEFO/serie) para selección de línea exacta.
- Interface en InventarioPage o nueva página WMS dedicada.

### Fase 4 — Surtido y cross-docking (fase larga plazo)

- Reposición automática: cuando stock en zona picking < umbral → tarea `replenishment` desde bulk.
- Cross-docking: mercadería entrante → tarea putaway directo a zona despacho sin almacenar.
- KPIs WMS: tasa de error de picking, tiempo promedio por tarea, utilización de ubicaciones.

### Fase 2.5 — KITs / Kitting ✅ (migration 040+041, v0.65.0–v0.67.0)

- `kit_recetas` (kit_producto_id, comp_producto_id, cantidad) + `kitting_log` (tipo armado/desarmado)
- `productos.es_kit BOOLEAN` · tipos `kitting` / `des_kitting` en `movimientos_stock`
- Tab "Kits" en InventarioPage: CRUD recetas · preview "puede armar N" · modal ejecutar
- Desarmado inverso: valida stock KIT · rebaja KIT · ingresa componentes
- Clonar receta entre KITs · badge "KIT" naranja en dropdown ventas
- KIT como producto vendible (precio/stock se gestiona igual que cualquier SKU)

### Dependencias entre fases

```
Fase 1 ✅ (producto_estructuras) 
  → Fase 2 ✅ (ubicaciones con dimensiones)
    → Fase 2.5 ✅ (KITs / Kitting)
    → Fase 3 🔵 (tareas WMS + picking — pendiente)
      → Fase 4 🔵 (surtido + cross-docking — largo plazo)
```

> **Nota de arquitectura**: el schema actual es compatible con todas las fases.
> `inventario_lineas` ya tiene `ubicacion_id`, `lpn`, `nro_lote`, `fecha_vencimiento`, series.
> Al llegar a Fase 2, solo se agregan columnas a `ubicaciones` + nueva tabla `wms_tareas`.

---

## Orden recomendado

```
Phase 1 ✅ → Phase 2 ✅ → Phase 3 ✅
                        → Phase 4 ✅
                                  → Phase 5 ✅

Próximo RRHH: Bloque 5 — CHECK-IN/CHECK-OUT rápido (v0.76.0)
```

---

> Patrones de código (tabla RRHH, queries estándar) → ver [CLAUDE.md](CLAUDE.md) § Arquitectura multi-tenant.
