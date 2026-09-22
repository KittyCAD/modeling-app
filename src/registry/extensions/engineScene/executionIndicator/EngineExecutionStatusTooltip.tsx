import type { ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useState } from 'react'

function formatExecutionDuration(elapsedMs: number) {
  const totalSeconds = Math.max(0, elapsedMs) / 1000

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export function EngineExecutionStatusTooltip({
  isExecuting,
  executionElapsedMs,
  getPendingCommandCount,
}: {
  isExecuting: boolean
  executionElapsedMs: ReadonlySignal<number | null>
  getPendingCommandCount: () => number
}) {
  useSignals()
  const [pendingCommandCount, setPendingCommandCount] = useState(() =>
    isExecuting ? getPendingCommandCount() : 0
  )

  useEffect(() => {
    if (!isExecuting) return

    const updatePendingCommandCount = () => {
      setPendingCommandCount(getPendingCommandCount())
    }

    updatePendingCommandCount()
    const intervalId = window.setInterval(updatePendingCommandCount, 100)

    return () => window.clearInterval(intervalId)
  }, [isExecuting, getPendingCommandCount])

  return (
    <>
      <p className="text-sm">
        {isExecuting ? 'Engine executing for' : 'Engine execution took'}{' '}
        {formatExecutionDuration(executionElapsedMs.value ?? 0)}.
      </p>
      {isExecuting && (
        <p className="text-sm text-2">
          Pending commands: {pendingCommandCount}
        </p>
      )}
    </>
  )
}
