import { useState, useEffect } from 'react'
import { BRAND } from '@/config/brand'
import {
  Package, ArrowLeftRight, ShoppingCart, DollarSign,
  TrendingDown, BarChart2, Settings, CheckCircle2, X, ChevronLeft, ChevronRight,
  Sparkles, Users, ClipboardList
} from 'lucide-react'

const STORAGE_KEY = `${BRAND.name.toLowerCase().replace(/\s/g,'_')}_walkthrough_v1`

interface Slide {
  icon: any
  color: string
  titulo: string
  descripcion: string
  tip?: string
  ruta?: string
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    color: 'text-accent',
    titulo: `Bienvenido a ${BRAND.name}`,
    descripcion: 'En 2 minutos te mostramos todo lo que podés hacer. Es rápido, prometido.',
    tip: 'Podés relanzar este tour desde el menú lateral cuando quieras.',
  },
  {
    icon: Package,
    color: 'text-blue-500',
    titulo: 'Productos — tu catálogo',
    descripcion: 'Cargá tus productos con precio de costo, precio de venta, stock mínimo y categoría. Podés hacerlo uno por uno, desde una foto, o importar un Excel completo.',
    tip: 'Activá "Trazabilidad por serie" si vendés productos únicos (electrónica, herramientas, etc.)',
    ruta: '/inventario/nuevo',
  },
  {
    icon: ArrowLeftRight,
    color: 'text-orange-500',
    titulo: 'Movimientos — controlá el stock',
    descripcion: 'Cada vez que entra o sale mercadería, registralo acá. El stock se actualiza solo. Podés asignar ubicación, lote, vencimiento y número de serie.',
    tip: 'Usá "LPN" para identificar pallets o cajas físicas dentro de tu depósito.',
    ruta: '/movimientos',
  },
  {
    icon: ShoppingCart,
    color: 'text-green-500',
    titulo: 'Ventas — ticket rápido',
    descripcion: 'Buscá el producto, agregalo al carrito y cobrá. Soporta múltiples medios de pago, descuentos por producto y descuento total. El stock baja automáticamente.',
    tip: 'Podés reservar una venta y despacharla después cuando el cliente retire.',
    ruta: '/ventas',
  },
  {
    icon: DollarSign,
    color: 'text-yellow-500',
    titulo: 'Caja — abrí y cerrá el día',
    descripcion: 'Abrí la caja al inicio de la jornada y cerrala al final. Registrá ingresos y egresos de efectivo, y llevá el control del saldo real vs lo esperado.',
    tip: 'El historial de caja te muestra cada cierre con el detalle completo.',
    ruta: '/caja',
  },
  {
    icon: TrendingDown,
    color: 'text-red-400',
    titulo: 'Gastos — egresos del negocio',
    descripcion: 'Registrá alquiler, servicios, sueldos y cualquier egreso. Categorizalos para saber dónde se va la plata y calcular tu ganancia real.',
    tip: 'Los gastos se cruzan con las ventas en Métricas para darte la ganancia neta.',
    ruta: '/gastos',
  },
  {
    icon: BarChart2,
    color: 'text-purple-500',
    titulo: 'Métricas — la salud del negocio',
    descripcion: 'Mirá ventas, margen, rotación de stock, productos sin movimiento y comparativas por período. Todo en un solo lugar.',
    tip: 'Accedé desde Dashboard → pestaña "Métricas".',
    ruta: '/dashboard',
  },
  {
    icon: ClipboardList,
    color: 'text-indigo-500',
    titulo: 'Historial — quién hizo qué',
    descripcion: 'Cada acción queda registrada: quién cambió un precio, qué estado movió un producto, quién editó una venta. Completo y filtrable.',
    tip: 'Solo lo ven Supervisores y Dueños.',
    ruta: '/historial',
  },
  {
    icon: Settings,
    color: 'text-gray-500 dark:text-gray-400',
    titulo: 'Configuración — a tu medida',
    descripcion: 'Creá categorías, proveedores, ubicaciones y estados de inventario según cómo funciona tu negocio. Todo se puede personalizar.',
    tip: 'Completá la configuración antes de cargar productos para que todo quede organizado desde el inicio.',
    ruta: '/configuracion',
  },
  {
    icon: Users,
    color: 'text-teal-500',
    titulo: 'Usuarios — tu equipo',
    descripcion: 'Agregá a tu equipo con roles específicos: Dueño, Supervisor o Cajero. Cada rol tiene permisos distintos.',
    tip: 'El Cajero solo puede ver ventas y movimientos. El Supervisor puede ver métricas e historial.',
    ruta: '/usuarios',
  },
  {
    icon: CheckCircle2,
    color: 'text-green-500',
    titulo: '¡Todo listo!',
    descripcion: 'Ya sabés cómo funciona. El primer paso es configurar tus categorías y proveedores, luego cargar tus productos.',
    tip: '¿Dudas? Podés relanzar este tour desde el ícono ❓ en el menú lateral.',
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function Walkthrough({ open, onClose }: Props) {
  const [paso, setPaso] = useState(0)

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'seen')
    onClose()
  }

  const next = () => {
    if (paso < SLIDES.length - 1) setPaso(p => p + 1)
    else handleClose()
  }

  const prev = () => setPaso(p => Math.max(0, p - 1))

  // Reset al abrir
  useEffect(() => { if (open) setPaso(0) }, [open])

  if (!open) return null

  const slide = SLIDES[paso]
  const Icon = slide.icon
  const esUltimo = paso === SLIDES.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md relative overflow-hidden">

        {/* Barra de progreso */}
        <div className="h-1 bg-gray-100 dark:bg-gray-700">
          <div
            className="h-1 bg-accent transition-all duration-300"
            style={{ width: `${((paso + 1) / SLIDES.length) * 100}%` }}
          />
        </div>

        {/* Botón cerrar */}
        <button onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 text-gray-300 hover:text-gray-500 dark:text-gray-400 transition-colors z-10">
          <X size={18} />
        </button>

        {/* Contenido */}
        <div className="px-8 pt-8 pb-6 text-center min-h-[280px] flex flex-col items-center justify-center">
          <div className={`w-14 h-14 rounded-2xl bg-gray-50 dark:bg-gray-700 flex items-center justify-center mb-4 ${slide.color}`}>
            <Icon size={28} />
          </div>

          <h2 className="text-xl font-bold text-primary mb-3">{slide.titulo}</h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">{slide.descripcion}</p>

          {slide.tip && (
            <div className="mt-4 bg-accent/5 border border-accent/20 rounded-xl px-4 py-2.5 text-xs text-accent/80 text-left w-full">
              💡 {slide.tip}
            </div>
          )}
        </div>

        {/* Dots de progreso */}
        <div className="flex items-center justify-center gap-1.5 pb-2">
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => setPaso(i)}
              className={`rounded-full transition-all ${i === paso ? 'w-4 h-2 bg-accent' : 'w-2 h-2 bg-gray-200 hover:bg-gray-300'}`}
            />
          ))}
        </div>

        {/* Navegación */}
        <div className="flex items-center gap-3 px-8 pb-7 pt-2">
          <button onClick={prev} disabled={paso === 0}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-0 transition-all">
            <ChevronLeft size={18} />
          </button>

          <button onClick={handleClose}
            className="flex-1 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 transition-colors">
            Omitir tour
          </button>

          <button onClick={next}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white text-sm font-semibold rounded-xl transition-all">
            {esUltimo ? 'Empezar' : 'Siguiente'}
            {!esUltimo && <ChevronRight size={16} />}
          </button>
        </div>

        {/* Contador */}
        <p className="text-center text-xs text-gray-300 pb-4">{paso + 1} / {SLIDES.length}</p>
      </div>
    </div>
  )
}

export function useWalkthrough() {
  const seen = localStorage.getItem(STORAGE_KEY) === 'seen'
  return { visto: seen, storageKey: STORAGE_KEY }
}
