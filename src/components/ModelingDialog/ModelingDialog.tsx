import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import toast from 'react-hot-toast'

import { MarkdownText } from '@src/components/MarkdownText'
import { useApp, useSingletons } from '@src/lib/boot'
import { isKclCommandValue } from '@src/lib/commandUtils'
import type {
  CommandArgument,
  CommandArgumentOption,
  CommandDialogGroup,
} from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { MODELING_AREA_CONTAINER_ID } from '@src/lib/layout/modelingArea'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  AdvancedSection,
  ArgumentField,
  ArgumentGroup,
  DialogHeader,
  Draggable,
  type SelectionListItem,
  SubmitButton,
} from '@kittycad/ui-components'

type ModelingDialogField = {
  argName: string
  arg: CommandArgument<unknown>
  isHidden: boolean
  isRequired: boolean
  options: CommandArgumentOption<unknown>[]
}

type ResolvedModelingDialogGroup = CommandDialogGroup & {
  fields: ModelingDialogField[]
}

type CapturedSelectionListItem = SelectionListItem & {
  source: 'graphSelections' | 'otherSelections'
  index: number
}

const MODELING_DIALOG_TOOLBAR_GAP_PX = 8
const DEFAULT_DIALOG_GROUP_ID = 'parameters'
const EMPTY_SELECTION: Selections = {
  graphSelections: [],
  otherSelections: [],
}

const DEFAULT_DIALOG_GROUP: CommandDialogGroup = {
  id: DEFAULT_DIALOG_GROUP_ID,
  title: 'Parameters',
}

function getToolbarBottomOffset(wrapper: HTMLElement | null): number {
  if (typeof window === 'undefined') return 0

  const toolbar = window.document.querySelector<HTMLElement>(
    '[data-testid="toolbar"]'
  )
  if (!toolbar) return 0

  const wrapperTop = wrapper?.getBoundingClientRect().top ?? 0
  return Math.max(
    0,
    toolbar.getBoundingClientRect().bottom -
      wrapperTop +
      MODELING_DIALOG_TOOLBAR_GAP_PX
  )
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

function removeSelectionItem(
  value: unknown,
  source: CapturedSelectionListItem['source'],
  selectionIndex: number
): Selections | undefined {
  if (!value || typeof value !== 'object') return undefined

  const graphSelections = isArray(
    (value as Partial<Selections>).graphSelections
  )
    ? (value as Selections).graphSelections
    : []
  const otherSelections = isArray(
    (value as Partial<Selections>).otherSelections
  )
    ? (value as Selections).otherSelections
    : []
  const nextSelection: Selections = {
    graphSelections:
      source === 'graphSelections'
        ? graphSelections.filter((_, index) => index !== selectionIndex)
        : graphSelections,
    otherSelections:
      source === 'otherSelections'
        ? otherSelections.filter((_, index) => index !== selectionIndex)
        : otherSelections,
  }

  return isSelectionValueEmpty(nextSelection) ? undefined : nextSelection
}

function hasMeaningfulDialogValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (typeof value === 'boolean') return true
  if (isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    return !isSelectionValueEmpty(value)
  }
  return true
}

function toTitleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function resolveDialogGroups(
  fields: ModelingDialogField[],
  groups: CommandDialogGroup[] | undefined,
  draftValues: Record<string, unknown>
): ResolvedModelingDialogGroup[] {
  if (!groups?.length) return []

  const groupMap = new Map<string, ResolvedModelingDialogGroup>()
  const orderedGroups: ResolvedModelingDialogGroup[] = []

  for (const group of groups) {
    const resolvedGroup = {
      ...group,
      fields: [],
    }
    groupMap.set(group.id, resolvedGroup)
    orderedGroups.push(resolvedGroup)
  }

  for (const field of fields) {
    const groupId = field.arg.dialog?.group || DEFAULT_DIALOG_GROUP_ID
    let group = groupMap.get(groupId)

    if (!group) {
      group = {
        ...(groupId === DEFAULT_DIALOG_GROUP_ID
          ? DEFAULT_DIALOG_GROUP
          : { id: groupId, title: toTitleCase(groupId) }),
        fields: [],
      }
      groupMap.set(groupId, group)
      orderedGroups.push(group)
    }

    group.fields.push(field)
  }

  return orderedGroups
    .filter((group) => group.fields.length > 0)
    .map((group) => ({
      ...group,
      defaultOpen:
        group.defaultOpen ||
        group.fields.some((field) =>
          hasMeaningfulDialogValue(draftValues[field.argName])
        ),
    }))
}

function shouldResolveDefaultValue(
  arg: CommandArgument<unknown>,
  isRequired: boolean
): boolean {
  return isRequired || !!arg.prepopulate || !!arg.skip
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

function getSelectionItemLabel(ast: unknown, selection: Selections): string {
  const summary = selectionSummary(ast, selection).replace(/^1\s+/, '')
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}

function getSelectionListItems(
  ast: unknown,
  selection: Selections | undefined
): CapturedSelectionListItem[] {
  if (!selection) return []

  const items: CapturedSelectionListItem[] = []

  selection.graphSelections.forEach((graphSelection, index) => {
    items.push({
      id: `graph-${index}`,
      source: 'graphSelections',
      index,
      label: getSelectionItemLabel(ast, {
        graphSelections: [graphSelection],
        otherSelections: [],
      }),
    })
  })

  selection.otherSelections.forEach((otherSelection, index) => {
    items.push({
      id: `other-${index}`,
      source: 'otherSelections',
      index,
      label: getSelectionItemLabel(ast, {
        graphSelections: [],
        otherSelections: [otherSelection],
      }),
    })
  })

  return items
}

export function ModelingDialog() {
  const { commands, wasmPromise } = useApp()
  const { kclManager } = useSingletons()
  const {
    context: { selectionRanges },
    send: modelingSend,
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
  const pendingSelectionSyncArgNameRef = useRef<string | null>(null)
  const [didAutoEnableSelection, setDidAutoEnableSelection] = useState(false)
  const dialogPositioningRef = useRef<HTMLDivElement>(null)
  const [dialogTopOffset, setDialogTopOffset] = useState(() =>
    getToolbarBottomOffset(null)
  )
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

  useLayoutEffect(() => {
    const updateDialogTopOffset = () => {
      setDialogTopOffset(getToolbarBottomOffset(dialogPositioningRef.current))
    }

    updateDialogTopOffset()

    const toolbar = window.document.querySelector<HTMLElement>(
      '[data-testid="toolbar"]'
    )
    if (!toolbar) return

    const observer = new ResizeObserver(updateDialogTopOffset)
    observer.observe(toolbar)
    window.addEventListener('resize', updateDialogTopOffset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDialogTopOffset)
    }
  }, [selectedCommand])

  useEffect(() => {
    setActiveSelectionArgName(null)
    setDidAutoEnableSelection(false)
  }, [selectedCommand])

  useEffect(() => {
    const syncSelectionArgName =
      pendingSelectionSyncArgNameRef.current ?? activeSelectionArgName

    if (!syncSelectionArgName || !selectedCommand?.args) return
    const arg = selectedCommand.args[syncSelectionArgName]
    if (
      !arg ||
      (arg.inputType !== 'selection' && arg.inputType !== 'selectionMixed')
    ) {
      return
    }

    const nextSelection = isSelectionValueEmpty(selectionRanges)
      ? undefined
      : structuredClone(selectionRanges)
    pendingSelectionSyncArgNameRef.current = null
    setDraftValues((prev) => ({
      ...prev,
      [syncSelectionArgName]: nextSelection,
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

  const removeDraftSelection = useCallback(
    (
      argName: string,
      source: CapturedSelectionListItem['source'],
      selectionIndex: number
    ) => {
      const nextSelection = removeSelectionItem(
        draftValues[argName],
        source,
        selectionIndex
      )

      setDraftValues((prev) => ({
        ...prev,
        [argName]: nextSelection,
      }))
      pendingSelectionSyncArgNameRef.current = argName
      setActiveSelectionArgName(argName)
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: nextSelection ?? EMPTY_SELECTION,
        },
      })
    },
    [draftValues, modelingSend]
  )

  const clearDraftSelection = useCallback(
    (argName: string) => {
      setDraftValues((prev) => ({
        ...prev,
        [argName]: undefined,
      }))
      pendingSelectionSyncArgNameRef.current = argName
      setActiveSelectionArgName(argName)
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: EMPTY_SELECTION,
        },
      })
    },
    [modelingSend]
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

  const visibleFields = fields.filter((field) => !field.isHidden)
  const groupedFields = resolveDialogGroups(
    visibleFields,
    selectedCommand.dialogLayout?.groups,
    draftValues
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

  function renderField({
    argName,
    arg,
    isRequired,
    options,
  }: ModelingDialogField) {
    const key = `${argName}-${arg.inputType}`
    const value = draftValues[argName]

    const capturedSelection =
      (arg.inputType === 'selection' || arg.inputType === 'selectionMixed') &&
      (draftValues[argName] as Selections | undefined) &&
      !isSelectionValueEmpty(draftValues[argName])
        ? (draftValues[argName] as Selections)
        : undefined
    const isSelecting = activeSelectionArgName === argName
    const currentSelection = isSelectionValueEmpty(selectionRanges)
      ? undefined
      : selectionRanges
    const capturedSelectionItems = getSelectionListItems(
      kclManager.astSignal.value,
      capturedSelection
    )

    return (
      <ArgumentField
        key={key}
        name={argName}
        inputType={arg.inputType}
        label={arg.displayName || argName}
        description={
          arg.description ? (
            <MarkdownText
              text={arg.description}
              className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
            />
          ) : undefined
        }
        isRequired={isRequired}
        options={options}
        controlStyle={arg.dialog?.controlStyle}
        value={value}
        selectionItems={capturedSelectionItems}
        selectionHeading={arg.dialog?.selectionHeading || arg.displayName}
        selectionEmptyLabel={arg.dialog?.selectionEmptyLabel}
        selectionHint={arg.dialog?.selectionHint}
        isSelecting={isSelecting}
        currentSelectionLabel={selectionSummary(
          kclManager.astSignal.value,
          currentSelection
        )}
        onChange={(nextValue) =>
          setDraftValues((prev) => ({
            ...prev,
            [argName]: nextValue,
          }))
        }
        onStartSelecting={() => startSelectingArgument(argName, arg)}
        onRemoveSelection={(item) => {
          startSelectingArgument(argName, arg)
          removeDraftSelection(argName, item.source, item.index)
        }}
        onClearSelection={() => {
          startSelectingArgument(argName, arg)
          clearDraftSelection(argName)
        }}
      />
    )
  }

  return (
    <div
      ref={dialogPositioningRef}
      className="w-full pointer-events-none"
      style={{ paddingTop: dialogTopOffset }}
    >
      <Draggable
        className="relative ml-auto mr-2 pointer-events-auto flex !h-auto w-full max-w-[21rem] flex-col overflow-hidden border rounded shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
        containerRef={modelingAreaContainerRef}
        startInContainer
        data-testid="modeling-dialog"
        style={{ maxHeight: `calc(100vh - ${dialogTopOffset + 16}px)` }}
        Handle={
          <DialogHeader
            title={selectedCommand.displayName || selectedCommand.name}
            onClose={() => commands.send({ type: 'Close' })}
          />
        }
      >
        <form
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          className="flex min-h-0 w-full flex-col px-3 pb-3 pt-2 text-xs"
        >
          {selectedCommand.description && (
            <p className="mt-1 mb-2 text-xs leading-tight text-chalkboard-70 dark:text-chalkboard-40">
              {selectedCommand.description}
            </p>
          )}

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            {groupedFields.length > 0
              ? groupedFields.map((group) =>
                  group.collapsible ? (
                    <AdvancedSection
                      key={group.id}
                      title={group.title}
                      description={group.description}
                      defaultOpen={group.defaultOpen}
                    >
                      {group.fields.map(renderField)}
                    </AdvancedSection>
                  ) : (
                    <ArgumentGroup
                      key={group.id}
                      title={group.title}
                      description={group.description}
                    >
                      {group.fields.map(renderField)}
                    </ArgumentGroup>
                  )
                )
              : visibleFields.map(renderField)}
          </div>

          {reviewValidationError && (
            <p className="mt-2 mb-0 text-xs leading-tight text-destroy-70 dark:text-destroy-40">
              {reviewValidationError}
            </p>
          )}

          <div className="mt-3 flex shrink-0 items-center justify-end gap-1.5">
            <SubmitButton
              disabled={isSubmitting}
              isChecking={isCheckingArguments}
            />
          </div>
        </form>
      </Draggable>
    </div>
  )
}

export default ModelingDialog
