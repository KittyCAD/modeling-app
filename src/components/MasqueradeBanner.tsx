import { isDesktop } from '@src/lib/isDesktop'
import {
  hasMasqueradeHint,
  type MasqueradeStatus,
  watchSessionIdentity,
} from '@src/lib/masquerade'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { useEffect, useRef, useState } from 'react'

export default function MasqueradeBanner() {
  const [status, setStatus] = useState<MasqueradeStatus | null>(null)
  const [ending, setEnding] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endingRef = useRef(false)

  useEffect(() => {
    if (isDesktop()) return
    const startedWithMasquerade = hasMasqueradeHint(withAPIBaseURL(''))
    const abort = new AbortController()
    const stop = watchSessionIdentity(
      () => {
        setSwitching(true)
        window.location.reload()
      },
      () =>
        endingRef.current ||
        (!startedWithMasquerade && !hasMasqueradeHint(withAPIBaseURL('')))
    )
    const refresh = async () => {
      if (!hasMasqueradeHint(withAPIBaseURL(''))) {
        setStatus(null)
        return
      }
      try {
        const response = await fetch(`${withAPIBaseURL('')}/masquerade`, {
          credentials: 'include',
          cache: 'no-store',
          signal: abort.signal,
        })
        if (!response.ok) return
        const next: MasqueradeStatus | null = await response.json()
        if (!abort.signal.aborted) setStatus(next)
      } catch {
        // Preserve the current banner through a temporary network failure.
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 15000)
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      abort.abort()
      stop()
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const end = async () => {
    endingRef.current = true
    setEnding(true)
    setError(null)
    try {
      const response = await fetch(`${withAPIBaseURL('')}/masquerade/end`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        setError('Unable to end masquerade. Try again.')
        endingRef.current = false
        setEnding(false)
        return
      }
      const result: { redirect_url: string } = await response.json()
      window.location.assign(result.redirect_url)
    } catch {
      setError('Unable to end masquerade. Check your connection and try again.')
      endingRef.current = false
      setEnding(false)
    }
  }

  if (switching || ending) {
    return (
      <div
        role="status"
        className="fixed inset-0 z-[9999] grid place-items-center bg-zinc-950 text-white"
      >
        {ending ? 'Ending masquerade...' : 'Switching accounts...'}
      </div>
    )
  }
  if (!status) return null
  return (
    <aside
      aria-label="Masquerade"
      className="fixed bottom-4 right-4 z-[9999] max-w-[calc(100vw-2rem)] rounded-lg border border-amber-400 bg-amber-100 p-3 text-sm text-amber-950 shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <p className="font-semibold">
            {status.expired ? 'Masquerade expired for' : 'Masquerading as'}{' '}
            {status.display_name}
          </p>
          <p>
            {status.environment}
            {status.expires_at &&
              ` | Ends ${new Date(status.expires_at).toLocaleTimeString()}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void end()
          }}
          className="rounded border border-amber-700 px-3 py-1 font-semibold hover:bg-amber-200"
        >
          End masquerade
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
    </aside>
  )
}
