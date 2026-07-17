// Multi-CUIT (F5, Fase 3) — gestión de EMISORES FISCALES adicionales del tenant.
//
// El emisor PRINCIPAL se sigue editando en la sección "Facturación Electrónica (ARCA)" de
// arriba (escribe en tenants.* y el trigger de mig 267 lo espeja en emisores_fiscales).
// Este panel gestiona los emisores ADICIONALES (CRUD directo sobre emisores_fiscales),
// su certificado y sus puntos de venta (ambos POR emisor, mig 268), y la asignación
// sucursal → emisor (regla de resolución: override ?? sucursal ?? principal).
//
// ⚠ Hasta la Fase 4, el modal de emisión del POS ofrece los tipos de comprobante del
// emisor PRINCIPAL. Si la sucursal está asignada a otro emisor, la EF usa ESE emisor y
// sus guards validan server-side (una letra inválida para su condición da error claro).
// Diseño completo: G360.Wiki/wiki/features/multi-cuit.md
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2, Plus, ChevronDown, ChevronRight, Trash2, Pencil, ShieldCheck,
  Star, Hash, AlertTriangle, Wand2, Copy, Download, ExternalLink,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { uploadCertificates, generarCsrEmisor, finalizarCertificadoDesdeCsr } from '@/lib/afip'
import { pasoWizardCert } from '@/lib/csrCert'
import { Toggle } from '@/components/Toggle'
import toast from 'react-hot-toast'

interface Emisor {
  id: string
  nombre: string
  cuit: string
  razon_social_fiscal: string | null
  condicion_iva_emisor: string | null
  domicilio_fiscal: string | null
  ingresos_brutos: string | null
  inicio_actividades: string | null
  umbral_factura_b: number | string | null
  afip_produccion: boolean
  afip_provider: string
  afipsdk_token: string | null
  banco: string | null
  cbu: string | null
  alias_cbu: string | null
  leyenda_comprobante: string | null
  es_default: boolean
  activo: boolean
  csr_key_path: string | null
}

const FORM_VACIO = {
  nombre: '', cuit: '', razon_social_fiscal: '', condicion_iva_emisor: '',
  domicilio_fiscal: '', ingresos_brutos: '', inicio_actividades: '', umbral_factura_b: '',
  afip_provider: 'propio', afipsdk_token: '', banco: '', cbu: '', alias_cbu: '',
  leyenda_comprobante: '',
}

const inputCls = 'w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100'

export function EmisoresFiscalesPanel() {
  const { tenant, setTenant } = useAuthStore()
  const [collapsed, setCollapsed] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(FORM_VACIO)
  const [saving, setSaving] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  // Cert upload por emisor (modo manual: .crt + .key)
  const [certCrt, setCertCrt] = useState<File | null>(null)
  const [certKey, setCertKey] = useState<File | null>(null)
  const [subiendoCert, setSubiendoCert] = useState(false)
  // Wizard de CSR (self-service): generamos key+CSR, el cliente sube solo el .crt
  const [modoCert, setModoCert] = useState<'wizard' | 'manual'>('wizard')
  const [csrGenerado, setCsrGenerado] = useState<string | null>(null)
  const [generandoCsr, setGenerandoCsr] = useState(false)
  const [crtSolo, setCrtSolo] = useState<File | null>(null)
  // PV por emisor
  const [pvNuevo, setPvNuevo] = useState('')

  const { data: emisores = [], refetch } = useQuery({
    queryKey: ['emisores-fiscales-panel', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('emisores_fiscales')
        .select('*').eq('tenant_id', tenant!.id)
        .order('es_default', { ascending: false }).order('created_at')
      return (data ?? []) as Emisor[]
    },
    enabled: !!tenant,
  })

  const { data: certs = [], refetch: refetchCerts } = useQuery({
    queryKey: ['emisores-certs', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tenant_certificates')
        .select('id, emisor_id, activo, fecha_validez_hasta').eq('tenant_id', tenant!.id)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: pvs = [], refetch: refetchPvs } = useQuery({
    queryKey: ['emisores-pvs', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('puntos_venta_afip')
        .select('id, numero, nombre, emisor_id').eq('tenant_id', tenant!.id).order('numero')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: sucursales = [], refetch: refetchSuc } = useQuery({
    queryKey: ['emisores-sucursales', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('sucursales')
        .select('id, nombre, emisor_fiscal_id').eq('tenant_id', tenant!.id)
        .eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const adicionales = emisores.filter(e => !e.es_default)
  const principal = emisores.find(e => e.es_default) ?? null

  const abrirNuevo = () => { setEditId(null); setForm(FORM_VACIO); setShowForm(true) }
  const abrirEditar = (e: Emisor) => {
    setEditId(e.id)
    setForm({
      nombre: e.nombre ?? '', cuit: e.cuit ?? '',
      razon_social_fiscal: e.razon_social_fiscal ?? '',
      condicion_iva_emisor: e.condicion_iva_emisor ?? '',
      domicilio_fiscal: e.domicilio_fiscal ?? '',
      ingresos_brutos: e.ingresos_brutos ?? '',
      inicio_actividades: e.inicio_actividades ?? '',
      umbral_factura_b: e.umbral_factura_b != null ? String(e.umbral_factura_b) : '',
      afip_provider: e.afip_provider ?? 'propio',
      afipsdk_token: e.afipsdk_token ?? '',
      banco: e.banco ?? '', cbu: e.cbu ?? '', alias_cbu: e.alias_cbu ?? '',
      leyenda_comprobante: e.leyenda_comprobante ?? '',
    })
    setShowForm(true)
  }

  const guardar = async () => {
    if (!form.nombre.trim() || !form.cuit.trim()) { toast.error('Nombre y CUIT son obligatorios'); return }
    if (!form.condicion_iva_emisor) { toast.error('Elegí la condición frente al IVA del emisor'); return }
    setSaving(true)
    try {
      const row = {
        nombre: form.nombre.trim(), cuit: form.cuit.trim(),
        razon_social_fiscal: form.razon_social_fiscal.trim() || null,
        condicion_iva_emisor: form.condicion_iva_emisor,
        domicilio_fiscal: form.domicilio_fiscal.trim() || null,
        ingresos_brutos: form.ingresos_brutos.trim() || null,
        inicio_actividades: form.inicio_actividades || null,
        umbral_factura_b: form.umbral_factura_b ? parseFloat(form.umbral_factura_b) : null,
        afip_provider: form.afip_provider,
        afipsdk_token: form.afipsdk_token.trim() || null,
        banco: form.banco.trim() || null, cbu: form.cbu.trim() || null,
        alias_cbu: form.alias_cbu.trim() || null,
        leyenda_comprobante: form.leyenda_comprobante.trim() || null,
        updated_at: new Date().toISOString(),
      }
      const { error } = editId
        ? await supabase.from('emisores_fiscales').update(row).eq('id', editId)
        : await supabase.from('emisores_fiscales').insert({
            ...row, tenant_id: tenant!.id, es_default: false, activo: true,
            // Los emisores adicionales SIEMPRE nacen en homologación; producción se
            // habilita por SQL/soporte con el onboarding AFIP completo (como el piloto).
            afip_produccion: false,
          })
      if (error) throw error
      toast.success(editId ? 'Emisor actualizado' : 'Emisor creado (en modo homologación)')
      setShowForm(false); refetch()
      // Si se editó el PRINCIPAL: el espejo DB (mig 271) ya actualizó tenants.* → refrescar el
      // store para que el form de la sección "Facturación (ARCA)" se re-sincronice y no quede
      // stale (evita que un "Guardar" posterior desde allá pise con valores viejos).
      if (editId && principal && editId === principal.id) {
        const { data: t } = await supabase.from('tenants').select('*').eq('id', tenant!.id).single()
        if (t) setTenant(t)
      }
    } catch (e) {
      // ⚠ Los errores de Supabase (PostgrestError) NO son instancia de Error → hay que leer
      // `.message` directo, si no se pierde el motivo real (ej. el RAISE del trigger de cupo).
      const msg = (e as { message?: string })?.message || 'Error al guardar el emisor'
      // El enforcement server-side (mig 269) tira este mensaje si no hay cupo de CUITs.
      if (/Límite de CUITs/i.test(msg)) {
        toast.error(`${msg} Configuralo en Suscripción → Add-ons.`, { duration: 9000 })
      } else {
        toast.error(msg)
      }
    } finally { setSaving(false) }
  }

  const toggleActivo = async (e: Emisor) => {
    if (e.es_default) { toast.error('El emisor principal no se puede desactivar'); return }
    const { error } = await supabase.from('emisores_fiscales')
      .update({ activo: !e.activo, updated_at: new Date().toISOString() }).eq('id', e.id)
    if (error) toast.error(error.message)
    else refetch()
  }

  const eliminar = async (e: Emisor) => {
    if (e.es_default) { toast.error('El emisor principal no se puede eliminar'); return }
    // 🛑 REGLA #0: un emisor con comprobantes emitidos no se borra (trazabilidad fiscal).
    const { count } = await supabase.from('ventas')
      .select('id', { count: 'exact', head: true }).eq('emisor_id', e.id)
    if ((count ?? 0) > 0) {
      toast.error(`Este emisor tiene ${count} comprobante(s) emitido(s) — desactivalo en vez de eliminarlo.`)
      return
    }
    if (!confirm(`¿Eliminar el emisor "${e.nombre}" (${e.cuit})? También se quitan su certificado y puntos de venta.`)) return
    await supabase.from('puntos_venta_afip').delete().eq('emisor_id', e.id)
    await supabase.from('tenant_certificates').delete().eq('emisor_id', e.id)
    const { error } = await supabase.from('emisores_fiscales').delete().eq('id', e.id)
    if (error) toast.error(error.message)
    else { toast.success('Emisor eliminado'); refetch(); refetchCerts(); refetchPvs() }
  }

  const subirCert = async (e: Emisor) => {
    if (!certCrt || !certKey) { toast.error('Seleccioná los dos archivos (.crt y .key)'); return }
    setSubiendoCert(true)
    try {
      await uploadCertificates(tenant!.id, certCrt, certKey, e.cuit, null, e.id)
      toast.success(`Certificado de ${e.nombre} guardado`)
      setCertCrt(null); setCertKey(null); refetchCerts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al subir el certificado')
    } finally { setSubiendoCert(false) }
  }

  // Wizard: genera la clave privada + el CSR server-side (la .key nunca llega al browser).
  const generarCsr = async (e: Emisor) => {
    setGenerandoCsr(true)
    try {
      const csr = await generarCsrEmisor(tenant!.id, e.id, e.cuit, e.razon_social_fiscal ?? e.nombre)
      setCsrGenerado(csr)
      toast.success('CSR generado. Pegalo en ARCA y subí después el .crt que te den.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error generando el CSR')
    } finally { setGenerandoCsr(false) }
  }

  const copiarCsr = () => {
    if (!csrGenerado) return
    navigator.clipboard.writeText(csrGenerado).then(
      () => toast.success('CSR copiado al portapapeles'),
      () => toast.error('No se pudo copiar — seleccionalo y copialo a mano'),
    )
  }

  const descargarCsr = (e: Emisor) => {
    if (!csrGenerado) return
    const blob = new Blob([csrGenerado], { type: 'application/x-pem-file' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${e.cuit.replace(/\D/g, '')}.csr`
    a.click()
  }

  // Sube SOLO el .crt (el que baja de ARCA) y lo aparea con la .key ya generada.
  const finalizarCert = async (e: Emisor) => {
    if (!crtSolo) { toast.error('Seleccioná el archivo .crt que descargaste de ARCA'); return }
    setSubiendoCert(true)
    try {
      await finalizarCertificadoDesdeCsr(tenant!.id, e.id, crtSolo)
      toast.success(`Certificado de ${e.nombre} activado`)
      setCrtSolo(null); setCsrGenerado(null); refetchCerts(); refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al finalizar el certificado')
    } finally { setSubiendoCert(false) }
  }

  const agregarPv = async (e: Emisor) => {
    const numero = parseInt(pvNuevo)
    if (!numero || numero < 1) { toast.error('Número de punto de venta inválido'); return }
    const { error } = await supabase.from('puntos_venta_afip').insert({
      tenant_id: tenant!.id, numero, emisor_id: e.id,
    })
    if (error) toast.error(error.message)
    else { toast.success('Punto de venta agregado'); setPvNuevo(''); refetchPvs() }
  }

  const asignarSucursal = async (sucursalId: string, emisorId: string | null) => {
    const { error } = await supabase.from('sucursales')
      .update({ emisor_fiscal_id: emisorId }).eq('id', sucursalId)
    if (error) toast.error(error.message)
    else { toast.success('Sucursal reasignada'); refetchSuc() }
  }

  const certDe = (emisorId: string) => (certs as { emisor_id: string | null; activo: boolean }[]).find(c => c.emisor_id === emisorId && c.activo)
  // El emisor PRINCIPAL también matchea el cert legacy sin emisor (filas pre mig 267).
  const certActivoDe = (e: Emisor) =>
    certDe(e.id) ?? (e.es_default ? (certs as { emisor_id: string | null; activo: boolean }[]).find(c => !c.emisor_id && c.activo) : undefined)
  const pvsDe = (emisorId: string) => (pvs as { id: string; numero: number; nombre: string | null; emisor_id: string | null }[]).filter(p => p.emisor_id === emisorId)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
      <button className="w-full flex items-center gap-3 px-5 py-4 text-left" onClick={() => setCollapsed(v => !v)}>
        <Building2 size={18} className="text-accent" />
        <span className="font-semibold text-gray-700 dark:text-gray-300 flex-1">Emisores fiscales (multi-CUIT)</span>
        <span className="text-xs text-gray-400">{emisores.length} emisor{emisores.length !== 1 ? 'es' : ''}</span>
        {collapsed ? <ChevronRight size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Un negocio puede facturar con más de una razón social (CUIT). Acá se gestionan <strong>todos</strong> los
            emisores — el principal (⭐) y los adicionales — cada uno con su certificado y sus puntos de venta.
            La venta usa el emisor de su sucursal (o el principal). Los datos del principal también pueden
            editarse arriba en "Facturación Electrónica": desde el cutover a fuente única (mig 271) ambos
            formularios escriben el MISMO registro, así que no pueden divergir.
          </p>

          {/* Lista de emisores */}
          {emisores.map(e => (
            <div key={e.id} className={`rounded-xl border p-3 ${e.activo ? 'border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700 opacity-60'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {e.es_default && <Star size={14} className="text-amber-500 shrink-0" />}
                <span className="font-medium text-sm text-gray-800 dark:text-gray-100">{e.nombre}</span>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{e.cuit}</span>
                <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{e.condicion_iva_emisor ?? 'sin condición'}</span>
                {e.es_default
                  ? <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">Principal</span>
                  : !e.activo && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">Inactivo</span>}
                {/* Estado del certificado — para TODOS los emisores, incluido el principal */}
                {certActivoDe(e)
                  ? <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><ShieldCheck size={12} /> cert</span>
                  : <span className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} /> sin cert</span>}
                <div className="ml-auto flex items-center gap-2">
                  {/* El asistente de certificado está disponible también para el principal (1er certificado) */}
                  <button onClick={() => { setExpandido(expandido === e.id ? null : e.id); setModoCert('wizard'); setCsrGenerado(null); setCrtSolo(null); setCertCrt(null); setCertKey(null) }}
                    className="text-xs text-accent hover:underline">{expandido === e.id ? 'Cerrar' : (e.es_default ? 'Certificado' : 'Cert / PV')}</button>
                  {/* Editar: TODOS los emisores, incluido el principal (F3a, cutover mig 271 —
                      con fuente única ambos formularios escriben el mismo registro). Desactivar
                      y eliminar siguen solo para adicionales (los guards de DB además lo
                      rechazan con P0001 si alguien lo intenta por API). */}
                  <button onClick={() => abrirEditar(e)}
                    title={e.es_default ? 'Editar la identidad fiscal del emisor principal' : 'Editar'}
                    className="text-gray-400 hover:text-accent"><Pencil size={14} /></button>
                  {!e.es_default && (<>
                    <Toggle
                      checked={e.activo}
                      onChange={() => toggleActivo(e)}
                      size="sm"
                      aria-label={`${e.activo ? 'Desactivar' : 'Activar'} el emisor ${e.nombre}`}
                      title={e.activo ? 'Desactivar' : 'Activar'}
                    />
                    <button onClick={() => eliminar(e)} title="Eliminar" className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </>)}
                </div>
              </div>

              {/* Detalle: certificado (TODOS, incluido el principal) + PV (solo adicionales) */}
              {expandido === e.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">
                  {e.es_default && (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      Los datos fiscales y los puntos de venta del emisor principal se editan arriba, en "Facturación Electrónica". Acá cargás su <strong>certificado</strong>.
                    </p>
                  )}
                  {/* Certificado — wizard (generamos key+CSR) o carga manual (.crt+.key) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                        <ShieldCheck size={13} className={certActivoDe(e) ? 'text-green-500' : 'text-gray-400'} />
                        Certificado AFIP {certActivoDe(e) ? '(activo — volver a cargar reemplaza)' : '(requerido para emitir)'}
                      </p>
                      <div className="flex gap-1 text-[11px]">
                        <button onClick={() => setModoCert('wizard')} className={`px-2 py-0.5 rounded ${modoCert === 'wizard' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>Asistente</button>
                        <button onClick={() => setModoCert('manual')} className={`px-2 py-0.5 rounded ${modoCert === 'manual' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>Ya tengo .crt + .key</button>
                      </div>
                    </div>

                    {modoCert === 'wizard' ? (() => {
                      const paso = pasoWizardCert({
                        tieneCertActivo: !!certActivoDe(e),
                        csrKeyPath: e.csr_key_path,
                        csrGeneradoEnSesion: !!csrGenerado,
                      })
                      // Sub-bloque reutilizado en 'subir-crt' y 'pendiente-crt': subir SOLO el .crt.
                      const subirCrtBox = (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 cursor-pointer text-gray-600 dark:text-gray-300">
                            {crtSolo ? crtSolo.name : 'Archivo .crt de ARCA'}
                            <input type="file" accept=".crt,.pem" className="hidden" onChange={ev => setCrtSolo(ev.target.files?.[0] ?? null)} />
                          </label>
                          <button onClick={() => finalizarCert(e)} disabled={subiendoCert || !crtSolo}
                            className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-50">
                            {subiendoCert ? 'Activando…' : 'Activar certificado'}
                          </button>
                        </div>
                      )
                      return (
                        <div className="space-y-2">
                          {paso === 'generar' && (
                            <>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                Generamos la clave y el pedido (CSR) por vos. Solo vas a ARCA, subís el CSR y volvés con el certificado (.crt).
                              </p>
                              <button onClick={() => generarCsr(e)} disabled={generandoCsr}
                                className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                                <Wand2 size={13} /> {generandoCsr ? 'Generando…' : '1 · Generar CSR automáticamente'}
                              </button>
                            </>
                          )}

                          {paso === 'pendiente-crt' && (
                            <>
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                Ya generaste un CSR para este emisor. Si ya tenés el <strong>.crt</strong> de ARCA, subilo acá para activar el certificado. Si perdiste el CSR, generá uno nuevo (el .crt debe corresponder al <strong>último</strong> CSR).
                              </p>
                              {subirCrtBox}
                              <button onClick={() => generarCsr(e)} disabled={generandoCsr}
                                className="text-[11px] text-accent hover:underline flex items-center gap-1">
                                <Wand2 size={11} /> {generandoCsr ? 'Generando…' : 'Generar un CSR nuevo'}
                              </button>
                            </>
                          )}

                          {paso === 'subir-crt' && csrGenerado && (
                            <>
                              <p className="text-[11px] text-gray-600 dark:text-gray-300 font-medium">2 · Copiá este CSR y pegalo/subilo en ARCA:</p>
                              <textarea readOnly value={csrGenerado} rows={4}
                                className="w-full text-[10px] font-mono border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300" />
                              <div className="flex flex-wrap gap-2">
                                <button onClick={copiarCsr} className="text-[11px] px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center gap-1 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"><Copy size={11} /> Copiar</button>
                                <button onClick={() => descargarCsr(e)} className="text-[11px] px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center gap-1 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"><Download size={11} /> Descargar .csr</button>
                                <a href="https://www.afip.gob.ar/ws/documentacion/certificados.asp" target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center gap-1 text-accent hover:bg-accent/5"><ExternalLink size={11} /> Ir a ARCA</a>
                              </div>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                En ARCA → <strong>Administración de Certificados Digitales</strong>: creá un certificado con este CSR, descargá el <strong>.crt</strong> y asocialo al servicio <strong>Facturación Electrónica (wsfe)</strong> en el Administrador de Relaciones.
                              </p>
                              <p className="text-[11px] text-gray-600 dark:text-gray-300 font-medium">3 · Subí el .crt que descargaste:</p>
                              {subirCrtBox}
                            </>
                          )}

                          {paso === 'activo' && (
                            <>
                              <p className="text-[11px] text-green-600 dark:text-green-400">
                                Certificado activo. Para reemplazarlo (renovación o vencimiento), generá un CSR nuevo y volvé a subir el .crt.
                              </p>
                              <button onClick={() => generarCsr(e)} disabled={generandoCsr}
                                className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                                <Wand2 size={13} /> {generandoCsr ? 'Generando…' : 'Generar CSR nuevo (reemplazar)'}
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })() : (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 cursor-pointer text-gray-600 dark:text-gray-300">
                          {certCrt ? certCrt.name : 'Archivo .crt'}
                          <input type="file" accept=".crt" className="hidden" onChange={ev => setCertCrt(ev.target.files?.[0] ?? null)} />
                        </label>
                        <label className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 cursor-pointer text-gray-600 dark:text-gray-300">
                          {certKey ? certKey.name : 'Clave .key'}
                          <input type="file" accept=".key" className="hidden" onChange={ev => setCertKey(ev.target.files?.[0] ?? null)} />
                        </label>
                        <button onClick={() => subirCert(e)} disabled={subiendoCert || !certCrt || !certKey}
                          className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-50">
                          {subiendoCert ? 'Subiendo…' : 'Guardar certificado'}
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Puntos de venta — solo emisores adicionales (los del principal se editan arriba) */}
                  {!e.es_default && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                      <Hash size={13} className="text-accent" /> Puntos de venta de este CUIT
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {pvsDe(e.id).map(pv => (
                        <span key={pv.id} className="text-xs bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1 font-mono flex items-center gap-1.5">
                          {String(pv.numero).padStart(4, '0')}
                          <button onClick={async () => {
                            await supabase.from('puntos_venta_afip').delete().eq('id', pv.id)
                            refetchPvs()
                          }} className="text-gray-400 hover:text-red-500"><Trash2 size={11} /></button>
                        </span>
                      ))}
                      <input type="number" onWheel={ev => ev.currentTarget.blur()} value={pvNuevo}
                        onChange={ev => setPvNuevo(ev.target.value)} min="1" max="9998" placeholder="N°"
                        className="w-16 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      <button onClick={() => agregarPv(e)} disabled={!pvNuevo}
                        className="text-xs px-2 py-1 bg-accent text-white rounded-lg disabled:opacity-50 flex items-center gap-1">
                        <Plus size={11} /> Agregar
                      </button>
                    </div>
                    {pvsDe(e.id).length === 0 && (
                      <p className="text-[11px] text-gray-400 mt-1">Sin PV configurados: al emitir se usa el N° que mande la app (habilitalo antes en ARCA).</p>
                    )}
                  </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <button onClick={abrirNuevo}
            className="flex items-center gap-1.5 px-3 py-2 border border-accent text-accent rounded-xl text-sm hover:bg-accent/10 transition-all">
            <Plus size={14} /> Agregar emisor (otro CUIT)
          </button>

          {/* Asignación sucursal → emisor */}
          {adicionales.length > 0 && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">¿Con qué CUIT factura cada sucursal?</p>
              <div className="space-y-2">
                {(sucursales as { id: string; nombre: string; emisor_fiscal_id: string | null }[]).map(s => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{s.nombre}</span>
                    <select value={s.emisor_fiscal_id ?? ''} onChange={ev => asignarSucursal(s.id, ev.target.value || null)}
                      className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      <option value="">{principal ? `${principal.nombre} (principal)` : 'Emisor principal'}</option>
                      {adicionales.filter(e => e.activo).map(e => (
                        <option key={e.id} value={e.id}>{e.nombre} — {e.cuit}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                Las ventas de una sucursal asignada a otro emisor se facturan con ESE CUIT. El selector de tipo de
                comprobante del POS todavía muestra los del emisor principal; si elegís una letra inválida para el
                emisor de la sucursal, la emisión se rechaza con un error claro (no se emite mal).
              </p>
            </div>
          )}

          {/* Form crear/editar */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
                  {editId ? 'Editar emisor fiscal' : 'Nuevo emisor fiscal (otro CUIT)'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Nombre interno *</label>
                    <input type="text" value={form.nombre} onChange={ev => setForm(f => ({ ...f, nombre: ev.target.value }))} placeholder='Ej: "Otranto SA"' className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CUIT *</label>
                    <input type="text" value={form.cuit} onChange={ev => setForm(f => ({ ...f, cuit: ev.target.value }))} placeholder="30-12345678-9" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Condición IVA *</label>
                    <select value={form.condicion_iva_emisor} onChange={ev => setForm(f => ({ ...f, condicion_iva_emisor: ev.target.value }))} className={inputCls}>
                      <option value="">Seleccionar…</option>
                      <option value="RI">Responsable Inscripto (RI)</option>
                      <option value="Monotributista">Monotributista</option>
                      <option value="Exento">Exento</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Razón social fiscal</label>
                    <input type="text" value={form.razon_social_fiscal} onChange={ev => setForm(f => ({ ...f, razon_social_fiscal: ev.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Domicilio fiscal</label>
                    <input type="text" value={form.domicilio_fiscal} onChange={ev => setForm(f => ({ ...f, domicilio_fiscal: ev.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Ingresos Brutos</label>
                    <input type="text" value={form.ingresos_brutos} onChange={ev => setForm(f => ({ ...f, ingresos_brutos: ev.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Inicio de actividades</label>
                    <input type="date" value={form.inicio_actividades} onChange={ev => setForm(f => ({ ...f, inicio_actividades: ev.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Umbral Factura B ($)</label>
                    <input type="number" onWheel={ev => ev.currentTarget.blur()} value={form.umbral_factura_b} onChange={ev => setForm(f => ({ ...f, umbral_factura_b: ev.target.value }))} placeholder="68305.16" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Circuito AFIP</label>
                    <select value={form.afip_provider} onChange={ev => setForm(f => ({ ...f, afip_provider: ev.target.value }))} className={inputCls}>
                      <option value="propio">Propio (certificado, recomendado)</option>
                      <option value="afipsdk">AfipSDK (requiere token)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Token AfipSDK (solo circuito AfipSDK)</label>
                    <input type="password" value={form.afipsdk_token} onChange={ev => setForm(f => ({ ...f, afipsdk_token: ev.target.value }))} autoComplete="new-password" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Banco</label>
                    <input type="text" value={form.banco} onChange={ev => setForm(f => ({ ...f, banco: ev.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CBU</label>
                    <input type="text" value={form.cbu} onChange={ev => setForm(f => ({ ...f, cbu: ev.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Alias CBU</label>
                    <input type="text" value={form.alias_cbu} onChange={ev => setForm(f => ({ ...f, alias_cbu: ev.target.value }))} className={inputCls} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Leyenda del comprobante</label>
                    <textarea value={form.leyenda_comprobante} onChange={ev => setForm(f => ({ ...f, leyenda_comprobante: ev.target.value }))} rows={2} className={inputCls} />
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-3">
                  Los emisores nuevos operan en <strong>homologación</strong> (CAE de prueba). El pase a producción
                  se habilita cuando el CUIT complete el onboarding AFIP (certificado de producción autorizado).
                </p>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl">Cancelar</button>
                  <button onClick={guardar} disabled={saving}
                    className="px-4 py-2 text-sm font-semibold text-white bg-accent hover:bg-accent/90 rounded-xl disabled:opacity-50">
                    {saving ? 'Guardando…' : (editId ? 'Guardar cambios' : 'Crear emisor')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
