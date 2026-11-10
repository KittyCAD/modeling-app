import { signal } from '@preact/signals-core'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { KclManager } from '@src/lang/KclManager'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { useState } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  codemod: vi.fn(async () => ({ modifiedAst: { body: [] } })),
  render: vi.fn(async () => [{ name: 'preview.glb', contents: [0] }]),
  dispose: vi.fn(),
}))
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    auth: { actor: { getSnapshot: () => ({ context: { token: 'test' } }) } },
  }),
}))
vi.mock('@src/components/ModelingDialog/arguments', () => ({
  fieldText: (value: unknown) => (typeof value === 'string' ? value : ''),
  resolveArguments: async (
    context: CommandBarContext,
    values: Record<string, unknown>
  ) => ({
    ...context.argumentsToSubmit,
    ...values,
    length: { valueText: values.length, valueAst: {}, valueCalculated: 5 },
  }),
}))
vi.mock('@src/lib/commandUtils', () => ({
  isKclCommandValue: (value: unknown) =>
    !!value && typeof value === 'object' && 'valueAst' in value,
}))
vi.mock('@src/lang/queryAst', () => ({
  resolveToCodeRef: () => ({
    artifact: { type: 'path', subType: 'region', id: 'region' },
  }),
}))
vi.mock('@src/lib/selections', () => ({
  isSelections: (value: unknown) =>
    !!value && typeof value === 'object' && 'graphSelections' in value,
  isEngineRegionSelection: () => false,
}))
vi.mock('@src/lib/commandBarConfigs/modelingCommandCodemods', () => ({
  modelingCommandCodemods: { Extrude: {} },
}))
vi.mock('@src/lang/modifyAst/modelingCodemod', () => ({
  runModelingCodemod: mocks.codemod,
}))
vi.mock('@src/lib/modelingPreview/executor', () => ({
  createPreviewExecutor: async () => ({
    render: mocks.render,
    dispose: mocks.dispose,
  }),
}))
vi.mock('@src/routes/utils', () => ({ IS_STAGING_OR_DEBUG: true }))

import { ExtrudePreview } from '@src/components/ModelingDialog/ExtrudePreview'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function fixture(localRendering = true) {
  const camera = new PerspectiveCamera()
  camera.position.set(100, -100, 100)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const nodeToEdit = [
    ['body', ''],
    [2, 'index'],
  ]
  const renderer = {
    getExtrudeFrame: vi.fn(() => ({
      origin: new Vector3(),
      normal: new Vector3(0, 0, 1),
    })),
    showOperationPreview: vi.fn(async () => {}),
    clearOperationPreview: vi.fn(),
  }
  const kcl = {
    ast: { body: [] },
    code: 'original',
    path: 'main.kcl',
    codeSignal: signal('original'),
    engineSceneGenerationSignal: signal(0),
    isExecutingSignal: signal(false),
    isExecuting: false,
    engineCommandManager: { engineSessionId: 'session' },
    fileSettings: { defaultLengthUnit: 'mm' },
    artifactGraph: new Map(),
    wasmInstancePromise: Promise.resolve({}),
    sceneInfra: {
      localRenderer: localRendering ? renderer : undefined,
      camControls: {
        camera,
        domElement: document.createElement('div'),
      },
    },
  } as unknown as KclManager
  const context = {
    argumentsToSubmit: { nodeToEdit, length: '5mm' },
  } as unknown as CommandBarContext
  function Dialog() {
    const [draft, setDraft] = useState<Record<string, unknown>>({
      sketches: {
        graphSelections: [{ artifact: { type: 'path', id: 'region' } }],
        otherSelections: [],
      },
      length: '5mm',
    })
    return (
      <ExtrudePreview
        kcl={kcl}
        context={context}
        draft={draft}
        save={(name, value) =>
          setDraft((previous) => ({ ...previous, [name]: value }))
        }
        containerRef={{ current: document.body }}
      />
    )
  }
  return { Dialog, kcl, renderer, nodeToEdit }
}

it('previews an existing extrusion without creating a new operation or changing source', async () => {
  const { Dialog, kcl, renderer, nodeToEdit } = fixture()
  const view = render(<Dialog />)
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Live preview (experimental)' })
  )
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe('Preview (5mm)')
  )
  expect(mocks.codemod).toHaveBeenCalledWith(
    expect.objectContaining({
      commandArgs: expect.objectContaining({
        nodeToEdit,
        method: undefined,
        bodyType: undefined,
      }),
    })
  )
  expect(renderer.getExtrudeFrame).toHaveBeenCalledWith('region', 5)
  expect(
    screen.getByRole('button', { name: 'Drag extrusion distance' })
  ).toBeTruthy()
  expect(kcl.code).toBe('original')
  view.unmount()
  expect(renderer.clearOperationPreview).toHaveBeenCalled()
  await waitFor(() => expect(mocks.dispose).toHaveBeenCalled())
})

it('explains the missing preview when local rendering is off', () => {
  const { Dialog } = fixture(false)
  render(<Dialog />)
  expect(screen.getByRole('status').textContent).toBe(
    'Enable Local Rendering in Settings to preview.'
  )
  expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
})
