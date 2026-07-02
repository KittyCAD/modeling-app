import { useSignals } from '@preact/signals-react/runtime'
import { useSelector } from '@xstate/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import toast from 'react-hot-toast'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'

import {
  AdvancedSection,
  ArgumentField,
  ArgumentGroup,
  DialogHeader,
  Draggable,
  type SelectionListItem,
  SubmitButton,
} from '@kittycad/ui-components'
import { MarkdownText } from '@src/components/MarkdownText'
import {
  ModelingDialogKclInput,
  type ModelingDialogKclValidationState,
  getKclInputValue,
  getKclSubmitValue,
} from '@src/components/ModelingDialog/ModelingDialogKclInput'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { coerceSelectionsToBody } from '@src/lang/std/artifactGraph'
import { useApp, useSingletons } from '@src/lib/boot'
import type {
  CommandArgument,
  CommandArgumentOption,
  CommandDialogGroup,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { MODELING_AREA_CONTAINER_ID } from '@src/lib/layout/modelingArea'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
  getSelectionTypeDisplayText,
  handleSelectionBatch,
} from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'

type ModelingDialogField = {
  argName: string
  arg: CommandArgument<unknown>
  isHidden: boolean
  isRequired: boolean
  isDisabled: boolean
  options: CommandArgumentOption<unknown>[]
}

type ResolvedModelingDialogGroup = CommandDialogGroup & {
  fields: ModelingDialogField[]
}

type CapturedSelectionListItem = SelectionListItem & {
  source: 'graphSelections' | 'otherSelections'
  index: number
}

type SelectionCommandArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'selection' | 'selectionMixed' }
>
type MachineContext = SnapshotFrom<AnyStateMachine>['context']

type DialogArgumentResolution =
  | { ok: true; argumentsToSubmit: Record<string, unknown> }
  | {
      ok: false
      reason:
        | 'missingCommand'
        | 'missingRequired'
        | 'invalidExpression'
        | 'invalidSelection'
      message?: string
    }

type ReviewValidationState =
  | { status: 'idle' | 'checking' | 'valid'; error?: undefined }
  | { status: 'invalid'; error: string }

const MODELING_DIALOG_TOOLBAR_GAP_PX = 8
const REVIEW_VALIDATION_DEBOUNCE_MS = 350
const DEFAULT_DIALOG_GROUP_ID = 'parameters'
const DISABLED_SELECTION_EDIT_TOOLTIP = "Selection edits aren't supported yet."
const EMPTY_SELECTION: Selections = {
  graphSelections: [],
  otherSelections: [],
}

const DEFAULT_DIALOG_GROUP: CommandDialogGroup = {
  id: DEFAULT_DIALOG_GROUP_ID,
  title: 'Parameters',
}

const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function getToolbarBottomOffset(wrapper: HTMLElement | null): number {
  if (typeof window === 'undefined') {
    return 0
  }

  const toolbar = window.document.querySelector<HTMLElement>(
    '[data-testid="toolbar"]'
  )
  if (!toolbar) {
    return 0
  }

  const wrapperTop = wrapper?.getBoundingClientRect().top ?? 0
  return Math.max(
    0,
    toolbar.getBoundingClientRect().bottom -
      wrapperTop +
      MODELING_DIALOG_TOOLBAR_GAP_PX
  )
}

function isSelectionValueEmpty(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return true
  }

  const selection = value as Partial<Selections>
  const graphSelections = isArray(selection.graphSelections)
    ? selection.graphSelections
    : []
  const otherSelections = isArray(selection.otherSelections)
    ? selection.otherSelections
    : []

  return graphSelections.length === 0 && otherSelections.length === 0
}

function isSelectionArgument(
  arg: CommandArgument<unknown>
): arg is SelectionCommandArgument {
  return arg.inputType === 'selection' || arg.inputType === 'selectionMixed'
}

function hasNonZeroGraphSelection(selection: Selections | undefined): boolean {
  return (
    selection?.graphSelections.some(
      (graphSelection) =>
        graphSelection.codeRef.range[1] - graphSelection.codeRef.range[0] !== 0
    ) ?? false
  )
}

function isBodyOnlySelectionArgument(arg: SelectionCommandArgument): boolean {
  return (
    arg.inputType === 'selectionMixed' &&
    arg.selectionTypes.every(
      (type) => type === 'path' || type === 'sweep' || type === 'compositeSolid'
    )
  )
}

function canSubmitDialogSelection(
  ast: Parameters<typeof getSelectionCountByType>[0],
  arg: SelectionCommandArgument,
  selection: Selections | undefined,
  isRequired: boolean
): boolean {
  if (!selection) {
    return (
      !isRequired ||
      (arg.inputType === 'selectionMixed' && Boolean(arg.allowNoSelection))
    )
  }
  if (
    arg.inputType === 'selectionMixed' &&
    (!isRequired || arg.allowNoSelection)
  ) {
    return true
  }
  if (
    arg.inputType === 'selectionMixed' &&
    hasNonZeroGraphSelection(selection)
  ) {
    return true
  }
  return canSubmitSelectionArg(getSelectionCountByType(ast, selection), arg)
}

function getSelectionValidationMessage(
  argName: string,
  arg: SelectionCommandArgument,
  selection: Selections | undefined
): string {
  const label = arg.displayName || argName
  return selection ? `Invalid selection for "${label}".` : `Select "${label}".`
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  ) {
    return error.message
  }
  if (typeof error === 'string' && error) {
    return error
  }
  const stringified = String(error)
  if (stringified && stringified !== '[object Object]') {
    return stringified
  }
  return fallback
}

function removeSelectionItem(
  value: unknown,
  source: CapturedSelectionListItem['source'],
  selectionIndex: number
): Selections | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

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

function selectionValueOrUndefined(value: unknown): Selections | undefined {
  return isSelectionValueEmpty(value) ? undefined : (value as Selections)
}

function cloneSelectionValue(value: unknown): Selections | undefined {
  const selection = selectionValueOrUndefined(value)
  return selection ? structuredClone(selection) : undefined
}

function getDraftOrSubmittedValue(
  draftValues: Record<string, unknown>,
  submittedValues: Record<string, unknown>,
  argName: string
): unknown {
  return Object.prototype.hasOwnProperty.call(draftValues, argName)
    ? draftValues[argName]
    : submittedValues[argName]
}

function hasMeaningfulDialogValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return false
  }
  if (typeof value === 'boolean') {
    return true
  }
  if (isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'object') {
    if (isKclCommandValue(value)) {
      return true
    }
    return !isSelectionValueEmpty(value)
  }
  return true
}

function isMissingRequiredDialogValue(
  arg: CommandArgument<unknown>,
  value: unknown
): boolean {
  return isSelectionArgument(arg)
    ? isSelectionValueEmpty(value)
    : !hasMeaningfulDialogValue(value)
}

function toTitleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function capitalizeFirstLetter(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function resolveDialogGroups(
  fields: ModelingDialogField[],
  groups: CommandDialogGroup[] | undefined,
  draftValues: Record<string, unknown>
): ResolvedModelingDialogGroup[] {
  if (!groups?.length) {
    return []
  }

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
  wasmInstance: unknown,
  machineContext?: MachineContext
): Promise<unknown> {
  if (!('defaultValue' in arg) || arg.defaultValue === undefined) {
    return undefined
  }
  if (typeof arg.defaultValue === 'function') {
    return arg.defaultValue(context, machineContext, wasmInstance)
  }
  return arg.defaultValue
}

function evaluateVisibility(
  arg: CommandArgument<unknown>,
  context: CommandBarContext,
  machineContext?: MachineContext
): { isHidden: boolean; isRequired: boolean; isDisabled: boolean } {
  const shouldShowDisabledSelectionInEdit =
    isSelectionArgument(arg) && Boolean(context.argumentsToSubmit.nodeToEdit)
  const isRawHidden =
    typeof arg.hidden === 'function'
      ? arg.hidden(context, machineContext)
      : !!arg.hidden
  const isRequired =
    typeof arg.required === 'function'
      ? arg.required(context, machineContext)
      : !!arg.required

  return {
    isHidden: isRawHidden && !shouldShowDisabledSelectionInEdit,
    isRequired,
    isDisabled: shouldShowDisabledSelectionInEdit,
  }
}

function getOptions(
  arg: CommandArgument<unknown>,
  context: CommandBarContext,
  machineContext?: MachineContext
): CommandArgumentOption<unknown>[] {
  if (arg.inputType !== 'options') {
    return []
  }
  if (typeof arg.options === 'function') {
    return [...arg.options(context, machineContext)]
  }
  return [...arg.options]
}

function selectionSummary(
  ast: unknown,
  selection: Selections | undefined
): string {
  if (!selection) {
    return 'No selection captured'
  }
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
  if (!selection) {
    return []
  }

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
  useSignals()
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
  const selectedCommandKey = selectedCommand
    ? `${selectedCommand.groupId}:${selectedCommand.name}`
    : undefined
  const selectedMachineContext = useSelector(
    selectedCommand?.machineActor,
    machineContextSelector
  )

  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({})
  const [dirtyArgNames, setDirtyArgNames] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeSelectionArgName, setActiveSelectionArgName] = useState<
    string | null
  >(null)
  const [didAutoEnableSelection, setDidAutoEnableSelection] = useState(false)
  const [reviewValidationState, setReviewValidationState] =
    useState<ReviewValidationState>({ status: 'idle' })
  const [kclValidationStates, setKclValidationStates] = useState<
    Record<string, ModelingDialogKclValidationState>
  >({})
  const dialogPositioningRef = useRef<HTMLDivElement>(null)
  const [dialogTopOffset, setDialogTopOffset] = useState(() =>
    getToolbarBottomOffset(null)
  )
  const modelingAreaContainerRef = useRef<HTMLElement | null>(
    typeof window === 'undefined'
      ? null
      : window.document.getElementById(MODELING_AREA_CONTAINER_ID)
  )
  const dirtyArgNamesRef = useRef(dirtyArgNames)
  const selectionRangesRef = useRef(selectionRanges)
  const initializedCommandRef = useRef<typeof selectedCommand>(undefined)

  useEffect(() => {
    dirtyArgNamesRef.current = dirtyArgNames
  }, [dirtyArgNames])

  useEffect(() => {
    selectionRangesRef.current = selectionRanges
  }, [selectionRanges])

  const markArgumentDirty = useCallback((argName: string) => {
    setDirtyArgNames((prev) => {
      if (prev.has(argName)) {
        return prev
      }
      const next = new Set(prev)
      next.add(argName)
      return next
    })
  }, [])

  const coerceSelectionForArgument = useCallback(
    (
      arg: SelectionCommandArgument,
      selection: Selections | undefined
    ): Selections | undefined | Error => {
      if (!selection || !isBodyOnlySelectionArgument(arg)) {
        return selection
      }
      return coerceSelectionsToBody(selection, kclManager.artifactGraph)
    },
    [kclManager.artifactGraph]
  )

  const dialogArgumentsToSubmit = useMemo(() => {
    const nextValues = {
      ...commandBarState.context.argumentsToSubmit,
      ...draftValues,
    }

    if (activeSelectionArgName && selectedCommand?.args) {
      const activeArg = selectedCommand.args[activeSelectionArgName]
      if (activeArg && isSelectionArgument(activeArg)) {
        nextValues[activeSelectionArgName] =
          selectionValueOrUndefined(selectionRanges)
      }
    }

    return nextValues
  }, [
    activeSelectionArgName,
    commandBarState.context.argumentsToSubmit,
    draftValues,
    selectedCommand?.args,
    selectionRanges,
  ])

  const dialogContext = useMemo<CommandBarContext>(
    () => ({
      ...commandBarState.context,
      argumentsToSubmit: dialogArgumentsToSubmit,
    }),
    [commandBarState.context, dialogArgumentsToSubmit]
  )

  const fields = useMemo<ModelingDialogField[]>(() => {
    if (!selectedCommand?.args) {
      return []
    }
    return Object.entries(selectedCommand.args).map(([argName, arg]) => {
      const { isHidden, isRequired, isDisabled } = evaluateVisibility(
        arg,
        dialogContext,
        selectedMachineContext
      )
      return {
        argName,
        arg,
        isHidden,
        isRequired,
        isDisabled,
        options: getOptions(arg, dialogContext, selectedMachineContext),
      }
    })
  }, [selectedCommand?.args, dialogContext, selectedMachineContext])

  useEffect(() => {
    let isCancelled = false

    async function initDraftValues() {
      if (!selectedCommand?.args) {
        initializedCommandRef.current = undefined
        setDraftValues({})
        return
      }
      const wasmInstance = await wasmPromise
      const nextValues: Record<string, unknown> = {}

      for (const [argName, arg] of Object.entries(selectedCommand.args)) {
        if (isSelectionArgument(arg)) {
          continue
        }

        const contextWithDraft: CommandBarContext = {
          ...commandBarState.context,
          argumentsToSubmit: {
            ...commandBarState.context.argumentsToSubmit,
            ...nextValues,
          },
        }
        const { isRequired } = evaluateVisibility(
          arg,
          contextWithDraft,
          selectedMachineContext
        )
        const existingValue = resolveContextValue(
          commandBarState.context.argumentsToSubmit[argName],
          contextWithDraft
        )
        const defaultValue =
          existingValue === undefined &&
          shouldResolveDefaultValue(arg, isRequired)
            ? await resolveDefaultValue(
                arg,
                contextWithDraft,
                wasmInstance,
                selectedMachineContext
              )
            : undefined
        const resolvedValue = existingValue ?? defaultValue

        if (arg.inputType === 'kcl') {
          nextValues[argName] = getKclInputValue(arg, resolvedValue)
        } else if (
          (arg.inputType === 'vector2d' || arg.inputType === 'vector3d') &&
          isKclCommandValue(resolvedValue)
        ) {
          nextValues[argName] = resolvedValue.valueText
        } else {
          nextValues[argName] = resolvedValue
        }
      }

      if (!isCancelled) {
        setDraftValues((prev) => {
          if (initializedCommandRef.current !== selectedCommand) {
            initializedCommandRef.current = selectedCommand
            return nextValues
          }

          const nextDraftValues = { ...prev }
          for (const [argName, value] of Object.entries(nextValues)) {
            if (!dirtyArgNamesRef.current.has(argName)) {
              nextDraftValues[argName] = value
            }
          }
          return nextDraftValues
        })
      }
    }

    void initDraftValues()

    return () => {
      isCancelled = true
    }
  }, [
    commandBarState.context,
    selectedCommand,
    selectedMachineContext,
    wasmPromise,
  ])

  useEffect(() => {
    modelingAreaContainerRef.current = window.document.getElementById(
      MODELING_AREA_CONTAINER_ID
    )
  }, [])

  useLayoutEffect(() => {
    const updateDialogTopOffset = () => {
      setDialogTopOffset(getToolbarBottomOffset(dialogPositioningRef.current))
    }

    updateDialogTopOffset()

    const toolbar = window.document.querySelector<HTMLElement>(
      '[data-testid="toolbar"]'
    )
    if (!toolbar) {
      return
    }

    const observer = new ResizeObserver(updateDialogTopOffset)
    observer.observe(toolbar)
    window.addEventListener('resize', updateDialogTopOffset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDialogTopOffset)
    }
  }, [])

  useEffect(() => {
    if (!selectedCommandKey) {
      return
    }
    setDirtyArgNames(new Set())
    setActiveSelectionArgName(null)
    setDidAutoEnableSelection(false)
    setReviewValidationState({ status: 'idle' })
    setKclValidationStates({})
  }, [selectedCommandKey])

  useEffect(() => {
    if (!activeSelectionArgName || !selectedCommand?.args) {
      return
    }
    const arg = selectedCommand.args[activeSelectionArgName]
    if (!arg || !isSelectionArgument(arg)) {
      return
    }

    let isCancelled = false
    const shouldShowPlanes = arg.selectionTypes.includes('plane')

    if (shouldShowPlanes) {
      kclManager.showPlanes().catch((error) => {
        console.error('Failed to show selection planes', error)
      })
    }

    void wasmPromise.then((wasmInstance) => {
      if (isCancelled) {
        return
      }
      if (arg.selectionFilter) {
        const selectionToRestore = coerceSelectionForArgument(
          arg,
          selectionValueOrUndefined(selectionRangesRef.current)
        )
        if (err(selectionToRestore)) {
          toast.error(selectionToRestore.message)
          return
        }
        kclManager.setSelectionFilter(
          arg.selectionFilter,
          wasmInstance,
          selectionToRestore,
          handleSelectionBatch
        )
      }
    })

    return () => {
      isCancelled = true
      void wasmPromise.then((wasmInstance) => {
        kclManager.setSelectionFilterToDefault(
          wasmInstance,
          selectionRangesRef.current,
          handleSelectionBatch
        )
        if (shouldShowPlanes && !kclManager._isAstEmpty(kclManager.ast)) {
          kclManager.hidePlanes().catch((error) => {
            console.error('Failed to hide selection planes', error)
          })
        }
      })
    }
  }, [
    activeSelectionArgName,
    coerceSelectionForArgument,
    kclManager,
    selectedCommand?.args,
    wasmPromise,
  ])

  const startSelectingArgument = useCallback(
    (argName: string, arg: CommandArgument<unknown>) => {
      if (
        activeSelectionArgName &&
        activeSelectionArgName !== argName &&
        selectedCommand?.args?.[activeSelectionArgName] &&
        isSelectionArgument(selectedCommand.args[activeSelectionArgName])
      ) {
        setDraftValues((prev) => ({
          ...prev,
          [activeSelectionArgName]: cloneSelectionValue(selectionRanges),
        }))
      }

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

      if (!isSelectionArgument(arg)) {
        return
      }
      markArgumentDirty(argName)

      const savedSelection = getDraftOrSubmittedValue(
        draftValues,
        commandBarState.context.argumentsToSubmit,
        argName
      )
      if (!isSelectionValueEmpty(savedSelection)) {
        const selectionForArgument = coerceSelectionForArgument(
          arg,
          savedSelection as Selections
        )
        if (err(selectionForArgument)) {
          toast.error(selectionForArgument.message)
          return
        }
        modelingSend({
          type: 'Set selection',
          data: {
            selectionType: 'completeSelection',
            selection: structuredClone(selectionForArgument as Selections),
          },
        })
      } else if (arg.clearSelectionFirst) {
        modelingSend({
          type: 'Set selection',
          data: {
            selectionType: 'completeSelection',
            selection: EMPTY_SELECTION,
          },
        })
      } else if (!isSelectionValueEmpty(selectionRanges)) {
        const selectionForArgument = coerceSelectionForArgument(
          arg,
          selectionRanges
        )
        if (err(selectionForArgument)) {
          toast.error(selectionForArgument.message)
          return
        }
        if (selectionForArgument) {
          modelingSend({
            type: 'Set selection',
            data: {
              selectionType: 'completeSelection',
              selection: selectionForArgument,
            },
          })
        }
      }
    },
    [
      activeSelectionArgName,
      commandBarState.context.argumentsToSubmit,
      commands,
      coerceSelectionForArgument,
      draftValues,
      markArgumentDirty,
      modelingSend,
      selectedCommand?.args,
      selectionRanges,
    ]
  )

  const removeSceneSelection = useCallback(
    (
      argName: string,
      source: CapturedSelectionListItem['source'],
      selectionIndex: number,
      selection: Selections | undefined = selectionRanges
    ) => {
      const nextSelection = removeSelectionItem(
        selection,
        source,
        selectionIndex
      )

      const selectionForScene = nextSelection ?? EMPTY_SELECTION

      markArgumentDirty(argName)
      setActiveSelectionArgName(argName)
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: selectionForScene,
        },
      })
    },
    [markArgumentDirty, modelingSend, selectionRanges]
  )

  const clearSceneSelection = useCallback(
    (argName: string) => {
      markArgumentDirty(argName)
      setActiveSelectionArgName(argName)
      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: EMPTY_SELECTION,
        },
      })
    },
    [markArgumentDirty, modelingSend]
  )

  useLayoutEffect(() => {
    if (didAutoEnableSelection || activeSelectionArgName !== null) {
      return
    }

    const hasAnySelectionArg = fields.some(({ arg }) =>
      isSelectionArgument(arg)
    )

    if (!hasAnySelectionArg) {
      setDidAutoEnableSelection(true)
      return
    }

    const firstVisibleSelectionField = fields.find(
      ({ isHidden, isDisabled, arg }) =>
        !isHidden && !isDisabled && isSelectionArgument(arg)
    )

    if (!firstVisibleSelectionField) {
      setDidAutoEnableSelection(true)
      return
    }

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

  const isCheckingArguments = commandBarState.matches(
    'Checking Arguments for Dialog'
  )
  const reviewValidationErrorToDisplay =
    reviewValidationState.status === 'invalid'
      ? reviewValidationState.error
      : undefined

  const visibleFields = fields.filter((field) => !field.isHidden)
  const groupedFields = resolveDialogGroups(
    visibleFields,
    selectedCommand?.dialogLayout?.groups,
    dialogArgumentsToSubmit
  )
  const activeSelectionFieldName =
    visibleFields.find(
      (field) =>
        field.argName === activeSelectionArgName &&
        !field.isDisabled &&
        isSelectionArgument(field.arg)
    )?.argName ??
    visibleFields.find(
      (field) => !field.isDisabled && isSelectionArgument(field.arg)
    )?.argName
  const invalidSelectionState = visibleFields
    .filter(
      (
        field
      ): field is ModelingDialogField & { arg: SelectionCommandArgument } =>
        !field.isDisabled && isSelectionArgument(field.arg)
    )
    .map((field) => {
      const rawSelection =
        field.argName === activeSelectionFieldName
          ? selectionValueOrUndefined(selectionRanges)
          : selectionValueOrUndefined(
              getDraftOrSubmittedValue(
                draftValues,
                commandBarState.context.argumentsToSubmit,
                field.argName
              )
            )
      const selection = coerceSelectionForArgument(field.arg, rawSelection)
      if (err(selection)) {
        return {
          argName: field.argName,
          message: selection.message,
        }
      }
      return canSubmitDialogSelection(
        kclManager.astSignal.value,
        field.arg,
        selection,
        field.isRequired
      )
        ? undefined
        : {
            argName: field.argName,
            message: getSelectionValidationMessage(
              field.argName,
              field.arg,
              selection
            ),
          }
    })
    .find(Boolean)
  const invalidSelectionMessage = invalidSelectionState?.message
  const firstVisibleKclFieldName = visibleFields.find(
    (field) => !field.isDisabled && field.arg.inputType === 'kcl'
  )?.argName
  const visibleKclValidationStates = visibleFields
    .filter((field) => !field.isDisabled && field.arg.inputType === 'kcl')
    .map((field) => kclValidationStates[field.argName])
    .filter((state): state is ModelingDialogKclValidationState =>
      Boolean(state)
    )
  const isCheckingKclFields = visibleKclValidationStates.some(
    (state) => state.isChecking
  )
  const invalidKclState = visibleKclValidationStates.find(
    (state) => !state.canSubmit && !state.isChecking
  )
  const kclValidationErrorToDisplay = invalidKclState?.message
  const validationErrorToDisplay =
    reviewValidationErrorToDisplay ||
    kclValidationErrorToDisplay ||
    invalidSelectionMessage

  const resolveDialogArgumentsForSubmit = useCallback(
    async ({
      showValidationToast = false,
      stopOnMissingRequired = false,
    }: {
      showValidationToast?: boolean
      stopOnMissingRequired?: boolean
    } = {}): Promise<DialogArgumentResolution> => {
      if (!selectedCommand?.args) {
        return { ok: false, reason: 'missingCommand' }
      }

      const wasmInstance = await wasmPromise
      const argumentsToSubmit: Record<string, unknown> = {
        ...commandBarState.context.argumentsToSubmit,
        ...draftValues,
      }

      for (const [argName, arg] of Object.entries(selectedCommand.args)) {
        const currentContext: CommandBarContext = {
          ...commandBarState.context,
          argumentsToSubmit,
        }
        const { isRequired, isDisabled } = evaluateVisibility(
          arg,
          currentContext,
          selectedMachineContext
        )
        if (isDisabled && isSelectionArgument(arg)) {
          argumentsToSubmit[argName] = selectionValueOrUndefined(
            commandBarState.context.argumentsToSubmit[argName]
          )
          continue
        }
        let value = isSelectionArgument(arg)
          ? argName === activeSelectionFieldName
            ? selectionRanges
            : argumentsToSubmit[argName]
          : argumentsToSubmit[argName]

        if (
          (value === undefined || value === '') &&
          shouldResolveDefaultValue(arg, isRequired)
        ) {
          const defaultValue = await resolveDefaultValue(
            arg,
            currentContext,
            wasmInstance,
            selectedMachineContext
          )
          value = defaultValue
        }

        if (isSelectionArgument(arg)) {
          const rawSelection = selectionValueOrUndefined(value)
          const selection = coerceSelectionForArgument(arg, rawSelection)
          if (err(selection)) {
            if (showValidationToast) {
              toast.error(selection.message)
            }
            return {
              ok: false,
              reason: 'invalidSelection',
              message: selection.message,
            }
          }
          value = selection
          if (isSelectionValueEmpty(value)) {
            value = undefined
          }

          if (
            !canSubmitDialogSelection(
              kclManager.astSignal.value,
              arg,
              selection,
              isRequired
            )
          ) {
            const message = getSelectionValidationMessage(
              argName,
              arg,
              selection
            )
            if (showValidationToast) {
              toast.error(message)
            }
            return {
              ok: false,
              reason:
                stopOnMissingRequired && !selection
                  ? 'missingRequired'
                  : 'invalidSelection',
              message,
            }
          }
        }

        if (arg.inputType === 'options') {
          const options = getOptions(
            arg,
            currentContext,
            selectedMachineContext
          )
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
              arg.inputType === 'kcl'
                ? getKclSubmitValue(arg, value)
                : arg.inputType === 'vector2d' || arg.inputType === 'vector3d'
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
                allowStringArrays:
                  arg.inputType === 'kcl' ? arg.allowStringArrays : undefined,
              }
            )
            if (err(parsed) || 'errors' in parsed) {
              const label = arg.displayName || argName
              const message = `Invalid expression for "${label}"`
              if (showValidationToast) {
                toast.error(message)
              }
              return { ok: false, reason: 'invalidExpression', message }
            }
            value = parsed
          }
        }

        if (isRequired && isMissingRequiredDialogValue(arg, value)) {
          const label = arg.displayName || argName
          const message = `Enter "${label}".`
          if (showValidationToast) {
            toast.error(message)
          }
          return { ok: false, reason: 'missingRequired', message }
        }

        argumentsToSubmit[argName] = value
      }

      return { ok: true, argumentsToSubmit }
    },
    [
      activeSelectionFieldName,
      commandBarState.context,
      coerceSelectionForArgument,
      draftValues,
      kclManager.astSignal.value,
      kclManager.rustContext,
      selectedCommand?.args,
      selectedMachineContext,
      selectionRanges,
      wasmPromise,
    ]
  )

  useEffect(() => {
    if (
      !selectedCommand?.needsReview ||
      !selectedCommand.reviewValidation ||
      !selectedCommand.args ||
      isCheckingKclFields ||
      invalidKclState ||
      invalidSelectionMessage
    ) {
      setReviewValidationState({ status: 'idle' })
      return
    }

    let isCancelled = false
    setReviewValidationState({ status: 'idle' })

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const resolvedArguments = await resolveDialogArgumentsForSubmit({
          stopOnMissingRequired: true,
        })

        if (isCancelled || !resolvedArguments.ok) {
          return
        }

        setReviewValidationState({ status: 'checking' })

        try {
          const result = await selectedCommand.reviewValidation?.(
            {
              ...commandBarState.context,
              argumentsToSubmit: resolvedArguments.argumentsToSubmit,
            },
            selectedCommand.machineActor
          )

          if (isCancelled) {
            return
          }

          setReviewValidationState(
            result instanceof Error
              ? { status: 'invalid', error: result.message }
              : { status: 'valid' }
          )
        } catch (error) {
          console.error('Error running dialog review validation', error)
          if (!isCancelled) {
            setReviewValidationState({
              status: 'invalid',
              error: getErrorMessage(error, 'Unable to validate command.'),
            })
          }
        }
      })()
    }, REVIEW_VALIDATION_DEBOUNCE_MS)

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [
    commandBarState.context,
    invalidKclState,
    invalidSelectionMessage,
    isCheckingKclFields,
    resolveDialogArgumentsForSubmit,
    selectedCommand,
  ])

  useEffect(() => {
    if (reviewValidationError) {
      setReviewValidationState({
        status: 'invalid',
        error: reviewValidationError,
      })
    }
  }, [reviewValidationError])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (
      isSubmitting ||
      isCheckingArguments ||
      isCheckingKclFields ||
      invalidKclState ||
      invalidSelectionState ||
      reviewValidationState.status === 'checking' ||
      reviewValidationState.status === 'invalid'
    ) {
      if (invalidKclState?.message) {
        toast.error(invalidKclState.message)
      } else if (invalidSelectionState?.message) {
        toast.error(invalidSelectionState.message)
      }
      return
    }

    setIsSubmitting(true)

    try {
      const resolvedArguments = await resolveDialogArgumentsForSubmit({
        showValidationToast: true,
      })

      if (!resolvedArguments.ok) {
        return
      }

      commands.send({
        type: 'Submit command from dialog',
        data: { argumentsToSubmit: resolvedArguments.argumentsToSubmit },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  function renderField({
    argName,
    arg,
    isRequired,
    isDisabled,
    options,
  }: ModelingDialogField) {
    const key = `${selectedCommand?.name ?? 'command'}-${argName}-${arg.inputType}`
    const isSelectionField = isSelectionArgument(arg)
    const isSelecting = activeSelectionArgName === argName
    const isActivelySelecting = isSelectionField && isSelecting && !isDisabled
    const currentSelection = isSelectionValueEmpty(selectionRanges)
      ? undefined
      : selectionRanges
    const savedSelectionValue = getDraftOrSubmittedValue(
      draftValues,
      commandBarState.context.argumentsToSubmit,
      argName
    )
    const savedSelection = isSelectionValueEmpty(savedSelectionValue)
      ? undefined
      : (savedSelectionValue as Selections)
    const displayedSelection = isActivelySelecting
      ? currentSelection
      : savedSelection
    const value = isSelectionField ? displayedSelection : draftValues[argName]
    const submittedValue = commandBarState.context.argumentsToSubmit[argName]
    const description = arg.description ? (
      <MarkdownText
        text={arg.description}
        className="text-[10px] leading-tight text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown"
      />
    ) : undefined

    const capturedSelection =
      isSelectionField && displayedSelection ? displayedSelection : undefined
    const capturedSelectionItems = getSelectionListItems(
      kclManager.astSignal.value,
      capturedSelection
    )
    const label = capitalizeFirstLetter(arg.displayName || argName)

    if (arg.inputType === 'kcl') {
      return (
        <ModelingDialogKclInput
          key={key}
          name={argName}
          arg={arg}
          label={label}
          description={description}
          isRequired={isRequired}
          disabled={isDisabled}
          value={getKclInputValue(arg, value)}
          commandBarContext={dialogContext}
          selectionRanges={selectionRanges}
          submittedValue={submittedValue}
          autoFocus={firstVisibleKclFieldName === argName}
          onChange={(nextValue) => {
            if (typeof nextValue === 'string') {
              markArgumentDirty(argName)
            }
            setDraftValues((prev) => ({
              ...prev,
              [argName]: nextValue,
            }))
          }}
          onValidationChange={(state) => {
            setKclValidationStates((prev) => {
              const current = prev[argName]
              if (
                current &&
                current.canSubmit === state.canSubmit &&
                current.isChecking === state.isChecking &&
                current.message === state.message
              ) {
                return prev
              }

              return {
                ...prev,
                [argName]: state,
              }
            })
          }}
        />
      )
    }

    const field = (
      <ArgumentField
        key={key}
        name={argName}
        inputType={arg.inputType}
        label={label}
        description={description}
        isRequired={isRequired}
        disabled={isDisabled}
        options={options}
        controlStyle={arg.dialog?.controlStyle}
        value={value}
        selectionItems={capturedSelectionItems}
        selectionHeading={arg.dialog?.selectionHeading || arg.displayName}
        selectionEmptyLabel={arg.dialog?.selectionEmptyLabel}
        selectionHint={arg.dialog?.selectionHint}
        isSelecting={isActivelySelecting}
        currentSelectionLabel={selectionSummary(
          kclManager.astSignal.value,
          currentSelection
        )}
        onChange={(nextValue) => {
          if (isSelectionField) {
            return
          }
          markArgumentDirty(argName)
          setDraftValues((prev) => ({
            ...prev,
            [argName]: nextValue,
          }))
        }}
        onStartSelecting={() => startSelectingArgument(argName, arg)}
        onRemoveSelection={(item) => {
          startSelectingArgument(argName, arg)
          removeSceneSelection(
            argName,
            item.source,
            item.index,
            capturedSelection
          )
        }}
        onClearSelection={() => {
          startSelectingArgument(argName, arg)
          clearSceneSelection(argName)
        }}
      />
    )

    if (isSelectionField && isDisabled) {
      return (
        <div key={key} className="relative">
          {field}
          <Tooltip position="left" hoverOnly>
            {DISABLED_SELECTION_EDIT_TOOLTIP}
          </Tooltip>
        </div>
      )
    }

    return field
  }

  if (!selectedCommand?.args) {
    return null
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
          className="flex min-h-0 w-full flex-col px-3 pt-2 text-xs"
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

          <div className="sticky bottom-0 -mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 border-chalkboard-20 border-t bg-chalkboard-10 px-3 py-3 dark:border-chalkboard-80 dark:bg-chalkboard-100">
            <div className="min-w-0 flex-1">
              {validationErrorToDisplay && (
                <p className="my-0 text-xs leading-tight text-destroy-70 dark:text-destroy-40">
                  {validationErrorToDisplay}
                </p>
              )}
            </div>
            <SubmitButton
              disabled={
                isSubmitting ||
                Boolean(invalidKclState) ||
                Boolean(invalidSelectionState) ||
                reviewValidationState.status === 'invalid'
              }
              isChecking={
                isCheckingArguments ||
                isCheckingKclFields ||
                reviewValidationState.status === 'checking'
              }
              checkingLabel={
                isCheckingKclFields ||
                reviewValidationState.status === 'checking'
                  ? 'Checking...'
                  : undefined
              }
            />
          </div>
        </form>
      </Draggable>
    </div>
  )
}

export default ModelingDialog
