import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import { FolderOpen, Upload, FileText, Download, Trash2, Search } from 'lucide-react'

const TIPO_LABELS: Record<string, string> = {
  certificado_afip_crt: 'Cert. AFIP (.crt)',
  certificado_afip_key: 'Cert. AFIP (.key)',
  contrato: 'Contrato',
  factura_proveedor: 'Factura proveedor',
  manual: 'Manual',
  otro: 'Otro',
}

const TIPO_COLORS: Record<string, string> = {
  certificado_afip_crt: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  certificado_afip_key: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  contrato: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  factura_proveedor: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  manual: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  otro: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

export default function BibliotecaPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [form, setForm] = useState({ nombre: '', tipo: 'otro', descripcion: '' })
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: archivos = [], isLoading } = useQuery({
    queryKey: ['archivos_biblioteca', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('archivos_biblioteca')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  const upload = async () => {
    if (!file || !form.nombre.trim()) {
      toast.error('Completá el nombre y seleccioná un archivo')
      return
    }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${tenant!.id}/${Date.now()}.${ext}`
      const { error: storageErr } = await supabase.storage.from('archivos-biblioteca').upload(path, file)
      if (storageErr) throw storageErr
      const { error: dbErr } = await supabase.from('archivos_biblioteca').insert({
        tenant_id: tenant!.id,
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        descripcion: form.descripcion.trim() || null,
        storage_path: path,
        tamanio: file.size,
        mime_type: file.type || null,
        created_by: user?.id,
      })
      if (dbErr) {
        await supabase.storage.from('archivos-biblioteca').remove([path])
        throw dbErr
      }
      toast.success('Archivo subido')
      setForm({ nombre: '', tipo: 'otro', descripcion: '' })
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      qc.invalidateQueries({ queryKey: ['archivos_biblioteca'] })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al subir archivo')
    } finally {
      setUploading(false)
    }
  }

  const descargar = async (path: string, nombre: string) => {
    const { data, error } = await supabase.storage.from('archivos-biblioteca').createSignedUrl(path, 300)
    if (error || !data?.signedUrl) { toast.error('No se pudo generar el enlace'); return }
    const a = document.createElement('a')
    a.href = data.signedUrl; a.download = nombre; a.target = '_blank'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const eliminar = async (id: string, path: string) => {
    if (!confirm('¿Eliminar este archivo?')) return
    await supabase.storage.from('archivos-biblioteca').remove([path])
    const { error } = await supabase.from('archivos_biblioteca').delete().eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('Eliminado'); qc.invalidateQueries({ queryKey: ['archivos_biblioteca'] }) }
  }

  const filtered = (archivos as any[]).filter(a => {
    if (filtroTipo && a.tipo !== filtroTipo) return false
    if (search) {
      const s = search.toLowerCase()
      return a.nombre.toLowerCase().includes(s) || a.descripcion?.toLowerCase().includes(s)
    }
    return true
  })

  const formatSize = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(0)} KB`

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-accent" />
        <h1 className="text-xl font-bold text-primary">Biblioteca de Archivos</h1>
        <span className="ml-2 text-xs text-muted">
          {(archivos as any[]).length} archivo{(archivos as any[]).length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-sm text-muted -mt-4">
        Almacená certificados AFIP, contratos, facturas de proveedor y cualquier documento del negocio.
      </p>

      {/* Upload form */}
      <div className="bg-surface rounded-xl shadow-sm border border-border-ds p-5 space-y-4">
        <h2 className="text-sm font-semibold text-primary">Subir nuevo archivo</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Nombre *</label>
            <input
              className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
              value={form.nombre}
              onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
              placeholder="Ej: Certificado AFIP 2025"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Tipo</label>
            <select
              className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
              value={form.tipo}
              onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}
            >
              {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-muted mb-1">Descripción (opcional)</label>
            <input
              className="w-full px-3 py-2 border border-border-ds rounded-lg bg-page text-primary text-sm"
              value={form.descripcion}
              onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
              placeholder="Ej: Certificado para facturación electrónica"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-border-ds rounded-lg cursor-pointer hover:bg-page transition-colors text-sm text-muted">
            <Upload className="w-4 h-4 shrink-0" />
            <span className="truncate">{file ? file.name : 'Seleccionar archivo (máx. 10 MB)'}</span>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            onClick={upload}
            disabled={!file || !form.nombre.trim() || uploading}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-40 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Subiendo…' : 'Subir'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            className="pl-9 pr-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
            placeholder="Buscar archivo…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 border border-border-ds rounded-lg bg-surface text-sm text-primary"
          value={filtroTipo}
          onChange={e => setFiltroTipo(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>{search || filtroTipo ? 'Sin resultados' : 'No hay archivos aún'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center gap-3 px-4 py-3 bg-surface rounded-xl border border-border-ds hover:bg-page transition-colors"
            >
              <FileText className="w-5 h-5 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-primary truncate">{a.nombre}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[a.tipo] ?? TIPO_COLORS.otro}`}>
                    {TIPO_LABELS[a.tipo] ?? a.tipo}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted">
                  {a.descripcion && <span className="truncate">{a.descripcion}</span>}
                  {a.tamanio && <span className="shrink-0">{formatSize(a.tamanio)}</span>}
                  <span className="shrink-0">
                    {new Date(a.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </span>
                </div>
              </div>
              <button
                onClick={() => descargar(a.storage_path, a.nombre)}
                title="Descargar / Ver"
                className="p-1.5 text-muted hover:text-accent rounded transition-colors shrink-0"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => eliminar(a.id, a.storage_path)}
                title="Eliminar"
                className="p-1.5 text-muted hover:text-red-500 rounded transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
