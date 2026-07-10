// ─── WSFE propio — firma CMS/PKCS#7 del TRA (compartida Deno/Node) ──────────────
// La única parte del circuito propio que necesita una librería (node-forge). Para que
// el script de integración (Node, tests/integration) y la Edge Function (Deno) usen
// EXACTAMENTE la misma firma sin duplicar código, el módulo de forge se INYECTA:
//   • providers.ts (Deno):        import forge from 'npm:node-forge' → signTra(forge, …)
//   • wsfe-homologacion.ts (Node): import forge from 'node-forge'    → signTra(forge, …)
// SignedData PKCS#7 con contenido embebido + SHA-256, en base64 (el in0 del loginCms).

// deno-lint-ignore no-explicit-any
type Forge = any

export function signTra(forge: Forge, traXml: string, certPem: string, keyPem: string): string {
  let cert, key
  try {
    cert = forge.pki.certificateFromPem(certPem)
  } catch (_e) {
    throw new Error('WSFE propio: el certificado (.crt) no es un PEM válido.')
  }
  try {
    key = forge.pki.privateKeyFromPem(keyPem)
  } catch (_e) {
    throw new Error('WSFE propio: la clave privada (.key) no es un PEM válido (¿está encriptada con passphrase? Debe subirse sin passphrase).')
  }
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(traXml, 'utf8')
  p7.addCertificate(cert)
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign()
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}
