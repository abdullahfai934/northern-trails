import React from 'react'

/**
 * Stops one bad field from blanking the entire site.
 *
 * A render error anywhere under this boundary would otherwise unmount the
 * whole React tree and leave a white page with nothing to go on. Here it
 * degrades to a readable message that names the error, which is the
 * difference between "the site is down" and a fixable bug report.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Northern Trails crashed while rendering:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/10 text-2xl">
          ⚠️
        </div>
        <h1 className="font-display text-xl text-frost-50">Something broke on this page</h1>
        <p className="mt-2 text-sm text-frost-300">
          The rest of the app still works. Try reloading, or head back to the home page.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-xl border border-ink-700 bg-ink-900 p-3 text-left font-mono text-[11px] leading-relaxed text-rose-300">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-glacier-400 px-5 py-2.5 text-sm font-semibold text-abyss"
          >
            Reload
          </button>
          <a href="/" className="rounded-xl border border-ink-700 px-5 py-2.5 text-sm text-frost-200">
            Home
          </a>
        </div>
      </div>
    )
  }
}
