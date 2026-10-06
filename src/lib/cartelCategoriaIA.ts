// Pide a la EF `categoria-cartel-ia` que redacte el cartel del POS de una categoría (B2 / Fase 5, mig 469).
// B-4: se redacta al guardar la promoción, nunca en la venta. La venta no depende de esto: si falla, el POS usa la
// plantilla. Se llama sin esperar (salvo el botón "Volver a redactar", que muestra el resultado).
import { supabase } from '@/lib/supabase'

export type ResultadoCartel = { origen: 'ia' | 'plantilla'; motivo?: string }

export async function pedirRedaccionCartel(categoriaId: string): Promise<ResultadoCartel> {
  const { data, error } = await supabase.functions.invoke('categoria-cartel-ia', { body: { categoria_id: categoriaId } })
  if (error) return { origen: 'plantilla', motivo: error.message }
  return (data as ResultadoCartel) ?? { origen: 'plantilla' }
}
