import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StateFrom } from 'xstate'

import { useSelectionLifecycle } from '@src/hooks/useSelectionLifecycle'
import type { KclManager } from '@src/lang/KclManager'
import { coerceSelectionsForBodyOnlySelectionTypes } from '@src/lang/std/selectionCoercion'
import { noAutofillFormProps, noAutofillInputProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import type { CommandArgument } from '@src/lib/commandTypes'
import {
  canSubmitSelectionArg,
  getSelectionTypeDisplayText,
  getSemanticSelectionType,
  isSelections,
} from '@src/lib/selections'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { Marked } from '@ts-stack/markdown'

const selectionSelector = (snapshot?: StateFrom<typeof modelingMachine>) =>
  snapshot?.context.selectionRanges

function CommandBarSelectionInput({
  arg,
  stepBack,
  onSubmit,
  executingEditor: kclManager,
}: {
  arg: CommandArgument<unknown> & { inputType: 'selection'; name: string }
  stepBack: () => void
  onSubmit: (data: unknown) => void
  executingEditor: KclManager
}) {
  const { commands, wasmPromise } = useApp()
  const engineCommandManager = kclManager.engineCommandManager
  const inputRef = useRef<HTMLInputElement>(null)
  const commandBarState = commands.useState()
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const rawSelection = useSelector(arg.machineActor, selectionSelector)
  const selection = useMemo(
    () =>
      coerceSelectionsForBodyOnlySelectionTypes(
        rawSelection,
        arg.selectionTypes,
        kclManager.artifactGraph
      ),
    [rawSelection, arg.selectionTypes, kclManager.artifactGraph]
  )
  const isArgRequired =
    arg.required instanceof Function
      ? arg.required(commandBarState.context)
      : arg.required
  const hasSelection = Boolean(
    selection &&
      selection.graphSelections.length + selection.otherSelections.length
  )
  const canSubmitSelection = !hasSelection
    ? !isArgRequired
    : canSubmitSelectionArg(
        kclManager.astSignal.value,
        selection,
        arg,
        kclManager.artifactGraph
      )

  useSelectionLifecycle({
    arg,
    kclManager,
    wasmPromise,
    selection,
    showPlanes: !canSubmitSelection,
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

  // Restore a captured argument, or clear once when entering a fresh collector.
  useEffect(() => {
    const saved =
      commands.actor.getSnapshot().context.argumentsToSubmit[arg.name]
    if (isSelections(saved) || arg.clearSelectionFirst) {
      engineCommandManager.modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: isSelections(saved)
            ? saved
            : { graphSelections: [], otherSelections: [] },
        },
      })
    }
    // The input is keyed by argument name; do not clear again on selection updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fast-forward only when the command opts into skipping a valid selection.
  useEffect(() => {
    const argValue = commandBarState.context.argumentsToSubmit[arg.name]
    if (
      canSubmitSelection &&
      arg.skip &&
      argValue === undefined &&
      !arg.clearSelectionFirst
    ) {
      handleSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [arg.name, canSubmitSelection])

  function handleChange() {
    inputRef.current?.focus()
  }

  function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault()

    if (!canSubmitSelection) {
      setHasSubmitted(true)
      return
    }

    /**
     * Now that arguments like this can be optional, we need to
     * construct an empty selection if it's not required to get it past our validation.
     */
    const resolvedSelection: Selections | undefined = isArgRequired
      ? selection
      : selection || {
          graphSelections: [],
          otherSelections: [],
        }

    onSubmit(resolvedSelection)
  }

  return (
    <form {...noAutofillFormProps} id="arg-form" onSubmit={handleSubmit}>
      <label
        className={
          'relative flex flex-col mx-4 my-4 ' +
          (!hasSubmitted || canSubmitSelection || 'text-destroy-50')
        }
      >
        {canSubmitSelection && hasSelection
          ? getSelectionTypeDisplayText(
              kclManager.astSignal.value,
              selection,
              kclManager.artifactGraph
            ) + ' selected'
          : `Please select ${
              arg.multiple ? 'one or more ' : 'one '
            }${getSemanticSelectionType(arg.selectionTypes).join(' or ') || (arg.multiple ? 'objects' : 'object')}`}
        <span data-testid="cmd-bar-arg-name" className="sr-only">
          {arg.name}
        </span>
        <input
          {...noAutofillInputProps}
          id="selection"
          name="selection"
          ref={inputRef}
          required
          data-testid="cmd-bar-arg-value"
          placeholder="Select an entity with your mouse"
          className="absolute inset-0 w-full h-full opacity-0 cursor-default"
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.metaKey) {
              stepBack()
            } else if (event.key === 'Escape') {
              commands.send({ type: 'Close' })
            }
          }}
          onChange={handleChange}
          value={JSON.stringify(selection || {})}
        />
      </label>
      {arg.description && (
        <div
          className="mx-4 mb-4 mt-2 text-sm leading-relaxed text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown [&_strong]:font-semibold [&_strong]:text-chalkboard-90 dark:[&_strong]:text-chalkboard-20"
          dangerouslySetInnerHTML={{
            __html: Marked.parse(arg.description, {
              gfm: true,
              breaks: true,
            }),
          }}
        />
      )}
    </form>
  )
}

export default CommandBarSelectionInput
