import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  estadoCapacidadUbicacion, estadoCargaUbicacion, estadoVolumenUbicacion,
  volumenUbicacionM3, capacidadUtilM3,
} from '@/lib/medidasLogistica'

interface Props {
  /** Ubicación destino elegida. Sin ella no hay nada que avisar. */
  ubicacionId: string | null | undefined
  /** Producto que se va a guardar ahí (para estimar cuánto suma la operación). */
  productoId?: string | null
  /** Unidades BASE que entran a esa ubicación. */
  cantidadBase?: number
  /** Empaque en el que entra (`unidades_medida.id`), si el operador eligió uno. */
  unidadMedidaId?: string | null
  /** LPN nuevos que crea la operación. Default 1. */
  lpnAAgregar?: number
  className?: string
}

/**
 * Aviso de capacidad al mandar mercadería a una ubicación (Fase C del cubicaje, migs 321/322/325).
 *
 * 🛑 **Avisa, nunca bloquea.** Los tres topes (`capacidad_pallets`, `peso_max_kg`, dimensiones) los
 * carga una persona en Configuración y pueden estar mal o desactualizados; la mercadería, en cambio,
 * ya está físicamente ahí. Frenar un ingreso real por un número de configuración sería peor que el
 * problema que resuelve.
 *
 * Solo se muestra cuando hay algo que decir (la ubicación quedaría **llena o excedida**): un cartel
 * permanente en verde se vuelve ruido y deja de leerse justo el día que importa.
 *
 * ⚠ Todos los números pecan **por defecto**: una línea sin peso o sin medidas suma 0. Por eso, cuando
 * la cobertura no es total, el aviso lo dice — el error empuja hacia "parece que hay lugar".
 */
export function AvisoCapacidadUbicacion({
  ubicacionId, productoId, cantidadBase = 0, unidadMedidaId, lpnAAgregar = 1, className = '',
}: Props) {
  const { tenant } = useAuthStore()

  const { data: ubic } = useQuery({
    queryKey: ['aviso-capacidad-ubic', ubicacionId],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones')
        .select('nombre, capacidad_pallets, peso_max_kg, alto_cm, ancho_cm, largo_cm')
        .eq('id', ubicacionId!).maybeSingle()
      return data as any
    },
    enabled: !!ubicacionId,
  })

  const { data: ocup } = useQuery({
    queryKey: ['aviso-capacidad-ocupacion', ubicacionId],
    queryFn: async () => {
      const { data } = await supabase.from('vw_ubicacion_ocupacion')
        .select('lpn_activos, peso_kg, lineas_con_peso, lineas_total, volumen_m3, lineas_con_volumen')
        .eq('ubicacion_id', ubicacionId!).maybeSingle()
      return data as any
    },
    enabled: !!ubicacionId,
  })

  // Cuánto suma lo que estamos por guardar. Espeja la elección de presentación de
  // `vw_ubicacion_ocupacion` (mig 325): manda el empaque de la línea; si no hay, la base.
  const { data: medidas } = useQuery({
    queryKey: ['aviso-capacidad-medidas', productoId, unidadMedidaId ?? null],
    queryFn: async () => {
      const [prod, pres] = await Promise.all([
        supabase.from('productos').select('peso_kg').eq('id', productoId!).maybeSingle(),
        supabase.from('producto_presentaciones')
          .select('factor_base, peso_kg, alto_cm, ancho_cm, largo_cm, nombre_empaque_id, es_base, orden')
          .eq('tenant_id', tenant!.id).eq('producto_id', productoId!).eq('activo', true)
          .order('orden'),
      ])
      const filas = (pres.data ?? []) as any[]
      const elegida = (unidadMedidaId && filas.find(f => f.nombre_empaque_id === unidadMedidaId))
        || filas.find(f => f.es_base)
        || null
      return { pesoProducto: (prod.data as any)?.peso_kg ?? null, presentacion: elegida }
    },
    enabled: !!tenant && !!productoId && !!ubicacionId,
  })

  if (!ubicacionId || !ubic) return null

  const factor = Number(medidas?.presentacion?.factor_base) || 1
  const bultos = cantidadBase > 0 ? cantidadBase / factor : 0

  // Peso que suma: el del NIVEL (incluye embalaje) o, si no está medido, el de la ficha × unidades.
  const pesoNivel = Number(medidas?.presentacion?.peso_kg) || 0
  const pesoAAgregar = pesoNivel > 0
    ? bultos * pesoNivel
    : cantidadBase * (Number(medidas?.pesoProducto) || 0)

  const volUnitario = volumenUbicacionM3(
    medidas?.presentacion?.largo_cm, medidas?.presentacion?.ancho_cm, medidas?.presentacion?.alto_cm,
  )
  const volAAgregar = volUnitario != null ? volUnitario * bultos : 0

  const cap = estadoCapacidadUbicacion(ubic.capacidad_pallets, ocup?.lpn_activos ?? 0, lpnAAgregar)
  const carga = estadoCargaUbicacion(
    ubic.peso_max_kg, (Number(ocup?.peso_kg) || 0) + pesoAAgregar,
    ocup?.lineas_con_peso ?? 0, ocup?.lineas_total ?? 0,
  )
  const vol = tenant?.cubicaje_habilitado
    ? estadoVolumenUbicacion(
        capacidadUtilM3(
          volumenUbicacionM3(ubic.largo_cm, ubic.ancho_cm, ubic.alto_cm),
          tenant?.cubicaje_factor_aprovechamiento,
        ),
        ocup?.volumen_m3 ?? 0, ocup?.lineas_con_volumen ?? 0, ocup?.lineas_total ?? 0, volAAgregar,
      )
    : null

  const alertas = [cap, carga, vol].filter(
    (e): e is NonNullable<typeof e> => !!e && (e.estado === 'lleno' || e.estado === 'excedido'),
  )
  if (alertas.length === 0) return null

  const excedido = alertas.some(a => a.estado === 'excedido')
  const cobertura = [carga.avisoCobertura, vol?.avisoCobertura].filter(Boolean)

  return (
    <div className={`flex gap-2 rounded-lg border px-2.5 py-2 text-xs ${excedido
      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'} ${className}`}>
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {alertas.map((a, i) => <p key={i}>{a.mensaje}</p>)}
        {cobertura.map((c, i) => <p key={`c${i}`} className="opacity-80">⚠ {c}</p>)}
        <p className="opacity-80">Se puede guardar igual — es un aviso, no un bloqueo.</p>
      </div>
    </div>
  )
}
