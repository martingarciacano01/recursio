import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { agruparAusencias, contarFaltasSinFichaje } from '../../utils/agruparAusencias'
import { construirDiasPeriodo } from '../../../packages/motor/src/asistencia.ts'

// Pestaña de solo lectura: nom_v_ausencias es una vista de Presencio, no
// editable desde acá.
//
// "Justificadas": licencias cargadas en `ausencias` con estado 'aprobada'
// (vacaciones/enfermedad/etc.) — coincide con "DÍAS DE LICENCIA/VACACIONES"
// en el reporte de Presencio.
//
// "Injustificadas": NO se calcula desde `ausencias` (esa tabla casi nunca
// tiene filas — una falta sin aviso nunca se carga ahí como licencia).
// Se calcula igual que Presencio calcula "FALTAS NO JUSTIFICADAS" en su
// pantalla de Reportes: días laborables del año sin ningún fichaje y sin
// una licencia que los cubra (misma regla que ya usa calcularAsistencia
// para descontar del sueldo — packages/motor/src/asistencia.ts). Antes esta
// pestaña usaba la tabla `ausencias` para las dos columnas y el número de
// Injustificadas nunca coincidía con el de Presencio (reportado por Martin,
// 2026-07-30: "fijate que no dan lo mismo").
//
// El rango de Presencio en su pantalla de Reportes es el que el usuario
// elija a mano (ej. 01/06 al 30/07); acá se usa el año calendario completo
// (1/1 al 31/12, o a hoy si es el año en curso) porque es lo que ya define
// el selector "Año" de esta pestaña — comparar contra un rango custom de
// Presencio puede no dar el mismo número exacto, pero el criterio es el
// mismo.
//
// `ausencias` llega ya cargada desde FichaLegajoPage (que la necesita también
// para generarLegajoPdf): evita refetch duplicado de esa consulta (revisión
// de calidad post 22e1016). `personalId` sí lo pide esta pestaña puntual,
// para traer los fichajes del año elegido.
export default function TabAusencias({ ausencias, personalId, legajo }) {
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [mes, setMes] = useState(0) // 0 = todo el año
  const [fichajes, setFichajes] = useState([])
  const [errorFichajes, setErrorFichajes] = useState('')

  const finDeMes = (a, m) => new Date(a, m, 0).getDate() // día 0 del mes siguiente = último día del mes
  const fechaDesde = mes
    ? `${anio}-${String(mes).padStart(2, '0')}-01`
    : `${anio}-01-01`
  const fechaHasta = mes
    ? `${anio}-${String(mes).padStart(2, '0')}-${String(finDeMes(anio, mes)).padStart(2, '0')}`
    : (anio === new Date().getFullYear() ? new Date().toISOString().slice(0, 10) : `${anio}-12-31`)

  useEffect(() => {
    let cancelado = false
    setErrorFichajes('')
    supabase.from('nom_v_horas_dia').select('tipo, timestamp')
      .eq('personal_id', personalId)
      .gte('timestamp', fechaDesde).lte('timestamp', fechaHasta)
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) setErrorFichajes(error.message)
        setFichajes(data || [])
      })
    return () => { cancelado = true }
  }, [personalId, fechaDesde, fechaHasta])

  const ausenciasEnRango = useMemo(
    () => ausencias.filter((a) => a.fecha_desde <= fechaHasta && a.fecha_hasta >= fechaDesde),
    [ausencias, fechaDesde, fechaHasta]
  )

  const { totalDiasJustificadas } = useMemo(
    () => agruparAusencias(ausenciasEnRango, anio),
    [ausenciasEnRango, anio]
  )

  const totalDiasInjustificadas = useMemo(() => {
    const dias = construirDiasPeriodo(fichajes, ausenciasEnRango, fechaDesde, fechaHasta, { fechaIngreso: legajo?.fechaIngreso, fechaBaja: legajo?.fechaBaja })
    return contarFaltasSinFichaje(dias)
  }, [fichajes, ausenciasEnRango, fechaDesde, fechaHasta, legajo?.fechaIngreso, legajo?.fechaBaja])

  const anios = useMemo(() => {
    const set = new Set(ausencias.map((a) => Number(a.fecha_desde.slice(0, 4))))
    set.add(new Date().getFullYear())
    return Array.from(set).sort((a, b) => b - a)
  }, [ausencias])

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Ausencias</h3>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Año</label>
          <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ maxWidth: 160 }}>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mes-ausencias-select" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Mes</label>
          <select id="mes-ausencias-select" aria-label="Mes" className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ maxWidth: 160 }}>
            <option value={0}>Todo el año</option>
            {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
              .map((nombre, i) => <option key={i + 1} value={i + 1}>{nombre}</option>)}
          </select>
        </div>
      </div>

      {errorFichajes && <p style={{ color: 'var(--danger)' }}>Error al cargar fichajes: {errorFichajes}</p>}

      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <h3 style={{ margin: 0 }}>Justificadas</h3>
          <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{totalDiasJustificadas}</p>
        </div>
        <div>
          <h3 style={{ margin: 0 }}>Injustificadas</h3>
          <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{totalDiasInjustificadas}</p>
        </div>
      </div>

      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        Para más información, revisar el detalle en Presencio.
      </p>
    </div>
  )
}
