# Marco legal / Compliance — Genesis360

Estado de los documentos y controles legales de la plataforma. **Todo el marco vive en el código**
(`src/pages/*Page.tsx` legales + `src/config/brand.ts`), no hay docs sueltos.

> ⚠️ **Estado al 2026-07-14: el blindaje está en `dev`, NO en PROD.** Antes de mostrarlo oficialmente
> en producción falta **revisión de un abogado** + **registro de la base ante la AAIP**.

## Titular del Servicio

Fuente única: `LEGAL_TITULAR` en `src/config/brand.ts` (la usan T&C, Privacidad, Cookies y los pies).
Si cambia la figura (p. ej. se constituye una SRL/SA), se actualiza ahí y se propaga solo.

- **Titular:** Federico Ezequiel Messina — **Responsable Monotributo** (es el socio de GO que factura).
- **CUIT:** 20-42237416-8 · **Domicilio:** Cnel. Ramón L. Falcón 2387, C1406, CABA.
- **Jurisdicción (T&C §13):** tribunales ordinarios de la Ciudad Autónoma de Buenos Aires.
- La ley de e-commerce AR obliga a **exhibir** esta identidad → se muestra en T&C y Privacidad. Si los
  campos quedan en `'PENDIENTE'`, `legalCompleto` es false y las páginas muestran "en definición".
- `LEGAL_VERSION` (brand.ts) versiona el texto legal aceptado (se guarda en `tenants.terminos_version`
  al aceptar en el alta, mig 249). Bumpear la fecha si el texto cambia sustancialmente.

## Documentos

| Documento | Ruta | Estado |
|-----------|------|--------|
| **Términos y Condiciones** | `/terminos` (`TerminosPage.tsx`) | ✅ 14 secciones + bloque de titular + cláusula de arrepentimiento/reembolsos + prohibiciones tipo-EULA (ingeniería inversa, sublicencia, scraping, reventa). Marco AR (Ley 24.240). |
| **Política de Privacidad** | `/privacidad` (`PrivacidadPage.tsx`) | ✅ Alineada a Ley 25.326. Sub-encargados: infra (Supabase), email (Resend), pagos (MP), AFIP/ARCA, **Sentry** (errores/rendimiento), **Google Maps**. Derechos art. 14/16 + AAIP. |
| **Política de Cookies** | `/cookies` (`CookiesPage.tsx`) | ✅ **Nueva 2026-07-14**. Solo esenciales + funcionales; **sin publicidad, sin banner** (no hay tracking de marketing). |
| **Botón de Arrepentimiento** | app (cancelación) + EF `cancel-suscripcion` | ✅ Ley 24.240 art. 34: 10 días corridos, reembolso TOTAL. Ver [[wiki/features/cancelacion-arrepentimiento]]. |
| **Consentimiento de marketing** | onboarding (mig 249, 2 checkboxes) | ✅ Opt-in separado y revocable. |
| **Defensa del Consumidor** | link en pies (Landing + LegalLayout) | ✅ Enlace al portal oficial AR. |

## Decisiones de negocio (GO, 2026-07-14)

- **Sin SLA de uptime** — el Servicio se presta "según disponibilidad" (menor exposición). Un SLA con
  crédito por incumplimiento se puede sumar más adelante como diferencial de planes altos.
- **Reembolsos:** solo el arrepentimiento obligatorio (10 días). Fuera de ese plazo, la cancelación
  corta la renovación pero no reembolsa el período en curso (acceso hasta fin de ciclo).
- **Cookies sin banner** — no se usan cookies de publicidad ni Session Replay, así que no hace falta
  consentimiento previo bloqueante.
- **Sentry sin Session Replay** (`main.tsx`) — no se graba la pantalla del usuario; solo errores +
  rendimiento. ⚠ Re-agregar `replayIntegration` obliga a sumar banner de consentimiento + actualizar
  Cookies/Privacidad.

## Pendientes

- 🔴 **Revisión de abogado** de T&C / Privacidad / Cookies antes de PROD (trámite de GO).
- 🔴 **Registro de la base ante la AAIP** (Agencia de Acceso a la Información Pública, Ley 25.326).
- 🟡 **DPA** (acuerdo de tratamiento de datos) para clientes B2B grandes — ofrecido, sin redactar.
- 🟡 Deploy a PROD del blindaje (con bump de versión + release) una vez aprobado por abogado.
