import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { addUnion } from '@src/lang/modifyAst/boolean'
import { recast } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
})
afterAll(() =>
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
)

it.each([
  'boolean-setup-with-sketch-on-faces.kcl',
  'boolean-setup-with-sketch-solve-on-faces.kcl',
])(
  'uses the live body alias for Boolean selections in %s',
  async (fixture) => {
    // Keep the existing legacy and sketch-block customer-like programs intact.
    const source = await readFile(
      `rust/kcl-lib/e2e/executor/inputs/${fixture}`,
      'utf8'
    )
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      source,
      world.instance,
      world.kclManager
    )
    const bindings = artifactGraph.bodyBindings ?? []
    const selections = ['extrude001', 'extrude002'].map((name) => {
      const binding = bindings.find((body) => body.variable === name)
      expect(binding).toBeDefined()
      if (!binding) throw new Error(`Missing binding for ${name}`)
      const artifact = artifactGraph.get(binding.artifactId)
      if (artifact?.type !== 'sweep')
        throw new Error(`Missing source sweep for ${name}`)
      return { artifact, codeRef: artifact.codeRef }
    })
    const input = bindings.find((body) => body.variable === 'extrude002')!
    const latest = bindings.find((body) => body.variable === 'extrude006')!
    expect(input.artifactId).not.toBe(latest.artifactId)
    expect(input.bodyId).toBe(latest.bodyId)

    const result = addUnion({
      ast,
      artifactGraph,
      solids: { graphSelections: selections, otherSelections: [] },
      wasmInstance: world.instance,
    })
    if (isErr(result)) throw result
    const code = recast(result.modifiedAst, world.instance)
    if (isErr(code)) throw code
    expect(code).toContain('union([extrude001, extrude006])')
    await getAstAndArtifactGraph(code, world.instance, world.kclManager)
  },
  30_000
)
