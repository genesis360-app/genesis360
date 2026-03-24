# 📋 Stokio — Roadmap de Desarrollo Completo

**Última actualización:** 23 de Marzo, 2026  
**Versión:** 1.0  
**Status general:** 🟡 Phase 1 RRHH completada; Phase 2+ planificada

---

## 📌 Overview del Producto

**Stokio** = "El cerebro del negocio físico" — no muestra datos, dice qué hacer.

Una app SaaS para **PYMES** (almacenes, ferreterías, kioscos, supermercados, etc.) que:
- Gestiona **inventario intelligente** con reglas WMS
- Controla **ventas, caja, gastos** en tiempo real
- Proporciona **métricas y gráficos** para tomar decisiones
- Gestiona **equipo de trabajo** (empleados, vacaciones, nómina)
- Integra con **Mercado Pago** para pagos
- Escala vía **planes de suscripción** (Free → Básico → Pro → Enterprise)

---

## 🏗️ Stack Tecnológico

### Frontend
- **React 18** + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Librerías clave:** 
  - @tanstack/react-query (estado de servidor)
  - zustand (estado local)
  - recharts (gráficos)
  - jspdf + jspdf-autotable (reportes PDF)
  - xlsx (importar/exportar Excel)
  - @zxing/library (lectura códigos de barras)
  - date-fns (manejo de fechas)
  - react-hot-toast (notificaciones)

### Backend
- **Supabase** (PostgreSQL + Auth + RLS + Edge Functions + Storage)
  - PROD: `jjffnbrdjchquexdfgwq`
  - DEV: `gcmhzdedrkmmzfzfveig`

### Deploy
- **Frontend:** Vercel (https://stokio-tau.vercel.app)
- **Backend:** Supabase (hosted)
- **Pagos:** Mercado Pago

---

## 🎯 Arquitectura Multi-Tenant

**Patrón crítico que se repite en TODO el proyecto:**

```
┌─ Supabase Auth (Google OAuth)
│  └─ users table (id, tenant_id, rol, activo)
│     └─ Cada usuario pertenece a 1 tenant
│
└─ Row Level Security (RLS)
   └─ TODAS las tablas tienen tenant_id
   └─ SELECT * FROM tabla WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
```

**Roles y permisos:**
```
OWNER       → Full access (crear usuarios, config, RRHH, todo)
SUPERVISOR  → Inventario + movimientos + historial (sin usuarios/config)
CAJERO      → Solo ventas + rebajes
RRHH        → Gestión de empleados + nómina + vacaciones (NEW en Phase 1)
ADMIN       → Global (no tenant-specific, acceso a AdminPage)
```

---

## 📊 Roadmap de Fases

### ✅ Phase 1: RRHH Básico (COMPLETADO)

**Status:** 🟢 Implementado, testeado, deployado en DEV  
**Timeline:** 23-Mar-2026  
**Tiempo estimado:** ~1 semana  

**Scope:**
- [x] Tabla `empleados` (DNI, contacto, datos personales, laboral, estado)
- [x] Tabla `rrhh_puestos` (nombre, salario_sugerido)
- [x] Tabla `rrhh_departamentos` (nombre, descripción)
- [x] Página RrhhPage con 4 tabs:
  - Empleados: CRUD + table + modal + soft delete + search
  - Puestos: CRUD inline
  - Departamentos: CRUD inline
  - Cumppleaños: filtro + orden + badges coloreados
- [x] Nuevo rol RRHH (acceso delegado)
- [x] Auditoría automática (logActividad)
- [x] Migration 014 aplicada en DEV

**Deliverables:**
- [supabase/migrations/014_rrhh_empleados.sql](supabase/migrations/014_rrhh_empleados.sql)
- [src/pages/RrhhPage.tsx](src/pages/RrhhPage.tsx)
- [src/App.tsx](src/App.tsx) (ruta `/rrhh`)
- [src/components/layout/AppLayout.tsx](src/components/layout/AppLayout.tsx) (link sidebar)

**Dependencias:** Ninguna (independent)

**Testing realizado:**
- ✅ TypeScript: 0 errores
- ✅ Vite build: success
- ✅ Dev server: running correctamente
- ✅ Git: commit + push a `dev`
- ✅ Supabase DEV: migration aplicada

**Notas:**
- Permisos: OWNER + RRHH acceso total; otros: página oculta
- Sin foto/documento storage en Phase 1
- Sin notificaciones automáticas en Phase 1

---

### 🟡 Phase 2: Nómina + Vacaciones (PLANEADO)

**Timeline:** Posterior a Phase 1  
**Tiempo estimado:** ~2-3 semanas  
**Dependencias:** Phase 1

**Scope:**

#### 2A: Sistema de Nómina
```
Tablas nuevas:
- rrhh_salarios (periodo, básico, descuentos, comisiones, neto)
- rrhh_conceptos (tipo: SUELDO, BONO, DESCUENTO, COMISIÓN, etc.)

Lógica:
- Plantilla semi-automática: básico + descuentos fijos
- Admin actualiza casos especiales (bonos, descuentos puntuales)
- Generar nómina mensual → crea egreso automático en Caja

Integración Caja:
- Pagar nómina → crea row en caja_movimientos (tipo: EGRESO, concepto: CAJA_NÓMINA)
- Validar: caja debe tener saldo suficiente
```

#### 2B: Sistema de Vacaciones
```
Tablas nuevas:
- rrhh_vacaciones_solicitud (empleado, fecha_desde, fecha_hasta, estado: pendiente/aprobada/rechazada)
- rrhh_vacaciones_saldo (empleado, año, días_totales, días_usados, año_anterior_remanente)

Flujo:
1. Empleado solicita vacaciones (desde APP simple, no en Phase 1)
2. RRHH/OWNER aprueba o rechaza (desde RrhhPage)
3. Si aprobada: descuenta de saldo anual
4. Dashboard RRHH muestra pendientes + auditoría completa

Lógica:
- Días hábiles solamente (excluir fines de semana + feriados)
- Validar: no solapamiento, saldo disponible
- Remanente de año anterior: heredar 50% (configurable por tenant)
```

#### 2C: Notificaciones Cumppleaños
```
- Enviar email automático mensualmente (trigger o scheduler)
- Dashboard alert: "X cumppleaños este mes"
- Edge Function: rrhh-notify-birthdays (via pg_cron o Vercel Cron)
```

**Deliverables:**
- `supabase/migrations/015_rrhh_nomina.sql`
- `supabase/migrations/016_rrhh_vacaciones.sql`
- Tab Nómina dentro RrhhPage (nueva)
- Tab Vacaciones dentro RrhhPage (nueva)
- Views/métricas: saldo vacaciones, próximas nóminas, etc.

**Decisiones importantes:**
- Nómina semi-automática (no full automation, requiere review)
- Integración Caja es automática (egreso generado)
- Vacaciones: flujo de aprobación manual

---

### 🔵 Phase 3: Asistencia + Métricas RRHH (PLANEADO)

**Timeline:** Después de Phase 2  
**Tiempo estimado:** ~2 semanas  
**Dependencias:** Phase 1 + 2

**Scope:**

#### 3A: Sistema de Asistencia
```
Tablas nuevas:
- rrhh_asistencia (empleado, fecha, hora_entrada, hora_salida, estado: presente/ausente/tardanza/licencia, motivo)
- rrhh_asistencia_motivo (tipo: LICENCIA, ENFERMEDAD, PERMISO, etc.)

Entrada de datos:
- Opción 1: Admin/RRHH registra manualmente en UI
- Opción 2: QR code en oficina (escanear para marcar entrada/salida) [future]

Métricas:
- Ausentismo por empleado
- Tardanzas recurrentes
- Cobertura por turno/departamento
```

#### 3B: Dashboard RRHH
```
KPIs monitoreados:
- Total empleados activos (por departamento)
- Asistencia mes actual: % promedio
- Vacaciones pendientes vs usadas
- Nómina próxima: montos, días para pago
- Cumppleaños próximo mes
- Ausentismo: alertas si > threshold

Reportes exportables:
- Asistencia (Excel/PDF)
- Nómina histórica
- Rotación de personal
```

**Deliverables:**
- `supabase/migrations/017_rrhh_asistencia.sql`
- Actualizar MetricasPage o crear DashboardRrhhPage
- Componentes gráficos (recharts)

---

### 🔵 Phase 4: Capacitaciones + Documentos (PLANEADO)

**Timeline:** Después de Phase 3  
**Tiempo estimado:** ~1.5 semanas  
**Dependencias:** Phase 1

**Scope:**

#### 4A: Documentos de Empleado
```
Tablas nuevas:
- rrhh_documentos (tipo: CONTRATO, DNI, CARNET_SALUD, etc., file_path, fecha_carga)

Storage:
- Supabase Storage: bucket "empleados" → {tenant_id}/{empleado_id}/{tipo}/{filename}

UI:
- Form para cargar documentos por empleado
- Listado de documentos (editable, eliminar)
```

#### 4B: Capacitaciones
```
Tablas nuevas:
- rrhh_capacitaciones (nombre, descripcion, fecha, instructor)
- rrhh_capacitaciones_registro (empleado, capacitacion, asistió: bool, certificado_url)

UI:
- Crear capacitación dentro RrhhPage
- Registrar asistencia
- Descargar certificado
```

**Deliverables:**
- `supabase/migrations/018_rrhh_documentos.sql`
- `supabase/migrations/019_rrhh_capacitaciones.sql`
- Actualizar RrhhPage (nuevos tabs)

---

### 🔵 Phase 5: Supervisor Self-Service (PLANEADO)

**Timeline:** Después de Phase 3  
**Tiempo estimado:** ~1 semana  
**Dependencias:** Phase 1 + 2 + 3

**Scope:**

#### 5A: Dashboard Supervisor
```
Vistas restringidas (solo su equipo):
- Asistencia de su equipo
- Solicitudes de vacaciones (para aprobar/rechazar)
- Reporte de rendimiento por subordinado
- Auditoría: quién hizo qué en su área

Permisos:
- SUPERVISOR rol: puede ver su árbol jerárquico
- Aprobar/rechazar vacaciones de su equipo
- Ver métricas de su departamento SOLAMENTE
```

**Deliverables:**
- Actualizar RLS policies para soportar árbol jerárquico
- SupervisorDashboard component
- Filtros en tablas RRHH por supervisor

---

## 🔄 Dependencias Entre Phases

```
Phase 1: RRHH Básico
└── Phase 2: Nómina + Vacaciones
    ├── Phase 3: Asistencia + Métricas (depende de Phase 2 para contexto)
    │   └── Phase 5: Supervisor Self-Service (depende de Phase 3)
    └── Phase 4: Capacitaciones + Documentos (independiente, puede ir en paralelo)
```

**Recomendación de order:**
1. ✅ Phase 1 (DONE)
2. → Phase 2 (NEXT - nómina es core para RRHH)
3. → Phase 3 (asistencia + métricas da valor)
4. → Phase 4 y Phase 5 en paralelo (menos críticas)

---

## 🛠️ Decisiones Arquitectónicas Importantes

### 1. Empleados = Nueva tabla, no extender Users
**Decisión:** Tabla `empleados` separada con FK a `users`  
**Razón:** users = auth + app access (limpio); empleados = RRHH data (extensible)  
**Impacto:** Flexible para futuro (un usuario puede tener múltiples empleados? No, 1:1 relación)

### 2. Rol RRHH vs solo OWNER
**Decisión:** Nuevo rol `RRHH` delegable  
**Razón:** OWNER might not be HR person; permite asignar responsabilidad  
**Impacto:** RrhhPage visible solo para OWNER + RRHH; otros roles: oculto

### 3. Página dedicada vs Tab en ConfigPage
**Decisión:** Página dedicada `RrhhPage`  
**Razón:** RRHH es módulo completo + escalable (Phase 2/3 lo expande mucho)  
**Impacto:** Mejor UX, no contamina ConfigPage

### 4. Auditoría: reutilizar logActividad()
**Decisión:** Fire-and-forget con `logActividad()` (sin await)  
**Razón:** No bloquea UI; entidad='empleado' agregada a enum  
**Impacto:** Historial completo sin overhead de performance

### 5. Nómina semi-automática, no full-auto
**Decisión:** Admin define plantilla básico + descuentos; casos puntuales manual  
**Razón:** No es legal automatizar sin revisión; cada país tiene reglas distintas  
**Impacto:** Require implementar UI de "gestión de casos especiales"

### 6. Integración Caja automática para nómina
**Decisión:** Pagar nómina → crea egreso en `caja_movimientos` automáticamente  
**Razón:** Nómina es gasto operativo; reconciliación de caja requiere estos registros  
**Impacto:** Edge Function o trigger al marcar "pagada" en nómina

### 7. Soft delete activo=false, no hard delete
**Decisión:** `empleados.activo = false` para "eliminar"  
**Razón:** Preservar histórico para auditoría y análisis  
**Impacto:** Siempre filtrar `activo=true` en queries; reportes pueden incluir histórico

### 8. RLS patrón subquery, nunca procedimientos
**Decisión:** `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`  
**Razón:** Evitar complejidad, sincrónico, no depende de funciones en schema  
**Impacto:** Consistencia garantizada, pero queries pueden ser lentitas con muchos tenants

---

## 📚 Patrones Reutilizables

### Nuevo módulo similar a RRHH

Si en futuro hay que agregar (e.g., Clientes premium management, Proveedores):

```typescript
// 1. Crear migration NNN_nuevo_modulo.sql
CREATE TABLE nuevo_modulo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  // ... fields
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE nuevo_modulo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nuevo_modulo_tenant" ON nuevo_modulo
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_nuevo_modulo_tenant ON nuevo_modulo(tenant_id);

// 2. Crear NuevoModuloPage.tsx
// 3. Query:
const { data } = useQuery({
  queryKey: ['nuevo_modulo', tenant?.id],
  queryFn: async () => {
    const { data, error } = await supabase.from('nuevo_modulo')
      .select('*')
      .eq('tenant_id', tenant!.id)
    if (error) throw error
    return (data ?? []) as NuevoModulo[]
  },
  enabled: !!tenant,
})

// 4. Mutation (crear):
const saveMutation = useMutation({
  mutationFn: async (data) => {
    const { error } = await supabase.from('nuevo_modulo').insert({
      tenant_id: tenant!.id,
      ...data,
    })
    if (error) throw error
    logActividad({ entidad: 'nuevo_modulo', /* ... */ })
  },
  onSuccess: () => {
    toast.success('Guardado')
    qc.invalidateQueries({ queryKey: ['nuevo_modulo'] })
  },
})
```

**Este patrón se repite en TODAS las páginas en Stokio.**

---

## 🎯 Convenciones del Proyecto

### Git Workflow
```bash
# Branch: dev (desarrollo)
git checkout dev
git pull origin dev

# Crear feature:
git checkout -b feat/nombre-feature

# Cuando listo:
git add ...
git commit -m "feat(categoría): descripción

Detalles adicionales.

Co-Authored-By: GNO <gaston.otranto@gmail.com>"

git push origin feat/nombre-feature
# → Hacer PR en GitHub, merge a dev
# → PR a main solo cuando listo para PROD
```

### TypeScript
- Interfaces explícitas para todos los datos
- `export type UserRole = 'OWNER' | 'SUPERVISOR' | 'CAJERO' | 'RRHH' | 'ADMIN'`
- Enums para logActividad: `EntidadLog`, `AccionLog`

### Nombres de tablas
- `snake_case`
- Prefijo de módulo: `rrhh_*`, `inventario_*`, `caja_*`, etc.
- Siempre `tenant_id`, `activo`, `created_at`, `updated_at`

### Queries/Mutations
- `useQuery` + `useQueryClient` + `invalidateQueries`
- Fire-and-forget: `logActividad()` sin await
- Toast para feedback: `toast.success()`, `toast.error()`

### Componentes UI
- Usar componentes shadcn/ui cuando existan
- Estados: `loading`, `isLoading`, `isPending`
- Accesibilidad: labels, alt text, keyboard nav

---

## 📈 Planes de Suscripción

```
┌─────────────────┬────────────┬────────────┬─────────┬────────────┐
│ Plan            │ Free       │ Básico     │ Pro     │ Enterprise │
├─────────────────┼────────────┼────────────┼─────────┼────────────┤
│ Precio/mes      │ $0         │ $4.900 ARS │ $9.900  │ Custom     │
│ Max usuarios    │ 1          │ 2          │ 10      │ ∞          │
│ Max productos   │ 50         │ 500        │ 5.000   │ ∞          │
│ Funcionalidades │ Base       │ +Metrics   │ +API    │ Todo       │
└─────────────────┴────────────┴────────────┴─────────┴────────────┘
```

**Nota:** Phase 2+ pueden agregar límites de transacciones, módulos premium, etc.

---

## 🚀 Setup & Development

### Requisitos
- Node.js 18+
- npm
- Supabase CLI
- Git

### Instalación local

```bash
git clone https://github.com/tongas86/stokio.git
cd stockapp/stockapp
npm install

# Variables de entorno (.env.local, ver CLAUDE.md)
# VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, etc.

# Dev:
npm run dev
# → http://localhost:5173/

# Build:
npm run build

# Deploy:
# Frontend: git push a main → Vercel auto-deploya
# Backend: supabase db push → aplica migrations
```

### Supabase en DEV

```bash
# Linked (ya está hecho):
supabase link --project-ref gcmhzdedrkmmzfzfveig

# Ver status:
supabase status

# Aplicar una migration:
supabase db push

# Crear migration nueva:
supabase migration new nombre_migration

# Ver migraciones aplicadas:
supabase migration list

# Reparar historial (si se daña):
supabase migration repair --status applied 001 002 003 ...
```

---

## 📖 Recursos Clave

### Arquitectura & Design
- [CLAUDE.md](CLAUDE.md) — Contexto general para Claude (modelos, decisiones)
- [WORKFLOW.md](WORKFLOW.md) — Proceso Git, deployment, PR review
- [supabase/schema_full.sql](supabase/schema_full.sql) — Schema completo (single source of truth)

### Code
- [src/lib/supabase.ts](src/lib/supabase.ts) — Tipos e interfaces principales
- [src/lib/actividadLog.ts](src/lib/actividadLog.ts) — Función logActividad()
- [src/store/authStore.ts](src/store/authStore.ts) — Estado global (user, tenant)
- [src/config/brand.ts](src/config/brand.ts) — Nombre app, colores, branding

### Pages (patrones)
- [src/pages/UsuariosPage.tsx](src/pages/UsuariosPage.tsx) — CRUD usuarios (patrón base)
- [src/pages/ConfigPage.tsx](src/pages/ConfigPage.tsx) — Tabs, múltiples CRUDs (referencia)
- [src/pages/RrhhPage.tsx](src/pages/RrhhPage.tsx) — Página RRHH (Phase 1, más reciente)

### Deploy & CI/CD
- Vercel: https://vercel.com/tongas86/stokio (auto deploy a `main`)
- Supabase: https://supabase.com/dashboard/projects
- GitHub: https://github.com/tongas86/stokio

---

## ⚠️ Notas Críticas para Developers

### No tocar
- ❌ Modificar `users.rol` enum sin actualizar TypeScript + UI
- ❌ Agregar tabla sin `tenant_id` + RLS
- ❌ Hard-codear nombre app (usar `BRAND.name`)
- ❌ Modificar `main` sin PR; commits a `dev` solo

### Siempre
- ✅ Fire-and-forget con `logActividad()` (no bloquear UI)
- ✅ Filtrar `WHERE tenant_id = ?` y RLS en todas las queries
- ✅ Soft delete con `activo = false`, nunca hard delete
- ✅ Usar tipos TypeScript explícitos
- ✅ Test en DEV antes de PR

### Validaciones importantes
- DNI/RUT: `UNIQUE(tenant_id, dni_rut)` → prevenir duplicados
- Salarios: `>= 0` siempre
- Fechas: ingreso < egreso, nacimiento < hoy
- Supervisores: no self-assign (empleado puede ser supervisor de otro)

---

## 🎬 Próximos Pasos Inmediatos

1. **Testear Phase 1 en DEV:**
   - [ ] Loguear como OWNER
   - [ ] Navegar a "/rrhh"
   - [ ] Crear empleado de prueba
   - [ ] Verificar en tabla + cumppleaños

2. **Hacer PR Phase 1 para PROD:**
   - [ ] Ir a GitHub → Pull Requests
   - [ ] Search: "feat(rrhh): fase 1"
   - [ ] Review (OK si hay cambios esperados)
   - [ ] Merge a `main`
   - [ ] Vercel auto-deploya frontend

3. **Aplicar migration en PROD (manual):**
   - [ ] Copiar `supabase/migrations/014_rrhh_empleados.sql`
   - [ ] Ir a Supabase console PROD (`jjffnbrdjchquexdfgwq`)
   - [ ] SQL Editor → Pegar → Run
   - [ ] Validar: `SELECT * FROM empleados LIMIT 0` → OK si da tabla vacía

4. **Planificar Phase 2:**
   - [ ] Asignar developer para nómina
   - [ ] Asignar developer para vacaciones
   - [ ] Review de datos necesarios (conceptos nómina, fórmulas, etc.)

---

## 📊 Metrics & KPIs to Track

### Phase 1 (Done)
- ✅ 0 TypeScript errors
- ✅ Migration applied in DEV
- ✅ Page loads in < 2s
- ✅ All CRUD operations tested

### Phase 2 (Target)
- Nómina: generada en < 1s para 100 empleados
- Vacaciones: solicitud aprobada/rechazada en < 500ms
- Caja: egreso registrado automático dentro 100ms de "pagar nómina"

### General
- RLS query latency: < 50ms (p95)
- Page navigation: < 500ms (p95)
- Build time: < 45s

---

## 🆘 Troubleshooting Común

### "Rol RRHH no reconocido"
- Verificar `src/lib/supabase.ts` → `UserRole` enum incluya 'RRHH'
- Verificar `src/pages/UsuariosPage.tsx` → ROLES dict incluya RRHH

### "RrhhPage no aparece en sidebar"
- Verificar `src/components/layout/AppLayout.tsx` → navItems incluya `/rrhh`
- Verificar permiso: `ownerOnly: true` en navItem RRHH
- Verificar usuario tiene rol OWNER o RRHH

### "Migration falla al aplicar"
- Verificar sintaxis SQL (errores de typo en nombres table/columns)
- Verificar FK no violan constraints existentes
- Ejecutar repair: `supabase migration repair --status applied 014`

### "Subqueries en RLS lento"
- Considerar vista materializada en próximas phases
- Agregar índices en `tenant_id` (ya hecho en Phase 1)
- Profile con `EXPLAIN ANALYZE`

---

## 📝 Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 23-Mar-2026 | 1.0 | Roadmap inicial + Phase 1 RRHH completada |

---

**Documento preparado para:** Equipo de desarrollo / Agentes / Nuevos developers  
**Mantener actualizado en cada fase completada.**
