import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConfiguracionPage from '../ConfiguracionPage'

// Regresión: con las tablas nom_* vacías (o con la consulta fallando) la
// página mostraba un <select> sin opciones y NADA más — ni error ni aviso.
// Diagnosticar eso costó una sesión entera de debugging, así que el estado
// vacío y el error ahora son visibles y están cubiertos por estos tests.

let estadoAuth
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector(estadoAuth),
}))

// Los tabs traen sus propios stores; acá solo importa el chrome de la página
// (selector, aviso de vacío, error), así que se stubean todos. Los paths van
// literales porque vi.mock se hoistea y no admite rutas armadas en runtime.
vi.mock('../../components/config/TabEscalas', () => ({ default: () => <div>tab-escalas</div> }))
vi.mock('../../components/config/TabNoRemunerativos', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabAportes', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabAdicionales', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabConvenios', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabEmpresa', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabParametros', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabDocumentacion', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabAlertas', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabFlujo', () => ({ default: () => <div>tab</div> }))
vi.mock('../../components/config/TabBonos', () => ({ default: () => <div>tab</div> }))

let estadoConvenios
vi.mock('../../store/conveniosStore', () => ({
  useConveniosStore: () => estadoConvenios,
}))

// Task 4.2 (convenio por obra): ConfiguracionPage carga nom_v_obras para el
// selector de "Personalizar convenio → por obra". Se mockea vacío: no es
// lo que este archivo testea (el chrome de la página).
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}))

const base = {
  convenios: [],
  cargando: false,
  error: null,
  cargarConvenios: vi.fn(),
  clonarConvenio: vi.fn(),
}

beforeEach(() => {
  estadoConvenios = { ...base }
  estadoAuth = { empresa: { id: 'e1' }, empresaVista: null }
})

describe('ConfiguracionPage — convenios que no cargan', () => {
  it('muestra el mensaje de error cuando la consulta de convenios falla', () => {
    estadoConvenios = { ...base, error: 'JWT expired' }
    render(<ConfiguracionPage />)
    expect(screen.getByText(/JWT expired/)).toBeInTheDocument()
  })

  it('avisa que no hay convenios en vez de dejar un selector vacío', () => {
    estadoConvenios = { ...base, convenios: [] }
    render(<ConfiguracionPage />)
    expect(screen.getByText(/no hay convenios/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Convenio')).not.toBeInTheDocument()
  })

  it('no muestra el aviso mientras todavía está cargando', () => {
    estadoConvenios = { ...base, cargando: true }
    render(<ConfiguracionPage />)
    expect(screen.queryByText(/no hay convenios/i)).not.toBeInTheDocument()
  })

  it('con convenios cargados muestra el selector y ningún aviso', () => {
    estadoConvenios = {
      ...base,
      convenios: [{ id: 'c1', nombre: 'UOCRA (Ley 22.250)', empresaId: 'e1', regimen: 'ley_22250' }],
    }
    render(<ConfiguracionPage />)
    expect(screen.getByLabelText('Convenio')).toBeInTheDocument()
    expect(screen.queryByText(/no hay convenios/i)).not.toBeInTheDocument()
  })

  // Task 6.3 (plan 2026-08-11): al cambiar de empresa (Superadmin), el
  // convenioId de la empresa anterior quedaba set, convenios.find daba null y
  // las pestañas por convenio se veían en blanco. El efecto de preselección
  // ahora vuelve a correr y el <select> vuelve a tener valor.
  it('al cambiar de empresa re-preselecciona un convenio de la nueva empresa', () => {
    // Primera carga: empresa e1, convenio propio c1 → se preselecciona c1.
    estadoConvenios = {
      ...base,
      convenios: [{ id: 'c1', nombre: 'UOCRA', empresaId: 'e1', regimen: 'ley_22250' }],
    }
    render(<ConfiguracionPage />)
    expect(screen.getByLabelText('Convenio').value).toBe('c1')

    // El superadmin cambia a la empresa e2: los convenios cambian (c1 ya no
    // existe en la lista) y debe preseleccionarse el primero de e2 (c2).
    estadoAuth = { empresa: null, empresaVista: { id: 'e2' } }
    estadoConvenios = {
      ...base,
      convenios: [{ id: 'c2', nombre: 'UOCRA', empresaId: 'e2', regimen: 'ley_22250' }],
    }
    render(<ConfiguracionPage />)
    expect(screen.getByLabelText('Convenio').value).toBe('c2')
  })
})
