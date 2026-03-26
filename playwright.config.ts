import { defineConfig, devices } from '@playwright/test'
import path from 'path'

// Variables de entorno para los tests E2E
// Configurar en .env.test.local (no commitear) o en GitHub Actions secrets
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.results',
  // Los tests corren secuencialmente para evitar conflictos en la BD compartida de DEV
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'tests/e2e/.report', open: 'never' }]]
    : [['html', { outputFolder: 'tests/e2e/.report', open: 'on-failure' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Guarda la sesión autenticada entre tests del mismo archivo
    storageState: path.join(__dirname, 'tests/e2e/.auth/session.json'),
  },

  projects: [
    // Proyecto especial para autenticación (corre primero, genera session.json)
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: { storageState: undefined },
    },
    // Tests principales, dependen de la sesión creada en setup
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  // Levanta el servidor de dev si no está corriendo (solo local)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 30000,
      },
})
