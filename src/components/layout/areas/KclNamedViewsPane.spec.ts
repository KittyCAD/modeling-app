import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { AreaType, LayoutType } from '@src/lib/layout'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const renderMocks = vi.hoisted(() => {
  const wasmInstance = {}
  const wasmInstancePromise = Object.assign(Promise.resolve(wasmInstance), {
    status: 'fulfilled',
    value: wasmInstance,
  })

  return {
    experimentalPointAndClick: true,
    activateNamedView: vi.fn(async () => undefined),
    appSend: vi.fn(),
    namedViewCameraSummary: vi.fn(() => 'Front Orthographic'),
    prepareNamedViewEditCommand: vi.fn(async () => ({
      type: 'Find and select command',
    })),
    kclManager: {
      wasmInstancePromise,
      ast: {},
      code: '',
      path: '/project/main.kcl',
      sceneInfra: {},
      execStateSignal: {
        value: { artifactGraph: new Map(), filenames: {} },
      },
      isExecutingSignal: { value: false },
      systemDeps: { projectPath: { value: '/project' } },
    },
  }
})

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
  namedViewCameraSummary: renderMocks.namedViewCameraSummary,
  prepareNamedViewEditCommand: renderMocks.prepareNamedViewEditCommand,
}))

vi.mock('@src/lib/kclNamedViewActivation', async (importOriginal) => ({
  ...(await importOriginal()),
  activateNamedView: renderMocks.activateNamedView,
}))

vi.mock('@src/components/ActionButton', () => ({
  ActionButton: () => null,
}))

vi.mock('@src/components/ContextMenu', () => ({
  ContextMenu: () => null,
  ContextMenuItem: () => null,
}))

vi.mock('@src/components/CustomIcon', () => ({
  CustomIcon: () => null,
}))

vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: ({ children }: { children: unknown }) => children,
  LayoutPanelHeader: ({ Menu }: { Menu: unknown }) => Menu,
}))

import {
  KclNamedViewsPane,
  canManageNamedView,
  nextViewSelection,
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

  it('only lets the root module manage a declared view', () => {
    expect(canManageNamedView(view({ name: 'Root' }))).toBe(true)
    expect(canManageNamedView(view({ name: 'Import', moduleId: 1 }))).toBe(
      false
    )
  })
})

describe('KclNamedViewsPane', () => {
  function renderPane(experimentalPointAndClick = true) {
    renderMocks.experimentalPointAndClick = experimentalPointAndClick
    return render(
      createElement(
        Suspense,
        { fallback: createElement('div', null, 'Loading WASM') },
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
      expect(label).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(label, { metaKey: true })
      expect(label).toHaveAttribute('aria-pressed', 'false')
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

describe('nextViewSelection', () => {
  const rowKeys = ['default', 'front', 'top', 'detail']
  const click = {
    selected: new Set(['front']),
    rowKey: 'detail',
    rowIndex: 3,
    anchorIndex: 1,
    rowKeys,
    shiftKey: false,
    toggleKey: false,
  }

  it('makes a plain click the only selection', () => {
    const result = nextViewSelection({
      ...click,
      selected: new Set(['front', 'top']),
    })

    expect([...result.selected]).toEqual(['detail'])
    expect(result.anchorIndex).toBe(3)
  })

  it('toggles a row with Command or Control click', () => {
    const added = nextViewSelection({
      ...click,
      rowKey: 'top',
      rowIndex: 2,
      toggleKey: true,
    })
    expect([...added.selected]).toEqual(['front', 'top'])

    const removed = nextViewSelection({
      ...click,
      selected: added.selected,
      rowKey: 'front',
      rowIndex: 1,
      anchorIndex: added.anchorIndex,
      toggleKey: true,
    })
    expect([...removed.selected]).toEqual(['top'])
  })

  it('selects a contiguous range with Shift click', () => {
    const result = nextViewSelection({
      ...click,
      shiftKey: true,
    })

    expect([...result.selected]).toEqual(['front', 'top', 'detail'])
    expect(result.anchorIndex).toBe(1)
  })

  it('adds a Shift range when Command or Control is also held', () => {
    const result = nextViewSelection({
      ...click,
      selected: new Set(['default']),
      anchorIndex: 2,
      shiftKey: true,
      toggleKey: true,
    })

    expect([...result.selected]).toEqual(['default', 'top', 'detail'])
  })
})
