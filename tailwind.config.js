/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Tokens de marca (existentes — NO cambiar nombres) ──────────────
        primary:    'rgb(var(--color-primary) / <alpha-value>)',
        accent:     'rgb(var(--color-accent) / <alpha-value>)',
        'brand-bg': 'rgb(var(--color-brand-bg) / <alpha-value>)',

        // ── Design System Sprint 1 — nuevos tokens semánticos ─────────────
        // Fondos adaptativos (light/dark via CSS var)
        page:       'rgb(var(--ds-page) / <alpha-value>)',
        surface:    'rgb(var(--ds-surface) / <alpha-value>)',
        muted:      'rgb(var(--ds-muted) / <alpha-value>)',

        // Bordes adaptativos
        'border-ds': 'rgb(var(--ds-border) / <alpha-value>)',

        // Semánticos — igual en light y dark
        success:  'rgb(var(--ds-success) / <alpha-value>)',
        danger:   'rgb(var(--ds-danger) / <alpha-value>)',
        warning:  'rgb(var(--ds-warning) / <alpha-value>)',
        info:     'rgb(var(--ds-info) / <alpha-value>)',
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
