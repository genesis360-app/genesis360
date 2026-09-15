// Ayuda → Cursos y recursos (mig 429) — lógica pura, sin Supabase (se testea sola).

export type AyudaRecurso = {
  id: string
  titulo: string
  descripcion: string | null
  modulo: string | null
  video_path: string
  miniatura_path: string | null
  duracion_seg: number | null
  orden: number
}

export const BUCKET_RECURSOS = 'ayuda-recursos'

/** ¿El recurso es de la pantalla donde está el usuario? '/ventas' vale para '/ventas' y '/ventas/historial', no para '/ventasx'. */
export function esDelModulo(recurso: Pick<AyudaRecurso, 'modulo'>, modulo?: string | null): boolean {
  if (!modulo || !recurso.modulo) return false
  return modulo === recurso.modulo || modulo.startsWith(`${recurso.modulo}/`)
}

/** Primero los del módulo actual; dentro de cada grupo, por `orden` y después por título. */
export function ordenarParaModulo(recursos: AyudaRecurso[], modulo?: string | null): AyudaRecurso[] {
  return [...recursos].sort((a, b) => {
    const grupo = Number(!esDelModulo(a, modulo)) - Number(!esDelModulo(b, modulo))
    return grupo || a.orden - b.orden || a.titulo.localeCompare(b.titulo, 'es')
  })
}

/** 95 → "1:35", 3605 → "1:00:05". Sin dato → null. */
export function formatearDuracion(seg: number | null | undefined): string | null {
  if (seg == null || !Number.isFinite(seg) || seg <= 0) return null
  const total = Math.round(seg)
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = total % 60
  const mm = horas > 0 ? String(minutos).padStart(2, '0') : String(minutos)
  return `${horas > 0 ? `${horas}:` : ''}${mm}:${String(segundos).padStart(2, '0')}`
}
