import { afterAll, beforeAll, expect, it } from 'vitest'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import { enterEditFlow } from '@src/lib/operations'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { isErr } from '@src/lib/trap'

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
})
afterAll(() => {
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

it.each(['Fillet', 'Chamfer'] as const)(
  'edits a tagged %s with a downstream annotation',
  async (command) => {
    const name = command.toLowerCase()
    const parameter = command === 'Fillet' ? 'radius' : 'length'
    const code = `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [30mm, 0mm])
  right = line(start = [30mm, 0mm], end = [30mm, 20mm])
  top = line(start = [30mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
region001 = region(point = [15mm, 10mm], sketch = profile)
body = extrude(region001, length = 12mm, tagEnd = $topCap)
chamfer001 = chamfer(body, edges = [{ sideFaces = [region001.tags.left, body.faces.topCap] }], length = 2mm)
${name}002 = ${name}(chamfer001, edges = [{ sideFaces = [region001.tags.right, body.faces.topCap] }], ${parameter} = 2mm, tag = $treatmentFace)
hide(profile)
gdt::annotation(faces = [treatmentFace], annotation = "yoyo", fontSize = 1.54mm)`
    const { ast, artifactGraph, operations } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const operation = getAllOperations(operations).findLast(
      (op) => op.type === 'StdLibCall' && op.name === name
    )
    if (!operation) throw new Error('Missing treatment operation')
    const edit = await enterEditFlow({
      operation,
      code,
      artifactGraph,
      rustContext: world.rustContext,
    })
    if (isErr(edit)) throw edit
    if (edit.type !== 'Find and select command')
      throw new Error('Expected edit command')
    const defaults = edit.data
      .argDefaultValues as ModelingCommandSchema['Fillet']
    const size = await stringToKclExpression('1mm', world.rustContext)
    if (isErr(size) || 'errors' in size) throw new Error('Invalid size')
    const context = {
      ast,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    }
    const result =
      command === 'Fillet'
        ? await modelingCommandCodemods.Fillet.run({
            ...context,
            args: { ...defaults, radius: size },
          })
        : await modelingCommandCodemods.Chamfer.run({
            ...context,
            args: { ...defaults, length: size },
          })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(() => assertParse(output, world.instance)).not.toThrow()
    expect(output).toContain('tag = $treatmentFace')
    expect(output).not.toContain('$$')
    expect(output).toContain('faces = [treatmentFace]')
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30000
)
