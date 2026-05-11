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
  executionElapsedMs,
  getPendingCommandCount,
}: {
  executionElapsedMs: ReadonlySignal<number>
  getPendingCommandCount: () => number
}) {
  useSignals()
  const [pendingCommandCount, setPendingCommandCount] = useState(
    getPendingCommandCount
  )

  useEffect(() => {
    const updatePendingCommandCount = () => {
      setPendingCommandCount(getPendingCommandCount())
    }

    updatePendingCommandCount()
    const intervalId = window.setInterval(updatePendingCommandCount, 100)

    return () => window.clearInterval(intervalId)
  }, [getPendingCommandCount])

  return (
    <>
      <p className="text-sm">
        Engine executing for {formatExecutionDuration(executionElapsedMs.value)}
        .
      </p>
      <p className="text-sm text-2">Pending commands: {pendingCommandCount}</p>
    </>
  )
}
