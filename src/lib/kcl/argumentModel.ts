import { computed } from '@preact/signals-core'
import type { CommandArgumentModel } from '@src/lib/commandArguments/registry/contract'
import { parse, resultIsOk } from '@src/lang/wasm'
import { currentModel, type ModelingTarget } from '@src/lib/kcl/modelingTarget'
import { watchViewerSelection } from '@src/lib/kcl/selection'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/** Cache one input model per execution so field rerenders do not restart expression evaluation. */
export function createArgumentModelLookup(wasmPromise: Promise<ModuleType>) {
  const cache = new WeakMap<object, CommandArgumentModel>()
  return (
    target: ModelingTarget,
    wasm: ModuleType
  ): CommandArgumentModel | undefined => {
    const snapshot = currentModel(target)
    if (!snapshot) return
    const existing = cache.get(snapshot)
    if (existing) return existing
    const parsed = parse(snapshot.contents, wasm)
    if (parsed instanceof Error || !resultIsOk(parsed)) return
    const model: CommandArgumentModel = {
      ast: parsed.program,
      astSignal: computed(() => parsed.program),
      codeSignal: computed(() => snapshot.contents),
      variablesSignal: computed(() => snapshot.execState.variables),
      artifactGraph: snapshot.execState.artifactGraph,
      rustContext: {
        wasmInstancePromise: wasmPromise,
        evaluateExpression: async (ast) =>
          currentModel(target) === snapshot
            ? target.session.evaluateExpression(ast)
            : Promise.reject(
                new Error('The model changed. Reopen the command.')
              ),
        waitForAllEngineModelingCommands:
          target.session.waitForAllEngineModelingCommands,
      },
      collect: (arg, onSelect, onError) =>
        watchViewerSelection({
          target,
          snapshot,
          wasm,
          arg,
          onSelect,
          onError,
        }),
    }
    cache.set(snapshot, model)
    return model
  }
}
