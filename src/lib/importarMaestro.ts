// Reglas puras del importador del Maestro (src/pages/ImportarMasterPage.tsx, mig 452 `fn_importar_maestro`).
//
// Mismo criterio que los otros importadores (D3-a): vista previa completa con el motivo de cada error y TODO O NADA.
// Lo que ya existe (mismo nombre) se ignora: el Maestro solo crea. Corrige los silencios del importador anterior:
// estado inexistente en un perfil/grupo se salteaba, el combo se creaba sin productos (`combo_items`) y el POS lo
// ignoraba, el tipo de motivo `egreso` (el de la plantilla) lo rechazaba la base, la ubicación se creaba sin sucursal
// y un color inválido se reemplazaba por uno al azar.
import { filaExcel, resolverReferencia, type ItemMaestro } from '@/lib/importacion'
import { fechaImportada } from '@/lib/importarInventario'

export type TipoMaestro = 'categorias' | 'ubicaciones' | 'estados' | 'motivos' | 'combos' | 'aging' | 'grupos'

type XlsxSsf = Parameters<typeof fechaImportada>[1]

export interface ContextoMaestro {
  /** Los del tipo elegido que ya existen (combos: solo los activos). */
  existentes: { id: string; nombre: string; sucursal_id?: string | null; codigo?: string | null }[]
  /** Estados de inventario (para perfiles de vencimiento y grupos). */
  estados?: ItemMaestro[]
  /** Productos por SKU (para combos). */
  productos?: { id: string; sku: string | null; nombre: string; activo?: boolean | null }[]
  /** Sucursal de destino de ubicaciones y combos; null = todas. */
  sucursalId?: string | null
  xlsx?: XlsxSsf
}

export interface FilaMaestro {
  idx: number
  nombre: string
  estado: 'nuevo' | 'existente' | 'error'
  errores: string[]
  celdas: string[]
  detalle?: string
}

export interface ValidacionMaestro {
  filas: FilaMaestro[]
  /** Lo que se manda a `fn_importar_maestro` (solo lo nuevo; vacío si hay algún error). */
  items: Record<string, unknown>[]
}

/** Columnas de la plantilla y de la vista previa por tipo. */
export const COLUMNAS_MAESTRO: Record<TipoMaestro, string[]> = {
  categorias:  ['nombre', 'descripcion'],
  ubicaciones: ['nombre', 'codigo', 'descripcion'],
  estados:     ['nombre', 'color'],
  motivos:     ['nombre', 'tipo'],
  combos:      ['nombre', 'sku', 'cantidad', 'descuento_tipo', 'descuento_valor', 'vigencia_desde', 'vigencia_hasta'],
  aging:       ['nombre_perfil', 'estado', 'dias'],
  grupos:      ['nombre', 'descripcion', 'estados', 'es_default'],
}

export const TIPOS_MOTIVO_PLANTILLA = ['ambos', 'ingreso', 'rebaje', 'caja']
export const TIPOS_DESCUENTO_PLANTILLA = ['pct', 'monto_ars', 'monto_usd']
export const CODIGO_UBICACION_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/

const clave = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const txt = (row: Record<string, unknown>, k: string) => String(row[k] ?? '').trim()

/** Tipo de motivo → valor del CHECK. `egreso` (el de la plantilla vieja) = `rebaje`. Vacío = ambos. */
export function tipoMotivo(v: unknown): 'ambos' | 'ingreso' | 'rebaje' | 'caja' | 'invalido' {
  const s = clave(v)
  if (!s || s === 'ambos') return 'ambos'
  if (s === 'ingreso') return 'ingreso'
  if (s === 'rebaje' || s === 'egreso') return 'rebaje'
  if (s === 'caja') return 'caja'
  return 'invalido'
}

/** Color '#rrggbb' (con o sin '#'). Vacío = null (la base pone el gris por defecto); otra cosa = 'invalido'. */
export function colorHex(v: unknown): string | null | 'invalido' {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = s.match(/^#?([0-9a-f]{6})$/i)
  return m ? `#${m[1].toLowerCase()}` : 'invalido'
}

/** SI/NO de la plantilla. Vacío = NO. */
export function siNo(v: unknown): boolean | 'invalido' {
  const s = clave(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!s || ['no', 'n', 'false', '0'].includes(s)) return false
  if (['si', 's', 'true', '1'].includes(s)) return true
  return 'invalido'
}

/**
 * Número de una celda. Acepta coma decimal y como mucho 2 decimales: "1.500" se rechaza en vez de leerse 1,5
 * (en un descuento en pesos esa ambigüedad es plata).
 */
export function numeroCelda(v: unknown): number | null | 'invalido' {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'invalido'
  const s = String(v ?? '').trim().replace(',', '.')
  if (!s) return null
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : 'invalido'
}

/** Entero ≥ 0 (días, cantidades). */
export function enteroCelda(v: unknown): number | null | 'invalido' {
  const s = String(v ?? '').trim()
  if (!s) return null
  return /^\d{1,6}$/.test(s) ? Number(s) : 'invalido'
}

function repetidos<T>(filas: T[], key: (f: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const f of filas) { const k = key(f); if (k) m.set(k, [...(m.get(k) ?? []), f]) }
  return m
}

const filasTxt = (fs: { idx: number }[]) => fs.map(f => filaExcel(f.idx)).join(', ')

export function validarMaestro(tipo: TipoMaestro, rows: Record<string, unknown>[], ctx: ContextoMaestro): ValidacionMaestro {
  const campoNombre = tipo === 'aging' ? 'nombre_perfil' : 'nombre'
  const existentes = new Map<string, ContextoMaestro['existentes'][number]>()
  for (const e of ctx.existentes) {
    // Las ubicaciones se distinguen por sucursal: "Depósito" puede existir en dos.
    if (tipo === 'ubicaciones' && (e.sucursal_id ?? null) !== (ctx.sucursalId ?? null)) continue
    existentes.set(clave(e.nombre), e)
  }

  const filas: FilaMaestro[] = rows.map((row, idx) => {
    // La plantilla vieja de aging usaba nombre_perfil y la de combos sku_producto: se aceptan las dos.
    const nombre = txt(row, campoNombre) || (tipo === 'aging' ? txt(row, 'nombre') : '')
    const celdas = COLUMNAS_MAESTRO[tipo].slice(1).map(c => txt(row, c) || (c === 'sku' ? txt(row, 'sku_producto') : ''))
    const errores: string[] = []
    if (!nombre) errores.push(`Falta ${campoNombre === 'nombre' ? 'el nombre' : 'el nombre del perfil'}`)
    const ex = nombre ? existentes.get(clave(nombre)) : undefined
    return { idx, nombre, celdas, errores, estado: ex ? 'existente' : 'nuevo', detalle: ex ? 'Ya existe: se ignora' : undefined }
  })

  // Tipos agrupados: varias filas = un combo / un perfil. El resto: un nombre repetido es un error.
  const agrupado = tipo === 'combos' || tipo === 'aging'
  if (!agrupado) {
    for (const [, fs] of repetidos(filas, f => clave(f.nombre))) {
      if (fs.length > 1) fs.forEach(f => f.errores.push(`Nombre repetido en el archivo (filas ${filasTxt(fs)})`))
    }
  }

  const items: Record<string, unknown>[] = []
  const nuevas = filas.filter(f => f.estado === 'nuevo')
  const row = (f: FilaMaestro) => rows[f.idx]

  if (tipo === 'categorias') {
    for (const f of nuevas) items.push({ fila: filaExcel(f.idx), nombre: f.nombre, descripcion: txt(row(f), 'descripcion') || null })
  }

  if (tipo === 'ubicaciones') {
    const codigosNegocio = new Map<string, string>()
    for (const e of ctx.existentes) if (e.codigo) codigosNegocio.set(e.codigo.toUpperCase(), e.nombre)
    const codigos = new Map<string, FilaMaestro[]>()
    for (const f of nuevas) {
      const codigo = txt(row(f), 'codigo').toUpperCase()
      if (codigo) {
        if (!CODIGO_UBICACION_RE.test(codigo)) f.errores.push(`Código "${codigo}" inválido: letras y números separados por guiones (ej. A-03-02), o vacío para generarlo`)
        else if (codigosNegocio.has(codigo)) f.errores.push(`El código "${codigo}" ya lo usa la ubicación "${codigosNegocio.get(codigo)}"`)
        else codigos.set(codigo, [...(codigos.get(codigo) ?? []), f])
      }
      items.push({ fila: filaExcel(f.idx), nombre: f.nombre, codigo: codigo || null, descripcion: txt(row(f), 'descripcion') || null })
    }
    for (const [c, fs] of codigos) if (fs.length > 1) fs.forEach(f => f.errores.push(`Código "${c}" repetido en el archivo (filas ${filasTxt(fs)})`))
  }

  if (tipo === 'estados') {
    for (const f of nuevas) {
      const color = colorHex(row(f).color)
      if (color === 'invalido') f.errores.push(`Color "${txt(row(f), 'color')}" inválido: código hex como #22c55e, o vacío`)
      items.push({ fila: filaExcel(f.idx), nombre: f.nombre, color: color === 'invalido' ? null : color })
    }
  }

  if (tipo === 'motivos') {
    for (const f of nuevas) {
      const t = tipoMotivo(row(f).tipo)
      if (t === 'invalido') f.errores.push(`Tipo "${txt(row(f), 'tipo')}" inválido: ambos, ingreso, rebaje o caja`)
      items.push({ fila: filaExcel(f.idx), nombre: f.nombre, tipo: t })
    }
  }

  if (tipo === 'grupos') {
    const estados = ctx.estados ?? []
    for (const f of nuevas) {
      const r = row(f)
      const nombres = txt(r, 'estados').split(/[|,;]/).map(s => s.trim()).filter(Boolean)
      if (!nombres.length) f.errores.push('Falta al menos un estado (nombres separados por |)')
      const ids = new Set<string>()
      for (const n of nombres) {
        const ref = resolverReferencia(n, estados, 'Estado')
        if (ref.error) f.errores.push(ref.error)
        else if (ref.id) ids.add(ref.id)
      }
      const def = siNo(r.es_default)
      if (def === 'invalido') f.errores.push(`es_default "${txt(r, 'es_default')}" inválido: SI o NO`)
      items.push({ fila: filaExcel(f.idx), nombre: f.nombre, descripcion: txt(r, 'descripcion') || null, es_default: def === true, estados: [...ids] })
    }
    const defaults = nuevas.filter(f => siNo(row(f).es_default) === true)
    if (defaults.length > 1) defaults.forEach(f => f.errores.push(`Solo un grupo puede ser el predeterminado (filas ${filasTxt(defaults)})`))
  }

  if (tipo === 'aging') {
    const estados = ctx.estados ?? []
    for (const [, fs] of repetidos(nuevas, f => clave(f.nombre))) {
      const reglas: { fila: number; estado_id: string; dias: number }[] = []
      for (const f of fs) {
        const r = row(f)
        const ref = resolverReferencia(txt(r, 'estado'), estados, 'Estado')
        if (!txt(r, 'estado')) f.errores.push('Falta el estado')
        else if (ref.error) f.errores.push(ref.error)
        const dias = enteroCelda(r.dias)
        if (dias === null || dias === 'invalido') f.errores.push(`Días "${txt(r, 'dias')}": número entero de 0 en adelante`)
        if (ref.id && typeof dias === 'number') reglas.push({ fila: filaExcel(f.idx), estado_id: ref.id, dias })
      }
      for (const [, rs] of repetidos(reglas, r => r.estado_id)) {
        if (rs.length > 1) fs.filter(f => rs.some(r => r.fila === filaExcel(f.idx))).forEach(f => f.errores.push(`El estado está dos veces en el perfil (filas ${rs.map(r => r.fila).join(', ')})`))
      }
      for (const [, rs] of repetidos(reglas, r => String(r.dias))) {
        if (rs.length > 1) fs.filter(f => rs.some(r => r.fila === filaExcel(f.idx))).forEach(f => f.errores.push(`Dos reglas del perfil con los mismos días (filas ${rs.map(r => r.fila).join(', ')})`))
      }
      items.push({ fila: filaExcel(fs[0].idx), nombre: fs[0].nombre, reglas })
    }
  }

  if (tipo === 'combos') {
    const porSku = new Map<string, NonNullable<ContextoMaestro['productos']>[number][]>()
    for (const p of ctx.productos ?? []) if (p.sku) porSku.set(p.sku.trim().toUpperCase(), [...(porSku.get(p.sku.trim().toUpperCase()) ?? []), p])
    for (const [, fs] of repetidos(nuevas, f => clave(f.nombre))) {
      const cab = { descuento_tipo: '', descuento_valor: '', vigencia_desde: '', vigencia_hasta: '' }
      const desde: Record<string, number> = {}
      const comboItems: { fila: number; producto_id: string; cantidad: number }[] = []
      for (const f of fs) {
        const r = row(f)
        // La cabecera (descuento y vigencia) se toma de la primera fila que la trae; otra distinta es un error.
        for (const k of Object.keys(cab) as (keyof typeof cab)[]) {
          const v = txt(r, k)
          if (!v) continue
          if (!cab[k]) { cab[k] = v; desde[k] = filaExcel(f.idx) }
          else if (clave(cab[k]) !== clave(v)) f.errores.push(`${k} "${v}" distinto al de la fila ${desde[k]} ("${cab[k]}") del mismo combo`)
        }
        const sku = (txt(r, 'sku') || txt(r, 'sku_producto')).toUpperCase()
        const prods = sku ? porSku.get(sku) ?? [] : []
        const prod = prods.find(p => p.activo !== false)
        if (!sku) f.errores.push('Falta el SKU')
        else if (!prods.length) f.errores.push(`SKU "${sku}" no existe en el catálogo`)
        else if (!prod) f.errores.push(`SKU "${sku}" está desactivado: reactivalo o elegí otro`)
        const cant = enteroCelda(r.cantidad)
        if (cant === null || cant === 'invalido' || cant < 1) f.errores.push(`Cantidad "${txt(r, 'cantidad')}": número entero de 1 en adelante`)
        if (prod && typeof cant === 'number' && cant >= 1) comboItems.push({ fila: filaExcel(f.idx), producto_id: prod.id, cantidad: cant })
      }
      for (const [, its] of repetidos(comboItems, i => i.producto_id)) {
        if (its.length > 1) fs.filter(f => its.some(i => i.fila === filaExcel(f.idx))).forEach(f => f.errores.push(`El producto está dos veces en el combo (filas ${its.map(i => i.fila).join(', ')})`))
      }
      // Un combo de un solo producto con cantidad 1 sería un descuento fijo, no un combo.
      if (fs.length === 1 && comboItems.length === 1 && comboItems[0].cantidad < 2) fs[0].errores.push('Un combo de un solo producto necesita cantidad 2 o más')

      const primera = fs[0]
      const dtipo = clave(cab.descuento_tipo)
      if (!dtipo) primera.errores.push('Falta descuento_tipo (pct, monto_ars o monto_usd)')
      else if (!TIPOS_DESCUENTO_PLANTILLA.includes(dtipo)) primera.errores.push(`descuento_tipo "${cab.descuento_tipo}" inválido: pct, monto_ars o monto_usd`)
      const dval = numeroCelda(cab.descuento_valor)
      if (dval === null) primera.errores.push('Falta descuento_valor')
      else if (dval === 'invalido') primera.errores.push(`descuento_valor "${cab.descuento_valor}" inválido: número con hasta 2 decimales, sin separador de miles`)
      else if (dtipo === 'pct' && dval > 100) primera.errores.push('El descuento en porcentaje no puede superar 100')
      const fechas: Record<'vigencia_desde' | 'vigencia_hasta', string | null> = { vigencia_desde: null, vigencia_hasta: null }
      for (const k of ['vigencia_desde', 'vigencia_hasta'] as const) {
        const filaOrigen = fs.find(f => filaExcel(f.idx) === desde[k])
        const v = filaOrigen ? fechaImportada(row(filaOrigen)[k], ctx.xlsx ?? { SSF: { parse_date_code: () => null } }) : undefined
        if (v === 'invalida') primera.errores.push(`${k} "${cab[k]}" no es una fecha válida (DD/MM/AAAA)`)
        else fechas[k] = v ?? null
      }
      if (fechas.vigencia_desde && fechas.vigencia_hasta && fechas.vigencia_desde > fechas.vigencia_hasta) {
        primera.errores.push('vigencia_desde es posterior a vigencia_hasta')
      }
      items.push({
        fila: filaExcel(primera.idx), nombre: primera.nombre, descuento_tipo: dtipo,
        descuento_valor: typeof dval === 'number' ? dval : null, ...fechas, items: comboItems,
      })
    }
  }

  for (const f of filas) if (f.errores.length) f.estado = 'error'
  return { filas, items: filas.some(f => f.estado === 'error') ? [] : items }
}
