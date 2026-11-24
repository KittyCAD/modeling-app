import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { signal } from '@preact/signals-core'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: {
      useState: () => ({ context: { commands: [] } }),
    },
  }),
  useSingletons: vi.fn(),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ state: null }),
}))
vi.mock('@src/hooks/useReliesOnEngine', () => ({
  useReliesOnEngine: () => false,
}))

import {
  canManageNamedView,
  KclNamedViewsPane,
  viewRows,
} from '@src/components/layout/areas/KclNamedViewsPane'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { initialiseWasmNode } from '@src/lang/wasmUtilsNode'
import { useSingletons } from '@src/lib/boot'
import {
  activeViewSignal,
  resetNamedViewSession,
} from '@src/lib/kclNamedViewActivation'
import { namedViewsPaneConfig } from '@src/lib/layout/configs/default'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'

beforeAll(async () => {
  await initialiseWasmNode()
})

afterEach(() => {
  vi.clearAllMocks()
  resetNamedViewSession()
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
      codeRef: { ...CODE_REF, range: [0, 0, moduleId] },
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

it('renders numbered rows with Default View first and module-qualified duplicate names', () => {
  const views = [
    view({ name: 'Front', id: 'panel-front', moduleId: 1 }),
    view({ name: 'Front', id: 'main-front' }),
    view({ name: 'Top' }),
  ]
  vi.mocked(useSingletons).mockReturnValue({
    kclManager: {
      isExecutingSignal: signal(false),
      execStateSignal: signal({
        artifactGraph: new Map(
          views.map(({ artifact }) => [
            artifact.id,
            {
              type: 'namedView',
              ...artifact,
            },
          ])
        ),
        filenames: {
          0: LOCAL_MAIN,
          1: {
            type: 'Local',
            value: '/project/panel.kcl',
            original_import_path: 'panel.kcl',
          },
        },
      }),
    },
  } as unknown as ReturnType<typeof useSingletons>)
  activeViewSignal.value = 'kclDefault'

  render(
    <KclNamedViewsPane
      layout={namedViewsPaneConfig}
      areaConfig={{ hide: () => false }}
    />
  )

  const pane = within(screen.getByRole('list', { name: 'Named views' }))
  expect(
    pane.getAllByTestId('named-view-label').map((row) => row.textContent)
  ).toEqual(['Default View', 'panel::Front', 'main::Front', 'Top'])
  expect(
    pane.getAllByTestId('named-view-number').map((row) => row.textContent)
  ).toEqual(['1', '2', '3', '4'])
  expect(pane.getAllByRole('listitem')[0]).toHaveAttribute(
    'data-active',
    'true'
  )
})

describe('viewRows', () => {
  it('puts Default View first when the program declared no views', () => {
    expect(viewRows([])).toEqual([
      {
        key: 'kcl-default',
        label: getKclDefaultViewName(),
        identity: 'kclDefault',
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

  it('summarizes camera intent, omitting distances that fit the model', () => {
    const front = view({ name: 'Plate' })
    front.artifact.camera.distance = 200
    const directed = view({ name: 'Inspection' })
    directed.artifact.camera = {
      look: {
        type: 'directed',
        direction: { x: 0, y: 1, z: 0, units: null },
        up: { x: 0, y: 0, z: 1, units: null },
      },
      target: null,
      distance: 125.555,
      projection: 'perspective',
    }

    expect(
      viewRows([view({ name: 'Overview' }), front, directed]).map(
        (row) => row.details
      )
    ).toEqual([
      undefined,
      'Front Orthographic',
      'Front 200mm Orthographic',
      'Directed 125.56mm Perspective',
    ])
  })

  it('gives two collided rows distinct identities', () => {
    const rows = viewRows([
      view({ name: 'Front', id: 'root', modulePath: LOCAL_MAIN }),
      view({ name: 'Front', id: 'imported', modulePath: LOCAL_BRACKET }),
    ])

    expect(rows.map((row) => row.identity)).toEqual([
      'kclDefault',
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
