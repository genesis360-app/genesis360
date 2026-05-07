---
name: feedback_reglas_negocio
description: Necesidad de documentar reglas de negocio antes de escribir tests automatizados
type: feedback
---

Siempre preguntar al usuario las reglas de negocio antes de asumir comportamiento en tests E2E.

**Why:** Los tests E2E actuales asumen comportamiento genérico (UI carga, botones visibles). Los bugs reales son de lógica de negocio (ej: ventas sin caja, bloqueos de rol). Sin conocer las reglas, los tests no detectan estos bugs.

**How to apply:** Al comenzar una sesión de bugfixing o testing, proponer al usuario una sesión de preguntas para documentar las reglas de negocio del módulo en cuestión y generar tests específicos a partir de ellas. El documento resultante se guarda como `docs/reglas_negocio.md` o similar.
