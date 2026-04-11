/**
 * Calcula el siguiente SKU secuencial a partir de una lista de SKUs existentes.
 * Formato: SKU-XXXXX (5 dígitos, zero-padded).
 * Solo considera SKUs que sigan el patrón SKU-\d+.
 */
export function calcularSiguienteSKU(skusExistentes: string[]): string {
  const maxNum = skusExistentes.reduce((max, sku) => {
    const match = sku.match(/^SKU-(\d+)$/)
    if (!match) return max
    const n = parseInt(match[1], 10)
    return isNaN(n) ? max : Math.max(max, n)
  }, 0)
  return `SKU-${String(maxNum + 1).padStart(5, '0')}`
}
