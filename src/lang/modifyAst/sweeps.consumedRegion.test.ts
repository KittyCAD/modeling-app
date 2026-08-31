import { addLoft } from '@src/lang/modifyAst/sweeps'
import { type Artifact, assertParse, recast } from '@src/lang/wasm'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
} from '@src/lib/testHelpers'
import type RustContext from '@src/lib/rustContext'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

beforeAll(async () => {
  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndNoEngineConnection()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('addLoft consumed generated regions', () => {
  it('should create fresh regions when lofting already-consumed generated regions', async () => {
    const code = `@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -2.42mm, var 1.91mm], end = [var -0.35mm, var 1.91mm])
  line2 = line(start = [var -0.35mm, var 1.91mm], end = [var -0.35mm, var -0.39mm])
  line3 = line(start = [var -0.35mm, var -0.39mm], end = [var -2.42mm, var -0.39mm])
  line4 = line(start = [var -2.42mm, var -0.39mm], end = [var -2.42mm, var 1.91mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden001 = hide(sketch001)
region001 = region(segments = [sketch001.line1, sketch001.line2], direction = CW)
extrude001 = extrude(region001, length = 2mm, tagEnd = $capEnd001)
plane001 = planeOf(extrude001, face = capEnd001)
plane002 = offsetPlane(plane001, offset = 6)
sketch002 = sketch(on = plane002) {
  line1 = line(start = [var 0.45mm, var 0.74mm], end = [var 1.81mm, var 0.74mm])
  line2 = line(start = [var 1.81mm, var 0.74mm], end = [var 1.81mm, var -0.74mm])
  line3 = line(start = [var 1.81mm, var -0.74mm], end = [var 0.45mm, var -0.74mm])
  line4 = line(start = [var 0.45mm, var -0.74mm], end = [var 0.45mm, var 0.74mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden002 = hide(sketch002)
region002 = region(segments = [sketch002.line1, sketch002.line2], direction = CW)
extrude002 = extrude(region002, length = 2mm)`
    const ast = assertParse(code, instanceInThisFile)
    if (err(ast)) throw ast

    const { artifactGraph } = await enginelessExecutor(
      ast,
      rustContextInThisFile
    )
    const regions = [...artifactGraph.values()].filter(
      (artifact): artifact is Extract<Artifact, { type: 'path' }> =>
        artifact.type === 'path' && artifact.subType === 'region'
    )
    expect(regions).toHaveLength(2)
    expect(regions.every((region) => region.consumed)).toBe(true)

    const result = addLoft({
      ast,
      artifactGraph,
      sketches: createSelectionFromArtifacts(regions, artifactGraph),
      wasmInstance: instanceInThisFile,
    })
    if (err(result)) throw result

    const newCode = recast(result.modifiedAst, instanceInThisFile)
    expect(newCode).toContain(
      `region003 = region(segments = [sketch001.line1, sketch001.line2], direction = CW)`
    )
    expect(newCode).toContain(
      `region004 = region(segments = [sketch002.line1, sketch002.line2], direction = CW)`
    )
    expect(newCode).toContain(`loft001 = loft([region003, region004])`)
    expect(newCode).not.toContain(`loft001 = loft([region001, region002])`)
    await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
  })
})
