---
name: asistente-ia
description: Asistente IA del header — chat de ayuda contextual con conocimiento generado desde el wiki y contexto real del usuario (rol/modo/menú visible)
---

# Asistente IA (header)

Chat flotante del header (`AiAssistant.tsx`, ícono robot) que guía a los usuarios por la app y canaliza reportes de problemas. **v1.117.0 lo reescribió**: antes respondía desde un prompt estático hardcodeado (desactualizado, inventaba botones y no sabía del modo básico); ahora su conocimiento se **genera desde el wiki** y recibe el **contexto real del usuario**.

## Arquitectura

```
Wiki (app-reference.md)
  └─ npm run ai:knowledge  →  supabase/functions/ai-assistant/knowledge.generated.ts (commiteado)
AppLayout (navVisibility real) ──contexto──▶ AiAssistant.tsx ──POST──▶ EF ai-assistant ──▶ Groq (Llama 3.3 70B)
```

1. **Conocimiento generado** (`scripts/build-ai-knowledge.mjs`): parsea `G360.Wiki/wiki/overview/app-reference.md` en ~44 secciones (una por módulo/flujo/tema) con keywords + sinónimos es-AR por ruta. Falla ruidosamente si el formato del wiki cambia (<20 secciones o falta un módulo clave). **⚠ Al actualizar `app-reference.md`: correr `npm run ai:knowledge` y redeployar la EF `ai-assistant`** (entra en el checklist de deploy).
2. **Contexto del usuario**: `AppLayout` calcula el menú visible con `navVisibility.ts` (la MISMA lógica que renderiza el sidebar) y `AiAssistant` manda `{rol, modoAvanzado, plan, ruta actual, módulos visibles (+bloqueadoPorPlan)}` a la EF. Es solo para guiar — no otorga permisos (RLS manda).
3. **EF `ai-assistant`**: arma el system prompt dinámico = reglas duras + contexto del usuario + secciones relevantes (la de la ruta actual + hasta 3 por score de keywords, tope 14k chars) + índice de módulos + flujo de bug report + recordatorio final. Modelo `llama-3.3-70b-versatile` (Groq free), `temperature 0.2`, últimos 12 mensajes.
4. **Espejo testeado**: `src/lib/aiAssistant.ts` (scoring, selección, prompt) + `tests/unit/aiAssistant.test.ts` (11 tests). Si se cambia la EF, actualizar el espejo.

## Reglas duras del prompt (anti-alucinación)

- Solo temas Genesis360 (off-topic se declina siempre; validado en smoke ×2).
- Nunca inventar botones/tabs/menús: solo UI que figure en el conocimiento o el contexto, con nombres exactos.
- El menú del usuario es EXACTAMENTE la lista recibida; funciones de módulos que no ve → explicar que requieren rol/modo avanzado/plan y que las gestiona el DUEÑO (nunca mandarlo a una pantalla que no tiene).
- Sin respuesta en el conocimiento → decirlo + ofrecer "Enviar reporte al equipo" o soporte@genesis360.pro.
- No ve datos del negocio (stock/ventas); indica en qué pantalla verlos.

## Reporte de problemas (sin cambios)

Tras 4+ mensajes aparece "Enviar reporte al equipo" → `send-email` `type:'bug_report'` → `soporte@genesis360.pro` con usuario, tenant y transcript.

## Limitaciones conocidas

- **Groq free tier**: `llama-3.3-70b-versatile` ≈ 12k tokens/min y 1.000 req/día — 2 consultas en el mismo minuto del MISMO tenant pueden dar 429 ("Error al consultar el asistente"); a ritmo humano no ocurre. Si molesta: retry con backoff o volver a `llama-3.1-8b-instant` (14.400 req/día) perdiendo calidad.
- El conocimiento se actualiza **al redeployar la EF**, no en caliente.
- Fase 3 pendiente: mejores keywords/embeddings, y batería de preguntas doradas en el UAT (Fase 4).

## Validación (2026-07-07, DEV)

Smoke real con login de CAJERO modo básico (menú Ventas/Caja/Clientes) preguntando "¿cómo emito una factura?": guió por Ventas → Historial → "Emitir factura AFIP" (real) y aclaró que la configuración AFIP la hace el DUEÑO, sin mandarlo a pantallas que no ve. Off-topic ("receta de milanesas") declinado en 2/2 corridas.
