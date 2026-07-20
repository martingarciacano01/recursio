import { describe, it, expect } from 'vitest'
import { supabase } from '../supabase'

describe('supabase client', () => {
  it('se inicializa con auth disponible', () => {
    expect(supabase.auth).toBeDefined()
    expect(typeof supabase.from).toBe('function')
  })
})
