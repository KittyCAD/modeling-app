import { effect, signal, untracked } from '@preact/signals-core'
import type {
  ExecutionInput,
  Executor,
  ExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { sameExecutionInput } from '@src/lib/executors/executor'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'

/** Mode contexts lease one policy per executor/capability. Any enabled lease may request current input. */
const policies = new WeakMap<
  Executor,
  Map<
    ExecutorCapability,
    {
      leases: Set<() => boolean>
      notify: () => void
      stop: () => void
    }
  >
>()

export function acquireAutomaticExecution(
  executor: Executor,
  capability: ExecutorCapability,
  enabled: () => boolean = () => true
): () => void {
  let owned = policies.get(executor)
  if (!owned) {
    owned = new Map()
    policies.set(executor, owned)
  }
  let policy = owned.get(capability)
  if (!policy) {
    const leases = new Set<() => boolean>()
    const changed = signal(0)
    let previous: ExecutionInput | undefined
    let generation = 0
    let stopped = false
    const stop = effect(() => {
      void changed.value
      const automatic = [...leases].map((read) => read()).some(Boolean)
      const next = executor.input(capability).value
      const state = executor.result(capability).value
      const ticket = ++generation
      if (!automatic || !next) {
        previous = undefined
        return
      }
      if (!state.running && !state.stale) {
        previous = next
        return
      }
      if (state.running || (previous && sameExecutionInput(previous, next)))
        return
      // Coalesce edits and shared acquisitions without putting work in a reactive source.
      queueMicrotask(() => {
        if (stopped || ticket !== generation) return
        previous = next
        untracked(() => {
          void executor.run(capability)
        })
      })
    })
    const lifetime = Effect.runSync(
      Scope.fork(executor.scope, ExecutionStrategy.sequential)
    )
    policy = {
      leases,
      notify: () => {
        changed.value++
      },
      stop: () => {
        Effect.runSync(Scope.close(lifetime, Exit.void))
      },
    }
    owned.set(capability, policy)
    const current = policy
    Effect.runSync(
      Scope.addFinalizer(
        lifetime,
        Effect.sync(() => {
          stopped = true
          generation++
          stop()
          if (owned?.get(capability) === current) owned.delete(capability)
        })
      )
    )
  }
  const lease = () => enabled()
  policy.leases.add(lease)
  policy.notify()
  const current = policy
  let released = false
  return () => {
    if (released) return
    released = true
    current.leases.delete(lease)
    if (!current.leases.size) {
      current.stop()
      owned?.delete(capability)
    } else current.notify()
  }
}
