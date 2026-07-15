// ─── Wizard de certificado AFIP — validación crt ↔ clave (compartida Deno/Node) ──────────
// 🛑 REGLA #0 (fiscal): el .crt que sube el usuario DEBE corresponder a la clave privada que
// generó el wizard (mismo par RSA). Si NO aparean, el WSAA de AFIP rechaza la firma
// (`cms.sign.invalid: Firma inválida`) recién AL EMITIR, con un error críptico y después de
// que el usuario ya cree que quedó configurado. Esta validación aparea al SUBIR el .crt y
// falla claro, en el momento correcto. Incidente real que la motiva: un .crt de un CSR viejo
// subido sobre una clave recién regenerada (Fede, 2026-07-14, homologación).
//
// forge se INYECTA (mismo criterio que wsfe-sign.ts) para correr idéntico en Deno (Edge
// Function) y en Node (vitest) sin duplicar código ni depender de un runtime.

// deno-lint-ignore no-explicit-any
type Forge = any

export interface CertKeyMatch {
  ok: boolean
  /** Mensaje listo para mostrar si `ok` es false. Nunca lanza por contenido inválido. */
  error?: string
}

/**
 * ¿La clave pública embebida en el certificado (.crt) corresponde a la clave privada (.key)?
 * Compara el módulo (n) y el exponente público (e) del par RSA — si son iguales, es el mismo par
 * y la firma CMS del WSAA va a validar. Devuelve un resultado con mensaje claro; no tira excepción
 * por PEM inválido (lo reporta en `error`) para que el caller pueda responder 400 sin try/catch.
 */
export function certKeyMatch(forge: Forge, certPem: string, keyPem: string): CertKeyMatch {
  let cert
  try {
    cert = forge.pki.certificateFromPem(certPem)
  } catch (_e) {
    return { ok: false, error: 'El archivo .crt no es un certificado PEM válido. Subí el .crt tal cual lo descargaste de ARCA.' }
  }
  let key
  try {
    key = forge.pki.privateKeyFromPem(keyPem)
  } catch (_e) {
    // La .key la generó el wizard, así que esto sería un problema interno, no del usuario.
    return { ok: false, error: 'La clave privada del CSR guardada no es un PEM válido. Regenerá el CSR e intentá de nuevo.' }
  }

  const pub = cert.publicKey
  if (!pub || !pub.n || !pub.e || !key.n || !key.e) {
    return { ok: false, error: 'No se pudo comparar la clave del certificado (¿no es un certificado RSA?).' }
  }

  const mismoModulo = pub.n.toString(16) === key.n.toString(16)
  const mismoExponente = pub.e.toString(16) === key.e.toString(16)
  if (!mismoModulo || !mismoExponente) {
    return {
      ok: false,
      error:
        'El certificado (.crt) no corresponde al CSR que generaste: es de otra clave. ' +
        'Generá el CSR una sola vez, pegá ESE CSR en ARCA y subí el .crt que ARCA emite para él. ' +
        'No reutilices un .crt anterior ni vuelvas a generar el CSR después de haberlo pegado en ARCA.',
    }
  }
  return { ok: true }
}
