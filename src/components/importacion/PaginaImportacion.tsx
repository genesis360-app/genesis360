// Layout estándar de las páginas de importación (mismo diseño que "Importar productos"): encabezado con volver,
// columna izquierda con Plantilla / Subir archivo / opciones, y la vista previa a la derecha (2/3).
// Lo usan Inventario, Clientes y Proveedores (pedido de GO 2026-10-01: "la misma pantalla que Productos/Inventario").
import { useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, FileSpreadsheet, Upload } from 'lucide-react'

interface Props {
  titulo: string
  subtitulo: string
  volverA: string
  /** Recuadro informativo arriba (qué hace la importación, topes, etc.). */
  aviso?: ReactNode
  /** Resultado de la carga (ok / no se cargó nada). */
  resultado?: ReactNode
  /** Tarjetas extra arriba de "Plantilla" (p. ej. la sucursal de destino). */
  antes?: ReactNode
  textoPlantilla?: string
  onPlantilla: () => void
  onArchivo: (f: File) => void
  hayFilas: boolean
  /** Si viene, la subida queda deshabilitada con este texto (p. ej. "Primero elegí la sucursal"). */
  bloqueoSubida?: string | null
  iconoVacio?: ReactNode
  /** Tarjeta de opciones debajo de "Subir archivo" (p. ej. qué hacer con los existentes). */
  opciones?: ReactNode
  /** La vista previa (solo se muestra si `hayFilas`). */
  children?: ReactNode
}

export function PaginaImportacion({
  titulo, subtitulo, volverA, aviso, resultado, antes, textoPlantilla = 'Descargá, completá y subí.',
  onPlantilla, onArchivo, hayFilas, bloqueoSubida, iconoVacio, opciones, children,
}: Props) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const icono = iconoVacio ?? <FileSpreadsheet size={28} className="text-gray-300 mx-auto mb-2" />

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(volverA)} aria-label="Volver" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">{titulo}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{subtitulo}</p>
        </div>
      </div>

      {resultado}
      {aviso}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          {antes}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><FileSpreadsheet size={16} className="text-accent-text" /> Plantilla</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{textoPlantilla}</p>
            <button onClick={onPlantilla} className="w-full flex items-center justify-center gap-2 border border-accent-text text-accent-text font-medium py-2.5 rounded-xl hover:bg-accent/10 transition-all text-sm">
              <Download size={15} /> Descargar plantilla
            </button>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><Upload size={16} className="text-accent-text" /> Subir archivo</h2>
            <div className={`border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center transition-all ${bloqueoSubida ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-accent-text hover:bg-accent/5'}`}
              onClick={() => { if (!bloqueoSubida) fileRef.current?.click() }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !bloqueoSubida) onArchivo(f) }}>
              {icono}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {bloqueoSubida ?? (hayFilas ? 'Subí el archivo corregido' : 'Arrastrá o hacé click')}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls, .csv</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onArchivo(f); e.target.value = '' }} />
          </div>
          {hayFilas && opciones}
        </div>

        <div className="lg:col-span-2">
          {!hayFilas ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-100 dark:border-gray-700 text-center text-gray-400 dark:text-gray-500">
              <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Subí un archivo para ver la previsualización</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Tarjeta de la columna izquierda con el mismo estilo (para opciones como "Si ya existe"). */
export function TarjetaImportacion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
      <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">{titulo}</h2>
      {children}
    </div>
  )
}
