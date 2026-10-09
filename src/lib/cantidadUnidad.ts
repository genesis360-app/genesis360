/** "1 unidad" / "5 unidades"; otras unidades (kg, m, caja) quedan como están. */
export function cantidadConUnidad(cantidad: number, um: string | null | undefined): string {
  const u = um || 'u'
  if (u === 'unidad') return `${cantidad} ${cantidad === 1 ? 'unidad' : 'unidades'}`
  return `${cantidad} ${u}`
}
