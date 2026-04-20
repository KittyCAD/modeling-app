import { useEffect, useMemo, useState } from 'react'

import { Spinner } from '@src/components/Spinner'

const PROGRESS_TICK_INTERVAL_MS = 100

const clampProgress = (progress: number) => {
  return Math.max(0, Math.min(100, progress))
}

type ToastProgressProps = {
  title: string
  subtitle?: string
  progressPercent?: number
  durationMs?: number
  showSpinner?: boolean
}

export function ToastProgress({
  title,
  subtitle,
  progressPercent,
  durationMs,
  showSpinner = true,
}: ToastProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (
      typeof progressPercent === 'number' ||
      durationMs === undefined ||
      durationMs <= 0
    ) {
      return
    }

    const startedAt = Date.now()
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, PROGRESS_TICK_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [durationMs, progressPercent])

  const progress = useMemo(() => {
    if (typeof progressPercent === 'number') {
      return clampProgress(progressPercent)
    }

    if (durationMs === undefined || durationMs <= 0) {
      return 0
    }

    return clampProgress((elapsedMs / durationMs) * 100)
  }, [durationMs, elapsedMs, progressPercent])

  return (
    <div className="relative overflow-hidden rounded border border-chalkboard-20/50 dark:border-chalkboard-80/50 bg-chalkboard-10 dark:bg-chalkboard-90 shadow-md">
      <div className="absolute inset-x-0 top-0 h-1 bg-chalkboard-20 dark:bg-chalkboard-70">
        <div
          data-testid="toast-progress-bar"
          className="h-full bg-primary transition-all duration-100 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center gap-3 py-3 pr-4 pl-3 pt-4">
        {showSpinner && <Spinner className="h-4 w-4 text-primary" />}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5">{title}</p>
          {subtitle && (
            <p className="text-xs leading-4 text-chalkboard-70 dark:text-chalkboard-30">
              {subtitle}
            </p>
          )}
        </div>
        <span
          className="ml-auto pl-2 text-xs tabular-nums text-chalkboard-70 dark:text-chalkboard-30"
          data-testid="toast-progress-label"
        >
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  )
}
