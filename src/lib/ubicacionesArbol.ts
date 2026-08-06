// Árbol de Ubicaciones (mig 334, relevamiento 2026-08-02) — contenedora/nivel self-FK dentro
// de la misma tabla `ubicaciones` (mismo patrón que producto_presentaciones.padre_linea_id).
// Helpers puros compartidos por ConfigPage.tsx (CRUD del árbol) y los selects operativos
// (Recepciones/Inventario/Traslados/Pedidos/LpnAccionesModal/MasivoModal/ProductoFormPage)
// que necesitan mostrar el camino completo padre→hijo para que el usuario elija el nivel
// correcto una vez que el árbol deje de ser plano.

export interface UbicacionArbolNodo {
  id: string
  nombre: string
  padre_ubicacion_id?: string | null
}

export function breadcrumbUbicacion(id: string | null | undefined, porId: Map<string, UbicacionArbolNodo>): string {
  const partes: string[] = []
  let cur = id ? porId.get(id) : null
  let guard = 0
  while (cur && guard++ < 50) {
    partes.unshift(cur.nombre)
    cur = cur.padre_ubicacion_id ? porId.get(cur.padre_ubicacion_id) : null
  }
  return partes.join(' › ')
}

export function descendientesDeUbicacion(id: string, lista: UbicacionArbolNodo[]): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    lista.forEach(u => { if (u.padre_ubicacion_id === cur && !out.has(u.id)) { out.add(u.id); stack.push(u.id) } })
  }
  return out
}

export function ordenarArbolUbicaciones<T extends UbicacionArbolNodo & { prioridad?: number | null }>(
  lista: T[],
): (T & { _depth: number })[] {
  const porPadre = new Map<string | null, T[]>()
  lista.forEach(u => {
    const key = u.padre_ubicacion_id ?? null
    if (!porPadre.has(key)) porPadre.set(key, [])
    porPadre.get(key)!.push(u)
  })
  const out: (T & { _depth: number })[] = []
  const visit = (padreId: string | null, depth: number) => {
    const hijos = (porPadre.get(padreId) ?? []).slice()
      .sort((a, b) => (a.prioridad ?? 0) - (b.prioridad ?? 0) || String(a.nombre).localeCompare(String(b.nombre)))
    hijos.forEach(h => { out.push({ ...h, _depth: depth }); visit(h.id, depth + 1) })
  }
  visit(null, 0)
  return out
}
