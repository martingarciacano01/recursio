import { useTemaStore } from '../store/temaStore'
import fullOscuro from '../assets/brand/recursio-full-dark.png'
import fullClaro from '../assets/brand/recursio-full-light.png'
import marca from '../assets/brand/recursio-mark.png'

// Logo institucional. `variante`:
//   'full'  -> isotipo + wordmark (cambia según tema: texto blanco / azul)
//   'marca' -> solo el hexágono, que funciona igual en claro y oscuro
export default function Logo({ variante = 'full', alto = 32, style }) {
  const efectivo = useTemaStore((s) => s.efectivo)
  const src = variante === 'marca' ? marca : efectivo === 'claro' ? fullClaro : fullOscuro
  return (
    <img
      src={src}
      alt="Recursio"
      height={alto}
      style={{ height: alto, width: 'auto', display: 'block', ...style }}
    />
  )
}
