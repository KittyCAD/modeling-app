import { signal } from '@preact/signals-core'
import { createEditorDocument } from '@src/lib/editors/document'
import { createExecutor } from '@src/lib/executors/executor'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { KclSession } from '@src/lib/kcl/modeling/session'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'
import { defaultModelingStatusItems } from '@src/lib/kcl/modeling/statusItems'
import { createSceneSelection } from '@src/lib/kcl/scene/selection'
import { createTestKclScene } from '@src/lib/kcl/testFixtures'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'
import { vi } from 'vitest'

/** Real document/executor state with complete scene contracts; no native model or transport is opened. */
export function modelingTestContext() {
  const readOnly = signal(false)
  const document = createEditorDocument(
    '@settings(kclVersion = 3.0)\nanswer = 42',
    () => !readOnly.peek()
  )
  const editor = {
    ...document.document,
    get state() {
      return document.document.state
    },
    id: Symbol('editor'),
    classification: signal(undefined),
    src: signal<string | undefined>('/main.kcl'),
    readOnly,
  }
  const execution = createExecutor(editor, signal([]), () => {})
  const selection = createSceneSelection(
    {
      pick: async ({ clientX }) => ({
        reference: { type: 'region', region_id: String(clientX) },
      }),
      present: async () => {},
    },
    ['region']
  )
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  const base = createTestKclScene('streamed', { selection })
  const resource = {
    ...base,
    commands: {
      ...base.commands,
      sendSceneCommand: vi.fn<KclSceneResource['commands']['sendSceneCommand']>(
        async () => null
      ),
    },
  }
  resource.runtime.executionRevision.value = 1
  resource.runtime.executionElapsedMs.value = 25
  const session = {
    element: globalThis.document.createElement('div'),
    resource: signal<KclSceneResource | undefined>(resource),
    state: signal<KclSession['state']['value']>({ type: 'ready' }),
    replaceScene: vi.fn(),
    reconnect: vi.fn(),
    execute: vi.fn<KclSession['execute']>(
      async () => new Error('No native runtime in this fixture')
    ),
    attach: (container: HTMLElement) => {
      container.append(resource.element)
      return () => resource.element.remove()
    },
    dispose: vi.fn(),
  } satisfies KclSession
  const viewState = signal<
    ModelingViewContext['viewExecution']['state']['value']
  >({
    revision: undefined,
    error: undefined,
    running: false,
    stale: false,
    result: resource.runtime.state.peek(),
  })
  const context: ModelingViewContext = {
    executor: execution.executor,
    session,
    viewExecution: {
      state: viewState,
      run: vi.fn(),
      refresh: vi.fn(),
      dispose: vi.fn(),
    },
    render: vi.fn(async () => {}),
    cameraShortcuts: signal({}),
    attachCameraViewport: () => () => {},
    wasm: new Promise(() => {}),
    fileOperations: testFileOperations,
    measurement: createMeasurementToolService(),
    physicalAnalysis: createPhysicalAnalysisService(),
    statusItems: signal(defaultModelingStatusItems),
  }
  return {
    context,
    resource,
    editor,
    viewState,
    dispose: () => {
      context.measurement.close()
      context.physicalAnalysis.close()
      selection.dispose()
      execution.dispose()
      document.dispose()
    },
  }
}
