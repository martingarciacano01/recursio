import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLegajoStore } from '../../store/legajoStore'
import { filtrarConveniosVisibles, categoriasVigentes } from '../../utils/convenios'

// Formulario de edición de "Datos y estado" del legajo — no existía UI
// para completar CUIL/CBU/convenio/categoría (Fase 1 solo construyó la
// vista de lectura), y sin esos 4 datos la Edge Function liquidar-periodo
// salta a la persona por "legajo incompleto" (Task 17).
export default function EditorDatosLegajo({ legajo, personalId, empresaId }) {
  const guardarLegajo = useLegajoStore((s) => s.guardarLegajo)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // `todosConvenios`/`todasCategorias`: listas SIN filtrar, para resolver el
  // nombre en la vista de solo lectura (el legajo puede apuntar a un id que
  // el filtro de visibilidad oculta, ej. el global cuando ya existe un clon,
  // o una versión de categoría vieja). `convenios`/`categorias`: listas
  // filtradas, solo para los <select> de edición.
  const [todosConvenios, setTodosConvenios] = useState([])
  const [todasCategorias, setTodasCategorias] = useState([])

  const [form, setForm] = useState({
    cuil: legajo?.cuil || '',
    cbu: legajo?.cbu || '',
    banco: legajo?.banco || '',
    obraSocial: legajo?.obraSocial || '',
    jornada: legajo?.jornada || 'completa',
    convenioId: legajo?.convenioId || '',
    categoriaId: legajo?.categoriaId || '',
    fueraConvenio: legajo?.fueraConvenio || false,
    sueldoConvenido: legajo?.sueldoConvenido || '',
  })

  useEffect(() => {
    // Se carga siempre (no solo al editar): la vista de solo lectura
    // también necesita el nombre del convenio para no mostrar el UUID
    // crudo (bug reportado: "Categoría" resolvía bien porque `categorias`
    // se recalculaba a partir de form.convenioId en el mount, pero
    // `convenios` solo se pedía al entrar en modo edición).
    // Convenios visibles: plantillas globales (empresa_id NULL) + los
    // propios de la empresa (RLS ya filtra, ver 0002_nomina_core.sql). El
    // clon de la empresa pisa al global homónimo en el <select>
    // (filtrarConveniosVisibles); esta lista sin filtrar solo se usa para
    // resolver el nombre en la vista de solo lectura.
    supabase.from('nom_convenios').select('id, nombre, empresa_id').order('nombre')
      .then(({ data }) => setTodosConvenios(data || []))
  }, [])

  useEffect(() => {
    if (!form.convenioId) { setTodasCategorias([]); return }
    supabase.from('nom_categorias').select('id, nombre, vigencia_desde').eq('convenio_id', form.convenioId).order('nombre')
      .then(({ data }) => setTodasCategorias(data || []))
  }, [form.convenioId])

  const convenios = filtrarConveniosVisibles(todosConvenios)
  const categorias = categoriasVigentes(todasCategorias)

  const handleGuardar = async () => {
    setError('')
    setGuardando(true)
    const r = await guardarLegajo(
      { id: legajo?.id, personalId, ...form },
      empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setEditando(false)
  }

  if (!editando) {
    return (
      <div>
        <p>CUIL: {legajo?.cuil || '—'}</p>
        <p>CBU: {legajo?.cbu || '—'}</p>
        <p>Banco: {legajo?.banco || '—'}</p>
        <p>Obra social: {legajo?.obraSocial || '—'}</p>
        <p>Jornada: {legajo?.jornada || '—'}</p>
        <p>Convenio: {todosConvenios.find((c) => c.id === legajo?.convenioId)?.nombre || (legajo?.convenioId ? legajo.convenioId : '—')}</p>
        <p>Categoría: {todasCategorias.find((c) => c.id === legajo?.categoriaId)?.nombre || (legajo?.categoriaId ? legajo.categoriaId : '—')}</p>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setEditando(true)}>Editar</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>CUIL</label>
        <input className="input" value={form.cuil} onChange={(e) => setForm((f) => ({ ...f, cuil: e.target.value }))} placeholder="20-12345678-9" />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>CBU</label>
        <input className="input" value={form.cbu} onChange={(e) => setForm((f) => ({ ...f, cbu: e.target.value }))} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Banco</label>
        <input className="input" value={form.banco} onChange={(e) => setForm((f) => ({ ...f, banco: e.target.value }))} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Obra social</label>
        <input className="input" value={form.obraSocial} onChange={(e) => setForm((f) => ({ ...f, obraSocial: e.target.value }))} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Jornada</label>
        {/* nom_legajo.jornada tiene un CHECK que solo acepta estos dos
            valores exactos en minúscula (0002_nomina_core.sql) — un input
            de texto libre como "Completa" rompía el guardado. */}
        <select className="input" value={form.jornada} onChange={(e) => setForm((f) => ({ ...f, jornada: e.target.value }))}>
          <option value="completa">Completa</option>
          <option value="parcial">Parcial</option>
        </select>
      </div>
      <div>
        <label htmlFor="fuera-convenio-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
          <input
            id="fuera-convenio-checkbox"
            type="checkbox"
            checked={form.fueraConvenio}
            onChange={(e) => {
              const fueraConvenio = e.target.checked
              setForm((f) => ({
                ...f,
                fueraConvenio,
                ...(fueraConvenio ? { convenioId: '', categoriaId: '' } : {}),
              }))
            }}
          />
          Fuera de convenio
        </label>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Convenio</label>
        <select
          className="input"
          aria-label="Convenio"
          value={form.convenioId}
          onChange={(e) => setForm((f) => ({ ...f, convenioId: e.target.value, categoriaId: '' }))}
          disabled={form.fueraConvenio}
        >
          <option value="">Elegir convenio…</option>
          {convenios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Categoría</label>
        <select
          className="input"
          aria-label="Categoría"
          value={form.categoriaId}
          onChange={(e) => setForm((f) => ({ ...f, categoriaId: e.target.value }))}
          disabled={form.fueraConvenio || !form.convenioId}
        >
          <option value="">Elegir categoría…</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      {form.fueraConvenio && (
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Sueldo convenido mensual</label>
          <input
            className="input"
            type="number"
            placeholder="Sueldo convenido mensual"
            value={form.sueldoConvenido}
            onChange={(e) => setForm((f) => ({ ...f, sueldoConvenido: e.target.value }))}
          />
        </div>
      )}

      {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}
