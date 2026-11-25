import { readFile } from 'node:fs/promises'
import { getBodiesFromArtifactGraph } from '@src/lang/std/artifactGraph'
import {
  applyOperationCallbackToOperationsByModule,
  assertParse,
  emptyOperationsByModule,
} from '@src/lang/wasm'
import {
  buildBodyOperationTree,
  getBodyTreeNodeRenderKey,
} from '@src/lib/featureTree/featureTreeBodyTree'
import { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, test } from 'vitest'
import { isArray } from '@src/lib/utils'

test('housing live rows have unique render keys before source paths are filled', async () => {
  const world = await buildTheWorldAndNoEngineConnection()
  try {
    const code = await readFile(
      'public/kcl-samples/artificial-heart/housing.kcl',
      'utf8'
    )
    let operations = emptyOperationsByModule()
    const duplicateKeys = new Set<string>()
    await world.rustContext.executeMock(
      assertParse(code, world.instance),
      {},
      undefined,
      false,
      {
        onOperation: (callback) => {
          operations = applyOperationCallbackToOperationsByModule({
            operationsByModule: operations,
            callback,
          })
          const keys = buildOperationTree(operations, 0).map(
            getBodyTreeNodeRenderKey
          )
          for (const [index, key] of keys.entries()) {
            if (keys.indexOf(key) !== index) duplicateKeys.add(key)
          }
        },
      }
    )
    expect(buildOperationTree(operations, 0)).toHaveLength(33)
    expect([...duplicateKeys]).toEqual([])
  } finally {
    world.settingsActor.stop()
    world.commandBarActor.stop()
    world.rustContext.destroy()
  }
}, 30_000)

test('GD&T tutorial keeps its ending annotations after the body', async () => {
  const world = await buildTheWorldAndNoEngineConnection()
  try {
    const code = await readFile(
      'public/kcl-samples/gdt-tutorial/main.kcl',
      'utf8'
    )
    const state = await world.rustContext.executeMock(
      assertParse(code, world.instance),
      {}
    )
    const nodes = buildOperationTree(state.operations, 0)
    const annotations = nodes.filter(
      (node) =>
        !isArray(node) && 'name' in node && node.name.startsWith('gdt::')
    )
    const tree = buildBodyOperationTree(
      nodes,
      getBodiesFromArtifactGraph(state.artifactGraph),
      state.artifactGraph
    )
    expect(annotations).toHaveLength(6)
    expect(tree.branches).toHaveLength(1)
    expect(tree.nodes).toEqual([
      { body: tree.branches[0], children: tree.branches[0].operations },
      ...annotations,
    ])
  } finally {
    world.settingsActor.stop()
    world.commandBarActor.stop()
    world.rustContext.destroy()
  }
}, 30_000)
