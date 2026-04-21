import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export type RecomendacionTipo = 'danger' | 'warning' | 'success' | 'info'
export type RecomendacionCategoria = 'stock' | 'ventas' | 'rentabilidad' | 'clientes' | 'datos' | 'operaciones'

export interface Recomendacion {
  id: string
  tipo: RecomendacionTipo
  categoria: RecomendacionCategoria
  titulo: string
  descripcion: string
  impacto: string           // "$X inmovilizados", "15% de margen", etc.
  accion: string
  link: string
  valor?: number            // para ordenar por impacto económico
}

export interface ScoreSalud {
  total: number             // 0–100
  rotacion: number          // 0–20
  rentabilidad: number      // 0–25
  reservas: number          // 0–20
  crecimiento: number       // 0–20
  datos: number             // 0–15
}

function fmt(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function useRecomendaciones() {
  const { tenant } = useAuthStore()

  const { data: raw, isLoading } = useQuery({
    queryKey: ['recomendaciones-raw', tenant?.id],
    queryFn: async () => {
      const hoy          = new Date()
      const inicioMes    = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
      const inicioMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString()
      const finMesAnt    = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59).toISOString()
      const hace30dias   = new Date(Date.now() - 30 * 86400000).toISOString()
      const hace3dias    = new Date(Date.now() - 3 * 86400000).toISOString()

      const hace90dias = new Date(Date.now() - 90 * 86400000).toISOString()

      const [
        productos,
        rebajesRecientes,
        ventasMes,
        ventasMesAnt,
        ventaItems30d,
        reservasViejas,
        clientesConCompras,
        ventas90d,
        empleadosMes,
      ] = await Promise.all([
        supabase.from('productos')
          .select('id, nombre, precio_venta, precio_costo, stock_actual, stock_minimo, activo')
          .eq('tenant_id', tenant!.id).eq('activo', true),

        supabase.from('movimientos_stock')
          .select('producto_id')
          .eq('tenant_id', tenant!.id).eq('tipo', 'rebaje')
          .gte('created_at', hace30dias),

        supabase.from('ventas')
          .select('total')
          .eq('tenant_id', tenant!.id)
          .in('estado', ['despachada', 'facturada'])
          .gte('created_at', inicioMes),

        supabase.from('ventas')
          .select('total')
          .eq('tenant_id', tenant!.id)
          .in('estado', ['despachada', 'facturada'])
          .gte('created_at', inicioMesAnt).lte('created_at', finMesAnt),

        supabase.from('venta_items')
          .select('producto_id, cantidad, precio_unitario, iva_monto, precio_costo_historico, productos(nombre)')
          .eq('tenant_id', tenant!.id)
          .gte('created_at', hace30dias),

        supabase.from('ventas')
          .select('id, cliente_nombre, created_at')
          .eq('tenant_id', tenant!.id)
          .eq('estado', 'reservada')
          .lte('created_at', hace3dias),

        supabase.from('ventas')
          .select('cliente_id, total, created_at, clientes(nombre)')
          .eq('tenant_id', tenant!.id)
          .in('estado', ['despachada', 'facturada'])
          .not('cliente_id', 'is', null)
          .gte('created_at', hace30dias),

        // Ventas 90d para análisis de día de semana
        supabase.from('ventas')
          .select('total, created_at')
          .eq('tenant_id', tenant!.id)
          .in('estado', ['despachada', 'facturada'])
          .gte('created_at', hace90dias),

        // Empleados con cumpleaños (solo activos con fecha de nacimiento)
        supabase.from('empleados')
          .select('id, nombre, apellido, fecha_nacimiento')
          .eq('tenant_id', tenant!.id)
          .eq('activo', true)
          .not('fecha_nacimiento', 'is', null),
      ])

      return {
        productos: productos.data ?? [],
        rebajesRecientes: rebajesRecientes.data ?? [],
        ventasMes: ventasMes.data ?? [],
        ventasMesAnt: ventasMesAnt.data ?? [],
        ventaItems30d: ventaItems30d.data ?? [],
        reservasViejas: reservasViejas.data ?? [],
        clientesConCompras: clientesConCompras.data ?? [],
        ventas90d: ventas90d.data ?? [],
        empleadosMes: empleadosMes.data ?? [],
      }
    },
    enabled: !!tenant,
    staleTime: 5 * 60 * 1000, // 5 min
  })

  const { recomendaciones, score } = useMemo(() => {
    if (!raw) return { recomendaciones: [] as Recomendacion[], score: null as ScoreSalud | null }

    const {
      productos, rebajesRecientes, ventasMes, ventasMesAnt,
      ventaItems30d, reservasViejas, clientesConCompras,
      ventas90d, empleadosMes,
    } = raw

    const vendidosSet    = new Set(rebajesRecientes.map((r: any) => r.producto_id))
    const totalVentasMes = ventasMes.reduce((a, v: any) => a + (v.total ?? 0), 0)
    const totalVentasAnt = ventasMesAnt.reduce((a, v: any) => a + (v.total ?? 0), 0)

    // ─── Reglas ───────────────────────────────────────────────────────────────

    const list: Recomendacion[] = []

    // 1. Stock muerto con capital inmovilizado
    const stockMuerto = productos.filter((p: any) => p.stock_actual > 0 && !vendidosSet.has(p.id))
    const valorStockMuerto = stockMuerto.reduce((a: number, p: any) => a + (p.precio_costo ?? 0) * p.stock_actual, 0)
    if (stockMuerto.length > 0) {
      list.push({
        id: 'stock-muerto',
        tipo: 'warning',
        categoria: 'stock',
        titulo: `${stockMuerto.length} producto${stockMuerto.length > 1 ? 's' : ''} sin movimiento en 30 días`,
        descripcion: `Estos productos tienen stock pero no se vendieron ni rebajaron en el último mes. Considerá hacer una oferta o liquidarlos.`,
        impacto: valorStockMuerto > 0 ? `${fmt(valorStockMuerto)} inmovilizados` : `${stockMuerto.length} productos parados`,
        accion: 'Ver inventario',
        link: '/inventario',
        valor: valorStockMuerto,
      })
    }

    // 2. Productos con margen bajo (<15%) — solo los que tienen precio de costo
    const prodConCosto = productos.filter((p: any) => p.precio_costo > 0 && p.precio_venta > 0)
    const prodMargenBajo = prodConCosto.filter((p: any) => {
      const margen = (p.precio_venta - p.precio_costo) / p.precio_venta * 100
      return margen < 15
    })
    if (prodMargenBajo.length > 0) {
      const ejemplo = (prodMargenBajo[0] as any).nombre
      list.push({
        id: 'margen-bajo',
        tipo: 'warning',
        categoria: 'rentabilidad',
        titulo: `${prodMargenBajo.length} producto${prodMargenBajo.length > 1 ? 's' : ''} con margen menor al 15%`,
        descripcion: `Estás vendiendo estos productos con muy poco margen. ${ejemplo}${prodMargenBajo.length > 1 ? ' y otros' : ''} — revisá el precio de venta o negociá mejor el costo.`,
        impacto: 'Rentabilidad en riesgo',
        accion: 'Ver rentabilidad',
        link: '/rentabilidad',
        valor: prodMargenBajo.length * 1000,
      })
    }

    // 3. Producto estrella del mes
    const rankingMes: Record<string, { nombre: string; cantidad: number; ingresos: number }> = {}
    for (const item of ventaItems30d as any[]) {
      const pid = item.producto_id
      if (!rankingMes[pid]) rankingMes[pid] = { nombre: item.productos?.nombre ?? '', cantidad: 0, ingresos: 0 }
      rankingMes[pid].cantidad += item.cantidad
      rankingMes[pid].ingresos += (item.precio_unitario ?? 0) * item.cantidad
    }
    const topProd = Object.values(rankingMes).sort((a, b) => b.ingresos - a.ingresos)[0]
    if (topProd && topProd.ingresos > 0) {
      list.push({
        id: 'estrella',
        tipo: 'success',
        categoria: 'ventas',
        titulo: `"${topProd.nombre}" es tu producto estrella`,
        descripcion: `Tu producto más rentable del último mes. Asegurate de tener siempre stock y considerá destacarlo en tu negocio.`,
        impacto: `${fmt(topProd.ingresos)} en ventas · ${topProd.cantidad} unidades`,
        accion: 'Ver métricas',
        link: '/metricas',
        valor: topProd.ingresos,
      })
    }

    // 4. Reservas sin despachar (+3 días)
    if (reservasViejas.length > 0) {
      list.push({
        id: 'reservas-viejas',
        tipo: 'danger',
        categoria: 'operaciones',
        titulo: `${reservasViejas.length} reserva${reservasViejas.length > 1 ? 's' : ''} sin despachar hace más de 3 días`,
        descripcion: `Tenés ventas reservadas que no se despacharon. Esto puede afectar la satisfacción del cliente y el stock reservado no está disponible para otras ventas.`,
        impacto: 'Atención al cliente en riesgo',
        accion: 'Ver ventas',
        link: '/ventas',
        valor: reservasViejas.length * 5000,
      })
    }

    // 5. Tendencia de ventas
    if (totalVentasAnt > 0) {
      const pct = (totalVentasMes - totalVentasAnt) / totalVentasAnt * 100
      const diff = Math.abs(totalVentasMes - totalVentasAnt)
      if (pct >= 15) {
        list.push({
          id: 'ventas-creciendo',
          tipo: 'success',
          categoria: 'ventas',
          titulo: `Las ventas crecieron ${pct.toFixed(0)}% vs el mes pasado`,
          descripcion: `Excelente momento. Aprovechá el impulso para reponer stock de los productos más vendidos y asegurarte de no quedar sin mercadería.`,
          impacto: `+${fmt(diff)} vs mes anterior`,
          accion: 'Ver métricas',
          link: '/metricas',
          valor: diff,
        })
      } else if (pct <= -15) {
        list.push({
          id: 'ventas-cayendo',
          tipo: 'danger',
          categoria: 'ventas',
          titulo: `Las ventas cayeron ${Math.abs(pct).toFixed(0)}% vs el mes pasado`,
          descripcion: `Tus ventas bajaron significativamente. Revisá si hay productos con stock crítico que no podés vender, o considerá promociones para reactivar.`,
          impacto: `-${fmt(diff)} vs mes anterior`,
          accion: 'Analizar métricas',
          link: '/metricas',
          valor: diff,
        })
      }
    } else if (totalVentasMes === 0) {
      list.push({
        id: 'sin-ventas',
        tipo: 'info',
        categoria: 'ventas',
        titulo: 'Sin ventas registradas este mes',
        descripcion: 'Todavía no hay ventas en Genesis360 este mes. Registrá tus ventas para empezar a ver tus métricas y recomendaciones.',
        impacto: 'Sin datos de ventas',
        accion: 'Nueva venta',
        link: '/ventas',
        valor: 0,
      })
    }

    // 6. Productos sin precio de costo (no podés ver rentabilidad)
    const sinCosto = productos.filter((p: any) => !p.precio_costo || p.precio_costo === 0)
    const pctSinCosto = productos.length > 0 ? sinCosto.length / productos.length * 100 : 0
    if (sinCosto.length > 0 && pctSinCosto > 30) {
      list.push({
        id: 'sin-costo',
        tipo: 'info',
        categoria: 'datos',
        titulo: `${sinCosto.length} productos sin precio de costo cargado`,
        descripcion: `Sin el precio de compra no podés saber cuánto ganás por cada venta. Cargá el costo en los productos para activar el módulo de Rentabilidad Real.`,
        impacto: `${pctSinCosto.toFixed(0)}% de tu catálogo sin datos`,
        accion: 'Ver productos',
        link: '/productos',
        valor: 0,
      })
    }

    // 7. Cliente frecuente sin compra reciente (últimos 30 días)
    const clienteMap: Record<string, { nombre: string; count: number; ultima: string }> = {}
    for (const v of clientesConCompras as any[]) {
      const cid = v.cliente_id
      if (!cid) continue
      if (!clienteMap[cid]) clienteMap[cid] = { nombre: v.clientes?.nombre ?? '', count: 0, ultima: '' }
      clienteMap[cid].count += 1
      if (!clienteMap[cid].ultima || v.created_at > clienteMap[cid].ultima)
        clienteMap[cid].ultima = v.created_at
    }
    // Clientes con >2 compras en 30d son frecuentes - si alguno no compró en 15 días, alertar
    // (Esto es básico - mejorar con historial completo en versiones futuras)
    const frecuentes = Object.values(clienteMap).filter(c => c.count >= 3)
    if (frecuentes.length > 0) {
      list.push({
        id: 'clientes-frecuentes',
        tipo: 'info',
        categoria: 'clientes',
        titulo: `${frecuentes.length} cliente${frecuentes.length > 1 ? 's' : ''} frecuente${frecuentes.length > 1 ? 's' : ''} este mes`,
        descripcion: `Tenés clientes que compran seguido. Conocerlos te permite anticipar pedidos y fidelizarlos con atención personalizada.`,
        impacto: `${frecuentes.length} cliente${frecuentes.length > 1 ? 's' : ''} con 3+ compras`,
        accion: 'Ver clientes',
        link: '/clientes',
        valor: 0,
      })
    }

    // 8. Cobertura crítica: stock que cubre < 3 días al ritmo actual
    const velocidadVenta: Record<string, number> = {}
    for (const item of ventaItems30d as any[]) {
      velocidadVenta[item.producto_id] = (velocidadVenta[item.producto_id] ?? 0) + item.cantidad
    }
    const coberturaUrgente = productos.filter((p: any) => {
      const vendido30d = velocidadVenta[p.id] ?? 0
      if (vendido30d === 0 || p.stock_actual <= 0) return false
      const diasCobertura = p.stock_actual / (vendido30d / 30)
      return diasCobertura < 3 && p.stock_actual > p.stock_minimo // ya en stock crítico los cubre regla distinta
    })
    if (coberturaUrgente.length > 0) {
      const ejemplo = (coberturaUrgente[0] as any).nombre
      list.push({
        id: 'cobertura-critica',
        tipo: 'danger',
        categoria: 'stock',
        titulo: `${coberturaUrgente.length} producto${coberturaUrgente.length > 1 ? 's' : ''} con menos de 3 días de stock`,
        descripcion: `${ejemplo}${coberturaUrgente.length > 1 ? ` y ${coberturaUrgente.length - 1} más tienen` : ' tiene'} stock para menos de 3 días al ritmo actual de ventas. Hacé un pedido urgente para evitar quiebres.`,
        impacto: `Quiebre de stock en menos de 72hs`,
        accion: 'Ver inventario',
        link: '/inventario',
        valor: coberturaUrgente.length * 8000,
      })
    }

    // 9. Margen realizado bajo (últimos 30 días) — markup sobre costo, usando neto sin IVA
    const itemsConCosto = (ventaItems30d as any[]).filter(i => i.precio_costo_historico > 0 && i.precio_unitario > 0)
    if (itemsConCosto.length > 0) {
      const totalFacturado = itemsConCosto.reduce((a, i) => a + i.precio_unitario * i.cantidad, 0)
      const totalIva       = itemsConCosto.reduce((a, i) => a + (i.iva_monto ?? 0), 0)
      const totalNeto      = totalFacturado - totalIva
      const totalCosto     = itemsConCosto.reduce((a, i) => a + i.precio_costo_historico * i.cantidad, 0)
      const margenRealizado = totalCosto > 0 ? (totalNeto - totalCosto) / totalCosto * 100 : null
      if (margenRealizado !== null && margenRealizado < 15) {
        list.push({
          id: 'margen-realizado-bajo',
          tipo: 'warning',
          categoria: 'rentabilidad',
          titulo: `Margen realizado del mes: ${margenRealizado.toFixed(1)}%`,
          descripcion: `El margen promedio de las ventas del último mes fue del ${margenRealizado.toFixed(1)}%. Un margen menor al 15% indica que los costos están consumiendo la mayoría del ingreso. Revisá los precios de compra o de venta.`,
          impacto: `${(15 - margenRealizado).toFixed(1)}pp por debajo del mínimo recomendado`,
          accion: 'Ver rentabilidad',
          link: '/rentabilidad',
          valor: totalCosto * 0.15,
        })
      }
    }

    // 10. Día de semana con ventas bajas (últimos 90 días)
    if (ventas90d.length >= 20) {
      const porDia: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
      for (const v of ventas90d as any[]) {
        const dow = new Date(v.created_at).getDay()
        porDia[dow].push(v.total ?? 0)
      }
      const promPorDia = Object.entries(porDia)
        .filter(([, totales]) => totales.length > 0)
        .map(([dow, totales]) => ({
          dow: Number(dow),
          prom: totales.reduce((a, t) => a + t, 0) / totales.length,
          semanas: totales.length,
        }))
      if (promPorDia.length > 1) {
        const promGeneral = promPorDia.reduce((a, d) => a + d.prom, 0) / promPorDia.length
        const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
        const diasFlojos = promPorDia.filter(d => d.prom < promGeneral * 0.5 && d.semanas >= 4)
        if (diasFlojos.length > 0) {
          const nombresDias = diasFlojos.map(d => DIAS[d.dow]).join(', ')
          list.push({
            id: 'dia-flojo',
            tipo: 'info',
            categoria: 'ventas',
            titulo: `${nombresDias}: día${diasFlojos.length > 1 ? 's' : ''} con ventas bajas`,
            descripcion: `${nombresDias} ${diasFlojos.length > 1 ? 'son consistentemente' : 'es consistentemente'} el día con menos ventas (menos de la mitad del promedio diario). Considerá una promoción del día para activar esas jornadas.`,
            impacto: `${Math.round((1 - diasFlojos[0].prom / promGeneral) * 100)}% menos que el promedio`,
            accion: 'Ver métricas',
            link: '/metricas',
            valor: 0,
          })
        }
      }
    }

    // 11. Cumpleaños de empleados este mes
    const mesActual = new Date().getMonth() + 1
    const cumpleanosMes = (empleadosMes as any[]).filter(e => {
      if (!e.fecha_nacimiento) return false
      const mes = new Date(e.fecha_nacimiento + 'T12:00:00').getMonth() + 1
      return mes === mesActual
    })
    if (cumpleanosMes.length > 0) {
      const nombres = cumpleanosMes
        .map((e: any) => [e.nombre, e.apellido].filter(Boolean).join(' '))
        .slice(0, 2)
        .join(' y ')
      const extra = cumpleanosMes.length > 2 ? ` y ${cumpleanosMes.length - 2} más` : ''
      list.push({
        id: 'cumpleanos-mes',
        tipo: 'info',
        categoria: 'operaciones',
        titulo: `${cumpleanosMes.length} empleado${cumpleanosMes.length > 1 ? 's' : ''} cumplen años este mes`,
        descripcion: `${nombres}${extra} ${cumpleanosMes.length > 1 ? 'cumplen' : 'cumple'} años este mes. Un pequeño gesto puede hacer la diferencia en el clima laboral.`,
        impacto: `${cumpleanosMes.length} cumpleaños en ${new Date().toLocaleString('es-AR', { month: 'long' })}`,
        accion: 'Ver RRHH',
        link: '/rrhh',
        valor: 0,
      })
    }

    // Ordenar: primero danger, luego warning, success, info — y por valor económico
    const orden = { danger: 0, warning: 1, success: 2, info: 3 }
    list.sort((a, b) => orden[a.tipo] - orden[b.tipo] || (b.valor ?? 0) - (a.valor ?? 0))

    // ─── Score de salud ───────────────────────────────────────────────────────

    // Dimensión 1 — Rotación (20 pts): % productos con movimiento en 30 días
    const pctRotacion = productos.length > 0 ? vendidosSet.size / productos.length : 0
    const scorRotacion = Math.round(Math.min(pctRotacion / 0.6, 1) * 20)

    // Dimensión 2 — Rentabilidad (25 pts): margen promedio
    let margenProm = 0
    if (prodConCosto.length > 0) {
      const totalMargen = prodConCosto.reduce((a: number, p: any) => {
        return a + (p.precio_venta - p.precio_costo) / p.precio_venta * 100
      }, 0)
      margenProm = totalMargen / prodConCosto.length
    }
    const scorRentabilidad = prodConCosto.length === 0
      ? 12 // sin datos = puntaje neutro
      : Math.round(Math.min(Math.max(margenProm - 10, 0) / 25, 1) * 25)

    // Dimensión 3 — Gestión de reservas (20 pts)
    const scorReservas = reservasViejas.length === 0 ? 20 : reservasViejas.length <= 2 ? 10 : 0

    // Dimensión 4 — Crecimiento (20 pts)
    let scorCrecimiento = 10 // neutro sin datos
    if (totalVentasAnt > 0) {
      const pctV = (totalVentasMes - totalVentasAnt) / totalVentasAnt * 100
      scorCrecimiento = pctV >= 10 ? 20 : pctV >= 0 ? 15 : pctV >= -10 ? 8 : 0
    }

    // Dimensión 5 — Calidad de datos (15 pts): % productos con precio_costo
    const pctConCosto = productos.length > 0 ? (productos.length - sinCosto.length) / productos.length : 0
    const scorDatos = Math.round(Math.min(pctConCosto / 0.8, 1) * 15)

    const score: ScoreSalud = {
      rotacion:     scorRotacion,
      rentabilidad: scorRentabilidad,
      reservas:     scorReservas,
      crecimiento:  scorCrecimiento,
      datos:        scorDatos,
      total:        scorRotacion + scorRentabilidad + scorReservas + scorCrecimiento + scorDatos,
    }

    return { recomendaciones: list, score }
  }, [raw])

  return { recomendaciones, score, isLoading }
}
