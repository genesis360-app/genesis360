// ─── Selección del certificado del EMISOR (multi-CUIT) — lógica pura y testeable ──────────
// 🛑 REGLA #0 (fiscal): el certificado lleva el CUIT adentro y es con ESE CUIT que firma el
// WSAA. Usar el cert de un emisor para firmar por OTRO = autenticarse con el CUIT equivocado.
// AFIP lo rechaza (`coe.notAuthorized`), pero el error es críptico y, si por casualidad los
// CUITs coincidieran, se emitiría a nombre de quien no corresponde. Por eso el apareo es
// ESTRICTO: cada emisor firma con SU certificado.
//
// El fallback a un cert LEGACY (fila con `emisor_id IS NULL`, anterior a mig 267) SOLO vale
// para el emisor DEFAULT: ese certificado se cargó cuando el tenant tenía una sola identidad
// fiscal, que es la del default. Un emisor ADICIONAL (otro CUIT) jamás puede tomarlo prestado
// — antes, el fallback era ciego y se lo habría prestado (edge case latente detectado en la
// auditoría multi-CUIT del 2026-07-15; inerte porque no hay certs legacy en DEV ni en PROD).

export interface CertRow {
  cert_crt_path: string | null
  cert_key_path: string | null
  /** Si viene false, la fila está dada de baja y no se usa. */
  activo?: boolean
  /** Emisor dueño del cert. `null` = fila legacy (pre mig 267): es del CUIT original del tenant. */
  emisor_id: string | null
}

export interface EmisorCertRef {
  /** `null` sólo en el fallback legacy (tenant sin fila en emisores_fiscales). */
  id: string | null
  es_default: boolean
}

/**
 * Devuelve el certificado que le corresponde al emisor, o `null` si no tiene uno legítimo.
 * `null` NO es un error acá: el caller decide (el circuito propio corta con 400 claro; AfipSDK
 * puede seguir en modo token-only).
 */
export function elegirCertificado<T extends CertRow>(
  certRows: T[] | null | undefined,
  emisor: EmisorCertRef,
): T | null {
  const rows = (certRows ?? []).filter((c) => c.activo !== false)

  // 1. El cert propio del emisor SIEMPRE gana (es el apareo correcto por CUIT).
  if (emisor.id) {
    const propio = rows.find((c) => c.emisor_id === emisor.id)
    if (propio) return propio
  }

  // 2. Sin cert propio: el legacy es del CUIT original del tenant → sólo para el DEFAULT.
  //    Un emisor adicional se queda sin cert (y el caller falla claro) en vez de firmar
  //    con el CUIT de otro.
  if (emisor.es_default) return rows.find((c) => !c.emisor_id) ?? null

  return null
}
