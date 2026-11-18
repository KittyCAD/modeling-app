import { readFile } from 'node:fs/promises'
import {
  applyOperationCallbackToOperationsByModule,
  assertParse,
  emptyOperationsByModule,
} from '@src/lang/wasm'
import { getBodyTreeNodeRenderKey } from '@src/lib/featureTree/featureTreeBodyTree'
import { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, test } from 'vitest'

test('housing live rows have unique render keys before source paths are filled', async () => {
  const world = await buildTheWorldAndNoEngineConnection()
  try {
    const code = await readFile(
      'e2e/playwright/fixtures/pump-housing.kcl',
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
