import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLegajoStore } from '../../store/legajoStore'
import { filtrarConveniosVisibles, categoriasVigentes } from '../../utils/convenios'

// Formulario de edición de "Datos y estado" del legajo — no existía UI
// para completar CUIL/CBU/convenio/categoría (Fase 1 solo construyó la
// vista de lectura), y sin esos 4 datos la Edge Function liquidar-periodo
// salta a la persona por "legajo incompleto" (Task 17).
// `iniciarEditando`: el asistente de alta (AsistenteAlta.jsx) muestra este
// mismo editor, pero ahí no tiene sentido arrancar en modo lectura con un
// botón "Editar" de por medio.
export default function EditorDatosLegajo({ legajo, personalId, empresaId, iniciarEditando = false }) {
  const guardarLegajo = useLegajoStore((s) => s.guardarLegajo)
  const [editando, setEditando] = useState(iniciarEditando)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // `todosConvenios`/`todasCategorias`: listas SIN filtrar, para resolver el
  // nombre en la vista de solo lectura (el legajo puede apuntar a un id que
  // el filtro de visibilidad oculta, ej. el global cuando ya existe un clon,
  // o una versión de categoría vieja). `convenios`/`categorias`: listas
  // filtradas, solo para los <select> de edición.
  const [todosConvenios, setTodosConvenios] = useState([])
  const [todasCategorias, setTodasCategorias] = useState([])
  const [cargandoConvenios, setCargandoConvenios] = useState(true)
  const [cargandoCategorias, setCargandoCategorias] = useState(false)

  const [form, setForm] = useState({
    cuil: legajo?.cuil || '',
    cbu: legajo?.cbu || '',
    banco: legajo?.banco || '',
    obraSocial: legajo?.obraSocial || '',
    jornada: legajo?.jornada || 'completa',
    fechaIngreso: legajo?.fechaIngreso || '',
    convenioId: legajo?.convenioId || '',
    categoriaId: legajo?.categoriaId || '',
    fueraConvenio: legajo?.fueraConvenio || false,
    sueldoConvenido: legajo?.sueldoConvenido || '',
    localidad: legajo?.localidad || '',
    provincia: legajo?.provincia || '',
    codigoPostal: legajo?.codigoPostal || '',
  })

  // `form` se inicializa en el primer render, cuando `legajo` todavía es
  // null (FichaLegajoPage lo resuelve contra `legajos`, que carga async).
  // Sin este resync, form.convenioId quedaba '' para siempre y el effect
  // de categorías nunca se disparaba: la vista de solo lectura imprimía
  // el UUID crudo de la categoría en vez de su nombre (bug del 28/07/2026).
  // No se resincroniza mientras `editando` es true para no pisar lo que el
  // usuario está tipeando si otra carga refresca el legajo.
  useEffect(() => {
    if (!legajo || editando) return
    setForm({
      cuil: legajo.cuil || '',
      cbu: legajo.cbu || '',
      banco: legajo.banco || '',
      obraSocial: legajo.obraSocial || '',
      jornada: legajo.jornada || 'completa',
      fechaIngreso: legajo.fechaIngreso || '',
      convenioId: legajo.convenioId || '',
      categoriaId: legajo.categoriaId || '',
      fueraConvenio: legajo.fueraConvenio || false,
      sueldoConvenido: legajo.sueldoConvenido || '',
      localidad: legajo.localidad || '',
      provincia: legajo.provincia || '',
      codigoPostal: legajo.codigoPostal || '',
    })
  }, [legajo?.id, legajo?.convenioId, legajo?.categoriaId, legajo?.fueraConvenio, legajo?.sueldoConvenido, editando])

  const [dandoBaja, setDandoBaja] = useState(false)
  const [fechaBaja, setFechaBaja] = useState('')
  const [motivoBaja, setMotivoBaja] = useState('')
  const [guardandoBaja, setGuardandoBaja] = useState(false)
  const [errorBaja, setErrorBaja] = useState('')

  const handleConfirmarBaja = async () => {
    setErrorBaja('')
    setGuardandoBaja(true)
    const r = await guardarLegajo({ id: legajo?.id, personalId, fechaBaja, motivoBaja }, empresaId)
    setGuardandoBaja(false)
    if (!r.ok) { setErrorBaja(r.error); return }
    setDandoBaja(false)
  }

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
    setCargandoConvenios(true)
    supabase.from('nom_convenios').select('id, nombre, empresa_id').order('nombre')
      .then(({ data }) => { setTodosConvenios(data || []); setCargandoConvenios(false) })
  }, [])

  // Se prueba primero el convenio del formulario y, si está vacío (primer
  // render, antes de que llegue el legajo), el del legajo — así la vista de
  // solo lectura resuelve el nombre de la categoría sin depender del resync.
  const convenioParaCategorias = form.convenioId || legajo?.convenioId || ''
  useEffect(() => {
    if (!convenioParaCategorias) { setTodasCategorias([]); setCargandoCategorias(false); return }
    setCargandoCategorias(true)
    supabase.from('nom_categorias').select('id, nombre, vigencia_desde').eq('convenio_id', convenioParaCategorias).order('nombre')
      .then(({ data }) => { setTodasCategorias(data || []); setCargandoCategorias(false) })
  }, [convenioParaCategorias])

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
        <p>Fecha de ingreso: {legajo?.fechaIngreso || '—'}</p>
        {legajo?.fueraConvenio ? (
          <>
            <p>Convenio: Fuera de convenio</p>
            <p>Sueldo convenido: {legajo?.sueldoConvenido != null
              ? `$ ${Number(legajo.sueldoConvenido).toLocaleString('es-AR')}`
              : '— (falta cargarlo: la liquidación va a saltear a esta persona)'}</p>
          </>
        ) : (
          <>
            <p>Convenio: {cargandoConvenios ? 'Cargando…' : (todosConvenios.find((c) => c.id === legajo?.convenioId)?.nombre || (legajo?.convenioId ? 'Convenio no encontrado' : '—'))}</p>
            <p>Categoría: {(legajo?.convenioId && cargandoCategorias) ? 'Cargando…' : (todasCategorias.find((c) => c.id === legajo?.categoriaId)?.nombre || (legajo?.categoriaId ? 'Categoría no encontrada' : '—'))}</p>
          </>
        )}
        <p>Localidad: {legajo?.localidad || '—'}</p>
        <p>Provincia: {legajo?.provincia || '—'}</p>
        <p>Código postal: {legajo?.codigoPostal || '—'}</p>
        {legajo?.fechaBaja && <p>Baja: {legajo.fechaBaja} ({legajo.motivoBaja})</p>}
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
        <label htmlFor="fecha-ingreso-input" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de ingreso</label>
        <input
          id="fecha-ingreso-input"
          aria-label="Fecha de ingreso"
          className="input"
          type="date"
          value={form.fechaIngreso}
          onChange={(e) => setForm((f) => ({ ...f, fechaIngreso: e.target.value }))}
        />
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
                ...(fueraConvenio ? { convenioId: '', categoriaId: '' } : { sueldoConvenido: '' }),
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
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Localidad</label>
        <input className="input" value={form.localidad} onChange={(e) => setForm((f) => ({ ...f, localidad: e.target.value }))} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Provincia</label>
        <input className="input" value={form.provincia} onChange={(e) => setForm((f) => ({ ...f, provincia: e.target.value }))} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Código postal</label>
        <input className="input" value={form.codigoPostal} onChange={(e) => setForm((f) => ({ ...f, codigoPostal: e.target.value }))} />
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        {legajo?.fechaBaja ? (
          <p>Baja: {legajo.fechaBaja} ({legajo.motivoBaja})</p>
        ) : dandoBaja ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label htmlFor="fecha-baja-input" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de baja</label>
              <input id="fecha-baja-input" aria-label="Fecha de baja" className="input" type="date" value={fechaBaja} onChange={(e) => setFechaBaja(e.target.value)} />
            </div>
            <div>
              <label htmlFor="motivo-baja-select" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Motivo de baja</label>
              <select id="motivo-baja-select" aria-label="Motivo de baja" className="input" value={motivoBaja} onChange={(e) => setMotivoBaja(e.target.value)}>
                <option value="">Elegir motivo…</option>
                <option value="renuncia">Renuncia</option>
                <option value="despido_sin_causa">Despido sin causa</option>
                <option value="despido_con_causa">Despido con causa</option>
                <option value="fin_obra">Fin de obra</option>
                <option value="mutuo_acuerdo">Mutuo acuerdo</option>
                <option value="fallecimiento">Fallecimiento</option>
              </select>
            </div>
            {errorBaja && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorBaja}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmarBaja} disabled={guardandoBaja || !fechaBaja || !motivoBaja}>
                {guardandoBaja ? 'Guardando…' : 'Confirmar baja'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDandoBaja(false)} disabled={guardandoBaja}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setDandoBaja(true)}>Dar de baja</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}
