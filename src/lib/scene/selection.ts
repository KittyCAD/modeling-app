import type { EntityReference, EntityType } from '@kittycad/lib'
import {
  batch,
  computed,
  effect,
  signal,
  type ReadonlySignal,
  type Signal,
} from '@preact/signals-core'
import { entityReferenceKey } from '@src/lib/scene/entityReference'
import { isErr } from '@src/lib/trap'

/** Identity is replaced for every execution, including native cache hits. References cannot cross models. */
export interface SelectionModel {
  readonly sceneId: symbol
  readonly executionId: symbol
}
export interface SceneSelection {
  readonly model: SelectionModel
  readonly reference: EntityReference
}

/** Argument accessors point at dialog-owned values, not a second selection store. */
export interface PickingArgument {
  readonly id: string
  readonly filter: readonly EntityType[]
  readonly multiple: boolean
  readonly value: ReadonlySignal<readonly SceneSelection[]>
  accepts: (reference: EntityReference) => boolean
  /** User edits carry intent; seeding and execution invalidation do not. */
  setValue: (
    value: readonly SceneSelection[],
    intent?: { additive: boolean }
  ) => void
}
export interface DialogPickingSession {
  readonly model: ReadonlySignal<SelectionModel | null>
  activate: (argumentId: string | null) => Error | undefined
  bindCurrentModel: () => Error | undefined
  validate: (values: readonly SceneSelection[]) => EntityReference[] | Error
  close: () => void
}
export interface SelectionAdapter {
  pick: (
    point: Pick<MouseEvent, 'clientX' | 'clientY'>
  ) => Promise<{ reference?: EntityReference } | undefined>
  present: (
    references: readonly EntityReference[],
    filter: readonly EntityType[],
    isCurrent: () => boolean,
    model: SelectionModel
  ) => Promise<void>
}

interface DialogState {
  target: Signal<SelectionModel | null>
  arguments: readonly PickingArgument[]
  active: Signal<PickingArgument | undefined>
}

/** One Modeling view owns ordinary selection; a dialog temporarily owns picking and displayed highlights. */
export function createSceneSelection(
  adapter: SelectionAdapter,
  defaultFilter: readonly EntityType[],
  correspondencePresentation: 'selection' | 'separate' = 'selection'
) {
  const model = signal<SelectionModel | null>(null)
  const selected = signal<readonly SceneSelection[]>([])
  const correspondence = signal<readonly SceneSelection[]>([])
  const viewFilter = signal<readonly EntityType[]>([...defaultFilter])
  const error = signal<Error | undefined>(undefined)
  const dialog = signal<DialogState | undefined>(undefined)
  let disposed = false
  let ownership = 0
  let projection = 0
  let presents = Promise.resolve()
  let picks = Promise.resolve()
  const changeOwner = () => {
    ownership++
    picks = Promise.resolve()
  }
  const displayed = computed(() => {
    const session = dialog.value
    if (!session) return selected.value
    const argument = session.active.value
    if (!session.target.value || !argument) return []
    return argument.value.value.filter((item) => item.model === model.value)
  })
  const filter = computed<readonly EntityType[]>(() =>
    dialog.value ? (dialog.value.active.value?.filter ?? []) : viewFilter.value
  )
  const pickingEnabled = computed(
    () =>
      !disposed &&
      model.value !== null &&
      (!dialog.value ||
        (dialog.value.target.value === model.value &&
          !!dialog.value.active.value))
  )
  const stop = effect(() => {
    const currentModel = model.value
    const values =
      dialog.value || correspondencePresentation === 'separate'
        ? displayed.value
        : [...displayed.value, ...correspondence.value].filter(
            (value, index, values) =>
              values.findIndex(
                (item) =>
                  entityReferenceKey(item.reference) ===
                  entityReferenceKey(value.reference)
              ) === index
          )
    const currentFilter = filter.value
    const ticket = ++projection
    if (!currentModel) return
    const current = () =>
      !disposed && ticket === projection && currentModel === model.peek()
    presents = presents
      .then(async () => {
        if (current())
          await adapter.present(
            values.map((item) => item.reference),
            currentFilter,
            current,
            currentModel
          )
      })
      .catch((cause) => {
        if (current())
          error.value = isErr(cause)
            ? cause
            : new Error('Unable to highlight selection', { cause })
      })
  })
  const change = (
    reference: EntityReference | undefined,
    additive: boolean
  ) => {
    const currentModel = model.peek()
    if (!currentModel || !pickingEnabled.peek()) return
    const argument = dialog.peek()?.active.peek()
    if (reference && argument && !argument.accepts(reference)) return
    const previous = argument ? argument.value.peek() : selected.peek()
    const key = reference && entityReferenceKey(reference)
    if (reference && key === null) return
    const target: SceneSelection | undefined = reference
      ? { model: currentModel, reference: structuredClone(reference) }
      : undefined
    const multiple = !argument || argument.multiple
    const exists =
      reference &&
      previous.some((item) => entityReferenceKey(item.reference) === key)
    const next = !target
      ? additive
        ? previous
        : []
      : additive && multiple
        ? exists
          ? previous.filter(
              (item) => entityReferenceKey(item.reference) !== key
            )
          : [...previous, target]
        : [target]
    error.value = undefined
    if (argument) argument.setValue(next, { additive })
    else selected.value = next
  }
  const invalidate = () => {
    changeOwner()
    batch(() => {
      model.value = null
      selected.value = []
      correspondence.value = []
      error.value = undefined
      const session = dialog.peek()
      if (session) {
        session.target.value = null
        session.active.value = undefined
        for (const argument of session.arguments) argument.setValue([])
      }
    })
  }
  return {
    model: model as ReadonlySignal<SelectionModel | null>,
    selected: selected as ReadonlySignal<readonly SceneSelection[]>,
    displayed,
    correspondence: correspondence as ReadonlySignal<readonly SceneSelection[]>,
    pickingArgument: computed(() => dialog.value?.active.value),
    /** Correspondence is presentation only; commands continue reading their own selection owner. */
    setCorrespondence: (values: readonly SceneSelection[]) => {
      if (disposed || values.some((value) => value.model !== model.peek()))
        return new Error('The correspondence model changed.')
      const previous = correspondence.peek()
      if (
        previous.length === values.length &&
        previous.every(
          (item, index) =>
            item.model === values[index].model &&
            entityReferenceKey(item.reference) ===
              entityReferenceKey(values[index].reference)
        )
      )
        return undefined
      correspondence.value = values.map((value) => ({
        ...value,
        reference: structuredClone(value.reference),
      }))
      return undefined
    },
    /** Programmatic promotion is deliberately unused by UI; navigation remains a separate capability. */
    // TODO: Keep promotion unbound from UI while its interaction semantics are evaluated.
    promoteCorrespondence: () => {
      if (disposed || dialog.peek() || !model.peek())
        return new Error(
          'A picking session owns selection, or the model is unavailable.'
        )
      changeOwner()
      selected.value = [...correspondence.peek()]
      return undefined
    },
    /** Linked modalities offer complete, validated picks to the active argument without mutating view selection. */
    offer: (values: readonly SceneSelection[], additive = false) => {
      const argument = dialog.peek()?.active.peek()
      if (
        !argument ||
        !pickingEnabled.peek() ||
        dialog.peek()?.target.peek() !== model.peek()
      )
        return new Error('No current argument is accepting picks.')
      if (
        !values.length ||
        values.some(
          (value) =>
            value.model !== model.peek() || !argument.accepts(value.reference)
        )
      )
        return new Error('The offered geometry is stale or incompatible.')
      const next = additive
        ? [...argument.value.peek(), ...values]
        : [...values]
      const unique = next.filter(
        (value, index) =>
          next.findIndex(
            (item) =>
              entityReferenceKey(item.reference) ===
              entityReferenceKey(value.reference)
          ) === index
      )
      if (!argument.multiple && unique.length !== 1)
        return new Error('This argument accepts one entity.')
      changeOwner()
      argument.setValue(unique, { additive })
      return undefined
    },
    filter,
    pickingEnabled,
    error,
    dialogOpen: computed(() => !!dialog.value),
    setModel: (next: SelectionModel | null) => {
      if (next !== model.peek()) {
        invalidate()
        if (!disposed) model.value = next
      }
    },
    invalidate,
    pick: (
      point: Pick<MouseEvent, 'clientX' | 'clientY'>,
      additive = false
    ) => {
      const owner = ownership
      const currentModel = model.peek()
      const currentFilter = filter.peek()
      if (!pickingEnabled.peek()) return Promise.resolve()
      const captured = { clientX: point.clientX, clientY: point.clientY }
      picks = picks.then(async () => {
        await presents
        if (
          disposed ||
          owner !== ownership ||
          currentModel !== model.peek() ||
          currentFilter !== filter.peek() ||
          !pickingEnabled.peek()
        )
          return
        try {
          const hit = await adapter.pick(captured)
          if (
            !disposed &&
            owner === ownership &&
            currentModel === model.peek() &&
            currentFilter === filter.peek() &&
            hit
          )
            change(hit.reference, additive)
        } catch (cause) {
          if (!disposed && owner === ownership)
            error.value = isErr(cause)
              ? cause
              : new Error('Unable to pick geometry', { cause })
        }
      })
      return picks
    },
    setFilter: (next: readonly EntityType[]) => {
      if (disposed || dialog.peek())
        return new Error('A dialog owns the selection filter.')
      changeOwner()
      batch(() => {
        viewFilter.value = [...next]
        selected.value = []
      })
      return undefined
    },
    clear: () => {
      changeOwner()
      change(undefined, false)
    },
    validate: (values: readonly SceneSelection[]) => {
      if (
        disposed ||
        !model.peek() ||
        values.some((value) => value.model !== model.peek())
      )
        return new Error('The selected model changed. Select geometry again.')
      return values.map((value) => value.reference)
    },
    beginPicking: ({
      arguments: arguments_,
      seed,
    }: {
      arguments: readonly PickingArgument[]
      seed?: string
    }): DialogPickingSession | Error => {
      if (disposed || !model.peek())
        return new Error('Wait for the model before picking')
      if (dialog.peek())
        return new Error('A dialog already owns picking in this view')
      if (new Set(arguments_.map((arg) => arg.id)).size !== arguments_.length)
        return new Error('Picking argument IDs must be unique')
      const seeded = seed
        ? arguments_.find((arg) => arg.id === seed)
        : undefined
      if (seed && !seeded)
        return new Error('The seed argument is not registered')
      changeOwner()
      const session = {
        target: signal(model.peek()),
        arguments: arguments_,
        active: signal<PickingArgument | undefined>(undefined),
      }
      if (seeded) {
        const values = selected
          .peek()
          .filter((value) => seeded.accepts(value.reference))
          .map((value) => ({
            model: value.model,
            reference: structuredClone(value.reference),
          }))
        seeded.setValue(seeded.multiple ? values : values.slice(0, 1))
      }
      dialog.value = session
      const current = () => !disposed && dialog.peek() === session
      return {
        model: session.target,
        activate: (id) => {
          if (!current()) return new Error('This picking session closed')
          if (
            id !== null &&
            (!session.target.peek() || session.target.peek() !== model.peek())
          )
            return new Error('Bind the current model before picking again')
          const argument =
            id === null ? undefined : arguments_.find((arg) => arg.id === id)
          if (id !== null && !argument)
            return new Error('Unknown picking argument')
          changeOwner()
          session.active.value = argument
          return undefined
        },
        bindCurrentModel: () => {
          if (!current() || !model.peek())
            return new Error('Wait for the current model before picking')
          changeOwner()
          batch(() => {
            for (const argument of arguments_) argument.setValue([])
            session.active.value = undefined
            session.target.value = model.peek()
          })
          return undefined
        },
        validate: (values) => {
          if (
            !current() ||
            !session.target.peek() ||
            session.target.peek() !== model.peek() ||
            values.some((value) => value.model !== session.target.peek())
          )
            return new Error(
              'The dialog model target changed. Bind the current model and pick again.'
            )
          return values.map((value) => value.reference)
        },
        close: () => {
          if (!current()) return
          changeOwner()
          batch(() => {
            dialog.value = undefined
            session.active.value = undefined
            session.target.value = null
          })
        },
      }
    },
    dispose: () => {
      if (!disposed) {
        disposed = true
        invalidate()
        dialog.value = undefined
        projection++
        stop()
      }
    },
  }
}
export type SceneSelectionController = ReturnType<typeof createSceneSelection>
