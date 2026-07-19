// ── Campos requeridos del cliente en el POS (backlog Fede/GO punto 4, mig 280) ───────────
// `tenants.cliente_campos_requeridos` = {"dni":bool,"telefono":bool,"email":bool} (el nombre
// es SIEMPRE obligatorio). Si el jsonb es NULL (tenant viejo sin re-guardar la config),
// se deriva del enum legacy `cliente_datos_minimos`.

export interface CamposRequeridosCliente {
  dni: boolean
  telefono: boolean
  email: boolean
}

const LEGACY_MAP: Record<string, CamposRequeridosCliente> = {
  nombre:            { dni: false, telefono: false, email: false },
  nombre_dni:        { dni: true,  telefono: false, email: false },
  nombre_dni_email:  { dni: true,  telefono: false, email: true },
  todos:             { dni: true,  telefono: true,  email: true },
}

export function camposRequeridosCliente(tenant: {
  cliente_campos_requeridos?: unknown
  cliente_datos_minimos?: string | null
} | null | undefined): CamposRequeridosCliente {
  const raw = tenant?.cliente_campos_requeridos
  if (raw && typeof raw === 'object') {
    const o = raw as any
    return { dni: o.dni === true, telefono: o.telefono === true, email: o.email === true }
  }
  return LEGACY_MAP[tenant?.cliente_datos_minimos ?? 'nombre'] ?? LEGACY_MAP.nombre
}

/** Enum legacy más cercano, para mantener sincronizada la columna vieja al guardar (mig 280). */
export function enumLegacyDeCampos(c: CamposRequeridosCliente): string {
  if (c.dni && c.email && c.telefono) return 'todos'
  if (c.dni && c.email) return 'nombre_dni_email'
  if (c.dni) return 'nombre_dni'
  return 'nombre'
}

/** Valida el alta rápida del POS. Devuelve el mensaje de error o null si está OK. */
export function validarClienteInline(
  form: { nombre: string; dni: string; telefono: string; email: string },
  req: CamposRequeridosCliente,
): string | null {
  if (!form.nombre.trim()) return 'El nombre es obligatorio'
  if (req.dni && !form.dni.trim()) return 'El DNI es obligatorio'
  if (req.telefono && !form.telefono.trim()) return 'El teléfono es obligatorio'
  if (req.email && !form.email.trim()) return 'El email es obligatorio'
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'El email no es válido'
  return null
}
