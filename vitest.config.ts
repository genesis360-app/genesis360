import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    // Sin paralelismo de archivos: correr los 43 archivos en paralelo levanta un
    // entorno jsdom por worker y agota la RAM, matando los workers con un error
    // genérico ("Cannot read properties of undefined (reading 'config')") — falla
    // toda la suite aunque los tests estén bien. Secuencial es ~90s pero 100% estable.
    // (Verificado 2026-06-11: parallel=rojo, fileParallelism:false=625 verdes.)
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/hooks/**', 'src/lib/**', 'src/config/**'],
      exclude: ['src/lib/supabase.ts'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
