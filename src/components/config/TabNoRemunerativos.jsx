import { useEffect } from 'react'
import { useNoRemunerativosStore } from '../../store/noRemunerativosStore'
import { agruparVigencias } from '../../store/escalasStore'
import TablaVigencias from './TablaVigencias'
import { descargarPlantillaVigencias } from '../../utils/descargarPlantillaVigencias'

export default function TabNoRemunerativos({ convenio, soloLectura }) {
  const { noRemunerativos, cargando, error, cargarNoRemunerativos, guardarVigencias } = useNoRemunerativosStore()

  useEffect(() => { if (convenio?.id) cargarNoRemunerativos(convenio.id) }, [convenio?.id])

  if (!convenio) return null
  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const hoy = new Date().toISOString().slice(0, 10)
  return (
    <div className="card">
      <p style={{ color: 'var(--text-secondary)' }}>
        Sumas no remunerativas por categoría (acuerdos/paritarias). El valor del período es el vigente a su fecha de cierre.
      </p>
      <TablaVigencias
        items={agruparVigencias(noRemunerativos, hoy)}
        etiquetaValor="Monto no rem."
        soloLectura={soloLectura}
        // Task 6.9: estado vacío visible (antes quedaba solo el encabezado)
        // + CTA descargar plantilla CSV.
        mensajeVacio="Sin no remunerativos para este convenio todavía. Agregalos desde “Nueva vigencia” o importalos en lote desde la pestaña “Importar CSV”."
        onDescargarPlantilla={() => descargarPlantillaVigencias(convenio.id)}
        onGuardar={async (filas, fecha) => {
          const r = await guardarVigencias(convenio.id, filas, fecha)
          if (r.ok) await cargarNoRemunerativos(convenio.id)
          return r
        }}
      />
    </div>
  )
}
