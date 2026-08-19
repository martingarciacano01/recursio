// Guía de alta de un legajo: qué falta cargar y en qué orden, para que el
// responsable de altas no dependa de acordarse.
//
// Los pasos NO se configuran en ningún lado: se derivan de lo que la app ya
// sabe, así nunca se desincronizan.
//   · Datos obligatorios para liquidar → mismo criterio que
//     src/utils/legajoCompletitud.js (y que la Edge Function liquidar-periodo).
//   · Documentación → Configuración → Empresa → Documentación
//     (nom_documentos_requeridos, los marcados como obligatorios).
//   · El resto son recomendados: no frenan la liquidación, pero hacen falta
//     para el recibo, para asignaciones familiares o para tener el legajo
//     presentable ante una inspección.

const vacio = (v) => v === null || v === undefined || String(v).trim() === ''

// `documentos` son los ya cargados (nom_documentos_legajo + los de Presencio),
// `requeridos` la configuración de la empresa.
export function pasosGuiaAlta({ legajo, requeridos = [], documentos = [], familiares = [] }) {
  const fueraConvenio = !!legajo?.fueraConvenio

  const identificacion = {
    id: 'identificacion',
    titulo: 'Identificación y pago',
    descripcion: 'Sin CUIL y CBU la liquidación saltea a la persona.',
    pestana: 'Datos',
    items: [
      { id: 'cuil', label: 'CUIL', obligatorio: true, ok: !vacio(legajo?.cuil) },
      { id: 'cbu', label: 'CBU', obligatorio: true, ok: !vacio(legajo?.cbu) },
      { id: 'banco', label: 'Banco', obligatorio: false, ok: !vacio(legajo?.banco) },
      { id: 'obraSocial', label: 'Obra social', obligatorio: false, ok: !vacio(legajo?.obraSocial) },
      { id: 'jornada', label: 'Jornada', obligatorio: false, ok: !vacio(legajo?.jornada) },
    ],
  }

  const remuneracion = {
    id: 'remuneracion',
    titulo: 'Convenio y remuneración',
    descripcion: fueraConvenio
      ? 'Fuera de convenio: el básico sale del sueldo pactado individualmente.'
      : 'El básico sale de la escala del convenio según la categoría.',
    pestana: 'Datos',
    items: fueraConvenio
      ? [{ id: 'sueldoConvenido', label: 'Sueldo convenido mensual', obligatorio: true, ok: !vacio(legajo?.sueldoConvenido) }]
      : [
          { id: 'convenio', label: 'Convenio', obligatorio: true, ok: !vacio(legajo?.convenioId) },
          { id: 'categoria', label: 'Categoría', obligatorio: true, ok: !vacio(legajo?.categoriaId) },
        ],
  }

  const cargados = new Set((documentos || []).map((d) => d.requeridoId).filter(Boolean))
  const documentacion = {
    id: 'documentacion',
    titulo: 'Documentación',
    descripcion: (requeridos || []).length === 0
      ? 'Todavía no hay documentación configurada en Configuración → Empresa → Documentación.'
      : 'Los obligatorios suman al contador de legajos a revisar del Dashboard.',
    pestana: 'Documentación',
    items: (requeridos || []).map((r) => ({
      id: `doc-${r.id}`,
      label: r.nombre,
      obligatorio: !!r.obligatorio,
      ok: cargados.has(r.id),
    })),
  }

  const domicilio = {
    id: 'domicilio',
    titulo: 'Domicilio y contacto',
    descripcion: 'Se imprime en documentación laboral; ninguno frena la liquidación.',
    pestana: 'Datos',
    items: [
      { id: 'domicilio', label: 'Dirección', obligatorio: false, ok: !vacio(legajo?.domicilio) },
      { id: 'localidad', label: 'Localidad', obligatorio: false, ok: !vacio(legajo?.localidad) },
      { id: 'provincia', label: 'Provincia', obligatorio: false, ok: !vacio(legajo?.provincia) },
      { id: 'codigoPostal', label: 'Código postal', obligatorio: false, ok: !vacio(legajo?.codigoPostal) },
      { id: 'telefono', label: 'Teléfono', obligatorio: false, ok: !vacio(legajo?.telefono) },
      { id: 'email', label: 'Correo electrónico', obligatorio: false, ok: !vacio(legajo?.email) },
    ],
  }

  const cargaFamilia = {
    id: 'familiares',
    titulo: 'Familiares a cargo',
    descripcion: 'Opcional: solo si corresponde declarar cónyuge o hijos.',
    pestana: 'Familiares',
    items: [
      {
        id: 'familiares',
        label: (familiares || []).length > 0
          ? `${familiares.length} familiar(es) declarado(s)`
          : 'Revisado (sin familiares a cargo)',
        obligatorio: false,
        ok: (familiares || []).length > 0,
      },
    ],
  }

  return [identificacion, remuneracion, documentacion, domicilio, cargaFamilia].map(resumirPaso)
}

function resumirPaso(paso) {
  const obligatorios = paso.items.filter((i) => i.obligatorio)
  const pendientesObligatorios = obligatorios.filter((i) => !i.ok)
  return {
    ...paso,
    total: paso.items.length,
    completos: paso.items.filter((i) => i.ok).length,
    obligatorios: obligatorios.length,
    pendientesObligatorios: pendientesObligatorios.length,
    // Un paso está "listo" cuando no le queda nada obligatorio pendiente.
    listo: pendientesObligatorios.length === 0,
  }
}

// Resumen global para la barra de avance y para el aviso de la ficha.
export function resumenGuia(pasos) {
  const items = pasos.flatMap((p) => p.items)
  const obligatorios = items.filter((i) => i.obligatorio)
  const pendientes = obligatorios.filter((i) => !i.ok)
  return {
    totalItems: items.length,
    completos: items.filter((i) => i.ok).length,
    obligatorios: obligatorios.length,
    pendientesObligatorios: pendientes.length,
    nombresPendientes: pendientes.map((i) => i.label),
    // Porcentaje sobre los obligatorios: es lo que de verdad habilita a
    // liquidar. Sin obligatorios configurados, se considera completo.
    porcentaje: obligatorios.length === 0
      ? 100
      : Math.round(((obligatorios.length - pendientes.length) / obligatorios.length) * 100),
    completo: pendientes.length === 0,
  }
}
