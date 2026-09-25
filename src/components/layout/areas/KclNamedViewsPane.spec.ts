import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import {
  canManageNamedView,
  namedViewDetail,
  nextViewSelection,
  viewRows,
} from '@src/components/layout/areas/KclNamedViewsPane'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { KCL_DEFAULT_VIEW_NAME } from '@src/lang/std/kclNamedViews'
import { describe, expect, it } from 'vitest'

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
        label: KCL_DEFAULT_VIEW_NAME,
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
      KCL_DEFAULT_VIEW_NAME,
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
      KCL_DEFAULT_VIEW_NAME,
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
      KCL_DEFAULT_VIEW_NAME,
      'Front',
      'Front',
    ])
  })

  it('keys each row by artifact id', () => {
    const rows = viewRows([view({ name: 'Front', id: 'view-1' })])

    expect(rows.map((row) => row.key)).toEqual(['kcl-default', 'view-1'])
  })

  it('summarizes the camera beside each declared view', () => {
    const namedView = view({ name: 'Front' })
    namedView.artifact.camera.distance = 200
    namedView.artifact.camera.projection = 'perspective'

    expect(namedViewDetail(namedView)).toBe('Front 200mm Perspective')
    expect(viewRows([namedView])[1].detail).toBe('Front 200mm Perspective')
  })

  it('only lets the root module manage a declared view', () => {
    expect(canManageNamedView(view({ name: 'Root' }))).toBe(true)
    expect(canManageNamedView(view({ name: 'Import', moduleId: 1 }))).toBe(
      false
    )
  })
})

describe('nextViewSelection', () => {
  const rowKeys = ['default', 'front', 'top', 'detail']

  it('makes a plain click the only selection', () => {
    const result = nextViewSelection({
      selected: new Set(['front', 'top']),
      rowKey: 'detail',
      rowIndex: 3,
      anchorIndex: 1,
      rowKeys,
      shiftKey: false,
      toggleKey: false,
    })

    expect([...result.selected]).toEqual(['detail'])
    expect(result.anchorIndex).toBe(3)
  })

  it('toggles a row with Command or Control click', () => {
    const added = nextViewSelection({
      selected: new Set(['front']),
      rowKey: 'top',
      rowIndex: 2,
      anchorIndex: 1,
      rowKeys,
      shiftKey: false,
      toggleKey: true,
    })
    expect([...added.selected]).toEqual(['front', 'top'])

    const removed = nextViewSelection({
      selected: added.selected,
      rowKey: 'front',
      rowIndex: 1,
      anchorIndex: added.anchorIndex,
      rowKeys,
      shiftKey: false,
      toggleKey: true,
    })
    expect([...removed.selected]).toEqual(['top'])
  })

  it('selects a contiguous range with Shift click', () => {
    const result = nextViewSelection({
      selected: new Set(['front']),
      rowKey: 'detail',
      rowIndex: 3,
      anchorIndex: 1,
      rowKeys,
      shiftKey: true,
      toggleKey: false,
    })

    expect([...result.selected]).toEqual(['front', 'top', 'detail'])
    expect(result.anchorIndex).toBe(1)
  })

  it('adds a Shift range when Command or Control is also held', () => {
    const result = nextViewSelection({
      selected: new Set(['default']),
      rowKey: 'detail',
      rowIndex: 3,
      anchorIndex: 2,
      rowKeys,
      shiftKey: true,
      toggleKey: true,
    })

    expect([...result.selected]).toEqual(['default', 'top', 'detail'])
  })
})
