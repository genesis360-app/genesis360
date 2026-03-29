import { useEffect, useRef, useState } from 'react'
import { X, Camera, CameraOff, SwitchCamera, Keyboard } from 'lucide-react'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
  title?: string
}

// BarcodeDetector no está en todos los typings de TS
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>
  constructor(options?: { formats: string[] })
  detect(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<{ rawValue: string; format: string }[]>
}

const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'qr_code', 'data_matrix', 'pdf417', 'aztec', 'itf']

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

// Aumenta contraste del frame — mejora lectura de líneas finas y QR en pantallas con glare
function boostContrast(imageData: ImageData) {
  const d = imageData.data
  const factor = 1.6 // factor de contraste: 1=sin cambio, 2=máximo
  const intercept = 128 * (1 - factor)
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, d[i]     * factor + intercept))
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] * factor + intercept))
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] * factor + intercept))
  }
}

// Carga zbar-wasm solo cuando hace falta (fallback para iOS/Safari/Firefox)
let zbarScanFn: ((data: ImageData) => Promise<{ typeName: string; decode(): string }[]>) | null = null
async function getZBarScan() {
  if (!zbarScanFn) {
    const mod = await import('@undecaf/zbar-wasm')
    zbarScanFn = mod.scanImageData
  }
  return zbarScanFn
}

export function BarcodeScanner({ onDetected, onClose, title = 'Escaneá un código' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const detectedRef = useRef(false)
  const useZBarRef = useRef(false)
  const processingRef = useRef(false)  // evita acumulación de llamadas async

  const [scanning, setScanning] = useState(false)
  const [detected, setDetected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraIdx, setCameraIdx] = useState(0)
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const manualRef = useRef<HTMLInputElement>(null)

  const handleDetected = (code: string) => {
    if (detectedRef.current) return
    detectedRef.current = true
    beep()
    try { navigator.vibrate(60) } catch {}
    setDetected(true)
    cancelAnimationFrame(rafRef.current)
    setTimeout(() => onDetected(code), 200)
  }

  const startScan = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(startScan)
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const tick = async () => {
      if (detectedRef.current) return
      // Si el frame anterior todavía se está procesando, saltear este tick
      if (processingRef.current) { rafRef.current = requestAnimationFrame(tick); return }

      processingRef.current = true
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      try {
        if (!useZBarRef.current && detectorRef.current) {
          // BarcodeDetector nativo (Chrome/Edge/Android)
          const results = await detectorRef.current.detect(video)
          if (results.length > 0) { processingRef.current = false; handleDetected(results[0].rawValue); return }
        } else {
          // zbar-wasm fallback (iOS/Safari/Firefox)
          const scan = await getZBarScan()
          // Aumentar contraste antes de pasar a ZBar — mejora lectura de códigos finos y pantallas
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          boostContrast(imageData)
          const results = await scan(imageData)
          if (results.length > 0) { processingRef.current = false; handleDetected(results[0].decode()); return }
        }
      } catch {}

      processingRef.current = false
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  const initCamera = async (deviceId?: string) => {
    // Detener stream anterior
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    cancelAnimationFrame(rafRef.current)
    detectedRef.current = false
    processingRef.current = false
    setDetected(false)
    setError(null)
    setScanning(false)

    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current!.play()
          setScanning(true)
          startScan()
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setError('Permiso de cámara denegado. Habilitalo en Ajustes del navegador.')
      } else {
        setError('No se pudo acceder a la cámara.')
      }
      setManualMode(true)
    }
  }

  useEffect(() => {
    // Detectar soporte BarcodeDetector o usar zbar-wasm
    const init = async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await BarcodeDetector.getSupportedFormats()
          const formats = SCAN_FORMATS.filter(f => supported.includes(f))
          detectorRef.current = new BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] })
          useZBarRef.current = false
        } catch {
          useZBarRef.current = true
        }
      } else {
        useZBarRef.current = true
        // Pre-cargar zbar-wasm en background para que esté listo
        getZBarScan().catch(() => {})
      }

      // Enumerar cámaras
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = devices.filter(d => d.kind === 'videoinput')
        setCameras(videoDevices)
        const backIdx = videoDevices.findIndex(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('trasera') ||
          d.label.toLowerCase().includes('environment')
        )
        const idx = backIdx >= 0 ? backIdx : 0
        setCameraIdx(idx)
        await initCamera(videoDevices[idx]?.deviceId)
      } catch {
        await initCamera()
      }
    }

    init()

    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  useEffect(() => {
    if (manualMode) setTimeout(() => manualRef.current?.focus(), 50)
  }, [manualMode])

  const switchCamera = async () => {
    const next = (cameraIdx + 1) % cameras.length
    setCameraIdx(next)
    await initCamera(cameras[next]?.deviceId)
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
            {/* Visor de cámara */}
            <div className="relative bg-black" style={{ aspectRatio: '1/1' }}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                muted
                playsInline  // iOS: evita modo fullscreen
              />
              {/* Canvas oculto para captura de frames */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Flash verde al detectar */}
              {detected && (
                <div className="absolute inset-0 bg-green-500/40 flex items-center justify-center">
                  <div className="bg-green-500 rounded-full p-4 shadow-lg">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Marco + laser — solo mientras escanea */}
              {scanning && !detected && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="relative" style={{ width: 260, height: 260 }}>
                    {/* Esquinas del marco */}
                    <div className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-violet-400 rounded-tl-sm" />
                    <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-violet-400 rounded-tr-sm" />
                    <div className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-violet-400 rounded-bl-sm" />
                    <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-violet-400 rounded-br-sm" />
                    {/* Línea laser */}
                    <div
                      className="absolute left-3 right-3 h-0.5 bg-violet-400 shadow-[0_0_8px_2px_rgba(167,139,250,0.7)]"
                      style={{ animation: 'laserScan 2s ease-in-out infinite' }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-5 text-center">
                  <CameraOff size={36} className="text-white/50 mb-3" />
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
          /* Modo manual — funciona también con lector físico USB/Bluetooth */
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
              <button onClick={() => { setManualMode(false); initCamera(cameras[cameraIdx]?.deviceId) }}
                className="mt-3 text-xs text-accent hover:underline flex items-center gap-1">
                <Camera size={12} /> Volver a la cámara
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes laserScan {
          0%   { top: 6px;  opacity: 1; }
          49%  { top: calc(100% - 6px); opacity: 1; }
          50%  { opacity: 0.2; }
          51%  { top: calc(100% - 6px); opacity: 1; }
          100% { top: 6px;  opacity: 1; }
        }
      `}</style>
    </div>
  )
}
