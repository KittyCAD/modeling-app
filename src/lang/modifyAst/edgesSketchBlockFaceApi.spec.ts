import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import env from '@src/env'
import type { KclManager } from '@src/lang/KclManager'
import { addFillet } from '@src/lang/modifyAst/edges'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import type { Expr } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let rustContextInThisFile: RustContext = null!
let engineCommandManagerInThisFile: ConnectionManager | null = null

beforeAll(async () => {
  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
}, 60_000)

afterAll(() => {
  engineCommandManagerInThisFile?.tearDown()
})

const sketchBlockBooleanFilletFaceApi = `startX = 2

baseSketch = sketch(on = XY) {
  yoyo = line(start = [startX, 0], end = [7, 6])
  line2 = line(start = [7, 6], end = [7, 12])
  hi = line(start = [7, 12], end = [startX, 0])
}

baseRegion = region(point = [5.5, 6], sketch = baseSketch)
myExtrude = extrude(baseRegion, length = 5, tagEnd = $endCap, tagStart = $startCap)
yodawg = getCommonEdge(faces = [baseRegion.tags.hi, baseRegion.tags.yoyo])

cutSketch = sketch(on = YZ) {
  myDisambigutator = line(start = [-3.29, 4.75], end = [2.03, 2.44])
  myDisambigutator2 = line(start = [2.03, 2.44], end = [-3.49, 0.31])
  line3 = line(start = [-3.49, 0.31], end = [-3.29, 4.75])
}

cutRegion = region(point = [-1.5833333333, 2.5], sketch = cutSketch)
extrude001 = extrude(cutRegion, length = 5)
solid001 = subtract(myExtrude, tools = extrude001)`

function getRegionTagName(expr: Expr): string | null {
  if (
    expr.type !== 'MemberExpression' ||
    expr.object.type !== 'MemberExpression' ||
    expr.object.object.type !== 'Name' ||
    expr.object.object.name.name !== 'baseRegion' ||
    expr.object.property.type !== 'Name' ||
    expr.object.property.name.name !== 'tags' ||
    expr.property.type !== 'Name'
  ) {
    return null
  }
  return expr.property.name.name
}

const describeWithEngine = env().VITE_ZOO_API_TOKEN ? describe : describe.skip

describeWithEngine('edges sketch block face api regression', () => {
  it('emits baseRegion.tags.* sideFaces for sketch block boolean fillet codemod', async () => {
    const { artifactGraph, ast } = await getAstAndArtifactGraph(
      sketchBlockBooleanFilletFaceApi,
      instanceInThisFile,
      kclManagerInThisFile
    )
    const walls = [...artifactGraph.values()].filter(
      (a): a is Extract<typeof a, { type: 'wall' }> => a.type === 'wall'
    )
    const taggedWalls = new Map<
      string,
      Extract<(typeof walls)[number], { type: 'wall' }>
    >()

    for (const wall of walls) {
      const codeRefs = getCodeRefsByArtifactId(wall.id, artifactGraph)
      if (!codeRefs?.length) continue
      const tagResult = modifyAstWithTagsForSelection(
        ast,
        {
          artifact: wall,
          codeRef: codeRefs[0],
        },
        artifactGraph,
        instanceInThisFile
      )
      if (err(tagResult)) continue
      const tagName = getRegionTagName(tagResult.exprs[0])
      if (tagName === 'yoyo' || tagName === 'hi') {
        taggedWalls.set(tagName, wall)
      }
    }

    const yoyoWall = taggedWalls.get('yoyo')
    const hiWall = taggedWalls.get('hi')
    expect(yoyoWall).toBeDefined()
    expect(hiWall).toBeDefined()
    if (!yoyoWall || !hiWall) return

    const codeRefs = getCodeRefsByArtifactId(yoyoWall.id, artifactGraph)
    expect(codeRefs?.length).toBeGreaterThan(0)
    if (!codeRefs?.length) return

    const selection: Selections = {
      graphSelections: [
        {
          entityRef: {
            type: 'edge',
            side_faces: [yoyoWall.id, hiWall.id],
          },
          codeRef: codeRefs[0],
        },
      ],
      otherSelections: [],
    }

    const radius = (await stringToKclExpression(
      '0.1',
      rustContextInThisFile
    )) as KclCommandValue
    const result = addFillet({
      ast,
      artifactGraph,
      selection,
      radius,
      wasmInstance: instanceInThisFile,
    })
    if (err(result)) throw result

    const newCode = recast(result.modifiedAst, instanceInThisFile)
    if (err(newCode)) throw newCode
    expect(newCode.replace(/\s+/g, ' ')).toContain(
      'edges = [ { sideFaces = [ baseRegion.tags.yoyo, baseRegion.tags.hi ] } ]'
    )
    await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
  }, 30_000)
})
