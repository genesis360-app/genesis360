// ccCategorias — condiciones de cuenta corriente con categoría de cliente (mig 442, Fase 2 del plan).
//
// Regla D1 del relevamiento de Fede: lo más puntual gana → Cliente > Categoría (activa) > Negocio.
// La fuente de verdad es la vista `vw_clientes_cc`; esto es su ESPEJO para previsualizar en un formulario lo que
// todavía no se guardó (al elegir otra categoría o sacar un valor propio). Si cambia uno, cambia el otro: los tests
// fijan los mismos casos que se probaron contra la vista.
//
// Semántica de los valores (decisión de GO 2026-09-26): en el cliente y en la categoría, `null` = HEREDA.

export type OrigenCC = 'cliente' | 'categoria' | 'negocio'
export type PoliticaExceso = 'permitir' | 'avisar' | 'bloquear'

/** Los 3 valores que un cliente puede tener propios (el override no se amplía, B-7). */
export interface PropiosCliente {
  cuenta_corriente_habilitada: boolean | null
  limite_credito: number | string | null
  plazo_pago_dias: number | string | null
}

/** Las 5 condiciones que puede definir una categoría (D3). `null` = hereda. */
export interface CondicionesCategoria {
  activo: boolean
  cc_habilitada: boolean | null
  cc_limite: number | string | null
  cc_plazo_dias: number | string | null
  cc_interes_mensual_pct: number | string | null
  cc_enforcement_politica: PoliticaExceso | null
}

export interface CondicionesNegocio {
  limite_cc_default: number | string | null
  cc_dias_vencimiento: number | string | null
  cc_interes_mensual_pct: number | string | null
  cc_enforcement_politica: string | null
}

export interface CondicionesEfectivas {
  cc_habilitada: boolean
  cc_limite: number | null
  cc_plazo_dias: number
  cc_interes_mensual_pct: number
  cc_enforcement_politica: PoliticaExceso
  origen: { habilitada: OrigenCC; limite: OrigenCC; plazo: OrigenCC; interes: OrigenCC; enforcement: OrigenCC }
}

/** El `numeric` de Postgres llega como string: normalizar; null/''/NaN = sin valor (hereda). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : null
}

const PLAZO_POR_DEFECTO = 30

/** Espejo de `vw_clientes_cc`. Una categoría DESACTIVADA no aplica (C2). */
export function resolverCondicionesCC(
  cliente: PropiosCliente,
  categoria: CondicionesCategoria | null | undefined,
  negocio: CondicionesNegocio,
): CondicionesEfectivas {
  const cat = categoria && categoria.activo ? categoria : null

  const habCli = cliente.cuenta_corriente_habilitada
  const habCat = cat?.cc_habilitada ?? null
  const limCli = num(cliente.limite_credito)
  const limCat = num(cat?.cc_limite)
  const plazoCli = num(cliente.plazo_pago_dias)
  const plazoCat = num(cat?.cc_plazo_dias)
  const intCat = num(cat?.cc_interes_mensual_pct)
  const enfCat = cat?.cc_enforcement_politica ?? null

  return {
    cc_habilitada: habCli ?? habCat ?? false,
    cc_limite: limCli ?? limCat ?? num(negocio.limite_cc_default),
    cc_plazo_dias: plazoCli ?? plazoCat ?? num(negocio.cc_dias_vencimiento) ?? PLAZO_POR_DEFECTO,
    cc_interes_mensual_pct: intCat ?? num(negocio.cc_interes_mensual_pct) ?? 0,
    cc_enforcement_politica: (enfCat ?? (negocio.cc_enforcement_politica as PoliticaExceso | null) ?? 'avisar'),
    origen: {
      habilitada: habCli !== null ? 'cliente' : habCat !== null ? 'categoria' : 'negocio',
      limite: limCli !== null ? 'cliente' : limCat !== null ? 'categoria' : 'negocio',
      plazo: plazoCli !== null ? 'cliente' : plazoCat !== null ? 'categoria' : 'negocio',
      interes: intCat !== null ? 'categoria' : 'negocio',
      enforcement: enfCat !== null ? 'categoria' : 'negocio',
    },
  }
}

// ── Formulario del cliente: 3 estados en "habilitada", vacío = hereda en límite y plazo ──────────────────
export type HabilitadaForm = 'hereda' | 'si' | 'no'

export function habilitadaAForm(v: boolean | null | undefined): HabilitadaForm {
  return v === true ? 'si' : v === false ? 'no' : 'hereda'
}

export function habilitadaDesdeForm(v: HabilitadaForm): boolean | null {
  return v === 'si' ? true : v === 'no' ? false : null
}

/** Los propios del cliente a partir del formulario: vacío = hereda (null). */
export function propiosDesdeForm(f: { cc_habilitada: HabilitadaForm; limite_credito: string; plazo_pago_dias: string }): PropiosCliente {
  const lim = num(f.limite_credito.replace(',', '.'))
  const plazo = num(f.plazo_pago_dias)
  return {
    cuenta_corriente_habilitada: habilitadaDesdeForm(f.cc_habilitada),
    limite_credito: lim,
    plazo_pago_dias: plazo === null ? null : Math.trunc(plazo),
  }
}

export function tienePropios(c: PropiosCliente): boolean {
  return c.cuenta_corriente_habilitada !== null || num(c.limite_credito) !== null || num(c.plazo_pago_dias) !== null
}

/**
 * D2 — de los clientes a asignar, los que tienen valores propios que DIFIEREN de lo que define la categoría en ese
 * campo. Solo esos necesitan decisión ("mantener o usar el de la categoría"); si la categoría no define el campo
 * (hereda), el propio no compite con nada.
 */
export function propiosQueCompiten(c: PropiosCliente, cat: CondicionesCategoria): { campo: 'habilitada' | 'limite' | 'plazo'; propio: string; categoria: string }[] {
  const out: { campo: 'habilitada' | 'limite' | 'plazo'; propio: string; categoria: string }[] = []
  if (c.cuenta_corriente_habilitada !== null && cat.cc_habilitada !== null && c.cuenta_corriente_habilitada !== cat.cc_habilitada) {
    out.push({ campo: 'habilitada', propio: c.cuenta_corriente_habilitada ? 'Sí' : 'No', categoria: cat.cc_habilitada ? 'Sí' : 'No' })
  }
  const lc = num(c.limite_credito), lk = num(cat.cc_limite)
  if (lc !== null && lk !== null && lc !== lk) out.push({ campo: 'limite', propio: String(lc), categoria: String(lk) })
  const pc = num(c.plazo_pago_dias), pk = num(cat.cc_plazo_dias)
  if (pc !== null && pk !== null && pc !== pk) out.push({ campo: 'plazo', propio: String(pc), categoria: String(pk) })
  return out
}

export const ETIQUETA_ORIGEN: Record<OrigenCC, string> = {
  cliente: 'valor propio',
  categoria: 'de la categoría',
  negocio: 'del negocio',
}

export const ETIQUETA_POLITICA: Record<PoliticaExceso, string> = {
  permitir: 'Permitir',
  avisar: 'Avisar',
  bloquear: 'Bloquear',
}

// ── Formulario de la categoría (rediseño 2026-10-05) ──────────────────────────────────────────────────────────────────
// Un check "Habilita cuenta corriente". Sin tildar = la categoría NO define CC: sus clientes usan lo del negocio (todos
// los campos quedan en "hereda"). Tildado = la categoría habilita CC con un límite OBLIGATORIO; plazo, interés y qué
// pasa al pasarse son opcionales (vacío = lo del negocio). Decisión de GO 2026-10-05.
export interface FormCCCategoria {
  habilita: boolean
  limite: string
  plazo: string
  interes: string
  politica: '' | PoliticaExceso
}

export type PayloadCCCategoria = Pick<CondicionesCategoria, 'cc_habilitada' | 'cc_limite' | 'cc_plazo_dias' | 'cc_interes_mensual_pct' | 'cc_enforcement_politica'>

export function payloadCCCategoria(f: FormCCCategoria): { ok: true; payload: PayloadCCCategoria } | { ok: false; error: string } {
  if (!f.habilita) {
    return { ok: true, payload: { cc_habilitada: null, cc_limite: null, cc_plazo_dias: null, cc_interes_mensual_pct: null, cc_enforcement_politica: null } }
  }
  const limite = num(f.limite.replace(',', '.'))
  if (limite === null) return { ok: false, error: 'Poné el límite de crédito: es obligatorio si la categoría habilita cuenta corriente' }
  if (limite <= 0) return { ok: false, error: 'El límite de crédito tiene que ser mayor que cero' }
  const plazoN = num(f.plazo)
  const plazo = plazoN === null ? null : Math.trunc(plazoN)
  if (plazo !== null && (plazo < 1 || plazo > 365)) return { ok: false, error: 'El plazo va de 1 a 365 días' }
  const interes = num(f.interes.replace(',', '.'))
  if (interes !== null && interes < 0) return { ok: false, error: 'El interés no puede ser negativo' }
  return { ok: true, payload: { cc_habilitada: true, cc_limite: limite, cc_plazo_dias: plazo, cc_interes_mensual_pct: interes, cc_enforcement_politica: f.politica || null } }
}

/** Para editar: una categoría "habilita" si tiene la CC en sí o algún valor propio cargado. */
export function formCCDesdeCategoria(c: CondicionesCategoria): FormCCCategoria {
  const n = (v: unknown) => (num(v) !== null ? String(num(v)) : '')
  const tieneAlgo = c.cc_habilitada === true || num(c.cc_limite) !== null || num(c.cc_plazo_dias) !== null
    || num(c.cc_interes_mensual_pct) !== null || !!c.cc_enforcement_politica
  return { habilita: tieneAlgo, limite: n(c.cc_limite), plazo: n(c.cc_plazo_dias), interes: n(c.cc_interes_mensual_pct), politica: (c.cc_enforcement_politica ?? '') as '' | PoliticaExceso }
}
