import type {
  CapabilityData,
  ExecutorCapability,
  ExecutorOutput,
} from '@src/lib/executors/registry/contract'
import { isErr } from '@src/lib/trap'

/** A completed capability is kept alongside its result until the snapshot is published. */
export type ExecutorResult = readonly [
  ExecutorCapability,
  Record<string, unknown> | Error,
]

/** Build a snapshot whose private identity map preserves each capability's result type. */
export function createExecutorOutput(
  snapshot: Pick<ExecutorOutput, 'src' | 'contents' | 'running'>,
  results: readonly ExecutorResult[] = []
): ExecutorOutput {
  const values = new Map<ExecutorCapability, Record<string, unknown>>()
  const data: [string, Record<string, unknown>][] = []
  const errors: [string, Error][] = []
  for (const [capability, result] of results) {
    if (isErr(result)) errors.push([capability.id, result])
    else {
      values.set(capability, result)
      data.push([capability.id, result])
    }
  }
  return {
    ...snapshot,
    data: Object.fromEntries(data),
    errors: Object.fromEntries(errors),
    get: <C extends ExecutorCapability>(capability: C) =>
      // The executor writes the result of capability.execute under that same
      // object. The heterogeneous map erases types only inside this boundary.
      values.get(capability) as CapabilityData<C> | undefined,
  }
}
