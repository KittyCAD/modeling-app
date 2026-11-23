import { readFile, readdir, access } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getBodiesFromArtifactGraph } from '@src/lang/std/artifactGraph'
import { engineIdForArtifact } from '@src/lang/std/kclNamedViews'
import { assertParse } from '@src/lang/wasm'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { buildBodyOperationTree } from '@src/lib/featureTree/featureTreeBodyTree'
import { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'
import { isArray } from '@src/lib/utils'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>

beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
  const directory = resolve('public/kcl-samples/axial-fan')
  projectFsManager.setOperations({
    readFile: (path) => readFile(resolve(directory, basename(path))),
    exists: (path) =>
      access(resolve(directory, basename(path))).then(
        () => true,
        () => false
      ),
    readDirectory: () => readdir(directory),
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
  world?.rustContext.destroy()
})

test('PC Fan keeps the housing Boolean inputs beneath its three bodies', async () => {
  const code = await readFile('public/kcl-samples/axial-fan/main.kcl', 'utf8')
  const state = await world.rustContext.execute(
    assertParse(code, world.instance),
    {}
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

test('wheel hub has three selectable body histories, including consumed patterns and merged extrusions', async () => {
  const code = await readFile('public/kcl-samples/wheel-hub/main.kcl', 'utf8')
  const state = await world.rustContext.execute(
    assertParse(code, world.instance),
    {}
  )
  const tree = buildBodyOperationTree(
    buildOperationTree(state.operations, 0),
    getBodiesFromArtifactGraph(state.artifactGraph),
    state.artifactGraph
  )
  expect(tree.branches).toHaveLength(3)
  for (const body of tree.branches) {
    expect(
      body.operations.some(
        (node) =>
          !isArray(node) && 'name' in node && node.name === 'patternCircular3d'
      )
    ).toBe(true)
    const response = await world.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: crypto.randomUUID(),
      cmd: {
        type: 'query_entity_type',
        entity_id: engineIdForArtifact({
          id: body.id,
          artifact: body.artifact,
          artifactGraph: state.artifactGraph,
        }),
      },
    })
    const reply = isArray(response) ? response[0] : response
    expect(
      reply && isModelingResponse(reply) && reply.resp.data.modeling_response
    ).toMatchObject({
      type: 'query_entity_type',
      data: { reference: { type: 'solid3d' } },
    })
  }
  const boltExtrusions = tree.branches[2].operations.filter(
    (node) => !isArray(node) && 'name' in node && node.name === 'extrude'
  )
  expect(boltExtrusions).toHaveLength(2)
}, 30_000)

test('pump housing nests all contributing features beneath its six bodies', async () => {
  const code = await readFile(
    'public/kcl-samples/artificial-heart/housing.kcl',
    'utf8'
  )
  const state = await world.rustContext.execute(
    assertParse(code, world.instance),
    {}
  )
  const tree = buildBodyOperationTree(
    buildOperationTree(state.operations, 0),
    getBodiesFromArtifactGraph(state.artifactGraph),
    state.artifactGraph
  )
  expect(tree.branches).toHaveLength(6)
  expect(tree.nodes.every((node) => !isArray(node) && 'body' in node)).toBe(
    true
  )
  const supportingPlanes = tree.branches
    .flatMap((body) => body.operations)
    .filter(
      (node) => !isArray(node) && 'name' in node && node.name === 'offsetPlane'
    )
  expect(supportingPlanes).toHaveLength(3)
}, 30_000)
