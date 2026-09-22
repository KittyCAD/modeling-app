import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function formatRemainingTime(remainingMs: number) {
  if (remainingMs < MINUTE_MS) return '< 1m'
  if (remainingMs < HOUR_MS) return `${Math.floor(remainingMs / MINUTE_MS)}m`
  if (remainingMs < DAY_MS) {
    return `${Math.floor(remainingMs / HOUR_MS)}h ${Math.floor((remainingMs % HOUR_MS) / MINUTE_MS)}m`
  }
  return `${Math.floor(remainingMs / DAY_MS)}d ${Math.floor((remainingMs % DAY_MS) / HOUR_MS)}h`
}

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
      : `Credits refresh in ${formatRemainingTime(remainingMs)}`

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
