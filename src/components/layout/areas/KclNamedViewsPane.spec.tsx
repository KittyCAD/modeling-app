import { signal } from '@preact/signals-core'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import type { NamedViewResolutionFailure } from '@rust/kcl-lib/bindings/NamedViewResolutionFailure'
import type { ResolvedNamedView } from '@rust/kcl-lib/bindings/ResolvedNamedView'
import { act, render, screen, within } from '@testing-library/react'

import {
  canManageNamedView,
  KclNamedViewsPane,
  viewRows,
} from '@src/components/layout/areas/KclNamedViewsPane'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { emptyExecState } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import {
  activeViewSignal,
  resetNamedViewSession,
} from '@src/lib/kclNamedViewActivation'
import { namedViewsPaneConfig } from '@src/lib/layout/configs/default'
import { initialiseWasmNode } from '@src/lang/wasmUtilsNode'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'
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
      declaringModuleId: moduleId,
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

function execution({
  views,
  resolved = [],
  failures = [],
}: {
  views: KclNamedView[]
  resolved?: ResolvedNamedView[]
  failures?: NamedViewResolutionFailure[]
}) {
  return {
    artifacts: new Map(
      views.map(({ artifact }) => [
        artifact.id,
        { ...artifact, type: 'namedView' as const },
      ])
    ),
    filenames: Object.fromEntries(
      views.map(({ moduleId, modulePath }) => [moduleId, modulePath])
    ),
    batch: { defaultView: {}, namedViews: resolved, failures },
  }
}

function result(view: KclNamedView, modulePath: ModulePath): ResolvedNamedView {
  return {
    info: {
      artifactId: view.artifact.id,
      name: view.artifact.name,
      moduleId: view.moduleId,
      modulePath,
    },
    cameraIntent: view.artifact.camera,
    visibility: {},
  }
}

it('renders numbered rows with Default View first and module-qualified duplicate names', () => {
  const panel: ModulePath = {
    type: 'Local',
    value: '/project/panel.kcl',
    original_import_path: 'panel.kcl',
  }
  const views = [
    view({ name: 'Front', id: 'panel-front', moduleId: 1, modulePath: panel }),
    view({ name: 'Front', id: 'main-front', modulePath: LOCAL_MAIN }),
    view({ name: 'Top', modulePath: LOCAL_MAIN }),
  ]
  const actual = execution({
    views,
    resolved: views.map((item) =>
      result(item, item.moduleId === 1 ? panel : LOCAL_MAIN)
    ),
  })
  vi.mocked(useSingletons).mockReturnValue({
    kclManager: {
      isExecutingSignal: signal(false),
      execStateSignal: signal({
        ...emptyExecState(),
        artifactGraph: new Map(actual.artifacts),
        filenames: actual.filenames,
        namedViews: actual,
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

  it('retains the actual view and keeps a mock artifact with a reused ID pending', () => {
    const actual = view({ name: 'Front', modulePath: LOCAL_MAIN, id: 'shared' })
    const matchingMock = view({
      name: 'Front',
      modulePath: { type: 'Main' },
      id: 'mock-front',
    })
    const newMock = view({ name: 'Side', id: 'shared' })
    const resolved = result(actual, LOCAL_MAIN)

    const [, front, side] = viewRows(
      [matchingMock, newMock],
      execution({ views: [actual], resolved: [resolved] })
    )

    expect(front).toMatchObject({
      label: 'Front',
      target: { kind: 'declared', view: resolved },
      editableView: matchingMock,
    })
    expect(side).toMatchObject({ label: 'Side', target: null })
    expect(side.key).not.toBe(front.key)
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

it('renders a disabled pending row, a failed row with its diagnostic, and an enabled resolved row', () => {
  const pending = view({ name: 'Preview', modulePath: LOCAL_MAIN })
  const failed = view({ name: 'Inspection', moduleId: 7 })
  const resolved = view({ name: 'Front', modulePath: LOCAL_MAIN })
  const message =
    'Could not resolve named view "Inspection" because its declaring file is unavailable.'
  const actual = execution({
    views: [failed, resolved],
    resolved: [result(resolved, LOCAL_MAIN)],
    failures: [
      {
        artifactId: failed.artifact.id,
        name: failed.artifact.name,
        moduleId: failed.moduleId,
        sourceRange: failed.artifact.codeRef.range,
        error: { type: 'missingModulePath', moduleId: failed.moduleId },
        message,
      },
    ],
  })
  const artifactGraph = new Map(actual.artifacts)
  artifactGraph.set(pending.artifact.id, {
    ...pending.artifact,
    type: 'namedView',
  })
  const execStateSignal = signal({
    ...emptyExecState(),
    artifactGraph,
    filenames: actual.filenames,
    namedViews: actual,
  })

  vi.mocked(useSingletons).mockReturnValue({
    kclManager: { execStateSignal, isExecutingSignal: signal(false) },
  } as unknown as ReturnType<typeof useSingletons>)

  const { unmount } = render(
    <KclNamedViewsPane
      layout={namedViewsPaneConfig}
      areaConfig={{ hide: () => false }}
    />
  )
  expect(screen.getByText('Waiting for execution')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Apply Preview' })).toHaveProperty(
    'disabled',
    true
  )
  expect(
    screen.getByRole('button', { name: 'Apply Inspection' })
  ).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: message })).toBeTruthy()
  expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe(
    message
  )
  expect(screen.getByRole('button', { name: 'Apply Front' })).toHaveProperty(
    'disabled',
    false
  )

  const next = execution({
    views: [pending],
    resolved: [result(pending, LOCAL_MAIN)],
  })
  act(() => {
    execStateSignal.value = {
      ...execStateSignal.value,
      artifactGraph: next.artifacts,
      filenames: next.filenames,
      namedViews: next,
    }
  })
  expect(screen.queryByText('Waiting for execution')).toBeNull()
  expect(screen.getByRole('button', { name: 'Apply Preview' })).toHaveProperty(
    'disabled',
    false
  )
  unmount()
})
