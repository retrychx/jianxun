import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
}

/**
 * 错误边界：任一视图渲染异常不再整页白屏，
 * 而是显示可恢复的兜底 UI（保留头部/导航/侧栏）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[ErrorBoundary] view crashed:', error)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="empty" style={{ marginTop: 60 }}>
          <p style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>⚠️</p>
          <p>页面出错了</p>
          <button className="load-more" onClick={this.handleReload} style={{ marginTop: 12 }}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
