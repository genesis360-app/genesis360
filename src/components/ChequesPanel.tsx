import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, AlertTriangle, ArrowRightLeft, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import {
  TIPOS_CHEQUE, ESTADO_CHEQUE_LABEL, estadosSiguientes, puedeEndosar,
  chequeProximoACobrar, chequeVencido, validarChequeAlta, totalPendiente,
  reversionPagoOC, reversionPagoGasto,
  type TipoCheque, type EstadoCheque,
} from '@/lib/comprasCheques'
import { logActividad } from '@/lib/actividadLog'

const ESTADO_CLS: Record<string, string> = {
  en_cartera: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  entregado:  'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  depositado: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  cobrado:    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  endosado:   'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  rechazado:  'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  anulado:    'bg-gray-100 dark:bg-gray-800 text-gray-400 line-through',
}

interface FormCheque {
  tipo: TipoCheque
  nro_cheque: string
  banco: string
  monto: string
  fecha_emision: string
  fecha_cobro: string
  proveedor_id: string
  cliente_origen: string
  notas: string
}

const FORM_EMPTY: FormCheque = {
  tipo: 'propio', nro_cheque: '', banco: '', monto: '', fecha_emision: '',
  fecha_cobro: '', proveedor_id: '', cliente_origen: '', notas: '',
}

export default function ChequesPanel({ tenant, user, sucursalId }: { tenant: any; user: any; sucursalId: string | null }) {
  const qc = useQueryClient()
  const hoy = new Date().toISOString().split('T')[0]
  const alertaDias = (tenant as any)?.cheques_alerta_dias ?? 7

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormCheque>(FORM_EMPTY)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [endosoId, setEndosoId] = useState<string | null>(null)
  const [endosoProvId, setEndosoProvId] = useState('')

  const { data: cheques = [] } = useQuery({
    queryKey: ['cheques', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('cheques')
        .select('*, proveedores:proveedor_id(nombre)')
        .eq('tenant_id', tenant!.id)
        .order('fecha_cobro', { ascending: true, nullsFirst: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['cheques-proveedores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && (showForm || !!endosoId),
  })

  const filtrados = useMemo(() => (cheques as any[]).filter(c => {
    if (filtroEstado && c.estado !== filtroEstado) return false
    if (filtroTipo && c.tipo !== filtroTipo) return false
    return true
  }), [cheques, filtroEstado, filtroTipo])

  const proximos = useMemo(
    () => (cheques as any[]).filter(c => chequeProximoACobrar(c, alertaDias, hoy)).length,
    [cheques, alertaDias, hoy],
  )
  const pendiente = useMemo(() => totalPendiente(cheques as any[]), [cheques])

  const openNew = () => { setEditId(null); setForm(FORM_EMPTY); setShowForm(true) }
  const openEdit = (c: any) => {
    setEditId(c.id)
    setForm({
      tipo: c.tipo, nro_cheque: c.nro_cheque ?? '', banco: c.banco ?? '',
      monto: String(c.monto ?? ''), fecha_emision: c.fecha_emision ?? '',
      fecha_cobro: c.fecha_cobro ?? '', proveedor_id: c.proveedor_id ?? '',
      cliente_origen: c.cliente_origen ?? '', notas: c.notas ?? '',
    })
    setShowForm(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const monto = parseFloat(form.monto.replace(',', '.')) || 0
      const err = validarChequeAlta({ monto, fecha_cobro: form.fecha_cobro || null, tipo: form.tipo })
      if (err) throw new Error(err)
      const payload: any = {
        tipo: form.tipo,
        nro_cheque: form.nro_cheque.trim() || null,
        banco: form.banco.trim() || null,
        monto,
        fecha_emision: form.fecha_emision || null,
        fecha_cobro: form.fecha_cobro || null,
        proveedor_id: form.proveedor_id || null,
        cliente_origen: form.tipo === 'tercero' ? (form.cliente_origen.trim() || null) : null,
        notas: form.notas.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (editId) {
        const { error } = await supabase.from('cheques').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('cheques').insert({
          ...payload, tenant_id: tenant!.id, sucursal_id: sucursalId || null,
          estado: 'en_cartera', created_by: user!.id,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editId ? 'Cheque actualizado' : 'Cheque registrado')
      logActividad({ entidad: 'cheque', entidad_nombre: form.nro_cheque || 'cheque', accion: editId ? 'editar' : 'crear', pagina: '/gastos' })
      qc.invalidateQueries({ queryKey: ['cheques'] })
      setShowForm(false); setForm(FORM_EMPTY); setEditId(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const cambiarEstado = useMutation({
    mutationFn: async ({ id, estado, cheque }: { id: string; estado: EstadoCheque; cheque?: any }) => {
      // Auditoría #5 — cheque propio RECHAZADO revierte el pago que lo originó:
      // la OC/gasto vuelven a deber y, si hay proveedor, la deuda reaparece en su CC.
      let reversion: string | null = null
      if (estado === 'rechazado' && cheque?.tipo === 'propio') {
        const monto = Number(cheque.monto) || 0
        if (cheque.oc_id && monto > 0) {
          const { data: oc } = await supabase.from('ordenes_compra')
            .select('id, numero, monto_total, monto_pagado, monto_descuento, proveedor_id')
            .eq('id', cheque.oc_id).single()
          if (oc) {
            const rev = reversionPagoOC({
              total: Number(oc.monto_total) || 0,
              montoPagado: Number(oc.monto_pagado) || 0,
              montoDescuento: Number(oc.monto_descuento) || 0,
              montoCheque: monto,
            })
            const { error: eOc } = await supabase.from('ordenes_compra')
              .update({ monto_pagado: rev.montoPagado, estado_pago: rev.estadoPago }).eq('id', oc.id)
            if (eOc) throw eOc
            if (oc.proveedor_id) {
              await supabase.from('proveedor_cc_movimientos').insert({
                tenant_id: tenant!.id, proveedor_id: oc.proveedor_id, oc_id: oc.id,
                tipo: 'ajuste', monto: monto, fecha: hoy,
                descripcion: `Cheque rechazado${cheque.nro_cheque ? ` ${cheque.nro_cheque}` : ''} — pago OC #${oc.numero} revertido`,
                created_by: user?.id ?? null,
              })
            }
            reversion = `Pago de la OC #${oc.numero} revertido — la deuda volvió a quedar pendiente`
          }
        } else if (cheque.gasto_id && monto > 0) {
          const { data: g } = await supabase.from('gastos')
            .select('id, descripcion, monto_pagado').eq('id', cheque.gasto_id).single()
          if (g) {
            const rev = reversionPagoGasto({ montoPagado: Number(g.monto_pagado) || 0, montoCheque: monto })
            const { error: eG } = await supabase.from('gastos')
              .update({ monto_pagado: rev.montoPagado, estado_pago: rev.estadoPago }).eq('id', g.id)
            if (eG) throw eG
            reversion = `Pago del gasto "${g.descripcion}" revertido — volvió a pendiente`
          }
        }
      }
      const { error } = await supabase.from('cheques')
        .update({ estado, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return { reversion }
    },
    onSuccess: (d: any, v) => {
      toast.success(`Cheque → ${ESTADO_CHEQUE_LABEL[v.estado]}`)
      if (d?.reversion) {
        toast(d.reversion, { icon: '↩️', duration: 8000 })
        logActividad({ entidad: 'cheque', entidad_nombre: v.cheque?.nro_cheque || 'cheque', accion: 'rechazar', valor_nuevo: d.reversion, pagina: '/gastos' })
        qc.invalidateQueries({ queryKey: ['gastos'] })
        qc.invalidateQueries({ queryKey: ['ordenes-compra'] })
        qc.invalidateQueries({ queryKey: ['proveedor-cc'] })
      }
      qc.invalidateQueries({ queryKey: ['cheques'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const endosar = useMutation({
    mutationFn: async () => {
      if (!endosoProvId) throw new Error('Elegí el proveedor al que endosás el cheque')
      const { error } = await supabase.from('cheques').update({
        estado: 'endosado', proveedor_id: endosoProvId, endosado_a_proveedor_id: endosoProvId,
        updated_at: new Date().toISOString(),
      }).eq('id', endosoId!)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cheque endosado')
      qc.invalidateQueries({ queryKey: ['cheques'] })
      setEndosoId(null); setEndosoProvId('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cheques').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Cheque eliminado'); qc.invalidateQueries({ queryKey: ['cheques'] }) },
    onError: (e: any) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      {/* Resumen + acciones */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3 flex-wrap text-sm">
          <span className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Pendiente: <strong>${pendiente.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong>
          </span>
          {proximos > 0 && (
            <span className="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={14} /> {proximos} próximo{proximos > 1 ? 's' : ''} a cobrar (≤{alertaDias}d)
            </span>
          )}
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90">
          <Plus size={14} /> Registrar cheque
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
          <option value="">Todos los tipos</option>
          {TIPOS_CHEQUE.map(t => <option key={t.value} value={t.value}>{t.value === 'propio' ? 'Propios' : 'De terceros'}</option>)}
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_CHEQUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No hay cheques{filtroEstado || filtroTipo ? ' con esos filtros' : ''}.</div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((c: any) => {
            const vencido = chequeVencido(c, hoy)
            const proximo = chequeProximoACobrar(c, alertaDias, hoy)
            const siguientes = estadosSiguientes(c.tipo, c.estado)
            return (
              <div key={c.id}
                className={`bg-white dark:bg-gray-800 rounded-xl border px-4 py-3 ${vencido ? 'border-red-300 dark:border-red-700' : proximo ? 'border-amber-300 dark:border-amber-700' : 'border-gray-100 dark:border-gray-700'}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-primary dark:text-white">
                        ${Number(c.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.tipo === 'propio' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' : 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300'}`}>
                        {c.tipo === 'propio' ? 'Propio' : 'Tercero'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_CLS[c.estado] ?? ''}`}>
                        {ESTADO_CHEQUE_LABEL[c.estado as EstadoCheque] ?? c.estado}
                      </span>
                      {vencido && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium">Vencido</span>}
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                      {c.nro_cheque && <span>N° {c.nro_cheque}</span>}
                      {c.banco && <span>{c.banco}</span>}
                      {c.fecha_cobro && <span className={vencido ? 'text-red-500 font-medium' : proximo ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>Cobro: {new Date(c.fecha_cobro + 'T00:00:00').toLocaleDateString('es-AR')}</span>}
                      {c.proveedores?.nombre && <span>→ {c.proveedores.nombre}</span>}
                      {c.cliente_origen && <span>de {c.cliente_origen}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {siguientes.filter(s => s !== 'endosado').map(s => (
                      <button key={s} onClick={() => cambiarEstado.mutate({ id: c.id, estado: s, cheque: c })}
                        className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                        {ESTADO_CHEQUE_LABEL[s]}
                      </button>
                    ))}
                    {puedeEndosar(c) && (
                      <button onClick={() => { setEndosoId(c.id); setEndosoProvId('') }}
                        className="text-xs px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-700 text-purple-600 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center gap-1">
                        <ArrowRightLeft size={12} /> Endosar
                      </button>
                    )}
                    <button onClick={() => openEdit(c)} className="text-gray-400 hover:text-accent p-1" title="Editar"><Pencil size={13} /></button>
                    <button onClick={() => { if (confirm('¿Eliminar este cheque?')) eliminar.mutate(c.id) }} className="text-gray-400 hover:text-red-500 p-1" title="Eliminar"><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal alta/edición */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-primary dark:text-white">{editId ? 'Editar cheque' : 'Registrar cheque'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tipo</label>
                <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoCheque }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  {TIPOS_CHEQUE.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">N° de cheque</label>
                  <input value={form.nro_cheque} onChange={e => setForm(f => ({ ...f, nro_cheque: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Banco</label>
                  <input value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Monto *</label>
                <input type="number" min="0" step="0.01" onWheel={e => e.currentTarget.blur()}
                  value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fecha emisión</label>
                  <input type="date" value={form.fecha_emision} onChange={e => setForm(f => ({ ...f, fecha_emision: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fecha cobro *</label>
                  <input type="date" value={form.fecha_cobro} onChange={e => setForm(f => ({ ...f, fecha_cobro: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {form.tipo === 'propio' ? 'Proveedor (a quién se entrega)' : 'Proveedor (opcional)'}
                </label>
                <select value={form.proveedor_id} onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  <option value="">—</option>
                  {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              {form.tipo === 'tercero' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cliente de origen</label>
                  <input value={form.cliente_origen} onChange={e => setForm(f => ({ ...f, cliente_origen: e.target.value }))}
                    placeholder="De quién se recibió el cheque"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notas</label>
                <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancelar</button>
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent/90 disabled:opacity-50">
                {save.isPending ? 'Guardando…' : editId ? 'Guardar' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal endoso */}
      {endosoId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-primary dark:text-white">Endosar cheque</h3>
              <button onClick={() => setEndosoId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">Pagar a un proveedor con este cheque de tercero.</p>
              <select value={endosoProvId} onChange={e => setEndosoProvId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                <option value="">Elegí el proveedor…</option>
                {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={() => setEndosoId(null)} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancelar</button>
              <button onClick={() => endosar.mutate()} disabled={endosar.isPending || !endosoProvId}
                className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
                {endosar.isPending ? 'Endosando…' : 'Endosar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
