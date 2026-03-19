# Stokio — Workflow de Desarrollo

## Ambientes

| Ambiente | Supabase | Vercel | Branch |
|----------|----------|--------|--------|
| **PROD** | `jjffnbrdjchquexdfgwq` (actual) | stokio-tau.vercel.app | `main` |
| **DEV** | *(crear — ver abajo)* | preview automático | `dev` |

---

## Reglas fundamentales

- **`main` = producción**. Nunca trabajar directo en `main`.
- **Todo desarrollo va en `dev`**. Cuando está listo → PR hacia `main`.
- **Claude Code nunca hace push a `main`**. Solo a `dev` o branches de feature.
- Cada feature importante → commit en `dev` → PR → merge a `main` → deploy automático.

---

## Flujo diario

```
1. Trabajar en rama dev (o feature/xxx desde dev)
2. Hacer commits con Co-Authored-By: GNO <noreply@anthropic.com>
3. Testear en ambiente DEV (Vercel preview)
4. Cuando el feature está listo:
   git push origin dev
   → Abrir PR en GitHub: dev → main
   → Revisar → Merge
   → Vercel despliega automáticamente a producción
```

---

## Migraciones de base de datos

**Regla:** Toda modificación al schema se hace mediante un archivo SQL en `supabase/migrations/`.

### Crear nueva migración
```
supabase/migrations/
  001_initial_schema.sql      ← tablas base
  002_cotizacion_y_precio_historico.sql
  003_clientes_y_rentabilidad.sql
  004_nombre_descriptivo.sql  ← nueva migración
```

### Aplicar migración
1. **En DEV primero:** SQL Editor del proyecto DEV → pegar contenido del `.sql`
2. **Verificar** que todo funciona en el ambiente DEV
3. **En PROD:** Solo después de merge a `main` → SQL Editor del proyecto PROD

### NUNCA
- ❌ Modificar tablas directamente en PROD sin pasar por DEV primero
- ❌ Cambiar datos de PROD manualmente
- ❌ Hacer ALTER TABLE fuera de un archivo de migración

---

## Configurar ambiente DEV (una sola vez)

### 1. Crear proyecto Supabase DEV
1. Ir a https://supabase.com/dashboard → New project
2. Nombre: `stokio-dev`
3. Contraseña: elegir una segura (guardarla)
4. Región: South America (São Paulo)
5. Plan: Free

### 2. Aplicar el schema completo
1. En el nuevo proyecto → SQL Editor
2. Pegar y ejecutar el contenido de `supabase/schema_full.sql`

### 3. Obtener credenciales DEV
En Settings → API del proyecto DEV:
- `Project URL` → `VITE_SUPABASE_URL_DEV`
- `anon public` key → `VITE_SUPABASE_ANON_KEY_DEV`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY_DEV`

### 4. Actualizar .env.local
```env
# DEV (para desarrollo local)
VITE_SUPABASE_URL=https://NUEVO_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...DEV_KEY...

# PROD (guardar por separado, no usar localmente)
# VITE_SUPABASE_URL_PROD=https://jjffnbrdjchquexdfgwq.supabase.co
# VITE_SUPABASE_ANON_KEY_PROD=eyJ...PROD_KEY...
```

### 5. Configurar Vercel para preview en `dev`
1. En Vercel → Settings → Environment Variables
2. Agregar variables del proyecto DEV con scope: **Preview**
3. Las variables del proyecto PROD quedan con scope: **Production**
4. Vercel detecta automáticamente el branch `dev` → usa vars de Preview

---

## Crear usuario de prueba en DEV

En Supabase DEV → Authentication → Users → Invite user (o crear desde onboarding).

---

## Releases y versioning

Seguimos SemVer pre-launch: `v0.X.Y`
- **PATCH** (`v0.x.Y`): bugfixes
- **MINOR** (`v0.X.0`): features nuevos
- No usamos MAJOR hasta el lanzamiento público

### Crear release
```bash
# 1. Asegurarse de estar en main y actualizado
git checkout main && git pull

# 2. Tag
git tag -a v0.X.Y -m "Descripción del release"
git push origin v0.X.Y

# 3. GitHub Release (via API)
curl -s -X POST "https://api.github.com/repos/tongas86/stokio/releases" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tag_name": "v0.X.Y",
    "name": "v0.X.Y — Nombre del release",
    "body": "## Cambios\n- Feature 1\n- Feature 2",
    "draft": false,
    "prerelease": true
  }'
```

---

## Estructura de branches

```
main          ← producción (solo merges desde dev via PR)
dev           ← desarrollo activo
feature/xxx   ← features grandes (opcional, se mergean a dev)
fix/xxx       ← hotfixes urgentes (pueden ir directo a main en emergencias)
```
