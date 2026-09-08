import type { SweepSubType } from '@rust/kcl-lib/bindings/Artifact'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Artifact } from '@src/lang/std/artifactGraph'
import type { VisibilityUniverse } from '@src/lang/std/kclNamedViews'
import {
  KCL_DEFAULT_VIEW_NAME,
  engineIdForArtifact,
  engineIdsForVisibility,
  getViewUniverse,
  listNamedViews,
  visibilityForKclDefault,
  visibilityForView,
} from '@src/lang/std/kclNamedViews'
import type { ArtifactGraph, ExecState } from '@src/lang/wasm'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { describe, expect, it } from 'vitest'

const ROOT_PATH: ModulePath = {
  type: 'Local',
  value: '/project/main.kcl',
  original_import_path: null,
}

const IMPORTED_PATH: ModulePath = {
  type: 'Local',
  value: '/project/parts/bracket.kcl',
  original_import_path: 'parts/bracket.kcl',
}

function codeRef(moduleId = ROOT_MODULE_ID) {
  return {
    range: [0, 0, moduleId] as [number, number, number],
    nodePath: { steps: [] },
    pathToNode: [],
  }
}

function namedView({
  id,
  name,
  moduleId = ROOT_MODULE_ID,
  baseline = 'show',
  showIds = [],
  hideIds = [],
}: {
  id: string
  name: string
  moduleId?: number
  baseline?: 'show' | 'hide'
  showIds?: string[]
  hideIds?: string[]
}): Extract<Artifact, { type: 'namedView' }> {
  return {
    type: 'namedView',
    id,
    name,
    camera: {
      look: { type: 'oriented', orientation: 'front' },
      target: null,
      distance: null,
      projection: 'orthographic',
    },
    baseline,
    showIds,
    hideIds,
    codeRef: codeRef(moduleId),
  }
}

function sweep({
  id,
  consumed = false,
  patternIds,
  subType = 'extrusion',
  pathId = `${id}-path`,
}: {
  id: string
  consumed?: boolean
  patternIds?: string[]
  subType?: SweepSubType
  pathId?: string
}): Extract<Artifact, { type: 'sweep' }> {
  return {
    type: 'sweep',
    id,
    subType,
    pathId,
    surfaceIds: [],
    edgeIds: [],
    method: 'new',
    trajectoryId: null,
    consumed,
    patternIds,
    codeRef: codeRef(),
  }
}

function compositeSolid({
  id,
  consumed = false,
}: {
  id: string
  consumed?: boolean
}): Extract<Artifact, { type: 'compositeSolid' }> {
  return {
    type: 'compositeSolid',
    id,
    subType: 'union',
    solidIds: [],
    toolIds: [],
    consumed,
    codeRef: codeRef(),
  }
}

function path({
  id,
  consumed = false,
  sweepId,
}: {
  id: string
  consumed?: boolean
  sweepId?: string
}): Extract<Artifact, { type: 'path' }> {
  return {
    type: 'path',
    id,
    subType: 'sketch',
    planeId: 'plane-1',
    segIds: [],
    trajectorySweepId: null,
    consumed,
    sweepId,
    codeRef: codeRef(),
  }
}

function gdtAnnotation(
  id: string
): Extract<Artifact, { type: 'gdtAnnotation' }> {
  return { type: 'gdtAnnotation', id, codeRef: codeRef() }
}

function pattern({
  id,
  sourceId,
  copyIds,
}: {
  id: string
  sourceId: string
  copyIds: string[]
}): Extract<Artifact, { type: 'pattern' }> {
  return {
    type: 'pattern',
    id,
    subType: 'linear',
    sourceId,
    copyIds,
    copyFaceIds: [],
    copyEdgeIds: [],
    codeRef: codeRef(),
  }
}

function graphOf(artifacts: Artifact[]): ArtifactGraph {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}

const rootOnlyFilenames: ExecState['filenames'] = {
  [ROOT_MODULE_ID]: ROOT_PATH,
}

/** The Rust module holding `RESERVED_DEFAULT_VIEW_NAME`. */
const NAMED_VIEWS_RS = join(
  process.cwd(),
  'rust/kcl-lib/src/execution/named_views.rs'
)

describe('KCL_DEFAULT_VIEW_NAME', () => {
  // Fails when the Rust constant changes without this literal.
  // `reserved_default_view_name_matches_typescript` covers the other direction.
  it('matches the name Rust reserves', () => {
    const source = readFileSync(NAMED_VIEWS_RS, 'utf8')
    const declaration =
      /const RESERVED_DEFAULT_VIEW_NAME: &str = "([^"]*)"/.exec(source)

    expect(
      declaration,
      `no RESERVED_DEFAULT_VIEW_NAME declaration found in ${NAMED_VIEWS_RS}`
    ).not.toBeNull()
    expect(
      declaration?.[1],
      'the reserved default view name is declared on both sides of the wasm boundary and the two have drifted apart; update this literal to match the Rust constant'
    ).toBe(KCL_DEFAULT_VIEW_NAME)
  })
})

describe('listNamedViews', () => {
  it('returns nothing when the program declared no views', () => {
    const graph = graphOf([path({ id: 'path-1' })])

    expect(
      listNamedViews({ artifactGraph: graph, filenames: rootOnlyFilenames })
    ).toEqual([])
  })

  it('returns every view in graph order, each with its declaring module', () => {
    const graph = graphOf([
      namedView({ id: 'view-front', name: 'Front' }),
      namedView({ id: 'view-context', name: 'Plate in context' }),
    ])

    const views = listNamedViews({
      artifactGraph: graph,
      filenames: rootOnlyFilenames,
    })

    expect(views).toHaveLength(2)
    expect(views.map((view) => view.artifact.name)).toEqual([
      'Front',
      'Plate in context',
    ])
    expect(views.map((view) => view.moduleId)).toEqual([
      ROOT_MODULE_ID,
      ROOT_MODULE_ID,
    ])
    expect(views.map((view) => view.modulePath)).toEqual([ROOT_PATH, ROOT_PATH])
  })

  it('keeps two modules apart when both declare the same display name', () => {
    const importedModuleId = 1
    const graph = graphOf([
      namedView({
        id: 'view-imported-front',
        name: 'Front',
        moduleId: importedModuleId,
      }),
      namedView({ id: 'view-root-front', name: 'Front' }),
    ])

    const views = listNamedViews({
      artifactGraph: graph,
      filenames: {
        [ROOT_MODULE_ID]: ROOT_PATH,
        [importedModuleId]: IMPORTED_PATH,
      },
    })

    expect(views).toHaveLength(2)
    expect(views.map((view) => view.artifact.name)).toEqual(['Front', 'Front'])
    expect(
      views.map((view) => ({
        id: view.artifact.id,
        moduleId: view.moduleId,
        modulePath: view.modulePath,
      }))
    ).toEqual([
      {
        id: 'view-imported-front',
        moduleId: importedModuleId,
        modulePath: IMPORTED_PATH,
      },
      {
        id: 'view-root-front',
        moduleId: ROOT_MODULE_ID,
        modulePath: ROOT_PATH,
      },
    ])
  })

  it('reports an unknown module as an undefined path rather than dropping the view', () => {
    const graph = graphOf([
      namedView({ id: 'view-front', name: 'Front', moduleId: 7 }),
    ])

    const views = listNamedViews({
      artifactGraph: graph,
      filenames: rootOnlyFilenames,
    })

    expect(views).toHaveLength(1)
    expect(views[0].moduleId).toBe(7)
    expect(views[0].modulePath).toBeUndefined()
  })
})

describe('getViewUniverse', () => {
  it('holds the unconsumed artifact of every universe kind', () => {
    const graph = graphOf([
      sweep({ id: 'body' }),
      compositeSolid({ id: 'union' }),
      path({ id: 'sketch' }),
      gdtAnnotation('annotation'),
    ])

    expect([...getViewUniverse(graph).keys()].sort()).toEqual([
      'annotation',
      'body',
      'sketch',
      'union',
    ])
  })

  it('drops consumed artifacts, whose engine id another member answers to', () => {
    const graph = graphOf([
      sweep({ id: 'body' }),
      sweep({ id: 'merged-away', consumed: true }),
      path({ id: 'region', consumed: true }),
      compositeSolid({ id: 'consumed-union', consumed: true }),
    ])

    expect([...getViewUniverse(graph).keys()]).toEqual(['body'])
  })

  it('leaves out the kinds `except` cannot name, which is a decision and not an omission', () => {
    const graph = graphOf([
      { type: 'plane', id: 'plane-1', pathIds: [], codeRef: codeRef() },
      {
        type: 'helix',
        id: 'helix-1',
        axisId: null,
        trajectorySweepId: null,
        consumed: false,
        codeRef: codeRef(),
      },
    ])

    expect([...getViewUniverse(graph).keys()]).toEqual([])
  })

  it('adds a pattern copy under its own id, against the pattern artifact', () => {
    const patternArtifact = pattern({
      id: 'pattern-1',
      sourceId: 'body',
      copyIds: ['copy-1', 'copy-2'],
    })
    const graph = graphOf([
      sweep({ id: 'body', patternIds: ['pattern-1'] }),
      patternArtifact,
    ])

    const universe = getViewUniverse(graph)

    expect([...universe.keys()].sort()).toEqual(['body', 'copy-1', 'copy-2'])
    expect(universe.get('copy-1')).toBe(patternArtifact)
    // The source body keeps its own artifact. Its engine id comes from the
    // sweep, while a copy id is already an engine id.
    expect(universe.get('body')?.type).toBe('sweep')
  })

  it('resolves the source body through `patternIds` when `sourceId` is not a body', () => {
    const graph = graphOf([
      sweep({ id: 'body', patternIds: ['pattern-1'] }),
      path({ id: 'sketch' }),
      pattern({ id: 'pattern-1', sourceId: 'sketch', copyIds: ['copy-1'] }),
    ])

    expect([...getViewUniverse(graph).keys()].sort()).toEqual([
      'body',
      'copy-1',
      'sketch',
    ])
  })

  it('drops the copies of a pattern whose source body was consumed', () => {
    const graph = graphOf([
      sweep({ id: 'body', consumed: true, patternIds: ['pattern-1'] }),
      pattern({ id: 'pattern-1', sourceId: 'body', copyIds: ['copy-1'] }),
    ])

    expect([...getViewUniverse(graph).keys()]).toEqual([])
  })
})

describe('visibilityForView', () => {
  const universe = getViewUniverse(
    graphOf([
      sweep({ id: 'body-1' }),
      sweep({ id: 'body-2' }),
      gdtAnnotation('annotation'),
    ])
  )

  it('hides only the exceptions under a `show` baseline', () => {
    const view = namedView({
      id: 'view-1',
      name: 'Front',
      baseline: 'show',
      hideIds: ['body-2'],
    })

    expect(visibilityForView({ universe, view })).toEqual(
      new Map([
        ['body-1', false],
        ['body-2', true],
        ['annotation', false],
      ])
    )
  })

  it('shows only the exceptions under a `hide` baseline', () => {
    const view = namedView({
      id: 'view-1',
      name: 'Only body 2',
      baseline: 'hide',
      showIds: ['body-2'],
    })

    expect(visibilityForView({ universe, view })).toEqual(
      new Map([
        ['body-1', true],
        ['body-2', false],
        ['annotation', true],
      ])
    )
  })

  it('gives every member a state, because the engine cannot be asked for one', () => {
    const view = namedView({ id: 'view-1', name: 'Front' })

    expect([...visibilityForView({ universe, view }).keys()].sort()).toEqual(
      [...universe.keys()].sort()
    )
  })

  it('ignores an exception that is not a universe member', () => {
    const view = namedView({
      id: 'view-1',
      name: 'Front',
      baseline: 'show',
      hideIds: ['a-hidden-plane'],
    })

    const visibility = visibilityForView({ universe, view })

    expect(visibility.has('a-hidden-plane')).toBe(false)
    expect([...visibility.values()]).toEqual([false, false, false])
  })
})

describe('visibilityForKclDefault', () => {
  it('hides what the program hid and shows the rest', () => {
    const universe = getViewUniverse(
      graphOf([
        sweep({ id: 'body-1' }),
        sweep({ id: 'body-2' }),
        path({ id: 'sketch' }),
      ])
    )

    expect(
      visibilityForKclDefault({
        universe,
        hiddenIds: new Set(['body-2']),
      })
    ).toEqual(
      new Map([
        ['body-1', false],
        ['body-2', true],
        ['sketch', false],
      ])
    )
  })

  it('shows everything when the program hid nothing', () => {
    const universe = getViewUniverse(graphOf([sweep({ id: 'body-1' })]))

    expect(visibilityForKclDefault({ universe, hiddenIds: new Set() })).toEqual(
      new Map([['body-1', false]])
    )
  })
})

/**
 * Which id a swept body answers to when its base path points back at it:
 * `basePath` for the subtypes whose two id domains diverge, `ownId` for the
 * subtypes that override the base sketch's id with their command id.
 *
 * `satisfies Record<SweepSubType, ...>` makes a subtype added to the binding a
 * compile error here, so this table cannot fall behind the switch it pins.
 */
const LINKED_SWEEP_ENGINE_ID = {
  extrusion: 'basePath',
  extrusionTwist: 'basePath',
  revolve: 'basePath',
  revolveAboutEdge: 'basePath',
  sweep: 'basePath',
  loft: 'ownId',
  blend: 'ownId',
} as const satisfies Record<SweepSubType, 'basePath' | 'ownId'>

const SWEEP_ENGINE_ID_ROWS = Object.entries(LINKED_SWEEP_ENGINE_ID) as [
  SweepSubType,
  'basePath' | 'ownId',
][]

const DIVERGENT_SUBTYPES = SWEEP_ENGINE_ID_ROWS.filter(
  ([, side]) => side === 'basePath'
).map(([subType]) => subType)

describe('engineIdForArtifact', () => {
  for (const [subType, side] of SWEEP_ENGINE_ID_ROWS) {
    it(`sends a linked ${subType} sweep to its ${side}`, () => {
      const body = sweep({ id: 'body-1', subType, pathId: 'path-1' })
      const basePath = path({ id: 'path-1', consumed: true, sweepId: 'body-1' })
      const graph = graphOf([basePath, body])

      expect(
        engineIdForArtifact({
          id: body.id,
          artifact: body,
          artifactGraph: graph,
        })
      ).toBe(side === 'basePath' ? 'path-1' : 'body-1')
    })
  }

  for (const subType of DIVERGENT_SUBTYPES) {
    it(`sends a mirrored ${subType} sweep to its own id`, () => {
      // A mirror3d node carries the mirrored body's engine object id as its
      // own `id`, keeps the source's `pathId`, and has no back-link.
      const source = sweep({ id: 'body-1', subType, pathId: 'path-1' })
      const mirrored = sweep({ id: 'mirrored-1', subType, pathId: 'path-1' })
      const basePath = path({ id: 'path-1', consumed: true, sweepId: 'body-1' })
      const graph = graphOf([basePath, source, mirrored])

      expect(
        engineIdForArtifact({
          id: source.id,
          artifact: source,
          artifactGraph: graph,
        })
      ).toBe('path-1')
      expect(
        engineIdForArtifact({
          id: mirrored.id,
          artifact: mirrored,
          artifactGraph: graph,
        })
      ).toBe('mirrored-1')
    })
  }

  it('sends a sweep whose base path is absent to its own id', () => {
    const body = sweep({ id: 'body-1', pathId: 'path-1' })
    const graph = graphOf([body])

    expect(
      engineIdForArtifact({ id: body.id, artifact: body, artifactGraph: graph })
    ).toBe('body-1')
  })

  it('sends a composite solid, a sketch and an annotation to their own ids', () => {
    const boolean = compositeSolid({ id: 'boolean-1' })
    const sketch = path({ id: 'sketch-1' })
    const annotation = gdtAnnotation('gdt-1')
    const graph = graphOf([boolean, sketch, annotation])

    for (const artifact of [boolean, sketch, annotation]) {
      expect(
        engineIdForArtifact({
          id: artifact.id,
          artifact,
          artifactGraph: graph,
        })
      ).toBe(artifact.id)
    }
  })

  it('sends a pattern copy to the copy id rather than the pattern id', () => {
    const copies = pattern({
      id: 'pattern-1',
      sourceId: 'body-1',
      copyIds: ['copy-1', 'copy-2'],
    })
    const graph = graphOf([copies])

    for (const copyId of copies.copyIds) {
      expect(
        engineIdForArtifact({
          id: copyId,
          artifact: copies,
          artifactGraph: graph,
        })
      ).toBe(copyId)
    }
  })

  it('translates every member of a mirrored and patterned universe', () => {
    const body = sweep({ id: 'body-1', patternIds: ['pattern-1'] })
    const graph = graphOf([
      path({ id: 'body-1-path', consumed: true, sweepId: 'body-1' }),
      body,
      sweep({ id: 'mirrored-1', pathId: 'body-1-path' }),
      pattern({ id: 'pattern-1', sourceId: 'body-1', copyIds: ['copy-1'] }),
      path({ id: 'sketch-1' }),
      gdtAnnotation('gdt-1'),
    ])

    const universe = getViewUniverse(graph)
    const engineIds = new Map(
      [...universe].map(([id, artifact]) => [
        id,
        engineIdForArtifact({ id, artifact, artifactGraph: graph }),
      ])
    )

    // The extruded body's engine object id is its consumed region path. That
    // path is not a universe member.
    expect(engineIds).toEqual(
      new Map([
        ['body-1', 'body-1-path'],
        ['mirrored-1', 'mirrored-1'],
        ['sketch-1', 'sketch-1'],
        ['gdt-1', 'gdt-1'],
        ['copy-1', 'copy-1'],
      ])
    )
  })
})

describe('engineIdsForVisibility', () => {
  it('rekeys a visibility from artifact ids to engine object ids', () => {
    const body = sweep({ id: 'body-1', pathId: 'body-1-path' })
    const graph = graphOf([
      path({ id: 'body-1-path', consumed: true, sweepId: 'body-1' }),
      body,
      gdtAnnotation('gdt-1'),
    ])
    const universe = getViewUniverse(graph)

    const hiddenByObjectId = engineIdsForVisibility({
      visibility: new Map([
        ['body-1', true],
        ['gdt-1', false],
      ]),
      universe,
      artifactGraph: graph,
    })

    expect(hiddenByObjectId).toEqual(
      new Map([
        ['body-1-path', true],
        ['gdt-1', false],
      ])
    )
  })

  it('skips an artifact id the universe does not hold', () => {
    const graph = graphOf([gdtAnnotation('gdt-1')])

    const hiddenByObjectId = engineIdsForVisibility({
      visibility: new Map([
        ['gdt-1', true],
        ['not-a-member', true],
      ]),
      universe: getViewUniverse(graph),
      artifactGraph: graph,
    })

    expect(hiddenByObjectId).toEqual(new Map([['gdt-1', true]]))
  })

  // Both members translate to the path's id. The `!consumed` filter prevents
  // this, so the universe is built by hand.
  it('resolves a collision to hidden whichever order the entries arrive in', () => {
    const body = sweep({ id: 'body-1', pathId: 'shared-path' })
    const collidingPath = path({ id: 'shared-path', sweepId: 'body-1' })
    const graph = graphOf([collidingPath, body])
    const universe: VisibilityUniverse = new Map()
    universe.set('body-1', body)
    universe.set('shared-path', collidingPath)

    const hideThenShow = engineIdsForVisibility({
      visibility: new Map([
        ['body-1', true],
        ['shared-path', false],
      ]),
      universe,
      artifactGraph: graph,
    })
    const showThenHide = engineIdsForVisibility({
      visibility: new Map([
        ['shared-path', false],
        ['body-1', true],
      ]),
      universe,
      artifactGraph: graph,
    })

    expect(hideThenShow).toEqual(new Map([['shared-path', true]]))
    expect(showThenHide).toEqual(new Map([['shared-path', true]]))
  })

  it('returns nothing for an empty visibility', () => {
    const graph = graphOf([gdtAnnotation('gdt-1')])

    expect(
      engineIdsForVisibility({
        visibility: new Map(),
        universe: getViewUniverse(graph),
        artifactGraph: graph,
      })
    ).toEqual(new Map())
  })
})
