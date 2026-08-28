import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import type { Executor } from '@src/contracts/execution'
import { executorsValueSpec } from '@src/contracts/execution'
import {
  type KclCompilationIssue,
  issuesToDiagnostics,
  thrownErrorToDiagnostics,
} from '@src/features/kclAnalysis/diagnostics'
import { userFeaturesService } from '@src/contracts/userFeatures'
import { createRuntimeFlagApplier } from '@src/features/kclAnalysis/runtimeFlags'
import { loadKclWasm } from '@src/features/kclAnalysis/wasmModule'
import type { KclWasmModule } from '@src/features/kclAnalysis/wasmModule'

/**
 * Parses KCL and reports what is wrong with it.
 *
 * This is analysis, not modelling: it produces diagnostics, not geometry.
 * Geometry needs the engine, and an engine-backed executor plugs in beside this
 * one — accepting the same requests at a lower order — without either of them
 * changing.
 *
 * Worth being precise about, because "execution" in #6836 means submitting to
 * the engine. What is shipped here is the coordinator, the adapter, and a real
 * offline executor; the engine-backed one is not built.
 */
export function createKclAnalysisExecutor(
  applyRuntimeFlags: (wasm: KclWasmModule) => Promise<void>
): Executor {
  return {
    id: 'kcl.analysis',
    order: 100,
    accepts: (request) => request.languageId === 'kcl',

    async run(request) {
      const wasm = await loadKclWasm()
      await applyRuntimeFlags(wasm)
      if (request.signal.aborted) {
        return { requestId: request.requestId, diagnostics: [] }
      }

      try {
        // Returns [ast, issues]. Issues carry both errors and warnings; a hard
        // failure throws instead.
        const [, issues] = wasm.parse_wasm(request.contents) as [
          unknown,
          KclCompilationIssue[],
        ]

        return {
          requestId: request.requestId,
          diagnostics: issuesToDiagnostics(
            issues ?? [],
            request.contents.length
          ),
        }
      } catch (thrown) {
        // A parse failure is a result, not a run failure: the user wants the
        // error shown in the gutter, not an execution marked broken.
        return {
          requestId: request.requestId,
          diagnostics: thrownErrorToDiagnostics(
            thrown,
            request.contents.length
          ),
        }
      }
    },
  }
}

export default defineRegistryItemFactory((ctx) => {
  // Optional: a build with no features service is a build that runs KCL on
  // Rust's own defaults, which is what it did before this existed.
  const applyRuntimeFlags = createRuntimeFlagApplier(() =>
    ctx.services.optional(userFeaturesService)
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'kclAnalysis',
      provides: [
        provide(
          executorsValueSpec,
          createKclAnalysisExecutor(applyRuntimeFlags)
        ),
      ],
    }),
  }
}, 'kclAnalysis')
