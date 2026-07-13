// Lógica pura del wizard de CERTIFICADO AFIP self-service (multi-CUIT + primer certificado).
// 🛑 REGLA #0 (fiscal): el subject del CSR lleva el CUIT del emisor — si se arma mal, ARCA
// rechaza el certificado (o peor, emite uno que no corresponde). Estos helpers concentran las
// decisiones testeables del flujo para poder lockearlas con unit tests.
//
// Espejo de la EF `supabase/functions/generar-csr/index.ts` (que corre en Deno y no puede
// importar de src/): `construirSubjectCsr` DEBE quedar EN SYNC con la construcción del subject
// de la EF. Si cambia una, cambia la otra (igual criterio que emisorFiscal.ts ↔ emitir-factura).

/** Extensión de certificado válida. ARCA entrega el .crt; algunos navegadores lo bajan .pem. */
export function esArchivoCrt(nombre: string | null | undefined, opts?: { permitirPem?: boolean }): boolean {
  const n = (nombre ?? '').toLowerCase()
  return n.endsWith('.crt') || (!!opts?.permitirPem && n.endsWith('.pem'))
}

/** La clave privada que sube el usuario en modo manual debe ser .key. */
export function esArchivoKey(nombre: string | null | undefined): boolean {
  return (nombre ?? '').toLowerCase().endsWith('.key')
}

/** Nombre sugerido al descargar el CSR (solo dígitos del CUIT). Mirror de descargarCsr(). */
export function nombreArchivoCsr(cuit: string): string {
  return `${(cuit ?? '').replace(/\D/g, '')}.csr`
}

export interface SubjectCsr {
  ok: boolean
  cuitDigits: string
  /** Razón social normalizada (subject O=…). */
  razon: string
  /** Common Name = razón truncada a 50 (subject CN=…). */
  commonName: string
  /** serialNumber del subject: "CUIT 30123456789". */
  serialNumber: string
  error?: string
}

/**
 * Valida y normaliza los datos que van al subject del CSR. **Espejo exacto** de la EF
 * `generar-csr` (11 dígitos de CUIT obligatorios; razón social con fallback; CN truncado a 50).
 * Se usa para no dejar generar un CSR con CUIT inválido desde el cliente (defensa en profundidad;
 * la EF igual revalida server-side — REGLA #0: guards en los dos lados).
 */
export function construirSubjectCsr(cuit: string | null | undefined, razonSocial: string | null | undefined): SubjectCsr {
  const cuitDigits = String(cuit ?? '').replace(/\D/g, '')
  const razon = String(razonSocial ?? '').trim() || 'Razón social'
  const base: SubjectCsr = {
    ok: false, cuitDigits, razon,
    commonName: razon.slice(0, 50),
    serialNumber: `CUIT ${cuitDigits}`,
  }
  if (cuitDigits.length !== 11) return { ...base, error: 'El CUIT debe tener 11 dígitos.' }
  return { ...base, ok: true }
}

export type PasoWizardCert = 'generar' | 'subir-crt' | 'pendiente-crt' | 'activo'

/**
 * Máquina de estados del recorrido de un usuario que carga su certificado con el asistente.
 * Es el corazón del "cómo lo haría una persona que recién arranca". El orden importa:
 *  - `subir-crt`      → acaba de generar un CSR en ESTA sesión (aunque ya tenga un cert activo que
 *                       esté reemplazando): paso 2/3, pegarlo en ARCA y subir el .crt.
 *  - `activo`         → ya tiene certificado activo y no está generando uno nuevo (recargar reemplaza).
 *  - `pendiente-crt`  → generó un CSR en una sesión anterior (la .key quedó guardada, `csr_key_path`)
 *                       pero nunca subió el .crt: retomar subiendo el .crt (o regenerar).
 *  - `generar`        → todavía no hay nada: paso 1, generar el CSR.
 */
export function pasoWizardCert(args: {
  tieneCertActivo: boolean
  csrKeyPath: string | null | undefined
  /** CSR generado en la sesión actual (aún en memoria del cliente). */
  csrGeneradoEnSesion: boolean
}): PasoWizardCert {
  if (args.csrGeneradoEnSesion) return 'subir-crt'
  if (args.tieneCertActivo) return 'activo'
  if (args.csrKeyPath) return 'pendiente-crt'
  return 'generar'
}
