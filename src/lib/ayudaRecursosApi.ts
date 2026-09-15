// Ayuda → Cursos y recursos (mig 429) — acceso a datos. La RLS devuelve solo los recursos publicados.
import { supabase } from '@/lib/supabase'
import { BUCKET_RECURSOS, type AyudaRecurso } from '@/lib/ayudaRecursos'

export async function listarRecursos(): Promise<AyudaRecurso[]> {
  const { data, error } = await supabase.from('ayuda_recursos')
    .select('id, titulo, descripcion, modulo, video_path, miniatura_path, duracion_seg, orden')
    .order('orden')
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as AyudaRecurso[]
}

/** URL pública del archivo (el bucket es público: material de ayuda). */
export function urlRecurso(path: string): string {
  return supabase.storage.from(BUCKET_RECURSOS).getPublicUrl(path).data.publicUrl
}
