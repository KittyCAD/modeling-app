import { useLayoutEffect, useRef, useState } from 'react'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'

/** Unmount the draft for a new command, but keep it through validation errors. */
export function useDialogReset(actor: CommandBarActorType) {
  const previous = useRef(actor.getSnapshot().context.argumentsToSubmit)
  const [opening, setOpening] = useState(previous.current)
  const [renderedOpening, setRenderedOpening] = useState(opening)

  useLayoutEffect(() => {
    function update(snapshot: ReturnType<CommandBarActorType['getSnapshot']>) {
      const args = snapshot.context.argumentsToSubmit
      const changed = args !== previous.current
      previous.current = args
      if (changed && !snapshot.matches('Checking Arguments for Dialog')) {
        setOpening(args)
      }
    }
    // Observe every transition, even when React batches checking and its result.
    const subscription = actor.subscribe(update)
    update(actor.getSnapshot())
    return () => subscription.unsubscribe()
  }, [actor])

  useLayoutEffect(() => {
    setRenderedOpening(opening)
  }, [opening])

  return renderedOpening !== opening
}
