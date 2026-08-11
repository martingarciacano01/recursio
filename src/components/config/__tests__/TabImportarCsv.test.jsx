import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabImportarCsv from '../TabImportarCsv'

const importarVigenciasMock = vi.fn()
const pushMock = vi.fn()

vi.mock('../../../store/conveniosStore', () => ({
  useConveniosStore: () => ({ importarVigencias: importarVigenciasMock }),
}))

vi.mock('../../../store/toastStore', () => ({
  useToastStore: (sel) => sel({ push: pushMock }),
}))

// Base vacía: nada existe todavía.
const selectExistentes = vi.fn().mockResolvedValue({ data: [], error: null })
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => selectExistentes() }) }) },
}))

describe('TabImportarCsv', () => {
  beforeEach(() => {
    importarVigenciasMock.mockReset().mockResolvedValue({ ok: true, insertados: 2, omitidos: 0 })
    pushMock.mockClear()
    selectExistentes.mockClear().mockResolvedValue({ data: [], error: null })
  })

  it('sin texto no ofrece importar', () => {
    render(<TabImportarCsv convenioId="c1" />)
    expect(screen.queryByRole('button', { name: /Importar/ })).not.toBeInTheDocument()
  })

  it('parsea el texto pegado y muestra filas nuevas antes de importar', async () => {
    render(<TabImportarCsv convenioId="c1" />)
    fireEvent.change(screen.getByLabelText('…o pegá el contenido acá'), {
      target: { value: 'concepto;nombre;valor;modalidad;vigencia_desde\nbasico;Operario;1284,50;hora;2026-08-01' },
    })
    await waitFor(() => {
      expect(screen.getByText('Operario')).toBeInTheDocument()
      expect(screen.getByText('nuevo')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Importar 1 fila\(s\)/ }))
    await waitFor(() => {
      expect(importarVigenciasMock).toHaveBeenCalledWith('c1', [expect.objectContaining({ nombre: 'Operario', valor: 1284.5 })])
    })
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('2 filas nuevas'), 'success')
  })

  it('fila con error se descarta y no se cuenta', async () => {
    render(<TabImportarCsv convenioId="c1" />)
    fireEvent.change(screen.getByLabelText('…o pegá el contenido acá'), {
      target: { value: 'concepto;nombre;valor;vigencia_desde\nbasico;Operario;muy caro;2026-08-01' },
    })
    await waitFor(() => {
      expect(screen.getByText(/Se descartaron 1 fila\(s\) con errores/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Importar/ })).not.toBeInTheDocument()
  })

  it('sin convenio no importa aunque haya filas', () => {
    render(<TabImportarCsv convenioId={null} />)
    fireEvent.change(screen.getByLabelText('…o pegá el contenido acá'), {
      target: { value: 'concepto;nombre;valor;vigencia_desde\nbasico;Operario;1000;2026-08-01' },
    })
    expect(screen.getByText('Seleccioná un convenio para importar.')).toBeInTheDocument()
  })
})