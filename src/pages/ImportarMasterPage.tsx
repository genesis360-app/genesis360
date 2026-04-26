import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Upload, Download, CheckCircle, XCircle, FileSpreadsheet, RefreshCw, Tag, Truck, MapPin, CircleDot, MessageSquare, Gift, Timer, Layers } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type TipoMaster = 'categorias' | 'proveedores' | 'ubicaciones' | 'estados' | 'motivos' | 'combos' | 'aging' | 'grupos'

interface FilaMaster {
  idx: number
  nombre: string
  extra: Record<string, string>
  estado: 'nuevo' | 'existente' | 'error'
  errores: string[]
}

const COLORES_DEFAULT = ['#22c55e', '#ef4444', '#f97316', '#3b82f6', '#8b5cf6', '#eab308', '#6b7280']

const MASTER_CONFIG: Record<TipoMaster, { label: string; icon: any; cols: string[]; extraCols: string[]; tabla?: string; hint?: string }> = {
  categorias:  { label: 'Categorías',           icon: Tag,        cols: ['nombre', 'descripcion'],                        extraCols: ['descripcion'],                     tabla: 'categorias' },
  proveedores: { label: 'Proveedores',           icon: Truck,      cols: ['nombre', 'contacto', 'telefono', 'email'],      extraCols: ['contacto', 'telefono', 'email'],   tabla: 'proveedores' },
  ubicaciones: { label: 'Ubicaciones',           icon: MapPin,     cols: ['nombre', 'descripcion'],                        extraCols: ['descripcion'],                     tabla: 'ubicaciones' },
  estados:     { label: 'Estados',               icon: CircleDot,  cols: ['nombre', 'color'],                              extraCols: ['color'],                           tabla: 'estados_inventario',  hint: 'color: código hex (ej: #22c55e). Opcional.' },
  motivos:     { label: 'Motivos',               icon: MessageSquare, cols: ['nombre', 'tipo'],                            extraCols: ['tipo'],                            tabla: 'motivos_movimiento',  hint: 'tipo: ambos | ingreso | egreso | caja. Opcional (default: ambos).' },
  combos:      { label: 'Combos',                icon: Gift,       cols: ['nombre', 'sku_producto', 'cantidad', 'descuento_tipo', 'descuento_valor'], extraCols: ['sku_producto', 'cantidad', 'descuento_tipo', 'descuento_valor'], hint: 'descuento_tipo: pct | monto_ars | monto_usd' },
  aging:       { label: 'Progresión de estado',  icon: Timer,      cols: ['nombre_perfil', 'estado', 'dias'],              extraCols: ['estado', 'dias'],                  hint: 'Agrupa reglas por nombre_perfil. estado = nombre del estado de inventario. dias = días hasta vencimiento ≤' },
  grupos:      { label: 'Grupos de estados',      icon: Layers,     cols: ['nombre', 'descripcion', 'estados', 'es_default'], extraCols: ['descripcion', 'estados', 'es_default'], hint: 'estados: nombres separados por | (ej: Disponible|Próx a Vencer). es_default: SI o NO.' },
}

const PLANTILLA_EJEMPLOS: Record<TipoMaster, any[][]> = {
  categorias:  [['Ferretería', 'Herramientas y materiales']],
  proveedores: [['Proveedor A', 'Juan García', '1123456789', 'juan@proveedor.com']],
  ubicaciones: [['Depósito A', 'Primer piso']],
  estados:     [['Disponible', '#22c55e'], ['Bloqueado', '#ef4444'], ['En análisis', '#f97316']],
  motivos:     [['Venta mayorista', 'egreso'], ['Ingreso proveedor', 'ingreso'], ['Ajuste caja', 'caja']],
  combos:      [['3x Shampoo 10%', 'SKU-001', '3', 'pct', '10'], ['Pack ahorro $500', 'SKU-002', '2', 'monto_ars', '500']],
  aging:       [['PERECEDERO', 'Próx a Vencer', '30'], ['PERECEDERO', 'Vencido', '0'], ['ESTANDAR', 'Vencido', '0']],
  grupos:      [['Disponible para venta', 'Estados vendibles', 'Disponible|Próx a Vencer', 'SI'], ['Stock total', '', 'Disponible|Bloqueado|En análisis', 'NO']],
}

export default function ImportarMasterPage() {
  const navigate = useNavigate()
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tipoMaster, setTipoMaster] = useState<TipoMaster>('categorias')
  const [filas, setFilas] = useState<FilaMaster[]>([])
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<{ creados: number; ignorados: number; errores: number } | null>(null)

  // Queries para dedup y resolución de referencias
  const { data: categorias = [] }  = useQuery({ queryKey: ['categorias', tenant?.id],  queryFn: async () => { const { data } = await supabase.from('categorias').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: proveedores = [] } = useQuery({ queryKey: ['proveedores', tenant?.id], queryFn: async () => { const { data } = await supabase.from('proveedores').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: ubicaciones = [] } = useQuery({ queryKey: ['ubicaciones', tenant?.id], queryFn: async () => { const { data } = await supabase.from('ubicaciones').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: estados = [] }     = useQuery({ queryKey: ['estados_inventario', tenant?.id], queryFn: async () => { const { data } = await supabase.from('estados_inventario').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: motivos = [] }     = useQuery({ queryKey: ['motivos', tenant?.id],     queryFn: async () => { const { data } = await supabase.from('motivos_movimiento').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: combos = [] }      = useQuery({ queryKey: ['combos', tenant?.id],      queryFn: async () => { const { data } = await supabase.from('combos').select('id,nombre').eq('tenant_id', tenant!.id).eq('activo', true); return data ?? [] }, enabled: !!tenant })
  const { data: agingProfiles = [] }= useQuery({ queryKey: ['aging_profiles', tenant?.id], queryFn: async () => { const { data } = await supabase.from('aging_profiles').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: gruposEstados = [] } = useQuery({ queryKey: ['grupos_estados', tenant?.id], queryFn: async () => { const { data } = await supabase.from('grupos_estados').select('id,nombre').eq('tenant_id', tenant!.id); return data ?? [] }, enabled: !!tenant })
  const { data: productos = [] }   = useQuery({ queryKey: ['productos-sku', tenant?.id], queryFn: async () => { const { data } = await supabase.from('productos').select('id,nombre,sku').eq('tenant_id', tenant!.id).eq('activo', true); return data ?? [] }, enabled: !!tenant && tipoMaster === 'combos' })

  const getExistentesMap = (tipo: TipoMaster): Record<string, boolean> => {
    const map: Record<string, boolean> = {}
    const lista: any[] = tipo === 'categorias' ? categorias : tipo === 'proveedores' ? proveedores :
      tipo === 'ubicaciones' ? ubicaciones : tipo === 'estados' ? estados :
      tipo === 'motivos' ? motivos : tipo === 'combos' ? combos :
      tipo === 'aging' ? agingProfiles : gruposEstados
    lista.forEach((i: any) => { map[i.nombre.toLowerCase()] = true })
    return map
  }

  const descargarPlantilla = (tipo: TipoMaster) => {
    const cfg = MASTER_CONFIG[tipo]
    const rows = [cfg.cols, ...PLANTILLA_EJEMPLOS[tipo]]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = cfg.cols.map(() => ({ wch: 24 }))
    if (cfg.hint) {
      const noteCell = XLSX.utils.encode_cell({ r: rows.length + 1, c: 0 })
      ws[noteCell] = { v: `Nota: ${cfg.hint}`, t: 's' }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, cfg.label)
    XLSX.writeFile(wb, `plantilla_${tipo}.xlsx`)
  }

  const procesarArchivo = (file: File, tipo: TipoMaster) => {
    setResultado(null)
    const existentesMap = getExistentesMap(tipo)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (rows.length === 0) { toast.error('El archivo está vacío'); return }

        const cfg = MASTER_CONFIG[tipo]
        const preview: FilaMaster[] = rows.map((row, idx) => {
          const errores: string[] = []
          const campoNombre = tipo === 'aging' ? 'nombre_perfil' : 'nombre'
          const nombre = String((row as any)[campoNombre] || '').trim()
          if (!nombre) errores.push(`${campoNombre} requerido`)

          // Validaciones específicas por tipo
          if (tipo === 'motivos') {
            const tipoVal = String(row.tipo || 'ambos').trim().toLowerCase()
            if (!['ambos', 'ingreso', 'egreso', 'caja', ''].includes(tipoVal))
              errores.push(`tipo inválido: ${tipoVal} (use: ambos|ingreso|egreso|caja)`)
          }
          if (tipo === 'combos') {
            if (!row.sku_producto) errores.push('sku_producto requerido')
            const cant = parseInt(row.cantidad)
            if (!cant || cant < 2) errores.push('cantidad mínima: 2')
            const dtipo = String(row.descuento_tipo || '').toLowerCase()
            if (!['pct', 'monto_ars', 'monto_usd'].includes(dtipo)) errores.push('descuento_tipo inválido')
          }
          if (tipo === 'aging') {
            if (!row.estado) errores.push('estado requerido')
            const dias = parseInt(row.dias)
            if (isNaN(dias) || dias < 0) errores.push('dias debe ser ≥ 0')
          }

          const extra: Record<string, string> = {}
          cfg.extraCols.forEach(c => { extra[c] = String((row as any)[c] || '').trim() })

          // Para aging: dedup por nombre_perfil (puede haber múltiples filas del mismo perfil)
          const keyParaDedup = tipo === 'aging' ? nombre : nombre
          const estado = errores.length > 0 ? 'error'
            : (tipo !== 'aging' && existentesMap[nombre.toLowerCase()]) ? 'existente'
            : 'nuevo'

          return { idx, nombre, extra, estado, errores }
        })
        setFilas(preview)
      } catch {
        toast.error('Error al leer el archivo.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) procesarArchivo(file, tipoMaster)
  }

  const confirmarImportacion = async () => {
    setImportando(true)
    let creados = 0; let ignorados = 0; let errores = 0
    const nuevas = filas.filter(f => f.estado === 'nuevo')

    if (tipoMaster === 'combos') {
      // Combos: resolver SKU → producto_id
      const skuMap: Record<string, string> = {}
      ;(productos as any[]).forEach((p: any) => { skuMap[p.sku?.toLowerCase()] = p.id })

      for (const fila of nuevas) {
        try {
          const skuKey = fila.extra.sku_producto?.toLowerCase()
          const productoId = skuMap[skuKey]
          if (!productoId) { errores++; continue }
          const dtipo = fila.extra.descuento_tipo?.toLowerCase()
          const dval = parseFloat(fila.extra.descuento_valor) || 0
          await supabase.from('combos').insert({
            tenant_id: tenant!.id,
            nombre: fila.nombre,
            producto_id: productoId,
            cantidad: parseInt(fila.extra.cantidad) || 2,
            descuento_tipo: dtipo,
            descuento_pct: dtipo === 'pct' ? dval : 0,
            descuento_monto: dtipo !== 'pct' ? dval : 0,
          })
          creados++
        } catch { errores++ }
      }
      qc.invalidateQueries({ queryKey: ['combos'] })

    } else if (tipoMaster === 'aging') {
      // Aging: agrupar por nombre_perfil → crear profile + reglas
      const estadosMap: Record<string, string> = {}
      ;(estados as any[]).forEach((e: any) => { estadosMap[e.nombre.toLowerCase()] = e.id })
      const existentesMap = getExistentesMap('aging')

      // Agrupar filas por perfil
      const grupos: Record<string, FilaMaster[]> = {}
      for (const fila of filas.filter(f => f.estado !== 'error')) {
        if (!grupos[fila.nombre]) grupos[fila.nombre] = []
        grupos[fila.nombre].push(fila)
      }

      for (const [nombrePerfil, rows] of Object.entries(grupos)) {
        try {
          let profileId: string
          if (existentesMap[nombrePerfil.toLowerCase()]) {
            const existing = (agingProfiles as any[]).find((p: any) => p.nombre.toLowerCase() === nombrePerfil.toLowerCase())
            profileId = existing?.id
            ignorados++
          } else {
            const { data: newProfile, error } = await supabase.from('aging_profiles')
              .insert({ tenant_id: tenant!.id, nombre: nombrePerfil }).select('id').single()
            if (error || !newProfile) { errores++; continue }
            profileId = newProfile.id
            creados++
          }

          // Insertar reglas del perfil
          for (const row of rows) {
            const estadoNombre = row.extra.estado?.toLowerCase()
            const estadoId = estadosMap[estadoNombre]
            if (!estadoId) continue
            const dias = parseInt(row.extra.dias) || 0
            await supabase.from('aging_profile_reglas').insert({
              tenant_id: tenant!.id, profile_id: profileId, estado_id: estadoId, dias,
            }).then(() => {})
          }
        } catch { errores++ }
      }
      qc.invalidateQueries({ queryKey: ['aging_profiles'] })

    } else if (tipoMaster === 'grupos') {
      // Grupos de estados: crear grupo + asignar estados por nombre
      const estadosMap: Record<string, string> = {}
      ;(estados as any[]).forEach((e: any) => { estadosMap[e.nombre.toLowerCase()] = e.id })

      for (const fila of nuevas) {
        try {
          const esDefault = fila.extra.es_default?.toLowerCase() === 'si'
          if (esDefault) await supabase.from('grupos_estados').update({ es_default: false }).eq('tenant_id', tenant!.id)

          const { data: grupo, error: gErr } = await supabase.from('grupos_estados').insert({
            tenant_id: tenant!.id,
            nombre: fila.nombre,
            descripcion: fila.extra.descripcion || null,
            es_default: esDefault,
          }).select('id').single()
          if (gErr || !grupo) { errores++; continue }

          const nombresEstados = (fila.extra.estados || '').split('|').map((s: string) => s.trim()).filter(Boolean)
          for (const nomEst of nombresEstados) {
            const estadoId = estadosMap[nomEst.toLowerCase()]
            if (estadoId) {
              await supabase.from('grupo_estado_items').insert({ grupo_id: grupo.id, estado_id: estadoId })
            }
          }
          creados++
        } catch { errores++ }
      }
      qc.invalidateQueries({ queryKey: ['grupos_estados'] })

    } else {
      // Tipos simples: categorias, proveedores, ubicaciones, estados, motivos
      for (const fila of nuevas) {
        try {
          const payload: Record<string, any> = { tenant_id: tenant!.id, nombre: fila.nombre }

          if (tipoMaster === 'estados') {
            const hex = /^#[0-9a-f]{6}$/i.test(fila.extra.color || '') ? fila.extra.color : COLORES_DEFAULT[Math.floor(Math.random() * COLORES_DEFAULT.length)]
            payload.color = hex
          } else if (tipoMaster === 'motivos') {
            const tipoVal = ['ambos', 'ingreso', 'egreso', 'caja'].includes(fila.extra.tipo?.toLowerCase())
              ? fila.extra.tipo.toLowerCase() : 'ambos'
            payload.tipo = tipoVal
          } else {
            MASTER_CONFIG[tipoMaster].extraCols.forEach(c => { if (fila.extra[c]) payload[c] = fila.extra[c] })
          }

          const tabla = MASTER_CONFIG[tipoMaster].tabla!
          await supabase.from(tabla).insert(payload)
          creados++
        } catch { errores++ }
      }

      const qKey = tipoMaster === 'estados' ? 'estados_inventario' : tipoMaster === 'motivos' ? 'motivos' : tipoMaster
      qc.invalidateQueries({ queryKey: [qKey] })
    }

    ignorados = ignorados || filas.filter(f => f.estado === 'existente').length
    setResultado({ creados, ignorados, errores })
    setImportando(false)
    toast.success(`${MASTER_CONFIG[tipoMaster].label}: ${creados} creados`)
  }

  const nuevosMaster = filas.filter(f => f.estado === 'nuevo').length
  const existentesMaster = filas.filter(f => f.estado === 'existente').length

  const cambiarTipo = (tipo: TipoMaster) => {
    setTipoMaster(tipo)
    setFilas([])
    setResultado(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/configuracion')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Importar datos maestros</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Cargá configuración desde Excel</p>
        </div>
      </div>

      {resultado && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle size={20} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800 dark:text-green-400">Importación completada</p>
            <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">
              {resultado.creados} creado{resultado.creados !== 1 ? 's' : ''} · {resultado.ignorados} ignorado{resultado.ignorados !== 1 ? 's' : ''} (ya existían) · {resultado.errores} error{resultado.errores !== 1 ? 'es' : ''}
            </p>
            <button onClick={() => navigate('/configuracion')} className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium hover:underline">
              Volver a Configuración →
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          {/* Selector de tipo */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">¿Qué querés importar?</h2>
            <div className="space-y-1">
              {(Object.entries(MASTER_CONFIG) as [TipoMaster, typeof MASTER_CONFIG[TipoMaster]][]).map(([tipo, cfg]) => {
                const Icon = cfg.icon
                return (
                  <label key={tipo} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <input type="radio" name="tipoMaster" value={tipo} checked={tipoMaster === tipo}
                      onChange={() => cambiarTipo(tipo)} />
                    <Icon size={15} className="text-accent flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{cfg.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Hint */}
          {MASTER_CONFIG[tipoMaster].hint && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300">
              {MASTER_CONFIG[tipoMaster].hint}
            </div>
          )}

          {/* Plantilla */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-accent" /> Plantilla
            </h2>
            <button onClick={() => descargarPlantilla(tipoMaster)}
              className="w-full flex items-center justify-center gap-2 border border-accent text-accent font-medium py-2.5 rounded-xl hover:bg-accent/10 transition-all text-sm">
              <Download size={15} /> Descargar plantilla
            </button>
          </div>

          {/* Upload */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <Upload size={16} className="text-accent" /> Subir archivo
            </h2>
            <div
              className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f, tipoMaster) }}
            >
              <FileSpreadsheet size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Arrastrá o hacé click</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, .csv</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">Los duplicados (mismo nombre) se ignoran</p>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          {filas.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 text-center text-gray-400 dark:text-gray-500">
              <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Subí un archivo para ver la previsualización</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{nuevosMaster}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Nuevos</p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-gray-400 dark:text-gray-500">{existentesMaster}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Ya existen (se ignoran)</p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Estado</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">
                        {tipoMaster === 'aging' ? 'Perfil' : 'Nombre'}
                      </th>
                      {MASTER_CONFIG[tipoMaster].extraCols.map(c => (
                        <th key={c} className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400 capitalize">{c.replace('_', ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map(fila => (
                      <tr key={fila.idx} className={`border-b border-gray-50 ${fila.errores.length > 0 ? 'bg-red-50 dark:bg-red-900/20' : fila.estado === 'existente' ? 'bg-gray-50 dark:bg-gray-700' : ''}`}>
                        <td className="px-3 py-2">
                          {fila.errores.length > 0 ? (
                            <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> {fila.errores[0]}</span>
                          ) : fila.estado === 'existente' ? (
                            <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500"><RefreshCw size={12} /> Existe</span>
                          ) : (
                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle size={12} /> Nuevo</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{fila.nombre}</td>
                        {MASTER_CONFIG[tipoMaster].extraCols.map(c => (
                          <td key={c} className="px-3 py-2 text-gray-500 dark:text-gray-400">
                            {c === 'color' && fila.extra[c] ? (
                              <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: fila.extra[c] }} />
                                {fila.extra[c]}
                              </span>
                            ) : fila.extra[c] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t border-gray-100 bg-gray-50 dark:bg-gray-700">
                <button
                  onClick={confirmarImportacion}
                  disabled={importando || nuevosMaster === 0}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importando ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Importando...</>
                  ) : (
                    <><Upload size={16} /> Crear {nuevosMaster} {MASTER_CONFIG[tipoMaster].label.toLowerCase()}</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
