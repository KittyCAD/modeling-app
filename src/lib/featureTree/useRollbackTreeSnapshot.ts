import type { FeatureHistory } from '@src/lib/featureTree/featureHistory'
import type { OperationTreeNode } from '@src/lib/featureTree/featureTreeOperationTree'
import { useEffect, useState } from 'react'

interface RollbackSnapshot {
  file: object
  expectedCode: string
  previousCode: string
  awaitingCode: boolean
  rollbackIndex: number
  history: FeatureHistory
  operations: OperationTreeNode[]
}

/** Keep the displayed timeline while a marker-only edit regenerates geometry.
 * Ordinary source edits, reordering, and file switches invalidate the snapshot.
 */
export function useRollbackTreeSnapshot({
  file,
  code,
  history,
  operations,
}: {
  file: object
  code: string
  history: FeatureHistory
  operations: OperationTreeNode[]
}) {
  const [snapshot, setSnapshot] = useState<RollbackSnapshot | null>(null)
  const active =
    snapshot?.file === file &&
    (snapshot.expectedCode === code ||
      (snapshot.awaitingCode && snapshot.previousCode === code))
  useEffect(() => {
    if (snapshot && !active) setSnapshot(null)
    else if (snapshot?.awaitingCode && code === snapshot.expectedCode)
      setSnapshot({ ...snapshot, awaitingCode: false })
  }, [snapshot, active, code])

  return {
    active,
    history: active
      ? { ...snapshot.history, code, rollbackIndex: snapshot.rollbackIndex }
      : history,
    operations: active ? snapshot.operations : operations,
    operationsCode: active ? snapshot.history.code : history.code,
    beginRollback(nextCode: string, index: number) {
      setSnapshot(
        active
          ? {
              ...snapshot,
              expectedCode: nextCode,
              previousCode: code,
              awaitingCode: true,
              rollbackIndex: index,
            }
          : {
              file,
              expectedCode: nextCode,
              previousCode: code,
              awaitingCode: true,
              rollbackIndex: index,
              history,
              operations: structuredClone(operations),
            }
      )
    },
  }
}
