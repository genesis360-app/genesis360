import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, Camera, CameraOff, SwitchCamera, Keyboard } from 'lucide-react'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
  title?: string
}

const SCANNER_ID = 'barcode-scanner-container'

function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 1800
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.12)
  } catch {}
}

export function BarcodeScanner({ onDetected, onClose, title = 'Escaneá un código' }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [cameraIdx, setCameraIdx] = useState(0)
  const [detected, setDetected] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const detectedRef = useRef(false)
  const startedRef = useRef(false)
  const manualRef = useRef<HTMLInputElement>(null)

  const handleDetected = (code: string) => {
    if (detectedRef.current) return
    detectedRef.current = true
    beep()
    try { navigator.vibrate(60) } catch {}
    setDetected(true)
    setTimeout(() => {
      onDetected(code)
    }, 180) // breve flash verde antes de cerrar
  }

  const startScanner = async (camIdx: number, camList: { id: string; label: string }[]) => {
    if (startedRef.current) {
      try { await scannerRef.current?.stop() } catch {}
    }
    startedRef.current = false
    setError(null)
    setScanning(false)
    setDetected(false)
    detectedRef.current = false

    const cameraId = camList[camIdx]?.id
    if (!cameraId) return

    try {
      const scanner = scannerRef.current!
      await scanner.start(
        cameraId,
        { fps: 25, qrbox: { width: 280, height: 280 }, aspectRatio: 1 },
        (decodedText) => handleDetected(decodedText),
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
      .catch(() => {
        setError('No se pudo acceder a la cámara.')
        setManualMode(true)
      })

    return () => {
      if (startedRef.current) {
        scanner.stop().catch(() => {})
      }
    }
  }, [])

  // Foco automático en input manual
  useEffect(() => {
    if (manualMode) {
      setTimeout(() => manualRef.current?.focus(), 50)
    }
  }, [manualMode])

  const switchCamera = async () => {
    const next = (cameraIdx + 1) % cameras.length
    setCameraIdx(next)
    await startScanner(next, cameras)
  }

  const submitManual = () => {
    const val = manualInput.trim()
    if (!val) return
    setManualInput('')
    handleDetected(val)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-accent" />
            <span className="font-semibold text-gray-800 dark:text-white text-sm">{title}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {!manualMode ? (
          <>
            {/* Visor */}
            <div className="relative bg-black" style={{ aspectRatio: '1/1' }}>
              <div id={SCANNER_ID} className="w-full h-full" />

              {/* Flash verde al detectar */}
              {detected && (
                <div className="absolute inset-0 bg-green-500/40 flex items-center justify-center animate-pulse">
                  <div className="bg-green-500 rounded-full p-3">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Línea laser animada — solo cuando está escaneando y no detectó */}
              {scanning && !detected && !error && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  {/* Marco de esquinas */}
                  <div className="relative" style={{ width: 280, height: 280 }}>
                    {/* Esquinas */}
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-violet-400 rounded-tl" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-violet-400 rounded-tr" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-violet-400 rounded-bl" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-violet-400 rounded-br" />
                    {/* Línea laser */}
                    <div className="absolute left-2 right-2 h-0.5 bg-violet-400/80 shadow-[0_0_6px_2px_rgba(139,92,246,0.5)]"
                      style={{ animation: 'laserScan 1.8s ease-in-out infinite' }} />
                  </div>
                </div>
              )}

              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 p-4 text-center">
                  <CameraOff size={32} className="text-white/60 mb-3" />
                  <p className="text-white text-sm">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {detected ? '¡Código detectado!' : scanning ? 'Apuntá al código...' : 'Iniciando cámara...'}
              </p>
              <div className="flex items-center gap-3">
                {cameras.length > 1 && (
                  <button onClick={switchCamera}
                    className="flex items-center gap-1.5 text-xs text-accent font-medium hover:text-primary">
                    <SwitchCamera size={14} /> Cambiar
                  </button>
                )}
                <button onClick={() => setManualMode(true)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <Keyboard size={14} /> Manual
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Modo manual — también funciona con lector físico USB/Bluetooth */
          <div className="p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Ingresá el código manualmente o usá un lector físico.
            </p>
            <div className="flex gap-2">
              <input
                ref={manualRef}
                type="text"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitManual()}
                placeholder="Código de barras / QR"
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button onClick={submitManual}
                className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary">
                OK
              </button>
            </div>
            {!error && (
              <button onClick={() => setManualMode(false)}
                className="mt-3 text-xs text-accent hover:underline flex items-center gap-1">
                <Camera size={12} /> Volver a la cámara
              </button>
            )}
          </div>
        )}
      </div>

      {/* Animación laser — inyectada en el DOM una sola vez */}
      <style>{`
        @keyframes laserScan {
          0%   { top: 8px; opacity: 1; }
          48%  { top: calc(100% - 8px); opacity: 1; }
          50%  { opacity: 0.3; }
          52%  { top: calc(100% - 8px); opacity: 1; }
          100% { top: 8px; opacity: 1; }
        }
      `}</style>
    </div>
  )
}
