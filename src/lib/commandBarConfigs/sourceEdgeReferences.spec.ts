import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { recast } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({ webrtc: false, pool: 'cpu' })
})
afterAll(() => {
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

// Legacy sketch compatibility: code selection must preserve the original physical edge.
it.each(
  [
    { command: 'Fillet' as const, length: 12, cap: 'capStart001' },
    { command: 'Fillet' as const, length: -12, cap: 'capEnd001' },
    { command: 'Chamfer' as const, length: 12, cap: 'capStart001' },
    { command: 'Chamfer' as const, length: -12, cap: 'capEnd001' },
  ].flatMap((example) =>
    ['legacy', 'sketch block'].map((sketch) => ({ ...example, sketch }))
  )
)(
  'preserves the source edge for $command with extrusion length $length ($sketch)',
  async ({ command, length, cap, sketch }) => {
    const code =
      sketch === 'legacy'
        ? `@settings(kclVersion = 1.0)

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = ${length})`
        : `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 12])
  top = line(start = [24, 12], end = [0, 12])
  left = line(start = [0, 12], end = [0, 0])
}
region001 = region(point = [12, 6], sketch = sketch001)
extrude001 = extrude(region001, length = ${length})`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const segment = [...artifactGraph.values()].find(
      (a) =>
        a.type === 'segment' &&
        code
          .slice(a.codeRef.range[0], a.codeRef.range[1])
          .includes(sketch === 'legacy' ? 'endAbsolute' : 'start = [0, 12]')
    )
    if (segment?.type !== 'segment') throw new Error('Source segment not found')
    expect(
      [...artifactGraph.values()].some((a) => a.type === 'sweepEdge')
    ).toBe(false)
    const selection: Selections = {
      graphSelections: [{ artifact: segment, codeRef: segment.codeRef }],
      otherSelections: [],
    }
    const size = (await stringToKclExpression(
      '1',
      world.rustContext
    )) as KclCommandValue
    const context = {
      ast,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    }
    const result =
      command === 'Fillet'
        ? await modelingCommandCodemods.Fillet.run({
            ...context,
            args: { selection, radius: size },
          })
        : await modelingCommandCodemods.Chamfer.run({
            ...context,
            args: { selection, length: size },
          })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain(`extrude001.faces.${cap}`)
    expect(output).not.toContain(
      cap === 'capEnd001' ? 'capStart001' : 'capEnd001'
    )
    if (command === 'Fillet' && length < 0 && sketch === 'legacy') {
      const manager = world.engineCommandManager
      const send = manager.sendSceneCommand.bind(manager)
      const spy = vi
        .spyOn(manager, 'sendSceneCommand')
        .mockImplementation(async (...args) => {
          const response = await send(...args)
          world.kclManager.ast = structuredClone(world.kclManager.ast)
          return response
        })
      try {
        const staleResult = await modelingCommandCodemods.Fillet.run({
          ...context,
          args: { selection, radius: size },
        })
        expect(staleResult).toEqual(
          new Error(
            'The model changed while resolving the selected edge. Please select it again.'
          )
        )
      } finally {
        spy.mockRestore()
      }
    }
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30_000
)
