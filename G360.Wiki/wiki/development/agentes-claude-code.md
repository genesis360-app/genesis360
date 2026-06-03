---
title: Subagentes de Claude Code
category: development
tags: [claude-code, agentes, subagentes, automatizacion, qa]
sources: [.claude/agents/]
updated: 2026-06-03
---

# Subagentes de Claude Code

Genesis360 tiene **9 subagentes de proyecto** en `.claude/agents/` (versionados, commiteados 2026-06-02/03). Son especialistas **on-demand**: el agente principal les delega una subtarea, corren en **contexto propio y en frío**, y devuelven un resultado. No son procesos en background permanentes.

> ⚠ **Registro:** un subagente creado a mitad de sesión recién queda invocable por nombre (`subagent_type`) **al reiniciar Claude Code**. En la sesión donde se crean, se los puede correr embebiendo sus instrucciones en el agente `general-purpose`.

## Roster

| Agente | Rol | Naturaleza |
|---|---|---|
| **relevamiento** | Genera el HTML imprimible de relevamiento de un módulo (inspecciona código real) | escribe HTML |
| **spec-extractor** | Relevamiento + código → plan de escenarios testeables (Given/When/Then) en `tests/specs/` | escribe md |
| **test-author** | Escribe vitest/playwright desde el plan, siguiendo convenciones del repo, corre hasta verde | escribe tests |
| **test-runner** | Corre vitest + playwright, triagea fallas y reporta | read-only |
| **migration-reviewer** | Revisa una migración antes de aplicar (RLS, GRANT, SECURITY DEFINER, idempotencia, DDL destructivo) | read-only |
| **code-reviewer** | Revisa el diff vs reglas del CLAUDE.md (multi-tenant, sucursal, RLS, convenciones React) | read-only |
| **bug-fixer** | Toma un síntoma, rastrea la causa raíz, aplica fix mínimo, verifica con tsc/build | edita código |
| **deploy-runner** | Flujo dev→PR→migraciones PROD→merge→release→verificar Vercel (con OK de GO) | toca PROD |
| **wiki-keeper** | Actualiza wiki/log/roadmap/migraciones/index/feature page según el CLAUDE.md | solo docs |

## Pipelines

**Feature nueva → producción:**
```
relevamiento → (implementación) → code-reviewer → test-runner
                                       │
                            migration-reviewer (si hay SQL)
                                       │
                              deploy-runner (con OK de GO) → wiki-keeper
```

**QA / testing de lo ya construido:**
```
spec-extractor (relevamiento → plan)  →  test-author (escribe tests)  →  test-runner (corre)
                                                                              │
                                                                         bug-fixer (si hay regresión) → code-reviewer
```

## Principios

- **Gate humano:** `deploy-runner` solo se invoca cuando GO autorizó el deploy. Los fixes de `bug-fixer` se revisan (`code-reviewer`) y el merge a PROD lo aprueba GO. No hay auto-merge a producción, sobre todo en plata (caja/CC/AFIP) y RLS.
- **Arrancan fríos:** quien delega debe pasar el contexto (versión, migraciones, qué cambió). Lo estructural (IDs de Supabase/Vercel, reglas) ya está en cada `.md`.
- **Read-only por diseño** donde corresponde: los revisores no mutan; los de docs no tocan `src/`.

## Caso de uso real (v1.23.1)

Primer estreno del pipeline de QA sobre el módulo Clientes:
1. `spec-extractor` → `tests/specs/clientes.plan.md` (41 escenarios; detectó que toda la lógica de plata de CC estaba sin cubrir).
2. Extracción de la lógica pura a `src/lib/ccLogic.ts` (single source of truth) + rewire de POS/cobranza/aging.
3. `test-author` → `tests/unit/ccLogic.test.ts` (50 casos) + detectó un error de cálculo en el plan (no en el código).
4. Resultado: 228 unit tests verdes. Ver [[wiki/development/testing]].

## Links relacionados

- [[wiki/development/testing]]
- [[wiki/development/workflow-git]]
- [[wiki/development/deploy]]
- [[wiki/development/convenciones-codigo]]
