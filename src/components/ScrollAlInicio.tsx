// Al entrar a una página pública (landing, rubros, legales, login, alta) por un link, se arranca ARRIBA de todo.
// React Router no toca el scroll: sin esto, ir de la landing (scrolleada hasta el pie) a /terminos o /para/dieteticas
// abría la página nueva abajo de todo (reporte de GO 2026-10-07). Con "Atrás" (POP) no se toca: el navegador restaura
// donde estaba. Con #ancla tampoco: ese link quiere ir a una sección, no al principio.
import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { RUTAS_PRERENDER } from '@/lib/prerender'

const RUTAS_PUBLICAS = new Set([...RUTAS_PRERENDER, '/login', '/onboarding', '/restablecer-contrasena'])

export function debeIrArriba(pathname: string, hash: string, tipo: string): boolean {
  return tipo !== 'POP' && !hash && RUTAS_PUBLICAS.has(pathname)
}

export function ScrollAlInicio() {
  const { pathname, hash } = useLocation()
  const tipo = useNavigationType()
  const inicial = useRef(pathname)
  useEffect(() => {
    if (pathname === inicial.current) return // primera carga: el navegador ya arranca arriba (o restaura al recargar)
    inicial.current = pathname
    if (debeIrArriba(pathname, hash, tipo)) window.scrollTo(0, 0)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps -- solo al cambiar de página, no de #ancla
  return null
}
