import { create } from 'zustand'

// Task 4.3: cola global de notificaciones efímeras (guardado, error de
// negocio, etc.), para reemplazar los `alert`/mensajes locales sueltos que
// había en cada página (UsuariosPage, TabEmpresa, ...). No usa `persist`:
// es puramente UI transitoria, no hace falta que sobreviva un refresh.
let nextId = 1

export const useToastStore = create((set, get) => ({
  toasts: [],

  push: (mensaje, tipo = 'info', duracionMs = 5000) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, mensaje, tipo }] }))
    setTimeout(() => get().remove(id), duracionMs)
    return id
  },

  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
