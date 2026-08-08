---
name: relevamiento_supervisor_tab_respuestas
description: Respuestas de Fede (+ confirmaciones de GO en D2/G2) al relevamiento del patrón "Pestaña de supervisor" reusable — 2º de 4 relevamientos derivados hacia el módulo Repositores.
type: project
status: ✅ RESPONDIDO COMPLETO (2026-08-07) — 3 decisiones técnicas (A1/A3/B1) quedan delegadas a GO ("Tonga"), a discutir con Claude ANTES de implementar, no a decidir unilateralmente. Diseño/construcción arranca DESPUÉS de cerrar el 3º relevamiento derivado (Motor de Rotación) y de completar D1 (retrofit de Inventario) — GO confirmó D2 opción (a).
source: relevamiento-supervisor-tab-reglas-negocio.html
updated: 2026-08-07
---

# Respuestas — Relevamiento Reglas de Negocio · Patrón "Pestaña de Supervisor" reusable

> **Estado:** Fede respondió por escrito el 2026-08-03 ("De Fede para Tonga"). GO confirmó las 2
> preguntas que Fede había dejado abiertas (D2 y G2) el 2026-08-07. **"Tonga" en la respuesta de Fede
> es GO, no el asistente** — ver [[reference_tonga_es_go]]. Las decisiones que Fede catalogó como
> "puramente técnicas, en manos de Tonga" (A1, A3, B1) quedan para que GO las discuta CON Claude antes
> de implementar — no para que Claude las decida solo. **No arrancar diseño/código todavía**: falta
> cerrar el 3º relevamiento derivado (Motor de Rotación de productos con descuento) — ver "Orden de
> trabajo" al final.

---

## A. Qué herramientas van adentro, genéricas por módulo

| # | Respuesta de Fede | Resumen para implementación |
|---|---|---|
| A1 | Sin preferencia de negocio — decisión técnica, en manos de GO/Claude | 🔧 **Pendiente de discutir con GO antes de implementar** (no decidir unilateralmente): ¿se generaliza `autorizaciones_inventario` a una tabla `autorizaciones` con columna `modulo`, o queda exclusiva de Inventario y cada módulo nuevo arma la suya? |
| A2 | Requisito de negocio MÁS AMPLIO que las opciones del documento — sin preferencia técnica de implementación. Cualquier pestaña de asignación de tareas necesita: (1) asignación automática por prioridad como default, (2) reasignación puntual del supervisor en el momento, (3) reglas predefinidas de enrutamiento ("todas las tareas de tipo X las hace el Usuario A") que la asignación automática debe respetar | Requisito de negocio cerrado — supera A2(a)/(b)/(c) originales. La implementación concreta (cómo se guardan las reglas de enrutamiento, qué componente/RPC) es técnica, a definir al diseñar. |
| A3 | Confirmado: SÍ, todo módulo necesita historial de acciones visible para supervisores/dueños. Implementación (reusar Historial filtrado, tabla nueva, o ambos) — decisión técnica, en manos de GO/Claude | 🔧 **Pendiente de discutir con GO antes de implementar** — requisito confirmado, falta elegir el mecanismo. |
| A4 | (b) — sumar un mini-dashboard de KPIs del equipo (tareas pendientes/completadas por persona) como 4ª pieza del patrón, junto a aprobar/reasignar/trazabilidad | Confirmado. |

## B. Arquitectura de reuso

| # | Respuesta | Resumen |
|---|---|---|
| B1 | Sin preferencia técnica — decisión de GO/Claude | 🔧 **Pendiente de discutir con GO antes de implementar**: ¿componente genérico dentro de cada `PageTabs` (mismo patrón que hoy usa Autorizaciones) o ruta/página separada `/supervisor?modulo=`? |
| B2 | (a) — un único tab "Supervisor" por módulo, con sub-secciones internas (Aprobaciones / Reasignar / Trazabilidad) — no queda repartido en varios tabs de primer nivel | Confirmado. |

## C. Gateo de acceso

| # | Respuesta | Resumen |
|---|---|---|
| C1 | (a) — siempre delegable vía `roles_custom`, mismo patrón que ya usa Comercial, para TODOS los módulos (incluida una futura migración de Inventario) | Confirmado — reemplaza el gate hardcodeado actual de Autorizaciones (`['DUEÑO','SUPERVISOR','SUPER_USUARIO']`). |
| C2 | **Cambio de diseño respecto de lo planteado en el documento.** No se agrega una config nueva separada de "quién aprueba" — se suma un **4º nivel de permiso** al sistema de roles ya existente: hoy los módulos van `no_ver / ver / editar`; se agrega **`admin`** como 4º nivel. Quien tenga `admin` en un módulo es quien aprueba/supervisa ESE módulo. Reglas que acompañan la decisión: **(1)** el DUEÑO tiene `admin` en TODOS los módulos de forma **inmutable** — nadie puede editárselo ni quitárselo bajo ninguna circunstancia; **(2)** Configuración, Sucursales y Usuarios son exclusivos del dueño en el sidebar por default — ningún otro rol los ve de entrada; **(3)** el acceso a Usuarios SÍ se puede delegar a otro usuario si el dueño lo decide; **(4)** aunque se delegue Usuarios a alguien más (que podría crear usuarios/modificar roles), esa persona NUNCA puede tocar el acceso del propio dueño — sigue siendo inmutable | ⚠️ Reemplaza la necesidad de una tabla de configuración aparte para "quién aprueba" (opción C2-a del documento original queda descartada). Toca el modelo de permisos existente (`no_ver/ver/editar` → suma `admin`) — a diseñar con cuidado por ser transversal a TODA la app, no solo a este patrón. |

## D. Alcance de la migración

| # | Respuesta | Resumen |
|---|---|---|
| D1 | (a) — se construye el patrón genérico y DESPUÉS se retrofitea la tab Autorizaciones de Inventario al modelo nuevo (migrar `autorizaciones_inventario`) — dos pasos, sin duplicar UI/lógica hacia adelante | Confirmado. |
| D2 | **Sin responder por Fede** — pidió repreguntar si el patrón debe cerrarse 100% antes de diseñar Repositores, o si el diseño queda definido acá y la construcción avanza en paralelo con Repositores. **GO confirmó (2026-08-07): opción (a)** — se completa 100% este patrón (incluida la construcción real de D1, retrofit de Inventario) ANTES de arrancar el diseño de Repositores | ✅ Cerrado. Mismo criterio que el proyecto ya viene aplicando en features grandes (relevamiento → diseño completo → fases de construcción, sin diseñar apurado adentro de otra cosa en curso). |

## E. Reasignación

| # | Respuesta | Resumen |
|---|---|---|
| E1 | Cualquier tarea asignada a un usuario tiene que poder reasignarse, sin restringir por tipo — cubre tanto tareas operativas (WMS/Picking) como solicitudes de aprobación, sin necesidad de tratarlas distinto | Equivalente a la opción (c) "Ambos" del documento original, sin elegir literalmente entre (a)/(b)/(c). |
| E2 | Sí — reasignar queda registrado en `logActividad`, mismo criterio que el resto de las acciones | Confirmado — se agrega `'reasignar'` al enum `AccionLog`. |

## F. Notificación al supervisor

| # | Respuesta | Resumen |
|---|---|---|
| F1 | (a) — se construye genérico desde el día uno, cualquier módulo puede usar el botón "Avisar al supervisor" | Confirmado. |
| F2 | Sin marcar explícitamente — se resuelve solo con lo definido en C2: el aviso llega a quien tenga permiso `admin` en el módulo correspondiente | Resuelto por herencia de C2, no requiere config aparte. |

## G. Prioridad y comentarios

| # | Respuesta | Resumen |
|---|---|---|
| G1 | Sin responder — con A-F ya resueltos, Fede dejó a criterio de GO/Claude si todavía hacía falta priorizar 3 decisiones para arrancar | ✅ No aplica: como A-F quedaron todos resueltos o delegados, no hay nada pendiente que priorizar entre sí. |
| G2 | **GO confirmó (2026-08-07): sin comentarios adicionales** | ✅ Cerrado, nada que agregar al relevamiento. |

---

## Decisiones técnicas pendientes de discutir con GO (NO decidir unilateralmente)

Fede delegó explícitamente estas 3 piezas "en manos de Tonga" — que es GO, no el asistente (ver
[[reference_tonga_es_go]]). Antes de implementar cualquiera de estas, Claude debe traer opciones y
discutirlas con GO:

1. **A1** — ¿se generaliza `autorizaciones_inventario` (tabla + columna `modulo`) o queda exclusiva de
   Inventario?
2. **A3** — ¿trazabilidad por módulo = filtro de `actividad_log`/`HistorialPage`, tabla nueva, o ambos?
3. **B1** — ¿componente genérico dentro de cada `PageTabs`, o ruta/página compartida `/supervisor?modulo=`?

Más el diseño detallado de **C2** (4º nivel de permiso `admin`) — no es ambiguo en el QUÉ, pero es
transversal a toda la app y merece revisión cuidadosa antes de tocar el sistema de roles existente.

## Orden de trabajo (secuencia de 4 relevamientos hacia Repositores)

Ubicaciones (✅ respondido, EN PROD desde v1.157.0) → **Pestaña de supervisor reusable (este, ✅
respondido completo)** → Motor de Rotación de productos con descuento (relevamiento derivado #3,
generado, `relevamiento-rotacion-descuento-reglas-negocio.html`, **sin responder todavía**) →
Repositores (relevamiento final, depende de los 3 anteriores).

**Próximo paso real:** GO responde el relevamiento de Motor de Rotación con Fede. Recién con los 3
relevamientos derivados respondidos se arma el diseño técnico de la Pestaña de Supervisor (discutido
con GO, no decidido solo) y se construye — según D2, ANTES de diseñar Repositores en sí.
