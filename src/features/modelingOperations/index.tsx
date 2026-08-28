import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  argumentResolversValueSpec,
  modelingOperationsValueSpec,
} from '@src/contracts/modelingOperations'
import { modelingOperationsService } from '@src/contracts/modelingOperationsService'
import { projectSessionService } from '@src/contracts/projectSession'
import { selectionService } from '@src/contracts/selection'
import { overlaysValueSpec } from '@src/contracts/shell'
import { loadKclWasm } from '@src/features/kclAnalysis/wasmModule'
import { OperationPrompt } from '@src/features/modelingOperations/OperationPrompt'
import { createOperationRunner } from '@src/features/modelingOperations/createOperationRunner'
import { createSelectionResolver } from '@src/features/modelingOperations/selectionResolver'
import { extrudeOperation } from '@src/features/modelingOperations/operations/extrude'
import { builtInResolvers } from '@src/features/modelingOperations/resolvers'
import type { Program } from '@rust/kcl-lib/bindings/Program'

/**
 * Modelling operations: derived from KCL's standard library, applied as text.
 *
 * An operation is a command like any other, so it reaches the palette for free.
 * What it is *not* is a mode: there is no machine holding "currently extruding",
 * only a record of which argument is being asked about, and cancelling it leaves
 * nothing behind.
 *
 * The three layers stay separate on purpose. The stdlib shapes say what the
 * arguments are; a resolver says how a *type* is supplied; the operation says
 * how the call is written. Point-and-click will add a fourth — a way to start an
 * operation with its special argument already answered — and none of the other
 * three has to change for it.
 */
export default defineRegistryItemFactory((ctx) => {
  const operations = computed(() =>
    ctx.valueSpecs.get(modelingOperationsValueSpec)
  )
  const resolvers = computed(() =>
    ctx.valueSpecs.get(argumentResolversValueSpec)
  )

  const runner = createOperationRunner({
    operations,
    resolvers,
    session: () => ctx.services.get(projectSessionService).current.value,
    /**
     * Parse to understand, not to rewrite.
     *
     * The AST is used to find what is bound and what each binding produces. The
     * edit itself is text at an offset — recasting would rewrite the whole file
     * and hand back a diff touching every line the formatter disagrees with.
     */
    parse: async (source) => {
      const wasm = await loadKclWasm()
      const [ast] = wasm.parse_wasm(source) as [Program, unknown[]]
      return { source, ast }
    },
  })

  return {
    model: runner,
    item: defineRuntimeRegistryItem({
      id: 'modelingOperations',
      providesServices: [provideService(modelingOperationsService, runner)],
      provides: [
        provide(modelingOperationsValueSpec, extrudeOperation),
        ...builtInResolvers.map((resolver) =>
          provide(argumentResolversValueSpec, resolver)
        ),

        /**
         * Answering by pointing at the model.
         *
         * Resolved optionally: a build with no selection feature — or a session
         * with nothing rendering — simply offers one fewer way to answer, and
         * every operation is unchanged.
         */
        provide(
          argumentResolversValueSpec,
          createSelectionResolver(() => ctx.services.optional(selectionService))
        ),

        /**
         * One command per operation, contributed from the operations themselves.
         *
         * `enabled` is the runner's answer rather than a guess: an operation
         * needs a KCL buffer to write into, and the palette should say so by
         * disabling the row rather than by failing after it is chosen.
         */
        ...[extrudeOperation].map((operation) =>
          provide(commandsValueSpec, {
            id: operation.id,
            title: operation.title,
            category: operation.category ?? 'Model',
            icon: 'cube' as const,
            enabled: computed(() =>
              runner.available.value.some(
                (candidate) => candidate.id === operation.id
              )
            ),
            run: () => void runner.start(operation.id),
          })
        ),

        provide(overlaysValueSpec, {
          id: 'modeling.operationPrompt',
          order: 20,
          visible: computed(() => runner.pending.value !== null),
          render: () => <OperationPrompt />,
        }),
      ],
    }),
  }
}, 'modelingOperations')
