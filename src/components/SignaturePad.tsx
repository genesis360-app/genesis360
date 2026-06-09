import { useRef, useState, useEffect } from 'react'
import { Eraser, Check } from 'lucide-react'

// EN2/D3 — Pad de firma del receptor (canvas). Emite un dataURL PNG al confirmar.
// Sin dependencias externas: pointer events + canvas. Reusable en EnviosPage y TransportistePage.

interface Props {
  onChange: (dataUrl: string | null) => void
  initialUrl?: string | null
  height?: number
  accent?: string  // color del botón confirmar (default violeta)
}

export default function SignaturePad({ onChange, initialUrl, height = 160, accent = '#7c3aed' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hayTrazo, setHayTrazo] = useState(false)
  const [confirmada, setConfirmada] = useState(!!initialUrl)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Escala para nitidez en pantallas retina
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = height * ratio
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1f2937'
  }, [height])

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent) => {
    if (confirmada) return
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    setHayTrazo(true)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || confirmada) return
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  const end = () => { drawing.current = false }

  const limpiar = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHayTrazo(false)
    setConfirmada(false)
    onChange(null)
  }
  const confirmar = () => {
    if (!hayTrazo) return
    const dataUrl = canvasRef.current!.toDataURL('image/png')
    setConfirmada(true)
    onChange(dataUrl)
  }

  if (initialUrl && confirmada) {
    return (
      <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-2 bg-white">
        <img src={initialUrl} alt="Firma" style={{ height }} className="mx-auto object-contain" />
        <button type="button" onClick={limpiar} className="mt-2 text-xs text-gray-500 flex items-center gap-1 mx-auto">
          <Eraser size={12} /> Volver a firmar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: 'none' }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        className={`w-full rounded-xl border-2 ${confirmada ? 'border-green-400 bg-green-50' : 'border-dashed border-gray-300 dark:border-gray-600 bg-white'} cursor-crosshair`}
      />
      <div className="flex gap-2">
        <button type="button" onClick={limpiar}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">
          <Eraser size={13} /> Borrar
        </button>
        <button type="button" onClick={confirmar} disabled={!hayTrazo || confirmada}
          style={{ background: hayTrazo && !confirmada ? accent : undefined }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg text-white font-medium disabled:bg-gray-300 dark:disabled:bg-gray-600">
          <Check size={13} /> {confirmada ? 'Firma lista' : 'Confirmar firma'}
        </button>
      </div>
    </div>
  )
}
