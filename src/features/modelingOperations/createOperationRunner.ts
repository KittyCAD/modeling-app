import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { StdLibCommandShape } from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import type {
  ArgumentPrompt,
  ArgumentResolver,
  ModelingOperation,
  ParsedProgram,
  ProjectEdit,
  ResolvedArgument,
  ResolvedInputs,
  TextEdit,
} from '@src/contracts/modelingOperations'
import type { ProjectSession } from '@src/contracts/projectSession'
import type { DerivedInput } from '@src/lib/kclStdlib/shapes'
import { derivedInputs, stdLibCommand } from '@src/lib/kclStdlib/shapes'
import { mergeTextEdits } from '@src/features/modelingOperations/mergeEdits'
import { requestFocus } from '@src/lib/buffers/annotations'

/**
 * One argument of a running operation, and everything known about it.
 *
 * Every argument has a field for as long as the operation is running, answered
 * or not. That is the difference between this and asking one question at a
 * time: a surface that shows all the arguments at once needs them all to exist
 * at once, and a caller that supplies them all in one go needs somewhere to put
 * them. Which one is being *asked* about is then a question you answer by
 * looking at the fields, not a number anybody stores.
 */
export interface ArgumentField {
  input: DerivedInput
  /**
   * The ways this argument can be answered.
   *
   * More than one is the normal case for anything geometric: a `Sketch` can be
   * an existing binding or a region picked in the scene, and which to use is the
   * user's choice rather than the first matching resolver's.
   */
  methods: readonly { id: string; label: string }[]
  /** The method being offered. One of `methods`, or empty when none can. */
  method: string
  prompt: ArgumentPrompt
  /** The answer, once one has been given. */
  answer: ResolvedArgument | null
  /**
   * What was said, before the resolver turned it into an argument.
   *
   * Kept so an answer can be re-checked when another answer changes it out from
   * under: the resolved source is what goes in the call, but only the raw answer
   * can be compared against a list of options that has since moved.
   */
  raw: string | null
  /**
   * Offered, and deliberately left out of the call.
   *
   * Distinct from unanswered, and the reason a field set needs three states
   * where walking an index needed two: moving past an optional argument used to
   * be recorded by the index passing it, and nothing passes anything now.
   */
  skipped: boolean
  /** Why this argument cannot be answered, or why the last answer was refused. */
  error: string | null
}

/**
 * An operation part way through being asked about.
 *
 * A record in a signal, not a state machine. The transitions are answer, take
 * back, and cancel; there is no ordering between them to enforce, which is the
 * whole point — a dialog changes the third field and then the first, and an
 * agent sets all five at once.
 */
export interface PendingOperation {
  operation: ModelingOperation
  command: StdLibCommandShape
  fields: readonly ArgumentField[]
  program: ParsedProgram
  /** Project-relative path of the buffer being edited. */
  path: string
  /**
   * Which field is receiving what gets picked in the scene.
   *
   * Deliberately not the same thing as the field being asked about. A sequential
   * prompt has one of each and they coincide; a dialog with three selection
   * fields has three that need answering and exactly one armed to receive the
   * next click, and conflating them is how you end up putting a face into the
   * wrong argument.
   */
  focus: string | null
  /** The operation as a whole failed. Trouble with one argument is on its field. */
  error: string | null
  busy: boolean
}

export interface OperationRunnerDependencies {
  operations: ReadonlySignal<readonly ModelingOperation[]>
  resolvers: ReadonlySignal<readonly ArgumentResolver[]>
  session: () => ProjectSession | null
  /** Injected: parsing needs the WASM module, and a test does not. */
  parse: (source: string) => Promise<ParsedProgram>
}

export interface OperationRunner {
  readonly pending: ReadonlySignal<PendingOperation | null>
  /**
   * The field a one-question-at-a-time prompt should be asking about.
   *
   * Derived, not stored. An answer can change whether an earlier argument still
   * needs one, so the only way to be right about "which question now" is to work
   * it out from the answers every time.
   */
  readonly asking: ReadonlySignal<ArgumentField | null>
  /** Whether every argument that needs an answer has one. */
  readonly ready: ReadonlySignal<boolean>
  /** Operations that could run right now, for enabling their commands. */
  readonly available: ReadonlySignal<readonly ModelingOperation[]>
  /**
   * Begin an operation, optionally with some arguments already answered.
   *
   * Answers are keyed by argument name and are the same strings a person would
   * have typed or picked, so they go through the same resolver — a caller cannot
   * write a reference that a click could not have produced. Never submits, even
   * when nothing is left to ask: a caller that supplied everything still has to
   * say so, which is where a review step goes.
   */
  start(
    operationId: string,
    answers?: Readonly<Record<string, string>>
  ): Promise<void>
  /** Answer the field being asked about. Empty skips an optional one. */
  answer(value: string): Promise<void>
  /** Answer one field by name, in any order. */
  supply(name: string, value: string): Promise<void>
  /** Take an answer back, leaving the argument outstanding again. */
  clear(name: string): Promise<void>
  /** Offer the field being asked about a different way. */
  chooseMethod(resolverId: string): Promise<void>
  /** Offer one field a different way, by name. */
  chooseMethodFor(name: string, resolverId: string): Promise<void>
  /** Arm a field to receive what is picked in the scene. */
  focus(name: string | null): void
  /** Plan the operation and apply it. */
  submit(): Promise<void>
  cancel(): void
}

const KCL = 'kcl'

/** A prompt that has nothing to offer, so is worth falling through. */
const isEmptyChoice = (prompt: ArgumentPrompt) =>
  prompt.kind === 'choice' && prompt.options.length === 0

const answersOf = (fields: readonly ArgumentField[]): ResolvedInputs => {
  const resolved: Record<string, ResolvedArgument> = {}
  for (const field of fields) {
    if (field.answer) resolved[field.input.name] = field.answer
  }
  return resolved
}

/** Whether this field still wants an answer of some kind. */
const outstanding = (field: ArgumentField) =>
  field.answer === null && !field.skipped

/**
 * Whether a one-at-a-time prompt should stop here.
 *
 * An optional argument nothing can offer is not worth stopping for; a required
 * one is, precisely so the reason it cannot be answered gets said out loud.
 *
 * Exported because the prompt needs the same answer to know whether its button
 * says Next or Apply, and two definitions of "still to ask" would disagree the
 * first time one of them changed.
 */
export const worthAsking = (field: ArgumentField) =>
  outstanding(field) && (field.method !== '' || field.error !== null)

/**
 * Runs a modelling operation: derive its arguments, ask for them, apply the edit.
 *
 * The order is the whole design. Arguments are *derived* from the stdlib shape,
 * *asked* through whichever resolver claims each type, and the operation is only
 * consulted at the end, to write the call. So adding an operation adds no UI, and
 * adding a resolver adds no operation.
 */
export function createOperationRunner(
  dependencies: OperationRunnerDependencies
): OperationRunner {
  const { operations, resolvers, session, parse } = dependencies

  const pending = signal<PendingOperation | null>(null)

  const activeKclBuffer = () => {
    const current = session()
    const buffer = current?.activeBuffer.value ?? null
    if (!current || !buffer) return null
    if (buffer.languageId.value !== KCL) return null

    const path = current.relativePathFor(buffer)
    return path ? { session: current, buffer, path } : null
  }

  const available = computed(() =>
    // Every operation needs a KCL buffer to write into. Which arguments it can
    // fill is decided when it starts, because that needs the program parsed.
    activeKclBuffer() ? operations.value : []
  )

  const asking = computed(() => pending.value?.fields.find(worthAsking) ?? null)

  const ready = computed(() => {
    const state = pending.value
    if (!state) return false
    return !state.fields.some(
      (field) => field.input.required && field.answer === null
    )
  })

  /** Every way of answering this argument, in the order they are offered. */
  const resolversFor = (input: DerivedInput) =>
    [...resolvers.value]
      .filter((resolver) => resolver.handles(input))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const resolverById = (id: string) =>
    resolvers.value.find((resolver) => resolver.id === id)

  const fieldNamed = (state: PendingOperation, name: string) =>
    state.fields.find((field) => field.input.name === name) ?? null

  /**
   * Ask one resolver what this argument looks like, given the answers so far.
   */
  const promptWith = async (
    resolver: ArgumentResolver,
    input: DerivedInput,
    program: ParsedProgram,
    resolved: ResolvedInputs
  ) => resolver.prompt({ input, program, resolved })

  /**
   * Work out one field's methods and prompt from the current answers.
   *
   * A method the field is already showing is kept if it still handles the
   * argument, because recomputing must not undo somebody's choice of how to
   * answer. Otherwise the first method with something to offer wins, so "no
   * sketch in this file" falls through to picking one in the scene rather than
   * dead-ending on an empty list.
   */
  const refreshField = async (
    field: ArgumentField,
    program: ParsedProgram,
    resolved: ResolvedInputs
  ): Promise<ArgumentField> => {
    const { input } = field
    const candidates = resolversFor(input)
    const methods = candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
    }))

    if (candidates.length === 0) {
      return {
        ...field,
        methods,
        method: '',
        error: input.required
          ? `Nothing knows how to supply ${input.name}.`
          : null,
      }
    }

    const held = candidates.find((candidate) => candidate.id === field.method)
    if (held) {
      const prompt = await promptWith(held, input, program, resolved)
      return { ...field, methods, method: held.id, prompt, error: field.error }
    }

    /*
     * A method that can already answer is tried first.
     *
     * The displayed order is the contributed one, above; this only decides which
     * method a field *opens* on. It is what makes a face selected before the
     * operation started the thing the operation opens on, rather than a list of
     * standard planes with the selection one switch away — clicking a face and
     * then asking to sketch is one intention.
     *
     * Below the held method on purpose: recomputing must not undo somebody's
     * choice of how to answer, and readiness is a suggestion rather than an
     * instruction.
     */
    const request = { input, program, resolved }
    const ordered = [
      ...candidates.filter((candidate) => candidate.ready?.(request) === true),
      ...candidates.filter((candidate) => candidate.ready?.(request) !== true),
    ]

    let lastEmpty: { id: string; prompt: ArgumentPrompt } | null = null

    for (const candidate of ordered) {
      const prompt = await promptWith(candidate, input, program, resolved)
      if (isEmptyChoice(prompt)) {
        lastEmpty = { id: candidate.id, prompt }
        continue
      }
      return { ...field, methods, method: candidate.id, prompt, error: null }
    }

    // Every method had nothing. For an optional argument that means "not
    // applicable here"; for a required one it is worth saying why.
    return {
      ...field,
      methods,
      method: lastEmpty?.id ?? '',
      prompt: lastEmpty?.prompt ?? field.prompt,
      error: input.required
        ? ((lastEmpty?.prompt.kind === 'choice'
            ? lastEmpty.prompt.empty
            : null) ?? `There is no ${input.name} to choose.`)
        : null,
    }
  }

  /**
   * Rebuild every field against the current answers.
   *
   * Done for answered fields as well as outstanding ones, because a prompt is a
   * function of the other answers: change which sketch is being extruded and the
   * faces worth offering change with it. An answer that is no longer among the
   * options it came from is dropped rather than left to be written into the call,
   * which is the one kind of staleness that can be detected from here.
   */
  const recompute = async (
    state: PendingOperation
  ): Promise<PendingOperation> => {
    let fields = state.fields

    for (let index = 0; index < fields.length; index += 1) {
      const refreshed = await refreshField(
        fields[index],
        state.program,
        answersOf(fields)
      )

      const stale =
        refreshed.answer !== null &&
        refreshed.raw !== null &&
        refreshed.prompt.kind === 'choice' &&
        !refreshed.prompt.options.some(
          (option) => option.value === refreshed.raw
        )

      fields = fields.with(
        index,
        stale
          ? {
              ...refreshed,
              answer: null,
              raw: null,
              skipped: false,
              error: `${refreshed.input.name} is no longer available.`,
            }
          : refreshed
      )
    }

    return { ...state, fields }
  }

  /**
   * Record one answer, or record that the argument was left out.
   *
   * Returns the new state rather than assigning it, so a caller can decide what
   * an answer means: the sequential prompt submits when the last question is
   * gone, and a dialog waits to be told.
   */
  const record = async (
    state: PendingOperation,
    name: string,
    value: string
  ): Promise<PendingOperation> => {
    const field = fieldNamed(state, name)
    if (!field) {
      console.warn(`modeling: ${state.operation.id} has no argument ${name}`)
      return state
    }

    const index = state.fields.indexOf(field)
    const trimmed = value.trim()

    const refuse = (message: string) => ({
      ...state,
      fields: state.fields.with(index, { ...field, error: message }),
    })

    if (trimmed.length === 0) {
      if (field.input.required) return refuse(`${field.input.name} is needed.`)
      // Skipped, and left out of the call entirely rather than written empty.
      return recompute({
        ...state,
        fields: state.fields.with(index, {
          ...field,
          answer: null,
          raw: null,
          skipped: true,
          error: null,
        }),
      })
    }

    /*
     * An answer to a closed question has to be one of the answers.
     *
     * Nothing checked this while the only way to answer was to pick from a list
     * that was on the screen. A caller handing over answers it worked out
     * elsewhere is the case that needs it: an argument named from memory rather
     * than from the file should be refused here, with the reason, rather than
     * written into the call and failing as KCL.
     */
    if (
      field.prompt.kind === 'choice' &&
      !field.prompt.options.some((option) => option.value === trimmed)
    ) {
      return refuse(
        `${trimmed} is not one of the choices for ${field.input.name}.`
      )
    }

    const resolver = resolverById(field.method)
    const argument = resolver?.toArgument
      ? resolver.toArgument(trimmed, {
          input: field.input,
          program: state.program,
          resolved: answersOf(state.fields),
        })
      : { source: trimmed }

    /*
     * An answer that resolves to nothing was not an answer.
     *
     * A resolver can accept an answer and still be unable to express it — the
     * selection resolver does exactly that for geometry inside no named
     * binding, since there is nothing to refer to yet. Checking the raw answer
     * is not enough: it was `wall`, and only the resolver knows that came to
     * nothing. Writing it anyway produced `extrude(, length = 9)`.
     */
    if (argument.source.trim().length === 0) {
      if (field.input.required) return refuse(`${field.input.name} is needed.`)
      return recompute({
        ...state,
        fields: state.fields.with(index, {
          ...field,
          answer: null,
          raw: null,
          skipped: true,
          error: null,
        }),
      })
    }

    return recompute({
      ...state,
      error: null,
      fields: state.fields.with(index, {
        ...field,
        answer: argument,
        raw: trimmed,
        skipped: false,
        error: null,
      }),
    })
  }

  const apply = async (state: PendingOperation): Promise<void> => {
    const target = activeKclBuffer()
    if (!target) {
      pending.value = { ...state, error: 'The file is no longer open.' }
      return
    }

    pending.value = { ...state, busy: true, error: null }
    const resolved = answersOf(state.fields)

    try {
      const edit: ProjectEdit = await state.operation.plan({
        command: state.command,
        inputs: state.fields.map((field) => field.input),
        resolved,
        program: state.program,
        path: state.path,
      })

      /*
       * Prerequisites land with the operation, not before it.
       *
       * A reference that needs a segment named carries that edit as data, so
       * clicking never touched the file and cancelling left nothing behind. They
       * apply to the file being edited, in the same transaction as the
       * operation's own statement — one undo entry for the whole intention.
       */
      const prerequisites = Object.values(resolved).flatMap(
        (argument) => argument.prerequisites ?? []
      )

      const changes: Record<string, readonly TextEdit[]> = {
        ...edit.changes,
        [state.path]: mergeTextEdits([
          ...prerequisites,
          ...(edit.changes[state.path] ?? []),
        ]),
      }

      for (const [path, edits] of Object.entries(changes)) {
        const buffer = target.session.bufferForPath(path)
        if (!buffer) {
          // Only open buffers for now. Editing a file nobody has open means
          // opening it or writing behind the session's back, and both are
          // decisions this should not make quietly.
          throw new Error(`${path} is not open.`)
        }

        /*
         * The cursor moves in the same transaction as the text.
         *
         * Two dispatches would put a selection into a document that has already
         * been reported once, so anything watching the buffer would see the edit
         * without the cursor and then the cursor on its own. One transaction is
         * also one undo entry, which is what makes an operation that repositions
         * you as reversible as one that does not.
         */
        const focus = edit.focus?.path === path ? edit.focus.offset : null

        buffer.dispatch({
          changes: edits.map((change) => ({
            from: change.from,
            to: change.to,
            insert: change.insert,
          })),
          ...(focus === null ? {} : { selection: { anchor: focus } }),
          /*
           * Asking for the cursor to be somewhere is asking for the user to be
           * there, so the keyboard comes too. Half the gesture — a caret in a new
           * sketch block that nothing types into — would leave the app looking
           * like it had moved somebody who is still where they were.
           */
          ...(focus === null ? {} : { annotations: [requestFocus.of(true)] }),
        })
      }

      pending.value = null
    } catch (caught) {
      pending.value = {
        ...state,
        busy: false,
        error: caught instanceof Error ? caught.message : 'That did not work.',
      }
    }
  }

  /** Answer, then apply if that was the last question anybody had. */
  const answerAndContinue = async (name: string, value: string) => {
    const state = pending.value
    if (!state || state.busy) return

    const next = await record(state, name, value)
    pending.value = next

    if (!next.fields.some(worthAsking) && !next.fields.some((f) => f.error)) {
      await apply(next)
    }
  }

  const reoffer = async (name: string, resolverId: string) => {
    const state = pending.value
    if (!state || state.busy) return

    const field = fieldNamed(state, name)
    if (!field) return

    const resolver = resolverById(resolverId)
    if (!resolver || !resolver.handles(field.input)) return

    const index = state.fields.indexOf(field)

    /*
     * Re-asks rather than converting.
     *
     * A method that yields the same argument by a different route has its own
     * prompt, and whatever was said for the last one was an answer to a
     * different question — so the answer goes with it.
     */
    const reset: ArgumentField = {
      ...field,
      method: resolver.id,
      answer: null,
      raw: null,
      skipped: false,
      error: null,
    }

    pending.value = await recompute({
      ...state,
      error: null,
      fields: state.fields.with(index, reset),
    })
  }

  return {
    pending: computed(() => pending.value),
    asking,
    ready,
    available,

    async start(operationId, answers) {
      const operation = operations.value.find(
        (candidate) => candidate.id === operationId
      )
      if (!operation) return

      const target = activeKclBuffer()
      if (!target) return

      // Declared shape first: a language construct describes itself, because
      // nothing generates a description of it.
      const command = operation.shape ?? stdLibCommand(operation.stdlib)
      if (!command) {
        console.warn(
          `modeling: no stdlib shape for ${operation.stdlib}; is kcl-lib newer than these bindings?`
        )
        return
      }

      const program = await parse(target.buffer.text.value)
      const inputs = derivedInputs(command, operation.annotations)

      let state = await recompute({
        operation,
        command,
        fields: inputs.map((input) => ({
          input,
          methods: [],
          method: '',
          // Replaced by the first recompute; nothing is ever shown from here.
          prompt: { kind: 'expression' },
          answer: null,
          raw: null,
          skipped: false,
          error: null,
        })),
        program,
        path: target.path,
        focus: null,
        error: null,
        busy: false,
      })

      /*
       * Supplied answers go in declared order.
       *
       * A resolver sees the answers that came before it, so filling `sketches`
       * before `length` is not a stylistic choice — it is the order in which the
       * arguments were declared to depend on each other. A caller handing over a
       * bag of answers should not have to know that.
       */
      for (const input of inputs) {
        const supplied = answers?.[input.name]
        if (supplied === undefined) continue
        state = await record(state, input.name, supplied)
      }

      for (const name of Object.keys(answers ?? {})) {
        if (!inputs.some((input) => input.name === name)) {
          console.warn(`modeling: ${operation.id} has no argument ${name}`)
        }
      }

      pending.value = state
    },

    async answer(value) {
      const field = asking.value
      if (!field) return
      await answerAndContinue(field.input.name, value)
    },

    async supply(name, value) {
      const state = pending.value
      if (!state || state.busy) return
      pending.value = await record(state, name, value)
    },

    async clear(name) {
      const state = pending.value
      if (!state || state.busy) return

      const field = fieldNamed(state, name)
      if (!field) return

      pending.value = await recompute({
        ...state,
        error: null,
        fields: state.fields.with(state.fields.indexOf(field), {
          ...field,
          answer: null,
          raw: null,
          skipped: false,
          error: null,
        }),
      })
    },

    async chooseMethod(resolverId) {
      const field = asking.value
      if (!field) return
      await reoffer(field.input.name, resolverId)
    },

    async chooseMethodFor(name, resolverId) {
      await reoffer(name, resolverId)
    },

    focus(name) {
      const state = pending.value
      if (!state) return

      if (name === null) {
        pending.value = { ...state, focus: null }
        return
      }

      const field = fieldNamed(state, name)
      // Arming something that cannot take a click would leave the scene
      // reporting into a field that has no way to hold it.
      if (!field || field.prompt.kind !== 'selection') return

      pending.value = { ...state, focus: name }
    },

    async submit() {
      const state = pending.value
      if (!state || state.busy) return

      const missing = state.fields.filter(
        (field) => field.input.required && field.answer === null
      )

      if (missing.length > 0) {
        pending.value = {
          ...state,
          fields: state.fields.map((field) =>
            missing.includes(field)
              ? { ...field, error: `${field.input.name} is needed.` }
              : field
          ),
        }
        return
      }

      await apply(state)
    },

    cancel() {
      pending.value = null
    },
  }
}
