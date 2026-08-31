import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandService, commandsValueSpec } from '@src/contracts/commands'
import { executionCoordinatorService } from '@src/contracts/execution'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import {
  sceneModeGatesValueSpec,
  toolbarItemsValueSpec,
} from '@src/contracts/sceneModes'
import {
  argumentResolversValueSpec,
  modelingOperationsValueSpec,
} from '@src/contracts/modelingOperations'
import { modelingOperationsService } from '@src/contracts/modelingOperationsService'
import { operationPresentationValueSpec } from '@src/contracts/operationPresentation'
import { projectHistoryService } from '@src/contracts/projectHistory'
import { projectSessionService } from '@src/contracts/projectSession'
import { kclSceneService } from '@src/contracts/kclScene'
import { selectionService } from '@src/contracts/selection'
import { overlaysValueSpec } from '@src/contracts/shell'
import { loadKclWasm } from '@src/features/kclAnalysis/wasmModule'
import { OperationPrompt } from '@src/features/modelingOperations/OperationPrompt'
import { afterExecution } from '@src/features/modelingOperations/afterExecution'
import { createOperationRunner } from '@src/features/modelingOperations/createOperationRunner'
import { layoutFor } from '@src/features/modelingOperations/presentation'
import { createSelectionResolver } from '@src/features/modelingOperations/selectionResolver'
import {
  MODELING_TOOLS,
  TOOL_GROUPS,
  modelingOperations,
  toolbarItemsFor,
} from '@src/features/modelingOperations/operations/catalog'
import { operationIdFor } from '@src/features/modelingOperations/operations/derive'
import {
  ANNOTATING_MODE,
  MODELING_MODE,
  scopeForMode,
} from '@src/features/sceneToolbar/modes'
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

  /**
   * Layouts, contributed separately from the operations they lay out.
   *
   * Read here and handed to whoever asks, so the runner never sees it: an
   * argument's presentation must not be able to change whether it is answered,
   * and the surest way to guarantee that is for the thing gathering answers to
   * have no access to it.
   */
  const presentation = computed(() =>
    ctx.valueSpecs.get(operationPresentationValueSpec)
  )

  const runner = createOperationRunner({
    operations,
    resolvers,
    session: () => ctx.services.get(projectSessionService).current.value,
    /*
     * Read at apply time, and optional: the runner still writes without it, so a
     * host that has not installed the history feature loses coordinated undo
     * rather than the ability to model.
     */
    history: () => ctx.services.optional(projectHistoryService) ?? null,
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

    /**
     * Whatever the operation asked to happen next, once the model has caught up.
     *
     * Both halves are somebody else's: the coordinator knows when a run landed
     * and the command service knows what an id means. Wiring them together here
     * is what lets an operation say `then: 'sketch.enter'` and stay declarative —
     * Start sketch writes a block, and being able to draw in that block needs
     * object ids only an execution produces.
     */
    handoff: (commandId, until) => {
      afterExecution(
        () => ctx.services.optional(executionCoordinatorService),
        until,
        () => ctx.services.optional(commandService)?.run(commandId)
      )
    },
  })

  const service = {
    ...runner,
    layoutFor: (operationId: string) =>
      layoutFor(presentation.value, operationId),
  }

  return {
    model: runner,
    item: defineRuntimeRegistryItem({
      id: 'modelingOperations',
      providesServices: [provideService(modelingOperationsService, service)],
      provides: [
        ...modelingOperations.map((operation) =>
          provide(modelingOperationsValueSpec, operation)
        ),
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
          createSelectionResolver(
            () => ctx.services.optional(selectionService),
            () => ctx.services.optional(kclSceneService)
          )
        ),

        /**
         * One command per tool, contributed from the same list as everything
         * else.
         *
         * `enabled` is the runner's answer rather than a guess: an operation
         * needs a KCL buffer to write into, and the palette should say so by
         * disabling the row rather than by failing after it is chosen.
         */
        ...MODELING_TOOLS.map((tool) =>
          provide(commandsValueSpec, {
            id: operationIdFor(tool.stdlib),
            title: tool.title,
            category: tool.category ?? 'Model',
            description: tool.description,
            icon: tool.icon,
            enabled: computed(() =>
              runner.available.value.some(
                (candidate) => candidate.id === operationIdFor(tool.stdlib)
              )
            ),
            run: () => void runner.start(operationIdFor(tool.stdlib)),
          })
        ),

        /**
         * A button per tool, and a rule between sections.
         *
         * Derived from the same list, so a tool cannot appear in the palette and
         * be missing from the toolbar. The toolbar itself is contributed to
         * rather than owned: this feature says where its tools go, and knows
         * nothing about how a strip is drawn.
         */
        ...toolbarItemsFor(MODELING_TOOLS, TOOL_GROUPS).map((item) =>
          provide(toolbarItemsValueSpec, item)
        ),

        /**
         * A bare letter per tool, live only inside its mode.
         *
         * `e` extrudes in Modeling and means nothing in Annotating, because the
         * binding is scoped to the mode and only one mode's scope is applied.
         * That is the whole of modal keys — the keymap learns nothing about
         * modes, and this learns nothing about keymaps.
         */
        ...MODELING_TOOLS.flatMap((tool) => {
          const scope = tool.key ? scopeForMode(tool.mode) : undefined
          if (!tool.key || !scope) return []

          return [
            provide(keybindingsValueSpec, {
              keystrokes: [tool.key],
              commandId: operationIdFor(tool.stdlib),
              scopes: [scope],
            }),
          ]
        }),

        /**
         * Both modes need somewhere to write.
         *
         * Contributed as gates rather than assumed, and this is what keeps a bare
         * `e` from meaning anything on the projects screen: with no KCL buffer no
         * mode is available, so no mode's keymap scope is applied and the tools'
         * single-letter keys simply are not live. The alternative was every
         * keystroke reaching a disabled command and being refused, which is the
         * same outcome reported as a warning.
         */
        ...[MODELING_MODE, ANNOTATING_MODE].map((mode) =>
          provide(sceneModeGatesValueSpec, {
            id: `modeling.canWrite.${mode}`,
            mode,
            available: computed(() => runner.available.value.length > 0),
            reason: 'Open a KCL file to model.',
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
