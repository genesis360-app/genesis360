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
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [canSwitch, setCanSwitch] = useState(false)
  const facingRef = useRef<'environment' | 'user'>('environment')
  const detectedRef = useRef(false)

  const startScanner = (facing: 'environment' | 'user') => {
    if (!videoRef.current) return

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Tu navegador no soporta acceso a cámara. Usá Chrome o Safari actualizado.')
      return
    }

    readerRef.current?.reset()

    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    detectedRef.current = false
    setError(null)
    setScanning(false)

    reader.decodeFromConstraints(
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      videoRef.current,
      (result, err) => {
        if (result && !detectedRef.current) {
          detectedRef.current = true
          reader.reset()
          onDetected(result.getText())
        }
        if (err && !(err instanceof NotFoundException)) {
          // NotFoundException es normal entre frames, ignorar
        }
      }
    )
      .then(() => setScanning(true))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Error: ${msg}`)
      })

    // Mostrar botón cambiar cámara si hay más de un dispositivo
    navigator.mediaDevices.enumerateDevices().then(devs => {
      setCanSwitch(devs.filter(d => d.kind === 'videoinput').length > 1)
    }).catch(() => {})
  }

  useEffect(() => {
    startScanner('environment')
    return () => { readerRef.current?.reset() }
  }, [])

  const switchCamera = () => {
    const next = facingRef.current === 'environment' ? 'user' : 'environment'
    facingRef.current = next
    startScanner(next)
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
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
              {scanning && (
                <div className="absolute left-0 right-0 h-0.5 bg-accent opacity-80 animate-scan" />
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
          {canSwitch && (
            <button
              onClick={switchCamera}
              className="flex items-center gap-1.5 text-xs text-accent font-medium hover:text-primary"
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
