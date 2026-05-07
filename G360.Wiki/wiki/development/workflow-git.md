---
title: Workflow Git y Releases
category: development
tags: [git, workflow, deploy, releases, versioning]
sources: []
updated: 2026-04-30
---

# Workflow Git y Releases

---

## Ramas

| Rama | Propósito |
|------|-----------|
| `main` | Producción — Claude nunca pushea directo |
| `dev` | Desarrollo activo — Vercel preview habilitado |
| Feature branches | Para features grandes, desde `dev` |

---

## Flujo estándar

```
1. Trabajo en rama dev (o feature branch)
2. Commit con mensaje descriptivo
3. PR: dev → main
4. Review (manual o con /ultrareview)
5. Merge a main
6. Vercel deploya automáticamente
7. Si hay migrations: aplicar en PROD manualmente
8. Crear GitHub release con tag vX.Y.Z
```

---

## Versionado

- Bumpar `APP_VERSION` en `src/config/brand.ts` **antes** de cada release a producción
- Formato de tag: `vX.Y.Z` (semver)
- **MAJOR:** cambios breaking de schema o API
- **MINOR:** nuevas features
- **PATCH:** bugfixes

---

## Formato de commits

Todos los commits deben incluir co-autoría:
```
feat: descripción del cambio

Co-Authored-By: GNO <gaston.otranto@gmail.com>
```

---

## Protecciones de `main`

- Nunca pushear directo a `main`
- Nunca usar `--force` en `main`
- Siempre via PR con review

---

## Checklist pre-release

- [ ] `APP_VERSION` bumpeada en `brand.ts`
- [ ] Todas las migrations aplicadas en DEV y testeadas
- [ ] TypeScript compila sin errores (`npm run build`)
- [ ] ESLint sin warnings (`npm run lint`)
- [ ] Tests unitarios pasando (`npm run test:unit`)
- [ ] PR aprobado y mergeado a `main`
- [ ] GitHub release creado con tag

---

## Links relacionados

- [[wiki/development/deploy]]
- [[wiki/development/supabase-dev-vs-prod]]
- [[wiki/development/testing]]
