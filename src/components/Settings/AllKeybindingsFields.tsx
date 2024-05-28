import { ActionIcon } from 'components/ActionIcon'
import { useInteractionMapContext } from 'hooks/useInteractionMapContext'
import {
  isModifierKey,
  mapKey,
  mouseButtonToName,
  resolveInteractionEvent,
} from 'lib/keyboard'
import { InteractionMapItem } from 'machines/interactionMapMachine'
import { useEffect, useState } from 'react'
import { g } from 'vitest/dist/suite-IbNSsUWN'

export function AllKeybindingsFields() {
  const { state } = useInteractionMapContext()
  return (
    <div className="relative overflow-y-auto">
      <div className="flex flex-col gap-4 px-2">
        {state.context.interactionMap.map((item) => (
          <KeybindingField key={item.ownerId + '-' + item.name} item={item} />
        ))}
      </div>
    </div>
  )
}

function KeybindingField({ item }: { item: InteractionMapItem }) {
  const [isEditing, setIsEditing] = useState(false)
  const [newSequence, setNewSequence] = useState('')

  useEffect(() => {
    const blockOtherEvents = (e: KeyboardEvent | MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }

    const handleInteraction = (e: KeyboardEvent | MouseEvent) => {
      blockOtherEvents(e)

      const resolvedInteraction = resolveInteractionEvent(e)
      if (resolvedInteraction.isModifier) return
      setNewSequence(
        (prev) => prev + (prev.length ? ' ' : '') + resolvedInteraction.asString
      )
    }

    const handleContextMenu = (e: MouseEvent) => {
      blockOtherEvents(e)
    }

    if (!isEditing) {
      setNewSequence('')
      globalThis?.window?.removeEventListener('keydown', handleInteraction)
      globalThis?.window?.removeEventListener('mousedown', handleInteraction)
      globalThis?.window?.removeEventListener('contextmenu', handleContextMenu)
    } else {
      globalThis?.window?.addEventListener('keydown', handleInteraction)
      globalThis?.window?.addEventListener('mousedown', handleInteraction)
      globalThis?.window?.addEventListener('contextmenu', handleContextMenu)
    }

    return () => {
      globalThis?.window?.removeEventListener('keydown', handleInteraction)
      globalThis?.window?.removeEventListener('mousedown', handleInteraction)
      globalThis?.window?.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [isEditing])

  return (
    <div
      key={item.ownerId + '-' + item.name}
      className="flex gap-2 justify-between items-start"
    >
      <h3>{item.title}</h3>
      <div className="flex-1 flex flex-wrap justify-end gap-3">
        {(isEditing ? newSequence : item.sequence)
          .split(' ')
          .map((chord, i) => (
            <kbd
              key={`${item.ownerId}-${item.name}-${chord}-${i}`}
              className="py-0.5 px-1.5 rounded bg-primary/10 dark:bg-chalkboard-80"
            >
              {chord}
            </kbd>
          ))}
      </div>
      <button
        onClick={() => setIsEditing((prev) => !prev)}
        className="p-0 m-0"
        type={isEditing ? 'submit' : 'button'}
      >
        <ActionIcon icon={isEditing ? 'checkmark' : 'sketch'} />
      </button>
    </div>
  )
}
