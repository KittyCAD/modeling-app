import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { MarkdownText } from '@src/components/MarkdownText'
import Tooltip from '@src/components/Tooltip'
import { useApp, useSingletons } from '@src/lib/boot'
import { isKclCommandValue } from '@src/lib/commandUtils'
import type {
  CommandArgument,
  CommandArgumentOption,
} from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { MODELING_AREA_CONTAINER_ID } from '@src/lib/layout/modelingArea'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { Draggable } from '@kittycad/ui-components'

type ModelingDialogField = {
  argName: string
  arg: CommandArgument<unknown>
  isHidden: boolean
  isRequired: boolean
  options: CommandArgumentOption<unknown>[]
}

function isSelectionValueEmpty(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true

  const selection = value as Partial<Selections>
  const graphSelections = isArray(selection.graphSelections)
    ? selection.graphSelections
    : []
  const otherSelections = isArray(selection.otherSelections)
    ? selection.otherSelections
    : []

  return graphSelections.length === 0 && otherSelections.length === 0
}

function shouldResolveDefaultValue(
  arg: CommandArgument<unknown>,
  isRequired: boolean
): boolean {
  return isRequired || !!arg.prepopulate || !!arg.skip
}

function isOptionValueEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

function resolveContextValue(
  value: unknown,
  context: CommandBarContext
): unknown {
  return typeof value === 'function' ? value(context) : value
}

async function resolveDefaultValue(
  arg: CommandArgument<unknown>,
  context: CommandBarContext,
  wasmInstance: unknown
): Promise<unknown> {
  if (!('defaultValue' in arg) || arg.defaultValue === undefined) {
    return undefined
  }
  const machineContext = arg.machineActor?.getSnapshot().context
  if (typeof arg.defaultValue === 'function') {
    return arg.defaultValue(context, machineContext, wasmInstance as never)
  }
  return arg.defaultValue
}

function evaluateVisibility(
  arg: CommandArgument<unknown>,
  context: CommandBarContext
): { isHidden: boolean; isRequired: boolean } {
  const machineContext = arg.machineActor?.getSnapshot().context
  const isHidden =
    typeof arg.hidden === 'function'
      ? arg.hidden(context, machineContext)
      : !!arg.hidden
  const isRequired =
    typeof arg.required === 'function'
      ? arg.required(context, machineContext)
      : !!arg.required
  return { isHidden, isRequired }
}

function getOptions(
  arg: CommandArgument<unknown>,
  context: CommandBarContext
): CommandArgumentOption<unknown>[] {
  if (arg.inputType !== 'options') return []
  const machineContext = arg.machineActor?.getSnapshot().context
  if (typeof arg.options === 'function') {
    return arg.options(context, machineContext)
  }
  return arg.options
}

function selectionSummary(
  ast: unknown,
  selection: Selections | undefined
): string {
  if (!selection) return 'No selection captured'
  return getSelectionTypeDisplayText(ast as never, selection) ?? 'No selection'
}

export function ModelingDialog() {
  const { commands, wasmPromise } = useApp()
  const { kclManager } = useSingletons()
  const {
    context: { selectionRanges },
  } = useModelingContext()
  const commandBarState = commands.useState()
  const {
    context: { selectedCommand, reviewValidationError },
  } = commandBarState

  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeSelectionArgName, setActiveSelectionArgName] = useState<
    string | null
  >(null)
  const [didAutoEnableSelection, setDidAutoEnableSelection] = useState(false)
  const modelingAreaContainerRef = useRef<HTMLElement | null>(
    typeof window === 'undefined'
      ? null
      : window.document.getElementById(MODELING_AREA_CONTAINER_ID)
  )

  const dialogContext = useMemo<CommandBarContext>(
    () => ({
      ...commandBarState.context,
      argumentsToSubmit: draftValues,
    }),
    [commandBarState.context, draftValues]
  )

  const fields = useMemo<ModelingDialogField[]>(() => {
    if (!selectedCommand?.args) return []
    return Object.entries(selectedCommand.args).map(([argName, arg]) => {
      const { isHidden, isRequired } = evaluateVisibility(arg, dialogContext)
      return {
        argName,
        arg,
        isHidden,
        isRequired,
        options: getOptions(arg, dialogContext),
      }
    })
  }, [selectedCommand?.args, dialogContext])

  useEffect(() => {
    let isCancelled = false

    async function initDraftValues() {
      if (!selectedCommand?.args) {
        setDraftValues({})
        return
      }
      const wasmInstance = await wasmPromise
      const nextValues: Record<string, unknown> = {}

      for (const [argName, arg] of Object.entries(selectedCommand.args)) {
        const contextWithDraft: CommandBarContext = {
          ...commandBarState.context,
          argumentsToSubmit: {
            ...commandBarState.context.argumentsToSubmit,
            ...nextValues,
          },
        }
        const existingValue = resolveContextValue(
          commandBarState.context.argumentsToSubmit[argName],
          contextWithDraft
        )
        const { isRequired } = evaluateVisibility(arg, contextWithDraft)
        const defaultValue =
          existingValue === undefined &&
          shouldResolveDefaultValue(arg, isRequired)
            ? await resolveDefaultValue(arg, contextWithDraft, wasmInstance)
            : undefined
        let resolvedValue = existingValue ?? defaultValue

        if (
          (arg.inputType === 'selection' ||
            arg.inputType === 'selectionMixed') &&
          isSelectionValueEmpty(resolvedValue)
        ) {
          resolvedValue = undefined
        }

        if (
          (arg.inputType === 'kcl' ||
            arg.inputType === 'vector2d' ||
            arg.inputType === 'vector3d') &&
          isKclCommandValue(resolvedValue)
        ) {
          nextValues[argName] = resolvedValue.valueText
        } else {
          nextValues[argName] = resolvedValue
        }
      }

      if (!isCancelled) {
        setDraftValues(nextValues)
      }
    }

    void initDraftValues()

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize form on command selection
  }, [selectedCommand, wasmPromise])

  useEffect(() => {
    modelingAreaContainerRef.current = window.document.getElementById(
      MODELING_AREA_CONTAINER_ID
    )
  }, [selectedCommand])

  useEffect(() => {
    setActiveSelectionArgName(null)
    setDidAutoEnableSelection(false)
  }, [selectedCommand])

  useEffect(() => {
    if (!activeSelectionArgName || !selectedCommand?.args) return
    const arg = selectedCommand.args[activeSelectionArgName]
    if (
      !arg ||
      (arg.inputType !== 'selection' && arg.inputType !== 'selectionMixed')
    ) {
      return
    }

    const nextSelection = isSelectionValueEmpty(selectionRanges)
      ? undefined
      : structuredClone(selectionRanges)
    setDraftValues((prev) => ({
      ...prev,
      [activeSelectionArgName]: nextSelection,
    }))
  }, [activeSelectionArgName, selectionRanges, selectedCommand?.args])

  useEffect(() => {
    if (!activeSelectionArgName || !selectedCommand?.args) return
    const arg = selectedCommand.args[activeSelectionArgName]
    if (
      !arg ||
      (arg.inputType !== 'selection' && arg.inputType !== 'selectionMixed')
    ) {
      return
    }

    let isCancelled = false
    void wasmPromise.then((wasmInstance) => {
      if (isCancelled) return
      if (arg.selectionFilter) {
        kclManager.setSelectionFilter(arg.selectionFilter, wasmInstance)
      }
    })

    return () => {
      isCancelled = true
      void wasmPromise.then((wasmInstance) => {
        kclManager.setSelectionFilterToDefault(wasmInstance)
      })
    }
  }, [activeSelectionArgName, kclManager, selectedCommand?.args, wasmPromise])

  const startSelectingArgument = useCallback(
    (argName: string, arg: CommandArgument<unknown>) => {
      commands.send({
        type: 'Change current argument',
        data: {
          arg: {
            ...arg,
            name: argName,
          },
        },
      })
      setActiveSelectionArgName(argName)
    },
    [commands]
  )

  useEffect(() => {
    if (didAutoEnableSelection || activeSelectionArgName !== null) return

    const hasAnySelectionArg = fields.some(
      ({ arg }) =>
        arg.inputType === 'selection' || arg.inputType === 'selectionMixed'
    )

    if (!hasAnySelectionArg) {
      setDidAutoEnableSelection(true)
      return
    }

    const firstVisibleSelectionField = fields.find(
      ({ isHidden, arg }) =>
        !isHidden &&
        (arg.inputType === 'selection' || arg.inputType === 'selectionMixed')
    )

    if (!firstVisibleSelectionField) return

    startSelectingArgument(
      firstVisibleSelectionField.argName,
      firstVisibleSelectionField.arg
    )
    setDidAutoEnableSelection(true)
  }, [
    activeSelectionArgName,
    didAutoEnableSelection,
    fields,
    startSelectingArgument,
  ])

  if (!selectedCommand?.args) return null

  const isCheckingArguments = commandBarState.matches(
    'Checking Arguments for Dialog'
  )

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      if (!selectedCommand?.args) {
        return
      }
      const wasmInstance = await wasmPromise
      const argumentsToSubmit: Record<string, unknown> = {
        ...draftValues,
      }

      for (const [argName, arg] of Object.entries(selectedCommand.args)) {
        const currentContext: CommandBarContext = {
          ...commandBarState.context,
          argumentsToSubmit,
        }
        const { isRequired } = evaluateVisibility(arg, currentContext)
        let value = argumentsToSubmit[argName]

        if (
          (value === undefined || value === '') &&
          shouldResolveDefaultValue(arg, isRequired)
        ) {
          const defaultValue = await resolveDefaultValue(
            arg,
            currentContext,
            wasmInstance
          )
          value = defaultValue
        }

        if (
          (arg.inputType === 'selection' ||
            arg.inputType === 'selectionMixed') &&
          isSelectionValueEmpty(value)
        ) {
          value = undefined
        }

        if (arg.inputType === 'options') {
          const options = getOptions(arg, currentContext)
          if (value === undefined && options.length > 0 && isRequired) {
            value = (options.find((option) => option.isCurrent) || options[0])
              .value
          }
        } else if (arg.inputType === 'boolean' && value === '') {
          value = undefined
        } else if (
          (arg.inputType === 'string' ||
            arg.inputType === 'text' ||
            arg.inputType === 'color' ||
            arg.inputType === 'tagDeclarator') &&
          typeof value === 'string'
        ) {
          value = value.trim() === '' && !isRequired ? undefined : value
        } else if (
          arg.inputType === 'kcl' ||
          arg.inputType === 'vector2d' ||
          arg.inputType === 'vector3d'
        ) {
          if (value === undefined || value === '') {
            value = undefined
          } else if (typeof value === 'string') {
            const trimmed = value.trim()
            const expression =
              arg.inputType === 'vector2d' || arg.inputType === 'vector3d'
                ? trimmed.startsWith('[')
                  ? trimmed
                  : `[${trimmed}]`
                : trimmed
            const parsed = await stringToKclExpression(
              expression,
              kclManager.rustContext,
              {
                allowArrays:
                  arg.inputType === 'vector2d' ||
                  arg.inputType === 'vector3d' ||
                  arg.allowArrays,
              }
            )
            if (err(parsed) || 'errors' in parsed) {
              const label = arg.displayName || argName
              toast.error(`Invalid expression for "${label}"`)
              return
            }
            value = parsed
          }
        }

        argumentsToSubmit[argName] = value
      }

      commands.send({
        type: 'Submit command from dialog',
        data: { argumentsToSubmit },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Draggable
      className="relative self-center pointer-events-auto w-full max-w-[21rem] border rounded shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
      containerRef={modelingAreaContainerRef}
      startInContainer
      data-testid="modeling-dialog"
      Handle={
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-chalkboard-20 dark:border-chalkboard-70 cursor-move select-none">
          <CustomIcon
            name="three-dots"
            className="w-3.5 h-3.5 text-chalkboard-60 dark:text-chalkboard-40"
          />
          <span className="text-xs uppercase tracking-wide text-chalkboard-60 dark:text-chalkboard-40">
            {selectedCommand.displayName || selectedCommand.name}
          </span>
        </div>
      }
    >
      <button
        data-testid="command-bar-close-button"
        onClick={() => commands.send({ type: 'Close' })}
        className="group m-0 p-0 border-none bg-transparent hover:bg-transparent !absolute right-2 top-2"
        type="button"
      >
        <CustomIcon
          name="close"
          className="w-4 h-4 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
        />
        <Tooltip position="bottom">
          Cancel <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">esc</kbd>
        </Tooltip>
      </button>
      <form
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
        className="w-full px-3 pb-3 pt-2 text-xs"
      >
        {selectedCommand.description && (
          <p className="mt-1 mb-2 text-xs leading-tight text-chalkboard-70 dark:text-chalkboard-40">
            {selectedCommand.description}
          </p>
        )}

        <div className="flex flex-col gap-2.5 max-h-[30vh] overflow-y-auto pr-1">
          {fields
            .filter((field) => !field.isHidden)
            .map(({ argName, arg, isRequired, options }) => {
              const key = `${argName}-${arg.inputType}`
              const label = arg.displayName || argName
              const value = draftValues[argName]

              if (arg.inputType === 'options') {
                const selectedIndex = options.findIndex((option) =>
                  isOptionValueEqual(option.value, value)
                )

                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium leading-tight">
                      {label}
                      {isRequired ? ' *' : ''}
                    </span>
                    <select
                      value={selectedIndex >= 0 ? String(selectedIndex) : ''}
                      onChange={(event) => {
                        const rawIndex = event.target.value
                        const nextValue =
                          rawIndex === ''
                            ? undefined
                            : options[Number(rawIndex)]?.value
                        setDraftValues((prev) => ({
                          ...prev,
                          [argName]: nextValue,
                        }))
                      }}
                      className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
                    >
                      <option value="" disabled={isRequired}>
                        {isRequired ? 'Select an option' : 'Optional'}
                      </option>
                      {options.map((option, index) => (
                        <option
                          key={`${argName}-${String(option.name)}-${index}`}
                          value={String(index)}
                          disabled={option.disabled}
                        >
                          {option.name}
                        </option>
                      ))}
                    </select>
                    {arg.description && (
                      <MarkdownText
                        text={arg.description}
                        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                      />
                    )}
                  </label>
                )
              }

              if (arg.inputType === 'boolean') {
                const boolValue =
                  value === true ? 'true' : value === false ? 'false' : ''
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium leading-tight">
                      {label}
                      {isRequired ? ' *' : ''}
                    </span>
                    <select
                      value={boolValue}
                      onChange={(event) => {
                        const nextValue =
                          event.target.value === ''
                            ? undefined
                            : event.target.value === 'true'
                        setDraftValues((prev) => ({
                          ...prev,
                          [argName]: nextValue,
                        }))
                      }}
                      className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
                    >
                      <option value="" disabled={isRequired}>
                        {isRequired ? 'Select true or false' : 'Optional'}
                      </option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                    {arg.description && (
                      <MarkdownText
                        text={arg.description}
                        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                      />
                    )}
                  </label>
                )
              }

              if (
                arg.inputType === 'selection' ||
                arg.inputType === 'selectionMixed'
              ) {
                const capturedSelection =
                  (draftValues[argName] as Selections | undefined) &&
                  !isSelectionValueEmpty(draftValues[argName])
                    ? (draftValues[argName] as Selections)
                    : undefined
                const isSelecting = activeSelectionArgName === argName
                const currentSelection = isSelectionValueEmpty(selectionRanges)
                  ? undefined
                  : selectionRanges
                return (
                  <div key={key} className="flex flex-col gap-2">
                    <span className="text-xs font-medium leading-tight">
                      {label}
                      {isRequired ? ' *' : ''}
                    </span>
                    <p className="my-0 text-xs leading-tight text-chalkboard-70 dark:text-chalkboard-40">
                      Captured:{' '}
                      {selectionSummary(
                        kclManager.astSignal.value,
                        capturedSelection
                      )}
                    </p>
                    {isSelecting && (
                      <p className="my-0 text-[10px] leading-tight text-primary dark:text-primary">
                        Selecting now:{' '}
                        {selectionSummary(
                          kclManager.astSignal.value,
                          currentSelection
                        )}
                      </p>
                    )}
                    <div>
                      <ActionButton
                        Element="button"
                        type="button"
                        tabIndex={0}
                        onClick={() => {
                          if (isSelecting) {
                            setActiveSelectionArgName(null)
                            return
                          }
                          startSelectingArgument(argName, arg)
                        }}
                        className="px-2 py-1 text-xs"
                      >
                        {isSelecting ? 'Stop Selecting' : 'Select'}
                      </ActionButton>
                    </div>
                    {arg.description && (
                      <MarkdownText
                        text={arg.description}
                        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                      />
                    )}
                  </div>
                )
              }

              if (arg.inputType === 'text') {
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium leading-tight">
                      {label}
                      {isRequired ? ' *' : ''}
                    </span>
                    <textarea
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) =>
                        setDraftValues((prev) => ({
                          ...prev,
                          [argName]: event.target.value,
                        }))
                      }
                      className="min-h-16 w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
                      placeholder={label}
                    />
                    {arg.description && (
                      <MarkdownText
                        text={arg.description}
                        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                      />
                    )}
                  </label>
                )
              }

              if (
                arg.inputType === 'kcl' ||
                arg.inputType === 'vector2d' ||
                arg.inputType === 'vector3d'
              ) {
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium leading-tight">
                      {label}
                      {isRequired ? ' *' : ''}
                    </span>
                    <input
                      type="text"
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) =>
                        setDraftValues((prev) => ({
                          ...prev,
                          [argName]: event.target.value,
                        }))
                      }
                      className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
                      placeholder={
                        arg.inputType === 'vector2d'
                          ? '[x, y]'
                          : arg.inputType === 'vector3d'
                            ? '[x, y, z]'
                            : label
                      }
                    />
                    {arg.description && (
                      <MarkdownText
                        text={arg.description}
                        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                      />
                    )}
                  </label>
                )
              }

              if (arg.inputType === 'color') {
                const colorValue =
                  typeof value === 'string' && value.startsWith('#')
                    ? value
                    : '#ffffff'
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium leading-tight">
                      {label}
                      {isRequired ? ' *' : ''}
                    </span>
                    <input
                      type="color"
                      value={colorValue}
                      onChange={(event) =>
                        setDraftValues((prev) => ({
                          ...prev,
                          [argName]: event.target.value,
                        }))
                      }
                      className="h-8 w-full rounded border border-chalkboard-30 bg-transparent"
                    />
                    {arg.description && (
                      <MarkdownText
                        text={arg.description}
                        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                      />
                    )}
                  </label>
                )
              }

              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs font-medium leading-tight">
                    {label}
                    {isRequired ? ' *' : ''}
                  </span>
                  <input
                    type="text"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) =>
                      setDraftValues((prev) => ({
                        ...prev,
                        [argName]: event.target.value,
                      }))
                    }
                    className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
                    placeholder={label}
                  />
                  {arg.description && (
                    <MarkdownText
                      text={arg.description}
                      className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
                    />
                  )}
                </label>
              )
            })}
        </div>

        {reviewValidationError && (
          <p className="mt-2 mb-0 text-xs leading-tight text-destroy-70 dark:text-destroy-40">
            {reviewValidationError}
          </p>
        )}

        <div className="mt-3 flex items-center justify-end gap-1.5">
          <ActionButton
            Element="button"
            type="submit"
            tabIndex={0}
            className="w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current bg-primary border-primary text-chalkboard-10"
            disabled={isSubmitting || isCheckingArguments}
            iconEnd={{
              icon: 'checkmark',
              bgClassName: 'p-1 rounded-sm bg-primary',
              iconClassName: 'text-chalkboard-10',
            }}
          >
            <span className="pl-1.5 pr-1 text-xs">
              {isCheckingArguments ? 'Submitting...' : 'Submit'}
            </span>
          </ActionButton>
        </div>
      </form>
    </Draggable>
  )
}

export default ModelingDialog
