# Genesis360 — Roadmap RRHH

**Última actualización:** 23 de Marzo, 2026 · **v0.27.0 en PROD**

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

## 🟡 Phase 2 — Nómina + Vacaciones

**Dependencias:** Phase 1

### 2A · Nómina
```
Tablas nuevas:
- rrhh_salarios  (periodo, basico, descuentos, comisiones, neto, estado: borrador/pagada)
- rrhh_conceptos (tipo: SUELDO, BONO, DESCUENTO, COMISIÓN, etc.)

Flujo:
1. Plantilla base: básico + descuentos fijos por empleado
2. Admin carga casos especiales (bonos, descuentos puntuales) antes de cerrar nómina
3. "Pagar nómina" → crea egreso automático en caja_movimientos
   Migration: 015_rrhh_nomina.sql
```

### 2B · Vacaciones
```
Tablas nuevas:
- rrhh_vacaciones_solicitud (empleado, desde, hasta, estado: pendiente/aprobada/rechazada)
- rrhh_vacaciones_saldo     (empleado, año, dias_totales, dias_usados, remanente_anterior)

Flujo:
1. RRHH/OWNER crea o aprueba solicitudes (desde RrhhPage)
2. Si aprobada → descuenta del saldo anual
3. Días hábiles solamente (excluir fines de semana + feriados)
4. Remanente año anterior: 50% (configurable por tenant)
   Migration: 016_rrhh_vacaciones.sql
```

### 2C · Notificaciones cumpleaños
```
- Email automático mensual con lista de cumpleaños del mes
- Alerta en dashboard: "X cumpleaños este mes"
- Edge Function: rrhh-notify-birthdays (pg_cron o Vercel Cron)
```

---

## 🔵 Phase 3 — Asistencia + Dashboard RRHH

**Dependencias:** Phase 1 + 2

### 3A · Asistencia
```
Tabla nueva:
- rrhh_asistencia (empleado, fecha, hora_entrada, hora_salida,
                   estado: presente/ausente/tardanza/licencia, motivo)

Entrada de datos:
- Opción 1: Admin/RRHH registra manualmente en UI
- Opción 2: QR code en oficina [futuro]
  Migration: 017_rrhh_asistencia.sql
```

### 3B · Dashboard RRHH
```
KPIs:
- Total empleados activos (por departamento)
- Asistencia mes: % promedio · Tardanzas recurrentes
- Vacaciones: pendientes vs usadas
- Nómina próxima: montos + días para pago
- Cumpleaños próximo mes

Reportes exportables (Excel/PDF):
- Asistencia mensual · Nómina histórica · Rotación de personal
```

---

## 🔵 Phase 4 — Documentos + Capacitaciones

**Dependencias:** Phase 1 (independiente de 2 y 3)

### 4A · Documentos
```
Tabla nueva: rrhh_documentos (tipo: CONTRATO/DNI/CARNET_SALUD/etc., file_path, fecha_carga)
Storage: bucket "empleados" → {tenant_id}/{empleado_id}/{tipo}/{filename}
Migration: 018_rrhh_documentos.sql
```

### 4B · Capacitaciones
```
Tablas nuevas:
- rrhh_capacitaciones         (nombre, descripcion, fecha, instructor)
- rrhh_capacitaciones_registro (empleado, capacitacion, asistio, certificado_url)
Migration: 019_rrhh_capacitaciones.sql
```

---

## 🔵 Phase 5 — Supervisor Self-Service

**Dependencias:** Phase 1 + 2 + 3

```
- Dashboard restringido: SUPERVISOR ve solo su equipo (árbol jerárquico)
- Aprobar/rechazar vacaciones de subordinados
- Métricas de su departamento únicamente
- Requiere actualizar RLS policies para soportar árbol jerárquico
```

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

### Fase 2 — Dimensiones en ubicaciones (migration futura)

Nuevos campos en tabla `ubicaciones`:
- `alto_cm`, `ancho_cm`, `largo_cm` — dimensiones físicas del hueco/posición.
- `peso_max_kg` — peso máximo soportado.
- `tipo_ubicacion` ENUM: `picking` | `bulk` | `estiba` | `camara` | `cross_dock`.
- `capacidad_pallets INT` — para ubicaciones tipo estiba.

**Almacenaje dirigido (putaway)**: al ingresar stock, el sistema sugiere ubicación óptima
comparando dimensiones de la caja/pallet del producto vs disponibilidad en ubicaciones.
Prioridad: tipo adecuado → capacidad suficiente → menor prioridad ocupada.

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

### Dependencias entre fases

```
Fase 1 ✅ (producto_estructuras) 
  → Fase 2 (ubicaciones con dimensiones)
    → Fase 3 (tareas WMS + picking)
      → Fase 4 (surtido + cross-docking)
```

> **Nota de arquitectura**: el schema actual es compatible con todas las fases.
> `inventario_lineas` ya tiene `ubicacion_id`, `lpn`, `nro_lote`, `fecha_vencimiento`, series.
> Al llegar a Fase 2, solo se agregan columnas a `ubicaciones` + nueva tabla `wms_tareas`.

---

## Orden recomendado

```
Phase 1 ✅ → Phase 2 (nómina es core) → Phase 3 (asistencia + métricas)
                                       → Phase 4 (en paralelo con 3, menos crítica)
                                                 → Phase 5 (depende de 3)
```

---

## Patrones de código reutilizables

```typescript
// Nueva tabla RRHH (patrón estándar)
CREATE TABLE IF NOT EXISTS rrhh_nueva (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  // ... campos específicos
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_nueva ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_nueva' AND policyname='rrhh_nueva_tenant') THEN
    CREATE POLICY "rrhh_nueva_tenant" ON rrhh_nueva
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rrhh_nueva_tenant ON rrhh_nueva(tenant_id);

// Query estándar en componente
const { data } = useQuery({
  queryKey: ['rrhh_nueva', tenant?.id],
  queryFn: async () => {
    const { data, error } = await supabase.from('rrhh_nueva')
      .select('*').eq('tenant_id', tenant!.id).eq('activo', true)
    if (error) throw error
    return (data ?? [])
  },
  enabled: !!tenant,
})
```

---

## Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 23-Mar-2026 | 1.0 | Roadmap inicial + Phase 1 RRHH en PROD |
| 23-Mar-2026 | 1.1 | Actualizado post v0.27.0 · compactado · duplicados eliminados |
| 04-Apr-2026 | 1.2 | Sección WMS completa (Fases 1–4): estructura de producto ✅ · dimensiones ubicaciones · tareas/picking · cross-docking |
