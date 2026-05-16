import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

function getLang(): 'en' | 'zh' {
  try {
    // Read from localStorage as a synchronous fallback (electron-store is async)
    const raw = localStorage.getItem('appLang')
    if (raw === 'zh') return 'zh'
  } catch {
    // localStorage may not be available
  }
  return 'en'
}

const TEXT = {
  en: {
    heading: 'Something went wrong',
    fallback: 'An unexpected error occurred.',
    button: 'Try Again'
  },
  zh: {
    heading: '出现错误',
    fallback: '发生了意外错误。',
    button: '重试'
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const lang = getLang()
      const t = TEXT[lang]
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '16px',
          padding: '32px',
          fontFamily: 'var(--font-family, Inter, -apple-system, sans-serif)',
          color: 'var(--text-primary, #e0e0e0)',
          background: 'var(--bg-primary, #1a1a2e)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px' }}>!</div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {t.heading}
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-tertiary, #888)', maxWidth: '400px' }}>
            {this.state.error?.message || t.fallback}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: 'var(--accent-primary, #0abab5)',
              color: '#fff',
              border: 'none',
              borderRadius: '20px',
              padding: '10px 28px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: '8px'
            }}
          >
            {t.button}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
