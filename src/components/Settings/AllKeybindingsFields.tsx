import { CustomIcon } from 'components/CustomIcon'
import decamelize from 'decamelize'
import { useInteractionMapContext } from 'hooks/useInteractionMapContext'
import { resolveInteractionEvent } from 'lib/keyboard'
import {
  InteractionMapItem,
  makeOverrideKey,
} from 'machines/interactionMapMachine'
import { FormEvent, HTMLProps, useEffect, useRef, useState } from 'react'

export function AllKeybindingsFields() {
  const { state } = useInteractionMapContext()
  return (
    <div className="relative overflow-y-auto">
      <div className="flex flex-col gap-4 px-2">
        {Object.entries(state.context.interactionMap).map(
          ([category, categoryItems]) => (
            <KeybindingSection
              key={category}
              category={category}
              items={categoryItems}
            />
          )
        )}
      </div>
    </div>
  )
}

function KeybindingSection({
  category,
  items,
  ...props
}: HTMLProps<HTMLDivElement> & {
  category: string
  items: Record<string, InteractionMapItem>
}) {
  return (
    <section {...props}>
      <h2
        id={`category-${category}`}
        className="text-xl mt-6 first-of-type:mt-0 capitalize font-bold"
      >
        {decamelize(category, { separator: ' ' })}
      </h2>
      <div className="flex flex-col my-2 gap-2">
        {Object.entries(items).map(([_, item]) => (
          <KeybindingField key={item.ownerId + '-' + item.name} item={item} />
        ))}
      </div>
    </section>
  )
}

function KeybindingField({ item }: { item: InteractionMapItem }) {
  const { send, state } = useInteractionMapContext()
  const [isEditing, setIsEditing] = useState(false)
  const [newSequence, setNewSequence] = useState('')
  const submitRef = useRef<HTMLButtonElement>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (newSequence !== item.sequence) {
      send({
        type: 'Update overrides',
        data: {
          [makeOverrideKey(item)]: newSequence,
        },
      })
    }
    setIsEditing(false)
  }

  useEffect(() => {
    const blockOtherEvents = (e: KeyboardEvent | MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }

    const handleInteraction = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') {
        blockOtherEvents(e)
        setIsEditing(false)
        return
      } else if (e instanceof KeyboardEvent && e.key === 'Enter') {
        return
      } else if (e instanceof MouseEvent && e.target === submitRef.current) {
        return
      }
      blockOtherEvents(e)

      const resolvedInteraction = resolveInteractionEvent(e)
      if (resolvedInteraction.isModifier) return
      setNewSequence((prev) => {
        const newSequence =
          prev + (prev.length ? ' ' : '') + resolvedInteraction.asString
        console.log('newSequence', newSequence)
        return newSequence
      })
    }

    const handleContextMenu = (e: MouseEvent) => {
      blockOtherEvents(e)
    }

    if (!isEditing) {
      setNewSequence('')
      globalThis?.window?.removeEventListener('keydown', handleInteraction, {
        capture: true,
      })
      globalThis?.window?.removeEventListener('mousedown', handleInteraction, {
        capture: true,
      })
      globalThis?.window?.removeEventListener(
        'contextmenu',
        handleContextMenu,
        { capture: true }
      )
    } else {
      globalThis?.window?.addEventListener('keydown', handleInteraction, {
        capture: true,
      })
      globalThis?.window?.addEventListener('mousedown', handleInteraction, {
        capture: true,
      })
      globalThis?.window?.addEventListener('contextmenu', handleContextMenu, {
        capture: true,
      })
    }

    return () => {
      globalThis?.window?.removeEventListener('keydown', handleInteraction, {
        capture: true,
      })
      globalThis?.window?.removeEventListener('mousedown', handleInteraction, {
        capture: true,
      })
      globalThis?.window?.removeEventListener(
        'contextmenu',
        handleContextMenu,
        { capture: true }
      )
    }
  }, [isEditing, setNewSequence])

  return isEditing ? (
    <form
      key={item.ownerId + '-' + item.name}
      className="group flex gap-2 justify-between items-center"
      onSubmit={handleSubmit}
    >
      <h3>{item.title}</h3>
      <InteractionSequence sequence={newSequence} showNoSequence />
      <input type="hidden" value={item.sequence} name="sequence" />
      <button className="p-0 m-0" onClick={() => setIsEditing(false)}>
        <CustomIcon name="close" className="w-5 h-5" />
        <span className="sr-only">Cancel</span>
      </button>
      <button ref={submitRef} className="p-0 m-0" type="submit">
        <CustomIcon name="checkmark" className="w-5 h-5" />
        <span className="sr-only">Save</span>
      </button>
    </form>
  ) : (
    <div
      key={item.ownerId + '-' + item.name}
      className="group flex gap-2 justify-between items-center"
    >
      <h3>{item.title}</h3>
      <InteractionSequence
        sequence={
          state.context.overrides[makeOverrideKey(item)] || item.sequence
        }
        showNoSequence
      />
      <button
        ref={submitRef}
        className="invisible group-focus:visible group-hover:visible p-0 m-0 [&:not(:hover)]:border-transparent"
        onClick={() => setIsEditing(true)}
      >
        <CustomIcon name="sketch" className="w-5 h-5" />
        <span className="sr-only">Edit</span>
      </button>
    </div>
  )
}

export function InteractionSequence({
  sequence,
  className = '',
  showNoSequence = false,
  ...props
}: HTMLProps<HTMLDivElement> & { sequence: string; showNoSequence?: boolean }) {
  return sequence.length ? (
    <div
      className={
        'cursor-default flex-1 flex flex-wrap justify-end gap-3 ' + className
      }
      {...props}
    >
      {sequence.split(' ').map((chord, i) => (
        <kbd key={`sequence-${sequence}-${chord}-${i}`} className="hotkey">
          {chord}
        </kbd>
      ))}
    </div>
  ) : (
    showNoSequence && (
      <div className="flex-1 flex justify-end text-xs">No sequence set</div>
    )
  )
}
