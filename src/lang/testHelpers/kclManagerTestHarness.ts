import { setDiagnosticsEffect, type Diagnostic } from '@codemirror/lint'
import { KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import { loadWasm } from '@src/unitTestUtils'

const wasmPromise = loadWasm()

export function createKclManagerTestHarness(initialCode = ''): {
  app: App
  kclManager: KclManager
} {
  const app = App.fromProvided({
    wasmPromise,
  })
  const { kclManager } = app.singletons

  if (kclManager.code !== initialCode) {
    kclManager.updateCodeEditor(initialCode, {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
    })
  }

  return { app, kclManager }
}

export function getLatestDispatchedDiagnostics(
  dispatchCalls: Array<[unknown, ...unknown[]]>
): Diagnostic[] {
  for (let i = dispatchCalls.length - 1; i >= 0; i -= 1) {
    const [spec] = dispatchCalls[i]
    if (typeof spec !== 'object' || spec === null || !('effects' in spec)) {
      continue
    }

    const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects]
    const diagnosticsEffect = effects.find(
      (effect) =>
        typeof effect === 'object' &&
        effect !== null &&
        'is' in effect &&
        typeof effect.is === 'function' &&
        effect.is(setDiagnosticsEffect)
    )

    if (diagnosticsEffect && 'value' in diagnosticsEffect) {
      return diagnosticsEffect.value as Diagnostic[]
    }
  }

  return []
}
