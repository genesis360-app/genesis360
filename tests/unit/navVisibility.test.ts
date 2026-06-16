import { describe, it, expect } from 'vitest'
import { navItemVisible, navItemLocked, type NavItemFlags, type NavVisibilityCtx } from '@/lib/navVisibility'

// Espejo de los navItems de AppLayout.tsx (solo modulo + flags relevantes).
// Si cambian los flags allá, este array debe acompañar — los tests son la red
// de seguridad de la auditoría rol × modo.
const NAV: NavItemFlags[] = [
  { modulo: 'dashboard',     contadorVisible: true },
  { modulo: 'ventas',        cajeroVisible: true, contadorVisible: true },
  { modulo: 'gastos',        contadorVisible: true },
  { modulo: 'caja',          cajeroVisible: true, contadorVisible: true },
  { modulo: 'inventario',    depositoVisible: true },                                  // Productos
  { modulo: 'movimientos',   depositoVisible: true },                                  // Inventario
  { modulo: 'clientes',      cajeroVisible: true, contadorVisible: true },
  { modulo: 'envios',        cajeroVisible: true, depositoVisible: true, avanzadoOnly: true },
  { modulo: 'facturacion',   ownerOnly: true, basicoSiFacturacion: true },
  { modulo: 'proveedores',   ownerOnly: true },
  { modulo: 'recursos',      ownerOnly: true, avanzadoOnly: true },
  { modulo: 'recepciones',   supervisorOnly: true, depositoVisible: true, avanzadoOnly: true },
  { modulo: 'biblioteca',    ownerOnly: true, avanzadoOnly: true },
  { modulo: 'alertas',       depositoVisible: true },
  { modulo: 'rrhh',          ownerOnly: true, planFeature: 'puede_rrhh', rrhhVisible: true },
  { modulo: 'historial',     supervisorOnly: true, planFeature: 'puede_historial', contadorVisible: true, avanzadoOnly: true },
  { modulo: 'reportes',      planFeature: 'puede_reportes', contadorVisible: true },
  { modulo: 'sucursales',    ownerOnly: true, basicoSiMultisucursal: true },
  { modulo: 'usuarios',      ownerOnly: true },
  { modulo: 'configuracion', ownerOnly: true },
  { modulo: 'mi_portal',     portalEmpleado: true, cajeroVisible: true, contadorVisible: true, depositoVisible: true, rrhhVisible: true },
]

function visibles(ctx: NavVisibilityCtx): string[] {
  return NAV.filter(i => navItemVisible(i, ctx)).map(i => i.modulo)
}

const base = (over: Partial<NavVisibilityCtx>): NavVisibilityCtx => ({
  rol: 'DUEÑO', modoAvanzado: true, sucursalesCount: 1, ...over,
})

// ─── Modo de operación ───────────────────────────────────────────────────────
const SOLO_AVANZADO = ['envios', 'recursos', 'recepciones', 'biblioteca', 'historial']

describe('modo básico oculta los módulos avanzados', () => {
  it('Recursos/Biblioteca/Envíos/Recepciones/Historial NO aparecen en básico (ningún rol)', () => {
    for (const rol of ['DUEÑO', 'SUPERVISOR', 'DEPOSITO', 'CAJERO', 'CONTADOR'] as const) {
      const v = visibles(base({ rol, modoAvanzado: false }))
      for (const m of SOLO_AVANZADO) expect(v, `${rol} no debería ver ${m} en básico`).not.toContain(m)
    }
  })
  it('en avanzado el DUEÑO sí ve los módulos avanzados', () => {
    const v = visibles(base({ modoAvanzado: true }))
    for (const m of SOLO_AVANZADO) expect(v).toContain(m)
  })
})

describe('Rol LECTOR (Viewer) — solo operación + reportes, nunca administración', () => {
  const VIEWER_OK = ['dashboard', 'ventas', 'caja', 'gastos', 'inventario', 'movimientos', 'clientes', 'alertas', 'reportes']
  const VIEWER_NUNCA = ['usuarios', 'configuracion', 'sucursales', 'facturacion', 'proveedores', 'rrhh', 'recursos', 'biblioteca', 'envios', 'recepciones']

  it('en avanzado ve operación + reportes (incl. historial) y nada de administración', () => {
    const v = visibles(base({ rol: 'VIEWER', modoAvanzado: true }))
    for (const m of [...VIEWER_OK, 'historial']) expect(v, `Lector debería ver ${m}`).toContain(m)
    for (const m of VIEWER_NUNCA) expect(v, `Lector NO debería ver ${m}`).not.toContain(m)
  })

  it('en básico no asoma ningún módulo de WMS (historial es avanzadoOnly)', () => {
    const v = visibles(base({ rol: 'VIEWER', modoAvanzado: false }))
    expect(v).not.toContain('historial')
    for (const m of ['dashboard', 'ventas', 'caja', 'clientes', 'reportes']) expect(v).toContain(m)
  })
})

describe('Facturación y Sucursales condicionales en básico', () => {
  it('Facturación oculta en básico salvo facturación habilitada', () => {
    expect(visibles(base({ modoAvanzado: false, facturacionHabilitada: false }))).not.toContain('facturacion')
    expect(visibles(base({ modoAvanzado: false, facturacionHabilitada: true }))).toContain('facturacion')
  })
  it('Sucursales oculta en básico salvo más de una sucursal', () => {
    expect(visibles(base({ modoAvanzado: false, sucursalesCount: 1 }))).not.toContain('sucursales')
    expect(visibles(base({ modoAvanzado: false, sucursalesCount: 2 }))).toContain('sucursales')
  })
  it('en avanzado siempre se muestran (sin condición)', () => {
    const v = visibles(base({ modoAvanzado: true, facturacionHabilitada: false, sucursalesCount: 1 }))
    expect(v).toContain('facturacion')
    expect(v).toContain('sucursales')
  })
})

describe('nav básico mínimo del DUEÑO (kiosco: 1 sucursal, sin facturación)', () => {
  it('queda el set operativo + admin (12 usables + rrhh/reportes que pueden estar bloqueados)', () => {
    const v = visibles(base({ modoAvanzado: false, facturacionHabilitada: false, sucursalesCount: 1 }))
    expect(v.sort()).toEqual([
      'alertas', 'caja', 'clientes', 'configuracion', 'dashboard', 'gastos',
      'inventario', 'movimientos', 'proveedores', 'reportes', 'rrhh', 'usuarios', 'ventas',
    ].sort())
  })
})

// ─── Trabajo core por rol (en ambos modos) ───────────────────────────────────
describe('cada rol conserva su trabajo core', () => {
  it('CAJERO ve ventas/caja/clientes en básico y avanzado', () => {
    for (const modoAvanzado of [true, false]) {
      const v = visibles(base({ rol: 'CAJERO', modoAvanzado }))
      expect(v).toEqual(expect.arrayContaining(['ventas', 'caja', 'clientes']))
      // no ve administración
      expect(v).not.toContain('configuracion')
      expect(v).not.toContain('usuarios')
    }
  })
  it('DEPOSITO ve inventario/productos/alertas; sin recepciones en básico', () => {
    const av = visibles(base({ rol: 'DEPOSITO', modoAvanzado: true }))
    expect(av).toEqual(expect.arrayContaining(['movimientos', 'inventario', 'alertas', 'recepciones']))
    const bas = visibles(base({ rol: 'DEPOSITO', modoAvanzado: false }))
    expect(bas).toEqual(expect.arrayContaining(['movimientos', 'inventario', 'alertas']))
    expect(bas).not.toContain('recepciones')
  })
  it('CONTADOR ve dashboard/gastos/caja/reportes (read-only); sin historial en básico', () => {
    const av = visibles(base({ rol: 'CONTADOR', modoAvanzado: true }))
    expect(av).toEqual(expect.arrayContaining(['dashboard', 'gastos', 'caja', 'reportes', 'ventas', 'clientes', 'historial']))
    const bas = visibles(base({ rol: 'CONTADOR', modoAvanzado: false }))
    expect(bas).toEqual(expect.arrayContaining(['dashboard', 'gastos', 'caja', 'reportes']))
    expect(bas).not.toContain('historial')
  })
  it('RRHH solo ve rrhh y mi_portal (si habilitado)', () => {
    const v = visibles(base({ rol: 'RRHH', modoAvanzado: true, rrhhPortalEmpleado: true }))
    expect(v).toContain('rrhh')
    expect(v).toContain('mi_portal')
    expect(v).not.toContain('ventas')
    expect(v).not.toContain('inventario')
  })
  it('SUPERVISOR ve operación pero no configuración/usuarios/sucursales', () => {
    const v = visibles(base({ rol: 'SUPERVISOR', modoAvanzado: true }))
    expect(v).toEqual(expect.arrayContaining(['recepciones', 'historial']))
    expect(v).not.toContain('configuracion')
    expect(v).not.toContain('usuarios')
  })
})

// ─── Roles custom ────────────────────────────────────────────────────────────
describe('permisos de rol custom afectan el nav', () => {
  it("'no_ver' oculta el módulo", () => {
    const v = visibles(base({ rol: 'CAJERO', modoAvanzado: false, permisosCustom: { ventas: 'no_ver' } }))
    expect(v).not.toContain('ventas')
  })
  it("'ver' / 'editar' no ocultan", () => {
    const v = visibles(base({ rol: 'CAJERO', modoAvanzado: false, permisosCustom: { ventas: 'ver' } }))
    expect(v).toContain('ventas')
  })
})

// ─── locked por plan ─────────────────────────────────────────────────────────
describe('navItemLocked', () => {
  const rrhh = NAV.find(i => i.modulo === 'rrhh')!
  it('rrhh bloqueado si el plan no incluye puede_rrhh', () => {
    expect(navItemLocked(rrhh, { puede_rrhh: false })).toBe(true)
    expect(navItemLocked(rrhh, { puede_rrhh: true })).toBe(false)
  })
  it('sin limits (cargando) no está bloqueado', () => {
    expect(navItemLocked(rrhh, null)).toBe(false)
  })
  it('item sin planFeature nunca está bloqueado', () => {
    expect(navItemLocked({ modulo: 'ventas' }, { anything: false })).toBe(false)
  })
})
