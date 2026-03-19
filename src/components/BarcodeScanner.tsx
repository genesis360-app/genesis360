import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { X, Camera, CameraOff, SwitchCamera } from 'lucide-react'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
  title?: string
}

export function BarcodeScanner({ onDetected, onClose, title = 'Escaneá un código' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceIdx, setDeviceIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const detectedRef = useRef(false)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader

    reader.listVideoInputDevices().then(devs => {
      setDevices(devs)
      // Prefer back camera
      const backIdx = devs.findIndex(d =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('trasera') ||
        d.label.toLowerCase().includes('environment')
      )
      setDeviceIdx(backIdx >= 0 ? backIdx : 0)
    }).catch(() => setError('No se pudo acceder a la cámara'))

    return () => {
      reader.reset()
    }
  }, [])

  useEffect(() => {
    if (!readerRef.current || devices.length === 0) return
    const deviceId = devices[deviceIdx]?.deviceId
    if (!deviceId || !videoRef.current) return

    detectedRef.current = false
    setScanning(true)
    setError(null)

    readerRef.current.decodeFromVideoDevice(deviceId, videoRef.current, (result, err) => {
      if (result && !detectedRef.current) {
        detectedRef.current = true
        readerRef.current?.reset()
        onDetected(result.getText())
      }
      if (err && !(err instanceof NotFoundException)) {
        // NotFoundException es normal (no hay código en el frame), ignorar
      }
    }).catch(e => {
      setError('No se pudo iniciar la cámara. Verificá los permisos.')
      setScanning(false)
    })

    return () => {
      readerRef.current?.reset()
      setScanning(false)
    }
  }, [devices, deviceIdx])

  const switchCamera = () => {
    readerRef.current?.reset()
    setDeviceIdx(i => (i + 1) % devices.length)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-[#2E75B6]" />
            <span className="font-semibold text-gray-800 text-sm">{title}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Visor */}
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />
          {/* Guía de escaneo */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-52 h-32">
              {/* Esquinas */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
              {/* Línea de escaneo animada */}
              {scanning && (
                <div className="absolute left-0 right-0 h-0.5 bg-[#2E75B6] opacity-80 animate-scan" />
              )}
            </div>
          </div>
          {/* Error */}
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
          {devices.length > 1 && (
            <button
              onClick={switchCamera}
              className="flex items-center gap-1.5 text-xs text-[#2E75B6] font-medium hover:text-[#1E3A5F]"
            >
              <SwitchCamera size={14} /> Cambiar cámara
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0%   { top: 10%; }
          50%  { top: 80%; }
          100% { top: 10%; }
        }
        .animate-scan { animation: scan 2s ease-in-out infinite; position: absolute; }
      `}</style>
    </div>
  )
}
