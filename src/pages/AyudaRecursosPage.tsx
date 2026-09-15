import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, GraduationCap, PlayCircle } from 'lucide-react'
import { listarRecursos, urlRecurso } from '@/lib/ayudaRecursosApi'
import { formatearDuracion } from '@/lib/ayudaRecursos'

// Ayuda → Cursos y recursos (mig 429). Muestra solo lo que el equipo publicó; mientras no haya nada, "próximamente".

export default function AyudaRecursosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: recursos = [], isLoading, error } = useQuery({
    queryKey: ['ayuda-recursos'],
    queryFn: listarRecursos,
    staleTime: 5 * 60 * 1000,
  })
  const seleccionado = recursos.find(r => r.id === searchParams.get('video')) ?? null

  const ver = (id: string) => {
    setSearchParams({ video: id })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div>
        <Link to="/ayuda" className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent-text">
          <ArrowLeft size={13} /> Centro de Soporte
        </Link>
        <h1 className="text-2xl font-bold text-primary dark:text-white flex items-center gap-2 mt-2">
          <GraduationCap size={24} className="text-accent-text" /> Cursos y recursos
        </h1>
        <p className="text-sm text-muted mt-1">Videos cortos para aprender a usar cada parte de la app.</p>
      </div>

      {seleccionado && (
        <section className="bg-surface border border-border-ds rounded-xl overflow-hidden" aria-label={seleccionado.titulo}>
          <video
            key={seleccionado.id}
            data-recurso-video={seleccionado.id}
            src={urlRecurso(seleccionado.video_path)}
            poster={seleccionado.miniatura_path ? urlRecurso(seleccionado.miniatura_path) : undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full max-h-[70vh] bg-black"
          />
          <div className="px-5 py-4">
            <h2 className="font-semibold text-primary dark:text-white">{seleccionado.titulo}</h2>
            {seleccionado.descripcion && (
              <p className="text-sm text-muted mt-1 whitespace-pre-wrap">{seleccionado.descripcion}</p>
            )}
          </div>
        </section>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">No se pudieron cargar los recursos. Probá de nuevo en un rato.</p>
      ) : recursos.length === 0 ? (
        <div className="bg-surface border border-border-ds rounded-xl p-8 text-center" data-recursos-vacio>
          <GraduationCap size={32} className="mx-auto mb-2 text-muted" />
          <p className="font-medium text-primary dark:text-white">Próximamente</p>
          <p className="text-sm text-muted mt-1">Estamos preparando videos cortos para cada módulo.</p>
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recursos.map((r) => {
            const duracion = formatearDuracion(r.duracion_seg)
            const activo = seleccionado?.id === r.id
            return (
              <li key={r.id}>
                <button
                  type="button"
                  data-recurso={r.id}
                  onClick={() => ver(r.id)}
                  aria-current={activo ? 'true' : undefined}
                  className={`w-full h-full text-left bg-surface border rounded-xl overflow-hidden transition-colors hover:border-accent-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text ${activo ? 'border-accent-text' : 'border-border-ds'}`}
                >
                  <div className="relative aspect-video bg-page flex items-center justify-center">
                    {r.miniatura_path ? (
                      <img src={urlRecurso(r.miniatura_path)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <PlayCircle size={36} className="text-accent-text" />
                    )}
                    {duracion && (
                      <span className="absolute bottom-2 right-2 text-[11px] font-medium bg-black/70 text-white px-1.5 py-0.5 rounded">
                        {duracion}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-primary dark:text-white line-clamp-2">{r.titulo}</p>
                    {r.descripcion && <p className="text-xs text-muted mt-1 line-clamp-2">{r.descripcion}</p>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
