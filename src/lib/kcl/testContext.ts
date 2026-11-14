import { createActiveSelection } from '@src/lib/kcl/selection'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import { defaultModelingToolGroups } from '@src/lib/kcl/toolGroups'
import { createModelingInteractions } from '@src/lib/kcl/interactions'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@src/lang/wasm'
import { createModelingTools } from '@src/lib/kcl/modelingTools'
import { defaultModelingTools } from '@src/lib/kcl/toolDefinitions'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import { createEditorDocument } from '@src/lib/editors/document'
import type { Executor } from '@src/lib/executors/registry/contract'
import { createExecutorOutput } from '@src/lib/executors/output'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import { defaultModelingStatusItems } from '@src/lib/kcl/statusItems'
import { createSceneSelection } from '@src/lib/scene/selection'
import { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'
import { vi } from 'vitest'

export function modelingTestContext() {
  const document = createEditorDocument(
    '@settings(kclVersion = 3.0)\nanswer = 42'
  )
  const editor = {
    id: Symbol('test editor'),
    classification: signal({ languageId: 'kcl' }),
    ...document.document,
    get state() {
      return document.document.state
    },
    src: signal('/main.kcl'),
    readOnly: signal(false),
  }
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
  const resource = {
    element: globalThis.document.createElement('div'),
    selection,
    preferences: {
      camera: signal({ cameraProjection: 'perspective' }),
      appearance: signal({}),
      localRenderer: signal({}),
      defaultUnit: signal('mm'),
    },
    runtime: {
      sources: signal<KclSourceSnapshot | undefined>(undefined),
      state: signal(emptyExecState()),
      ast: signal<Node<Program> | null>(null),
      fileSettings: signal({}),
      executionRevision: signal(1),
      executionElapsedMs: signal(25),
      evaluateExpression: vi.fn(async (_ast: Node<Program>) =>
        emptyExecState()
      ),
      validate: vi.fn(
        async (_ast: Node<Program>, _src: string): Promise<Error | undefined> =>
          undefined
      ),
      waitForAllEngineModelingCommands: async () => {},
      executing: signal(false),
      failed: signal(false),
    },
    commands: {
      sendSceneCommand: vi.fn(
        async (_request: unknown): Promise<unknown> =>
          new Error('No geometry in the test scene')
      ),
      pendingCommands: {},
    },
    captureScreenshot: vi.fn(() => ''),
  }
  const session = {
    resource: signal(resource),
    state: signal({ type: 'ready' }),
    attach: (container: HTMLElement) => {
      container.append(resource.element)
      return () => resource.element.remove()
    },
  }
  const settings = createSettings()
  const context: ModelingViewContext = {
    selection: createActiveSelection(() => context),
    interactions: createModelingInteractions(() => context, signal([])),
    tools: createModelingTools(() => context, signal(defaultModelingTools)),
    settings: {
      current: signal(settings),
      useSettings: () => settings,
    } as SettingsRegistryService,
    executor: {
      editor,
      output: signal(
        createExecutorOutput({
          contents: editor.contents.peek(),
          src: '/main.kcl',
          running: false,
        })
      ),
    } as unknown as Executor,
    session: session as unknown as KclSession,
    wasm: Promise.resolve({} as Awaited<ModelingViewContext['wasm']>),
    fileOperations: undefined,
    measurement: createMeasurementToolService(),
    physicalAnalysis: createPhysicalAnalysisService(),
    toolGroups: signal(defaultModelingToolGroups),
    statusItems: signal(defaultModelingStatusItems),
  }
  return {
    context,
    resource,
    editor,
    dispose: () => {
      context.interactions.dispose()
      context.tools.dispose()
      selection.dispose()
      document.dispose()
    },
  }
}
