import { createClient } from '@supabase/supabase-js'

// Mismo proyecto Supabase que Presencio: la sesión de Auth se comparte entre
// ambas apps (mismo dominio de auth, mismo storageKey por defecto de
// supabase-js). Ver Recursio_Diseno.md 2.1.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Entorno y versión
export const appEnv = import.meta.env.VITE_APP_ENV || 'production'
export const isDev = appEnv === 'development'
