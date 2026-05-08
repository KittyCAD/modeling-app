import { useEffect, useState } from 'react'

export function EngineExecutionStatusTooltip({
  getPendingCommandCount,
}: {
  getPendingCommandCount: () => number
}) {
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
    <span className="whitespace-nowrap">
      Engine executing. Pending commands: {pendingCommandCount}
    </span>
  )
}
