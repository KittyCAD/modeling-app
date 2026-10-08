import type { ModelingCmd } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { useEffect, useMemo, useState } from 'react'
import {
  type MeasurementEntity,
  resolveMeasurementEntities,
} from './measurementUtils'

const emptyEntities: MeasurementEntity[] = []

/** Owns the resolved engine entities for exactly one selection and graph version. */
export function useMeasurementSelection(
  selections: Selections,
  artifactGraph: ArtifactGraph,
  sendModelingCommand: (cmd: ModelingCmd) => Promise<unknown>,
  enabled: boolean
) {
  const input = useMemo(
    () => ({ selections, artifactGraph, sendModelingCommand, enabled }),
    [selections, artifactGraph, sendModelingCommand, enabled]
  )
  const [resolved, setResolved] = useState<{
    input: typeof input
    entities: MeasurementEntity[]
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!input.enabled) return
    let cancelled = false
    resolveMeasurementEntities(input.selections, input.artifactGraph, (cmd) => {
      // Stop issuing subsequent lookups when a pending selection is replaced.
      return cancelled
        ? Promise.resolve(new Error('Selection changed.'))
        : input.sendModelingCommand(cmd)
    })
      .then((result) => {
        if (cancelled) return
        setResolved({
          input,
          entities: result instanceof Error ? [] : result,
          error: result instanceof Error ? result.message : null,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setResolved({
          input,
          entities: [],
          error:
            error instanceof Error
              ? error.message
              : 'Unable to resolve selection for measurement.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [input])

  // Hide the old entities during render, before the replacement effect runs.
  const current = input.enabled && resolved?.input === input ? resolved : null
  return {
    entities: current?.entities ?? emptyEntities,
    error: current?.error ?? null,
    resolving: input.enabled && current === null,
  }
}
