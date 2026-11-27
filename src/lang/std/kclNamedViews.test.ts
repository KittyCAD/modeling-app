import type { SweepSubType } from '@rust/kcl-lib/bindings/Artifact'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import type { ResolvedNamedView } from '@rust/kcl-lib/bindings/ResolvedNamedView'

import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  engineIdForArtifact,
  namedViewsForExport,
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
    declaringModuleId: moduleId,
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
  subType = 'extrusion',
  pathId = `${id}-path`,
}: {
  id: string
  consumed?: boolean
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

function gdtAnnotation({
  id,
  consumed = false,
}: {
  id: string
  consumed?: boolean
}): Extract<Artifact, { type: 'gdtAnnotation' }> {
  return { type: 'gdtAnnotation', id, codeRef: codeRef(), consumed }
}

function helix({
  id,
  consumed = false,
}: {
  id: string
  consumed?: boolean
}): Extract<Artifact, { type: 'helix' }> {
  return {
    type: 'helix',
    id,
    axisId: null,
    trajectorySweepId: null,
    consumed,
    codeRef: codeRef(),
  }
}

function plane({
  id,
  pathIds = [],
}: {
  id: string
  pathIds?: string[]
}): Extract<Artifact, { type: 'plane' }> {
  return { type: 'plane', id, pathIds, codeRef: codeRef() }
}

function importedGeometry({
  id,
  consumed = false,
}: {
  id: string
  consumed?: boolean
}): Extract<Artifact, { type: 'importedGeometry' }> {
  return { type: 'importedGeometry', id, codeRef: codeRef(), consumed }
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

describe('namedViewsForExport', () => {
  function resolvedView(
    artifact: ReturnType<typeof namedView>,
    modulePath: ModulePath = ROOT_PATH
  ): ResolvedNamedView {
    return {
      info: {
        artifactId: artifact.id,
        name: artifact.name,
        moduleId: artifact.declaringModuleId,
        modulePath,
      },
      cameraIntent: artifact.camera,
      visibility: {},
    }
  }

  function resolution(
    artifacts: ReturnType<typeof namedView>[],
    namedViews: ResolvedNamedView[]
  ): NonNullable<ExecState['namedViews']> {
    return {
      artifacts: new Map(artifacts.map((artifact) => [artifact.id, artifact])),
      filenames: Object.fromEntries(
        namedViews.map(({ info }) => [info.moduleId, info.modulePath])
      ),
      batch: { defaultView: {}, namedViews, failures: [] },
    }
  }

  it('serializes Rust camera intent and visibility exceptions for both authored baselines', () => {
    const hidden = namedView({
      id: 'hide-body',
      name: 'Hide body',
      baseline: 'show',
      hideIds: ['body-1'],
    })
    const shown = namedView({
      id: 'show-body',
      name: 'Only body',
      baseline: 'hide',
      showIds: ['body-1'],
    })
    const cameraIntent: ResolvedNamedView['cameraIntent'] = {
      look: {
        type: 'directed',
        direction: { x: 0, y: 2, z: 0, units: null },
        up: { x: 0, y: 1, z: 1, units: null },
      },
      target: { x: 10, y: 20, z: 30, units: 'mm' },
      distance: 8,
      projection: 'perspective',
    }
    const views = namedViewsForExport({
      namedViewResolution: resolution(
        [hidden, shown],
        [
          {
            ...resolvedView(hidden),
            cameraIntent,
            visibility: { 'path-1': true, 'path-2': false },
          },
          {
            ...resolvedView(shown),
            cameraIntent,
            visibility: { 'path-1': false, 'path-2': true },
          },
        ]
      ),
      fallbackDistance: 100,
    })

    const camera = {
      vantage: { x: 10, y: 12, z: 30 },
      target: { x: 10, y: 20, z: 30 },
      up: { x: 0, y: 0, z: 1 },
      projection: { type: 'perspective' },
    }
    expect(JSON.parse(JSON.stringify(views))).toEqual({
      'Hide body': { ...camera, baseline: 'show', except_ids: ['path-1'] },
      'Only body': { ...camera, baseline: 'hide', except_ids: ['path-1'] },
    })
  })

  it('exports same-named views in artifact order, even with matching filenames', () => {
    const root = namedView({ id: 'root-front', name: 'Front' })
    const imported = namedView({
      id: 'imported-front',
      name: 'Front',
      moduleId: 1,
    })
    const other = namedView({ id: 'other-front', name: 'Front', moduleId: 2 })
    const views = namedViewsForExport({
      namedViewResolution: resolution(
        [root, imported, other],
        [
          resolvedView(other, {
            type: 'Local',
            value: '/project/other/bracket.kcl',
            original_import_path: 'other/bracket.kcl',
          }),
          resolvedView(imported, IMPORTED_PATH),
          resolvedView(root),
        ]
      ),
      fallbackDistance: 12,
    })

    expect(Object.keys(views)).toEqual([
      'main::Front',
      'bracket::Front',
      'bracket::Front (2)',
    ])
    expect(views['main::Front']).toEqual({
      vantage: { x: 0, y: -12, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      projection: { type: 'orthographic' },
      baseline: 'show',
      except_ids: [],
    })
  })

  it('exports only resolved views paired with an artifact', () => {
    const ready = namedView({ id: 'ready', name: 'Ready' })
    const failed = namedView({ id: 'failed', name: 'Failed', moduleId: 7 })
    const missingArtifact = namedView({ id: 'missing', name: 'Missing' })
    const namedViewResolution = resolution(
      [failed, ready],
      [resolvedView(ready), resolvedView(missingArtifact)]
    )
    namedViewResolution.batch.failures.push({
      artifactId: failed.id,
      name: failed.name,
      moduleId: failed.declaringModuleId,
      sourceRange: failed.codeRef.range,
      error: { type: 'missingModulePath', moduleId: failed.declaringModuleId },
      message: 'Could not resolve named view "Failed".',
    })

    expect(
      Object.keys(
        namedViewsForExport({ namedViewResolution, fallbackDistance: 12 })
      )
    ).toEqual(['Ready'])
  })

  it('exports an empty set of views when the Rust batch is missing', () => {
    expect(
      namedViewsForExport({ namedViewResolution: null, fallbackDistance: 12 })
    ).toEqual({})
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

  it('sends every identity-domain artifact to its own id', () => {
    const artifacts = [
      compositeSolid({ id: 'boolean-1' }),
      path({ id: 'sketch-1' }),
      gdtAnnotation({ id: 'gdt-1' }),
      helix({ id: 'helix-1' }),
      plane({ id: 'plane-1' }),
      importedGeometry({ id: 'imported-1' }),
    ]
    const graph = graphOf(artifacts)

    for (const artifact of artifacts) {
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
})
