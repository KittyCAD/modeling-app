import {
  AdvancedSection,
  ArgumentField,
  ArgumentGroup,
  DialogHeader,
  Draggable,
  SubmitButton,
} from '@kittycad/ui-components'
import { useSignals } from '@preact/signals-react/runtime'
import { CodemodReviewDiff } from '@src/components/CommandBar/CodemodReviewDiff'
import { CustomIcon } from '@src/components/CustomIcon'
import { MarkdownText } from '@src/components/MarkdownText'
import { useModelingDialogBounds } from '@src/components/ModelingDialog/useModelingDialogBounds'
import { useModelingDialogSelection } from '@src/components/ModelingDialog/useModelingDialogSelection'
import {
  getDraftOrSubmittedValue,
  type ModelingDialogField,
  getKclInputValue,
  initializeDialogArguments,
  reconcileDialogOptions,
  resolveDialogArguments,
} from '@src/components/ModelingDialog/ModelingDialog.arguments'
import {
  canSubmitDialogSelection,
  getSelectionValidationMessage,
  selectionValueOrUndefined,
  getSelectionListItems,
  selectionSummary,
  invalidReviewValidationState,
  isSelectionArgument,
  isSelectionValueEmpty,
  type ReviewValidationState,
  type SelectionCommandArgument,
} from '@src/components/ModelingDialog/ModelingDialog.logic'
import {
  ModelingDialogKclInput,
  type ModelingDialogKclValidationState,
} from '@src/components/ModelingDialog/ModelingDialogKclInput'
import Tooltip from '@src/components/Tooltip'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useApp, useSingletons } from '@src/lib/boot'
import type { CommandDialogGroup } from '@src/lib/commandTypes'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'
import { err, trap } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { useSelector } from '@xstate/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import toast from 'react-hot-toast'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'

type ResolvedModelingDialogGroup = CommandDialogGroup & {
  fields: ModelingDialogField[]
}

const REVIEW_VALIDATION_DEBOUNCE_MS = 350
const DEFAULT_DIALOG_GROUP_ID = 'parameters'
const DISABLED_SELECTION_EDIT_TOOLTIP = "Selection edits aren't supported yet."
const DEFAULT_DIALOG_GROUP: CommandDialogGroup = {
  id: DEFAULT_DIALOG_GROUP_ID,
  title: 'Parameters',
}

function ValidationIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 6.5V10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="13.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

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

function hasOpenworthyDialogValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : hasModelingDialogValue(value)
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
      fields: [...group.fields].sort(
        (a, b) => (a.arg.dialog?.order ?? 0) - (b.arg.dialog?.order ?? 0)
      ),
      defaultOpen:
        group.defaultOpen ||
        group.fields.some((field) =>
          hasOpenworthyDialogValue(draftValues[field.argName])
        ),
    }))
}

export function ModelingDialog() {
  useSignals()
  const { commands, wasmPromise } = useApp()
  const resolvedTheme = useResolvedTheme()
  const { kclManager } = useSingletons()
  const commandBarState = commands.useState()
  const {
    context: {
      selectedCommand,
      commandInvocationId,
      reviewValidationError,
      reviewValidationDetails,
    },
  } = commandBarState
  const selectedMachineContext = useSelector(
    selectedCommand?.machineActor,
    machineContextSelector
  )

  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reviewValidationState, setReviewValidationState] =
    useState<ReviewValidationState>({ status: 'idle' })
  const [kclValidationStates, setKclValidationStates] = useState<
    Record<string, ModelingDialogKclValidationState>
  >({})
  const {
    dialogPositioningRef,
    modelingAreaContainerRef,
    dialogTopOffset,
    dialogMaxHeight,
  } = useModelingDialogBounds()
  const dirtyArgNamesRef = useRef(new Set<string>())
  const submissionVersionRef = useRef(0)

  useLayoutEffect(() => {
    if (!selectedCommand) {
      return
    }
    setIsSubmitting(false)
    return () => {
      submissionVersionRef.current += 1
    }
  }, [selectedCommand])

  const markArgumentDirty = useCallback((argName: string) => {
    dirtyArgNamesRef.current.add(argName)
  }, [])
  const {
    selectionRanges,
    activeSelectionArgName,
    activeSelectionFieldName,
    dialogContext,
    fields,
    coerceSelectionForArgument,
    startSelectingArgument,
    removeSceneSelection,
    moveSceneSelection,
    clearSceneSelection,
  } = useModelingDialogSelection({
    commandBarContext: commandBarState.context,
    selectedMachineContext,
    draftValues,
    setDraftValues,
    markArgumentDirty,
  })
  const dialogArgumentsToSubmit = dialogContext.argumentsToSubmit

  useEffect(() => {
    let isCancelled = false

    async function initDraftValues() {
      if (!selectedCommand?.args) {
        setDraftValues({})
        return
      }
      const wasmInstance = await wasmPromise
      const nextValues = await initializeDialogArguments(
        commandBarState.context,
        wasmInstance,
        selectedMachineContext
      )

      if (!isCancelled) {
        setDraftValues((prev) => {
          const nextDraftValues = { ...prev }
          for (const [argName, value] of Object.entries(nextValues)) {
            const arg = selectedCommand.args?.[argName]
            if (
              arg &&
              !isSelectionArgument(arg) &&
              !dirtyArgNamesRef.current.has(argName)
            ) {
              nextDraftValues[argName] = value
            }
          }
          return reconcileDialogOptions(
            commandBarState.context,
            nextDraftValues,
            selectedMachineContext
          )
        })
      }
    }

    void initDraftValues().catch((error: unknown) => {
      if (!isCancelled) {
        trap(error)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [
    commandBarState.context,
    selectedCommand,
    selectedMachineContext,
    wasmPromise,
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
    async (stopOnMissingRequired = false) =>
      resolveDialogArguments({
        context: commandBarState.context,
        values: draftValues,
        machineContext: selectedMachineContext,
        wasmInstance: await wasmPromise,
        ast: kclManager.astSignal.value,
        rustContext: kclManager.rustContext,
        selectionRanges,
        activeSelectionFieldName,
        coerceSelectionForArgument,
        stopOnMissingRequired,
      }),
    [
      commandBarState.context,
      draftValues,
      selectedMachineContext,
      wasmPromise,
      kclManager.astSignal.value,
      kclManager.rustContext,
      selectionRanges,
      activeSelectionFieldName,
      coerceSelectionForArgument,
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
        try {
          const resolvedArguments = await resolveDialogArgumentsForSubmit(true)

          if (isCancelled || !resolvedArguments.ok) {
            return
          }

          setReviewValidationState({ status: 'checking' })

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
              ? invalidReviewValidationState(result)
              : { status: 'valid' }
          )
        } catch (error) {
          console.error('Error running dialog review validation', error)
          if (!isCancelled) {
            setReviewValidationState(
              invalidReviewValidationState(
                getErrorMessage(error, 'Unable to validate command.')
              )
            )
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
      setReviewValidationState(
        invalidReviewValidationState(
          reviewValidationError,
          reviewValidationDetails
        )
      )
    }
  }, [reviewValidationDetails, reviewValidationError])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (
      !selectedCommand ||
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
    const submissionVersion = submissionVersionRef.current

    try {
      const resolvedArguments = await resolveDialogArgumentsForSubmit()

      if (submissionVersion !== submissionVersionRef.current) return
      if (!resolvedArguments.ok) {
        if (resolvedArguments.message) toast.error(resolvedArguments.message)
        return
      }

      commands.send({
        type: 'Submit command from dialog',
        data: {
          command: selectedCommand,
          commandInvocationId,
          argumentsToSubmit: resolvedArguments.argumentsToSubmit,
        },
      })
    } catch (error) {
      if (submissionVersion === submissionVersionRef.current) {
        trap(error)
      }
    } finally {
      if (submissionVersion === submissionVersionRef.current) {
        setIsSubmitting(false)
      }
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
    const value = isSelectionField
      ? displayedSelection
      : dialogArgumentsToSubmit[argName]
    const submittedValue = commandBarState.context.argumentsToSubmit[argName]
    const description = arg.description ? (
      <MarkdownText
        text={arg.description}
        className="parsed-markdown text-[11px] leading-snug text-chalkboard-70 dark:text-chalkboard-40"
      />
    ) : undefined

    const capturedSelection =
      isSelectionField && displayedSelection ? displayedSelection : undefined
    const capturedSelectionItems = getSelectionListItems(
      kclManager.astSignal.value,
      capturedSelection
    )
    const displayName = arg.dialog?.displayName ?? arg.displayName
    const label = displayName
      ? capitalizeFirstLetter(displayName)
      : toTitleCase(argName)

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
          onChange={(change) => {
            if (change.source === 'edit') {
              markArgumentDirty(argName)
            }
            setDraftValues((prev) =>
              reconcileDialogOptions(
                commandBarState.context,
                {
                  ...prev,
                  [argName]: change.value,
                },
                selectedMachineContext
              )
            )
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
        selectionHeading={
          arg.dialog?.selectionHeading ??
          arg.dialog?.displayName ??
          arg.displayName
        }
        selectionEmptyLabel={arg.dialog?.selectionEmptyLabel}
        selectionHint={arg.dialog?.selectionHint}
        compactSelection={arg.dialog?.compactSelection}
        hideLabel={arg.dialog?.hideLabel}
        orderedSelection={arg.dialog?.orderedSelection}
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
          setDraftValues((prev) =>
            reconcileDialogOptions(
              commandBarState.context,
              {
                ...prev,
                [argName]: nextValue,
              },
              selectedMachineContext
            )
          )
        }}
        onStartSelecting={() => startSelectingArgument(argName, arg)}
        onRemoveSelection={(item) => {
          removeSceneSelection(
            argName,
            item.source,
            item.index,
            capturedSelection
          )
        }}
        onMoveSelection={(item, direction) => {
          moveSceneSelection(
            argName,
            item.source,
            item.index,
            direction,
            capturedSelection
          )
        }}
        onClearSelection={() => clearSceneSelection(argName)}
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
        className="pointer-events-auto relative mb-2 ml-auto mr-2 flex !h-auto w-[calc(100%_-_1rem)] max-w-[21rem] flex-col overflow-hidden rounded-md border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-10"
        containerRef={modelingAreaContainerRef}
        data-testid="modeling-dialog"
        style={{ maxHeight: dialogMaxHeight }}
        Handle={
          <DialogHeader
            title={selectedCommand.displayName || selectedCommand.name}
            icon={
              selectedCommand.icon && (
                <CustomIcon name={selectedCommand.icon} className="h-5 w-5" />
              )
            }
            onClose={() => commands.send({ type: 'Close' })}
          />
        }
      >
        <form
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          className="flex min-h-0 w-full flex-col overflow-hidden px-3 pt-2 text-xs"
        >
          {selectedCommand.description &&
            selectedCommand.dialogLayout?.showCommandDescription !== false && (
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
            {reviewValidationState.status === 'invalid' &&
              reviewValidationState.details?.type === 'codemod' && (
                <CodemodReviewDiff
                  details={reviewValidationState.details}
                  resolvedTheme={resolvedTheme}
                />
              )}
          </div>

          <div className="sticky bottom-0 -mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 border-chalkboard-20 border-t bg-chalkboard-10 px-3 py-2 dark:border-chalkboard-80 dark:bg-chalkboard-100">
            <div className="min-w-0 flex-1">
              {validationErrorToDisplay && (
                <div
                  role="alert"
                  className="flex min-w-0 items-start gap-1.5 text-destroy-70 dark:text-destroy-40"
                >
                  <span className="mt-px shrink-0" aria-hidden="true">
                    <ValidationIcon />
                  </span>
                  <p className="my-0 min-w-0 break-words text-[11px] leading-snug">
                    {validationErrorToDisplay}
                  </p>
                </div>
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
