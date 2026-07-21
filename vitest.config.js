import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Env vars dummy para que los tests no dependan de un .env real ni de
// credenciales de Supabase (fuente de verdad: Recursio_Plan_Ejecucion_Sonnet5.md, Task 2).
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/setupTests.js'],
  },
})
