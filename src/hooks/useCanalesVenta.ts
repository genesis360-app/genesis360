import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// VF2 (I1+I2) — canales de venta configurables + clasificación online/presencial + reglas.

export interface CanalVenta {
  id: string
  nombre: string
  clasificacion: 'online' | 'presencial'
  icono: string | null
  activo: boolean
  predefinido: boolean
  orden: number | null
}

export interface ReglaCanal {
  devolucion_dias?: number | null
  descuento_max_pct?: number | null
  lista_precio?: 'minorista' | 'mayorista' | null
  requiere_cliente?: boolean | null
}

// Mapeo de orígenes que NO vienen del selector del POS (integraciones / pagos) a su nombre de canal.
const ORIGEN_ALIAS: Record<string, string> = {
  pos: 'Presencial', POS: 'Presencial',
  mercadolibre: 'MercadoLibre', MELI: 'MercadoLibre',
  tiendanube: 'TiendaNube', TiendaNube: 'TiendaNube',
  whatsapp: 'WhatsApp',
  // MP es medio de pago, no canal → se clasifica como online (origen de pago digital)
  MP: 'MercadoPago',
}

export function useCanalesVenta() {
  const { tenant } = useAuthStore()

  const { data: canales = [] } = useQuery({
    queryKey: ['canales-venta', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async (): Promise<CanalVenta[]> => {
      const { data, error } = await supabase
        .from('canales_venta')
        .select('id, nombre, clasificacion, icono, activo, predefinido, orden')
        .eq('tenant_id', tenant!.id)
        .order('orden', { ascending: true, nullsFirst: false })
        .order('nombre')
      if (error) throw error
      return (data ?? []) as CanalVenta[]
    },
  })

  const reglas: Record<'online' | 'presencial', ReglaCanal> = {
    online: ((tenant as any)?.reglas_canal?.online ?? {}) as ReglaCanal,
    presencial: ((tenant as any)?.reglas_canal?.presencial ?? {}) as ReglaCanal,
  }

  // Resuelve la clasificación de un origen/canal de venta (default presencial).
  const clasificacionDe = (origen: string | null | undefined): 'online' | 'presencial' => {
    if (!origen) return 'presencial'
    const nombre = ORIGEN_ALIAS[origen] ?? origen
    const canal = canales.find(c => c.nombre.toLowerCase() === nombre.toLowerCase())
    if (canal) return canal.clasificacion
    // Integraciones conocidas que no estén como canal → online
    if (['MercadoLibre', 'TiendaNube', 'MercadoPago', 'Shopify', 'WooCommerce'].includes(nombre)) return 'online'
    return 'presencial'
  }

  const reglaDe = (origen: string | null | undefined): ReglaCanal => reglas[clasificacionDe(origen)]

  return { canales, canalesActivos: canales.filter(c => c.activo), reglas, clasificacionDe, reglaDe }
}
