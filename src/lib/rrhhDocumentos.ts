// ── RH7 — Documentos: faltantes (E1) + vencimiento (E2) ──────────────────────
// Lógica pura (testeable). Sin I/O.

export interface DocCatalogo { id: string; nombre: string; obligatorio: boolean; activo: boolean }
export interface DocEmpleado { catalogo_id?: string | null; nombre?: string | null; fecha_vencimiento?: string | null }

/**
 * E1 — Documentos obligatorios del catálogo que el empleado NO tiene cargados.
 * Matchea por `catalogo_id`; como fallback, por nombre (case-insensitive).
 */
export function documentosFaltantes(catalogo: DocCatalogo[], docsEmpleado: DocEmpleado[]): DocCatalogo[] {
  const porId = new Set(docsEmpleado.map(d => d.catalogo_id).filter(Boolean) as string[])
  const porNombre = new Set(docsEmpleado.map(d => (d.nombre ?? '').trim().toLowerCase()).filter(Boolean))
  return (catalogo ?? []).filter(c =>
    c.activo && c.obligatorio &&
    !porId.has(c.id) &&
    !porNombre.has(c.nombre.trim().toLowerCase()),
  )
}

export interface DocVence { id?: string; nombre?: string | null; fecha_vencimiento?: string | null; empleado?: string | null }

/**
 * E2 — Documentos que vencen dentro de `diasAlerta` (o ya vencidos).
 * Devuelve cada doc con los días que faltan (negativo = vencido), ordenado por urgencia.
 */
export function documentosPorVencer<T extends DocVence>(docs: T[], hoyISO: string, diasAlerta: number): (T & { diasRestantes: number })[] {
  const hoy = new Date(hoyISO + 'T00:00:00').getTime()
  const out: (T & { diasRestantes: number })[] = []
  for (const d of docs ?? []) {
    if (!d.fecha_vencimiento) continue
    const venc = new Date(d.fecha_vencimiento + 'T00:00:00').getTime()
    if (isNaN(venc)) continue
    const diasRestantes = Math.floor((venc - hoy) / 86400000)
    if (diasRestantes <= (Number(diasAlerta) || 0)) out.push({ ...d, diasRestantes })
  }
  return out.sort((a, b) => a.diasRestantes - b.diasRestantes)
}
