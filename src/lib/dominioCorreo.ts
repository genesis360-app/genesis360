// Errores de tipeo frecuentes en el dominio de un correo (2026-10-05). Caso real: una invitación de El Tilo fue a
// "outloock.com" y nunca llegó. Solo sugiere, no corrige: el dueño confirma.

const DOMINIOS_COMUNES = [
  'gmail.com', 'hotmail.com', 'hotmail.com.ar', 'outlook.com', 'outlook.com.ar', 'live.com', 'live.com.ar',
  'yahoo.com', 'yahoo.com.ar', 'icloud.com',
]

/** Distancia de edición (Damerau, con transposición de vecinos). */
function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Si el dominio parece un error de tipeo de uno conocido, devuelve el correo corregido; si no, null. */
export function sugerenciaCorreo(email: string): string | null {
  const limpio = email.trim().toLowerCase()
  const at = limpio.lastIndexOf('@')
  if (at < 1 || at === limpio.length - 1) return null
  const dominio = limpio.slice(at + 1)
  if (DOMINIOS_COMUNES.includes(dominio)) return null
  let mejor: { dom: string; dist: number } | null = null
  for (const dom of DOMINIOS_COMUNES) {
    const dist = distancia(dominio, dom)
    if (dist <= 2 && (!mejor || dist < mejor.dist)) mejor = { dom, dist }
  }
  return mejor ? `${limpio.slice(0, at)}@${mejor.dom}` : null
}
