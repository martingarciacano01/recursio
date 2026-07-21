// Registra los matchers de jest-dom (toBeInTheDocument, etc.) para todos
// los tests que usan @testing-library/react. Sin este setup, cualquier
// test que use un matcher de jest-dom falla con "Invalid Chai property".
//
// El proyecto corre vitest con `globals: false` (los tests importan
// `expect` explícitamente de 'vitest' en vez de usarlo como global), así
// que no alcanza con `import '@testing-library/jest-dom'` (esa entrada
// asume un `expect` global). Hay que extender el `expect` de vitest a mano.
import { expect, afterEach } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'

expect.extend(matchers)

// Mismo motivo que arriba: con `globals: false`, Testing Library no puede
// registrar su afterEach de limpieza automática (depende de que exista un
// hook global `afterEach`), así que hay que desmontar el DOM a mano entre
// tests. Sin esto, tests de un mismo archivo que renderizan el mismo
// componente se pisan entre sí (el segundo `render` deja el DOM del
// primero sin desmontar, y una búsqueda por texto puede encontrar
// elementos duplicados de ambos renders).
afterEach(() => {
  cleanup()
})
