import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-zinc-50 dark:bg-zinc-900">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
              出错了
            </h2>
            <p className="text-sm text-zinc-500 mb-4">
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.hash = '#/'
              }}
              className="px-4 py-2 text-sm rounded-lg bg-primary-500 hover:bg-primary-600 text-white"
            >
              返回首页
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}