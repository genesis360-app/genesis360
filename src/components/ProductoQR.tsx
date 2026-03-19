import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Download, X, Printer } from 'lucide-react'

interface Props {
  productoId: string
  nombre: string
  sku: string
  onClose: () => void
}

export function ProductoQR({ productoId, nombre, sku, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  // El QR codifica el SKU (lo que el escáner lee para buscar el producto)
  const qrData = sku

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, qrData, {
      width: 220,
      margin: 2,
      color: { dark: '#1E3A5F', light: '#FFFFFF' },
    }).then(() => {
      setDataUrl(canvasRef.current!.toDataURL('image/png'))
    })
  }, [qrData])

  const descargar = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `qr-${sku}.png`
    a.click()
  }

  const imprimir = () => {
    if (!dataUrl) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <html><head><title>QR ${nombre}</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column;
               align-items: center; justify-content: center; min-height: 100vh;
               margin: 0; background: white; }
        img { width: 200px; height: 200px; }
        p { margin: 4px 0; text-align: center; }
        .nombre { font-size: 14px; font-weight: 600; color: #1E3A5F; max-width: 200px; }
        .sku { font-size: 11px; color: #6b7280; font-family: monospace; }
      </style>
      </head><body>
        <img src="${dataUrl}" />
        <p class="nombre">${nombre}</p>
        <p class="sku">${sku}</p>
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body></html>
    `)
    win.document.close()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <QrCode size={17} className="text-[#2E75B6]" />
            <span className="font-semibold text-sm text-gray-800">Código QR</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={17} className="text-gray-500" />
          </button>
        </div>

        {/* QR */}
        <div className="p-6 flex flex-col items-center gap-3">
          <canvas ref={canvasRef} className="rounded-xl border border-gray-100 shadow-sm" />
          <div className="text-center">
            <p className="font-semibold text-gray-800 text-sm">{nombre}</p>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{sku}</p>
          </div>
          <p className="text-xs text-gray-400 text-center px-4">
            Escaneá este QR con la app para buscar el producto directamente
          </p>
        </div>

        {/* Acciones */}
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={descargar}
            disabled={!dataUrl}
            className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download size={15} /> Descargar
          </button>
          <button
            onClick={imprimir}
            disabled={!dataUrl}
            className="flex-1 flex items-center justify-center gap-2 bg-[#1E3A5F] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#2E75B6] disabled:opacity-40"
          >
            <Printer size={15} /> Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}
