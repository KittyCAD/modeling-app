import type { KclManager } from '@src/lang/KclManager'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { type ArtifactGraph, assertParse, recast } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

describe('point-and-click distance annotations', () => {
  it.each(['face', 'edge'] as const)(
    'preserves two selected primitive %ss in generated KCL',
    async (primitiveType) => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(defaultLengthUnit = mm, kclVersion = 2)
profile = sketch(on = XY) {
  outer = circle(start = [20mm, 0mm], center = [0mm, 0mm])
}
plate = extrude(region(segments = [profile.outer]), length = 5mm)`,
        instance
      )
      const codeRef = {
        nodePath: { steps: [] },
        range: [0, 0, 0] as [number, number, number],
        pathToNode: createPathToNodeForLastVariable(ast),
      }
      const artifactGraph: ArtifactGraph = new Map([
        [
          'plate-body',
          {
            type: 'sweep',
            id: 'plate-body',
            subType: 'extrusion',
            surfaceIds: [],
            edgeIds: [],
            trajectoryId: null,
            method: 'new',
            consumed: false,
            codeRef,
          },
        ],
      ])
      const objects: Selections = {
        graphSelections: [],
        otherSelections: [1, 2].map((primitiveIndex) => ({
          type: 'enginePrimitive',
          primitiveType,
          parentEntityId: 'plate-body',
          primitiveIndex,
          entityId: `selected-${primitiveIndex}`,
        })),
      }
      const sendSceneCommand = vi.fn().mockResolvedValue(undefined)
      const result = await modelingCommandCodemods['GDT Distance'].run({
        args: { objects, framePlane: 'Automatic' },
        ast,
        kclManager: {
          artifactGraph,
          code: '',
          fileSettings: { defaultLengthUnit: 'mm' },
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
        } as KclManager,
        wasmInstance: instance,
      })
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      expect(code).toContain(`${primitiveType}Id(plate, index = 1)`)
      expect(code).toContain(`${primitiveType}Id(plate, index = 2)`)
      expect(code).toContain(`from = ${primitiveType}001`)
      expect(code).toContain(`to = ${primitiveType}002`)
      expect(code).not.toContain('framePlane =')
      expect(code).not.toContain('Automatic')
      expect(code).not.toContain('tolerance =')
      expect(sendSceneCommand).not.toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: expect.objectContaining({ type: 'make_plane' }),
        })
      )
    }
  )
})
