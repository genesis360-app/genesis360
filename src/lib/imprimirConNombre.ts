/**
 * `window.print()` con nombre de archivo. "Imprimir → Guardar como PDF" (iPhone, Chrome) nombra el archivo con el
 * TÍTULO de la página → sin esto todo salía "Genesis360.pdf". Se pone un nombre relacionado con el documento y se
 * restaura el título al terminar (en iOS `print()` no bloquea: se restaura con `afterprint` o, si no llega, al minuto).
 */
export function imprimirConNombre(nombre: string): void {
  const tituloPrevio = document.title
  document.title = nombre.replace(/\.pdf$/i, '')
  let restaurado = false
  const restaurar = () => { if (!restaurado) { restaurado = true; document.title = tituloPrevio } }
  window.addEventListener('afterprint', restaurar, { once: true })
  setTimeout(restaurar, 60_000)
  window.print()
}
