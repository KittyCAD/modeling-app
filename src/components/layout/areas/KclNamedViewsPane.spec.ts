import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { AreaType, LayoutType } from '@src/lib/layout'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const renderMocks = vi.hoisted(() => ({
  experimentalPointAndClick: true,
  activateNamedView: vi.fn(async () => undefined),
  appSend: vi.fn(),
  prepareNamedViewEditCommand: vi.fn(async () => ({
    type: 'Find and select command',
  })),
  kclManager: {
    ast: {},
    code: '',
    path: '/project/main.kcl',
    execStateSignal: {
      value: { artifactGraph: new Map(), filenames: {} },
    },
    isExecutingSignal: { value: false },
    systemDeps: { project: { value: { path: '/project' } } },
  },
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: { actor: { send: renderMocks.appSend } },
    userFeatures: { useHas: () => renderMocks.experimentalPointAndClick },
  }),
  useSingletons: () => ({ kclManager: renderMocks.kclManager }),
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ state: null }),
}))

vi.mock('@src/hooks/useReliesOnEngine', () => ({
  useReliesOnEngine: () => false,
}))

vi.mock('@src/lib/kclNamedViewEdit', () => ({
  prepareNamedViewEditCommand: renderMocks.prepareNamedViewEditCommand,
}))

vi.mock('@src/lib/kclNamedViewActivation', async (importOriginal) => ({
  ...(await importOriginal()),
  activateNamedView: renderMocks.activateNamedView,
}))

vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: ({ children }: { children: unknown }) => children,
  LayoutPanelHeader: ({ Menu }: { Menu: unknown }) => Menu,
}))

import {
  KclNamedViewsPane,
  canManageNamedView,
  viewRows,
} from '@src/components/layout/areas/KclNamedViewsPane'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { activeViewSignal } from '@src/lib/kclNamedViewActivation'
import { initialiseWasmNode } from '@src/lang/wasmUtilsNode'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'

beforeAll(async () => {
  await initialiseWasmNode()
})

afterEach(() => {
  act(() => {
    activeViewSignal.value = null
  })
})

const CODE_REF = {
  range: [0, 0, 0] as [number, number, number],
  nodePath: { steps: [] },
  pathToNode: [],
}

function view({
  name,
  id = `view-${name}`,
  modulePath,
  moduleId = 0,
}: {
  name: string
  id?: string
  modulePath?: ModulePath
  moduleId?: number
}): KclNamedView {
  return {
    artifact: {
      id,
      name,
      camera: {
        look: { type: 'oriented', orientation: 'front' },
        target: null,
        distance: null,
        projection: 'orthographic',
      },
      baseline: 'show',
      showIds: [],
      hideIds: [],
      codeRef: CODE_REF,
    },
    moduleId,
    modulePath,
  }
}

const LOCAL_MAIN: ModulePath = {
  type: 'Local',
  value: '/project/main.kcl',
  original_import_path: null,
}

const LOCAL_BRACKET: ModulePath = {
  type: 'Local',
  value: '/project/parts/bracket.kcl',
  original_import_path: 'parts/bracket.kcl',
}

describe('viewRows', () => {
  it('puts Default View first when the program declared no views', () => {
    expect(viewRows([])).toEqual([
      {
        key: 'kcl-default',
        label: getKclDefaultViewName(),
        identity: null,
        target: { kind: 'kclDefault' },
      },
    ])
  })

  it('keeps Default View first and the declared views in order', () => {
    const rows = viewRows([
      view({ name: 'Front', modulePath: LOCAL_MAIN }),
      view({ name: 'Plate in context', modulePath: LOCAL_MAIN }),
    ])

    expect(rows.map((row) => row.label)).toEqual([
      getKclDefaultViewName(),
      'Front',
      'Plate in context',
    ])
  })

  it('prefixes both rows with the declaring module when a name collides', () => {
    const rows = viewRows([
      view({ name: 'Front', id: 'root', modulePath: LOCAL_MAIN }),
      view({ name: 'Front', id: 'imported', modulePath: LOCAL_BRACKET }),
      view({ name: 'Side', id: 'side', modulePath: LOCAL_BRACKET }),
    ])

    expect(rows.map((row) => row.label)).toEqual([
      getKclDefaultViewName(),
      'main::Front',
      'bracket::Front',
      'Side',
    ])
  })

  it('gives two collided rows distinct identities', () => {
    const rows = viewRows([
      view({ name: 'Front', id: 'root', modulePath: LOCAL_MAIN }),
      view({ name: 'Front', id: 'imported', modulePath: LOCAL_BRACKET }),
    ])

    expect(rows.map((row) => row.identity)).toEqual([
      null,
      { name: 'Front', moduleKey: 'Local:/project/main.kcl' },
      { name: 'Front', moduleKey: 'Local:/project/parts/bracket.kcl' },
    ])
  })

  it('leaves a collided name bare when the module is unknown', () => {
    const rows = viewRows([
      view({ name: 'Front', id: 'a' }),
      view({ name: 'Front', id: 'b', modulePath: { type: 'Main' } }),
    ])

    expect(rows.map((row) => row.label)).toEqual([
      getKclDefaultViewName(),
      'Front',
      'Front',
    ])
  })

  it('keys each row by artifact id', () => {
    const rows = viewRows([view({ name: 'Front', id: 'view-1' })])

    expect(rows.map((row) => row.key)).toEqual(['kcl-default', 'view-1'])
  })

  it('only manages root-module views declared outside functions', () => {
    expect(canManageNamedView(view({ name: 'Root' }))).toBe(true)
    expect(canManageNamedView(view({ name: 'Import', moduleId: 1 }))).toBe(
      false
    )

    const generated = view({ name: 'Generated' })
    generated.artifact.codeRef = {
      ...generated.artifact.codeRef,
      pathToNode: [['body', 'FunctionExpression']],
    }
    expect(canManageNamedView(generated)).toBe(false)
  })
})

describe('KclNamedViewsPane', () => {
  function renderPane(experimentalPointAndClick = true) {
    renderMocks.experimentalPointAndClick = experimentalPointAndClick
    return render(
      createElement(KclNamedViewsPane, {
        layout: {
          id: 'named-views',
          label: 'Named Views',
          type: LayoutType.Simple,
          areaType: AreaType.NamedViews,
        },
        areaConfig: { hide: () => false },
        onClose: vi.fn(),
      })
    )
  }

  it.each([false, true])(
    'applies views independently of experimental editing (%s)',
    async (experimentalPointAndClick) => {
      const namedView = view({ name: 'Front', modulePath: { type: 'Main' } })
      renderMocks.kclManager.execStateSignal.value = {
        artifactGraph: new Map([
          [namedView.artifact.id, { type: 'namedView', ...namedView.artifact }],
        ]),
        filenames: { 0: { type: 'Main' } },
      }
      renderMocks.activateNamedView.mockClear()
      renderMocks.prepareNamedViewEditCommand.mockClear()

      renderPane(experimentalPointAndClick)

      const label = await screen.findByRole('button', { name: /^Front/ })
      fireEvent.click(label)
      expect(renderMocks.activateNamedView).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Apply Front' }))
      expect(renderMocks.activateNamedView).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ kind: 'declared' }),
        })
      )

      expect(renderMocks.activateNamedView).toHaveBeenCalledTimes(1)

      act(() => {
        activeViewSignal.value = { name: 'Front', moduleKey: 'Main' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Front is active' }))
      expect(renderMocks.activateNamedView).toHaveBeenCalledTimes(2)

      fireEvent.doubleClick(label)
      expect(renderMocks.prepareNamedViewEditCommand).toHaveBeenCalledTimes(
        experimentalPointAndClick ? 1 : 0
      )
    }
  )

  it.each(['unchanged', 'file'])(
    'only opens a prepared edit for the same source (%s)',
    async (change) => {
      const namedView = view({ name: 'Front', modulePath: { type: 'Main' } })
      renderMocks.kclManager.execStateSignal.value = {
        artifactGraph: new Map([
          [namedView.artifact.id, { type: 'namedView', ...namedView.artifact }],
        ]),
        filenames: { 0: { type: 'Main' } },
      }
      renderMocks.kclManager.path = '/project/main.kcl'
      renderMocks.appSend.mockClear()
      let finishEdit: (event: { type: string }) => void = () => {}
      renderMocks.prepareNamedViewEditCommand.mockReturnValueOnce(
        new Promise((resolve) => {
          finishEdit = resolve
        })
      )
      renderPane()

      fireEvent.doubleClick(
        await screen.findByRole('button', { name: /^Front/ })
      )
      if (change === 'file') renderMocks.kclManager.path = '/project/other.kcl'
      await act(async () => {
        finishEdit({ type: 'Find and select command' })
      })

      expect(renderMocks.appSend).toHaveBeenCalledTimes(
        change === 'unchanged' ? 1 : 0
      )
    }
  )
})
