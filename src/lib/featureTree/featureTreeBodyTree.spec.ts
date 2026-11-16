import { readFile, readdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getBodiesFromArtifactGraph } from '@src/lang/std/artifactGraph'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { buildBodyOperationTree } from '@src/lib/featureTree/featureTreeBodyTree'
import { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { isArray } from '@src/lib/utils'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>

beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
  const directory = resolve('public/kcl-samples/axial-fan')
  projectFsManager.setOperations({
    readFile: (path) => readFile(resolve(directory, path)),
    exists: (path) =>
      access(resolve(directory, path)).then(
        () => true,
        () => false
      ),
    readDirectory: (path) => readdir(resolve(directory, path)),
  })
})

afterAll(() => {
  projectFsManager.setOperations(testFileOperations)
  world?.settingsActor.stop()
  world?.commandBarActor.stop()
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

test('PC Fan keeps the housing Boolean inputs beneath its three bodies', async () => {
  const code = await readFile('public/kcl-samples/axial-fan/main.kcl', 'utf8')
  const state = await getAstAndArtifactGraph(
    code,
    world.instance,
    world.kclManager
  )
  const tree = buildBodyOperationTree(
    buildOperationTree(state.operations, 0),
    getBodiesFromArtifactGraph(state.artifactGraph),
    state.artifactGraph
  )
  const housing = tree.nodes.find(
    (node) =>
      !isArray(node) && 'parent' in node && node.parent.name === 'fanHousing'
  )
  expect(housing).toBeDefined()
  if (!housing || isArray(housing) || !('parent' in housing)) return
  const bodies = housing.children.filter(
    (node) => !isArray(node) && 'body' in node
  )
  expect(bodies).toHaveLength(3)
  const booleanBody = tree.branches.find(
    (body) =>
      body.ownerModuleId === housing.parent.moduleId &&
      body.artifact.type === 'compositeSolid'
  )
  expect(booleanBody).toBeDefined()
  const operations =
    booleanBody?.operations.flatMap((node) =>
      isArray(node) ? node : 'parent' in node ? [] : [node]
    ) ?? []
  expect(
    operations.filter((op) => op.type === 'StdLibCall').map((op) => op.name)
  ).toEqual(expect.arrayContaining(['extrude', 'revolve', 'subtract']))
  expect(operations.filter((op) => op.type === 'GroupBegin')).toHaveLength(2)
  expect(
    tree.nodes.filter((node) => !isArray(node) && 'body' in node)
  ).toHaveLength(0)
}, 30_000)
