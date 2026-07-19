import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2, Loader2, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface Props {
  envioId: string
  /** URL principal del envío (envios.pod_url). Cuando cambia la primera foto se actualiza el envío. */
  onPrincipalChange?: (url: string | null) => void
  /** En modo read-only no muestra controles de upload/eliminar */
  readOnly?: boolean
  /** Notifica la cantidad de fotos cargadas (EN2/D2 — validación de mínimo). */
  onCountChange?: (n: number) => void
}

interface PodFoto {
  id: string
  envio_id: string
  url: string
  storage_path: string | null
  orden: number
  created_at: string
}

export default function PodFotosManager({ envioId, onPrincipalChange, readOnly = false, onCountChange }: Props) {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: fotos = [], isLoading } = useQuery({
    queryKey: ['envio-pod-fotos', envioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('envio_pod_fotos')
        .select('*')
        .eq('envio_id', envioId)
        .order('orden', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as PodFoto[]
    },
    enabled: !!envioId,
  })

  useEffect(() => { onCountChange?.(fotos.length) }, [fotos.length, onCountChange])

  async function refrescarPrincipal(nuevoListado: PodFoto[]) {
    const principal = nuevoListado[0]?.url ?? null
    await supabase.from('envios').update({ pod_url: principal }).eq('id', envioId)
    onPrincipalChange?.(principal)
    qc.invalidateQueries({ queryKey: ['envios'] })
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length === 0 || !tenant?.id) return
    setUploading(true)
    try {
      const nuevasFotos: PodFoto[] = []
      const ordenBase = fotos.length
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `pod/${envioId}/${Date.now()}_${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('etiquetas-envios').upload(path, file, { upsert: true })
        if (upErr) throw upErr
        const { data: signed } = await supabase.storage.from('etiquetas-envios').createSignedUrl(path, 60 * 60 * 24 * 365)
        const url = signed?.signedUrl
        if (!url) continue
        const { data: row, error } = await supabase.from('envio_pod_fotos').insert({
          envio_id: envioId,
          tenant_id: tenant.id,
          url,
          storage_path: path,
          orden: ordenBase + i,
          created_by: user?.id ?? null,
        }).select().single()
        if (error) throw error
        nuevasFotos.push(row as PodFoto)
      }
      const merged = [...fotos, ...nuevasFotos]
      qc.setQueryData(['envio-pod-fotos', envioId], merged)
      await refrescarPrincipal(merged)
      toast.success(`${nuevasFotos.length} foto${nuevasFotos.length > 1 ? 's subidas' : ' subida'}`)
    } catch (err: any) {
      toast.error(err.message ?? 'Error al subir fotos')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function eliminarFoto(f: PodFoto) {
    if (!confirm('¿Eliminar esta foto del POD?')) return
    setDeletingId(f.id)
    try {
      if (f.storage_path) {
        await supabase.storage.from('etiquetas-envios').remove([f.storage_path])
      }
      const { error } = await supabase.from('envio_pod_fotos').delete().eq('id', f.id)
      if (error) throw error
      const restante = fotos.filter(x => x.id !== f.id)
      qc.setQueryData(['envio-pod-fotos', envioId], restante)
      await refrescarPrincipal(restante)
      toast.success('Foto eliminada')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Cargando fotos…</div>
      ) : fotos.length === 0 ? (
        <p className="text-xs text-muted flex items-center gap-1.5"><ImageIcon size={12} /> Sin fotos cargadas todavía.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {fotos.map((f, idx) => (
            <div key={f.id} className="relative group rounded-lg overflow-hidden border border-border-ds bg-page">
              <a href={f.url} target="_blank" rel="noreferrer" className="block aspect-square">
                <img src={f.url} alt={`POD ${idx + 1}`} className="w-full h-full object-cover" />
              </a>
              {idx === 0 && (
                <span className="absolute top-1 left-1 text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-600 text-white">Principal</span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => eliminarFoto(f)}
                  disabled={deletingId === f.id}
                  title="Eliminar foto"
                  className="absolute top-1 right-1 p-1 rounded-full bg-red-500/80 hover:bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                >
                  {deletingId === f.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-3 py-1.5 rounded-lg border border-border-ds text-muted hover:text-accent-text hover:border-accent-text flex items-center gap-1.5 disabled:opacity-50"
          >
            {uploading ? <><Loader2 size={12} className="animate-spin" /> Subiendo…</> : <><Camera size={12} /> Agregar foto{fotos.length > 0 ? '(s)' : ''}</>}
          </button>
        </>
      )}
    </div>
  )
}
