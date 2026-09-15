import { useRef } from 'react'
import { Paperclip, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { MAX_ADJUNTOS, TIPOS_ARCHIVO_ADJUNTO, validarAdjunto } from '@/lib/soporte'

/** Capturas o PDF para una consulta de soporte (hasta 3, 5 MB cada uno — mismos límites que el bucket). */
export function SelectorAdjuntos({ archivos, onChange, disabled = false, id }: {
  archivos: File[]
  onChange: (archivos: File[]) => void
  disabled?: boolean
  id: string
}) {
  const input = useRef<HTMLInputElement>(null)

  const agregar = (lista: FileList | null) => {
    if (!lista) return
    const nuevos = [...archivos]
    for (const archivo of Array.from(lista)) {
      const error = validarAdjunto(archivo)
      if (error) { toast.error(error); continue }
      if (nuevos.length >= MAX_ADJUNTOS) { toast.error(`Podés adjuntar hasta ${MAX_ADJUNTOS} archivos.`); break }
      nuevos.push(archivo)
    }
    onChange(nuevos)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || archivos.length >= MAX_ADJUNTOS}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text hover:underline disabled:opacity-50 disabled:no-underline"
      >
        <Paperclip size={13} /> Adjuntar captura o PDF
      </button>
      <input
        ref={input}
        id={id}
        type="file"
        accept={TIPOS_ARCHIVO_ADJUNTO.join(',')}
        multiple
        className="hidden"
        onChange={(e) => agregar(e.target.files)}
      />
      {archivos.map((archivo, i) => (
        <span key={`${archivo.name}-${i}`} className="inline-flex items-center gap-1 text-xs bg-page border border-border-ds rounded-lg pl-2 pr-1 py-0.5 max-w-[14rem]">
          <span className="truncate">{archivo.name}</span>
          <button
            type="button"
            onClick={() => onChange(archivos.filter((_, j) => j !== i))}
            disabled={disabled}
            aria-label={`Quitar ${archivo.name}`}
            className="text-muted hover:text-red-500 p-0.5"
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  )
}
