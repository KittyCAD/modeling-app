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
 * An operation part way through being asked about.
 *
 * A record in a signal, not a state machine. The states are "asking about
 * argument n" and "not running", the transitions are answer and cancel, and a
 * machine would be enforcing nothing that the index does not already say. The
 * file tree's draft row is the same shape for the same reason.
 */
export interface PendingOperation {
  operation: ModelingOperation
  command: StdLibCommandShape
  inputs: readonly DerivedInput[]
  /** Which input is being asked about. */
  index: number
  /**
   * The ways this argument can be answered.
   *
   * More than one is the normal case for anything geometric: a `Sketch` can be
   * an existing binding or a region picked in the scene, and which to use is the
   * user's choice rather than the first matching resolver's.
   */
  methods: readonly { id: string; label: string }[]
  /** The method being offered. One of `methods`. */
  method: string
  prompt: ArgumentPrompt
  resolved: ResolvedInputs
  program: ParsedProgram
  /** Project-relative path of the buffer being edited. */
  path: string
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
  /** Operations that could run right now, for enabling their commands. */
  readonly available: ReadonlySignal<readonly ModelingOperation[]>
  start(operationId: string): Promise<void>
  /** Answer the current argument. Empty skips an optional one. */
  answer(value: string): Promise<void>
  /** Offer this argument a different way. */
  chooseMethod(resolverId: string): Promise<void>
  cancel(): void
}

const KCL = 'kcl'

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

  /** Every way of answering this argument, in the order they are offered. */
  const resolversFor = (input: DerivedInput) =>
    [...resolvers.value]
      .filter((resolver) => resolver.handles(input))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const resolverById = (id: string) =>
    resolvers.value.find((resolver) => resolver.id === id)

  /**
   * Move to the next argument, or finish.
   *
   * Optional arguments whose resolver has nothing to offer are skipped rather
   * than shown empty — a choice with no options is a dead end, and for an
   * optional argument it is simply not applicable here.
   */
  const askWith = async (
    resolver: ArgumentResolver,
    state: PendingOperation,
    index: number
  ) => {
    const input = state.inputs[index]
    const methods = resolversFor(input).map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
    }))

    const prompt = await resolver.prompt({
      input,
      program: state.program,
      resolved: state.resolved,
    })

    return { ...state, index, methods, method: resolver.id, prompt }
  }

  /**
   * Move to the next argument, or finish.
   *
   * An argument may have several methods, and the first is offered — but a method
   * with nothing to offer is skipped in favour of the next one, so "no sketch in
   * this file" falls through to picking one in the scene rather than dead-ending
   * on an empty list. Only when every method is empty is an optional argument
   * skipped and a required one reported.
   */
  const advance = async (state: PendingOperation): Promise<void> => {
    for (let index = state.index; index < state.inputs.length; index += 1) {
      const input = state.inputs[index]

      /*
       * A method that can already answer is offered first.
       *
       * The order still decides everything else; this only lifts a method that
       * says it has the answer in hand. It is what makes a face selected before
       * the operation started the thing the operation opens on, rather than a
       * list of planes with the selection one switch away.
       */
      const request = {
        input,
        program: state.program,
        resolved: state.resolved,
      }
      const offered = resolversFor(input)
      const candidates = [
        ...offered.filter((resolver) => resolver.ready?.(request) === true),
        ...offered.filter((resolver) => resolver.ready?.(request) !== true),
      ]

      if (candidates.length === 0) {
        if (!input.required) continue
        pending.value = {
          ...state,
          index,
          methods: [],
          error: `Nothing knows how to supply ${input.name}.`,
          busy: false,
        }
        return
      }

      let lastEmpty: PendingOperation | null = null

      for (const resolver of candidates) {
        const asked = await askWith(resolver, state, index)

        if (
          asked.prompt.kind === 'choice' &&
          asked.prompt.options.length === 0
        ) {
          lastEmpty = asked
          continue
        }

        pending.value = { ...asked, error: null, busy: false }
        return
      }

      // Every method had nothing. For an optional argument that means "not
      // applicable here"; for a required one it is worth saying why.
      if (!input.required) continue

      pending.value = {
        ...(lastEmpty ?? state),
        index,
        error:
          (lastEmpty?.prompt.kind === 'choice'
            ? lastEmpty.prompt.empty
            : null) ?? `There is no ${input.name} to choose.`,
        busy: false,
      }
      return
    }

    await apply(state)
  }

  const apply = async (state: PendingOperation): Promise<void> => {
    const target = activeKclBuffer()
    if (!target) {
      pending.value = { ...state, error: 'The file is no longer open.' }
      return
    }

    pending.value = { ...state, busy: true, error: null }

    try {
      const edit: ProjectEdit = await state.operation.plan({
        command: state.command,
        inputs: state.inputs,
        resolved: state.resolved,
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
      const prerequisites = Object.values(state.resolved).flatMap(
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

  return {
    pending: computed(() => pending.value),
    available,

    async start(operationId) {
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

      await advance({
        operation,
        command,
        inputs,
        index: 0,
        // All three are replaced immediately by `advance`; nothing is ever shown
        // from here.
        methods: [],
        method: '',
        prompt: { kind: 'expression' },
        resolved: {},
        program,
        path: target.path,
        error: null,
        busy: false,
      })
    },

    async answer(value) {
      const state = pending.value
      if (!state || state.busy) return

      const input = state.inputs[state.index]
      const trimmed = value.trim()

      if (trimmed.length === 0) {
        if (input.required) {
          pending.value = { ...state, error: `${input.name} is needed.` }
          return
        }
        // Skipped, and left out of the call entirely rather than written empty.
        await advance({ ...state, index: state.index + 1, error: null })
        return
      }

      const resolver = resolverById(state.method)
      const argument = resolver?.toArgument
        ? resolver.toArgument(trimmed, {
            input,
            program: state.program,
            resolved: state.resolved,
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
        if (input.required) {
          pending.value = { ...state, error: `${input.name} is needed.` }
          return
        }
        await advance({ ...state, index: state.index + 1, error: null })
        return
      }

      const resolved: Record<string, ResolvedArgument> = {
        ...state.resolved,
        [input.name]: argument,
      }

      await advance({
        ...state,
        index: state.index + 1,
        resolved,
        error: null,
      })
    },

    /**
     * Offer the current argument a different way.
     *
     * Re-asks rather than converting: a method that yields the same argument by
     * a different route has its own prompt, and whatever was typed for the last
     * one was an answer to a different question.
     */
    async chooseMethod(resolverId) {
      const state = pending.value
      if (!state || state.busy) return

      const resolver = resolverById(resolverId)
      if (!resolver || !resolver.handles(state.inputs[state.index])) return

      const asked = await askWith(resolver, state, state.index)
      pending.value = { ...asked, error: null, busy: false }
    },

    cancel() {
      pending.value = null
    },
  }
}
