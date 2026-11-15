import { batch } from '@preact/signals-core'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import type {
  modelingMachine,
  ModelingMachineEvent,
} from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'

/** The actor publishes state to its supplied owner; no app singleton or React context selects that owner. */
export interface ModelingMachineStateHost {
  modelingSend: (event: ModelingMachineEvent) => void
  modelingState: SnapshotFrom<typeof modelingMachine> | null
  selectionRanges: Selections
}

const bindings = new WeakMap<ModelingMachineStateHost, () => void>()

/** Borrow an actor's state/send API. Its lifetime owner still starts and stops the actor and drains native work. */
export function bindModelingMachine(
  actor: ActorRefFrom<typeof modelingMachine>,
  host: ModelingMachineStateHost
) {
  bindings.get(host)?.()
  let disposed = false
  let unsubscribe = () => {}
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    if (bindings.get(host) !== dispose) return
    bindings.delete(host)
    batch(() => {
      host.modelingSend = () => {}
      host.modelingState = null
      host.selectionRanges = { graphSelections: [], otherSelections: [] }
    })
  }
  bindings.set(host, dispose)
  host.modelingSend = (event) => {
    if (!disposed) actor.send(event)
  }
  const publish = (snapshot: SnapshotFrom<typeof modelingMachine>) => {
    if (disposed) return
    batch(() => {
      host.modelingState = snapshot
      host.selectionRanges = snapshot.context.selectionRanges
    })
  }
  const subscription = actor.subscribe({ next: publish, complete: dispose })
  unsubscribe = () => subscription.unsubscribe()
  if (disposed) unsubscribe()
  else publish(actor.getSnapshot())
  return dispose
}
