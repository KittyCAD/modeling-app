import ms from 'ms'
import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000

export function BillingCreditRefresh({ refreshAt }: { refreshAt?: string }) {
  const refreshTime = refreshAt ? Date.parse(refreshAt) : Number.NaN
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!Number.isFinite(refreshTime)) return

    const update = () => setNow(Date.now())
    update()
    const id = setInterval(update, MINUTE_MS)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)

    return () => {
      clearInterval(id)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [refreshTime])

  if (!Number.isFinite(refreshTime)) return null

  // A past timestamp means the server has not applied the refresh yet.
  const remainingMs = refreshTime - now
  const label =
    remainingMs <= 0
      ? 'Credit refresh pending'
      : `Credits refresh in ${ms(remainingMs, { long: true })}`

  return (
    <time
      dateTime={refreshAt}
      title={`Credit refresh scheduled for ${new Date(refreshTime).toLocaleString()}`}
      className="text-chalkboard-90"
    >
      {label}
    </time>
  )
}
