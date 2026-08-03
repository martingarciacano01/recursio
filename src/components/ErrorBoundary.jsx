import { Component } from 'react'

// Error boundary global (Task 3.2, Fase 3): un throw en render en CUALQUIER
// parte del árbol (bug de un componente, dato inesperado que rompe un
// map/destructuring, etc.) tumbaba toda la app a una pantalla en blanco sin
// ninguna pista de qué pasó. React solo atrapa estos errores con un class
// component que implemente getDerivedStateFromError/componentDidCatch — no
// hay equivalente con hooks todavía.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { tieneError: false }
  }

  static getDerivedStateFromError() {
    return { tieneError: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary atrapó un error de render:', error, info)
  }

  render() {
    if (this.state.tieneError) {
      return (
        <div className="card" style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <h2>Algo salió mal</h2>
          <p style={{ color: 'var(--text-secondary, #666)' }}>
            Ocurrió un error inesperado en la aplicación. Podés intentar recargar la página;
            si el problema persiste, avisá al soporte técnico.
          </p>
          <button className="btn" onClick={() => window.location.reload()}>Recargar</button>
        </div>
      )
    }
    return this.props.children
  }
}
