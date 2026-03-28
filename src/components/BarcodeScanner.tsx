import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, Camera, CameraOff, SwitchCamera } from 'lucide-react'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
  title?: string
}

const SCANNER_ID = 'barcode-scanner-container'

export function BarcodeScanner({ onDetected, onClose, title = 'Escaneá un código' }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [cameraIdx, setCameraIdx] = useState(0)
  const detectedRef = useRef(false)
  const startedRef = useRef(false)

  const startScanner = async (camIdx: number, camList: { id: string; label: string }[]) => {
    if (startedRef.current) {
      try { await scannerRef.current?.stop() } catch {}
    }
    startedRef.current = false
    setError(null)
    setScanning(false)

    const cameraId = camList[camIdx]?.id
    if (!cameraId) return

    try {
      const scanner = scannerRef.current!
      await scanner.start(
        cameraId,
        { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.333 },
        (decodedText) => {
          if (!detectedRef.current) {
            detectedRef.current = true
            scanner.stop().catch(() => {})
            onDetected(decodedText)
          }
        },
        () => { /* frame sin código, ignorar */ }
      )
      startedRef.current = true
      setScanning(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setError('Permiso de cámara denegado. Habilitalo en Ajustes del navegador.')
      } else {
        setError(`No se pudo iniciar la cámara: ${msg}`)
      }
    }
  }

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ID)
    scannerRef.current = scanner

    Html5Qrcode.getCameras()
      .then(devices => {
        if (!devices.length) {
          setError('No se encontró ninguna cámara.')
          return
        }
        // Preferir cámara trasera
        const backIdx = devices.findIndex(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('trasera') ||
          d.label.toLowerCase().includes('environment')
        )
        const idx = backIdx >= 0 ? backIdx : 0
        setCameras(devices)
        setCameraIdx(idx)
        startScanner(idx, devices)
      })
      .catch(() => setError('No se pudo acceder a la cámara. Verificá los permisos.'))

    return () => {
      if (startedRef.current) {
        scanner.stop().catch(() => {})
      }
    }
  }, [])

  const switchCamera = async () => {
    const next = (cameraIdx + 1) % cameras.length
    setCameraIdx(next)
    await startScanner(next, cameras)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-accent" />
            <span className="font-semibold text-gray-800 text-sm">{title}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Visor — html5-qrcode inyecta el video acá */}
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          <div id={SCANNER_ID} className="w-full h-full" />
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 p-4 text-center">
              <CameraOff size={32} className="text-white/60 mb-3" />
              <p className="text-white text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {scanning ? 'Apuntá al código de barras...' : 'Iniciando cámara...'}
          </p>
          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              className="flex items-center gap-1.5 text-xs text-accent font-medium hover:text-primary"
            >
              <SwitchCamera size={14} /> Cambiar cámara
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
