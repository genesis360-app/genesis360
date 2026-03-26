// Setup global para Vitest — mocks globales necesarios antes de cada test

// Mock de variables de entorno que normalmente vienen de Vite
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    VITE_MP_PUBLIC_KEY: 'TEST_MP_KEY',
    VITE_APP_URL: 'http://localhost:5173',
    MODE: 'test',
    DEV: false,
    PROD: false,
  },
  writable: true,
})
