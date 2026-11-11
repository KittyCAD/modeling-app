import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getAllOperations, recast } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { enterEditFlow } from '@src/lib/operations'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { isErr } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import {
  getEventForQueryEntityTypeWithPoint,
  isSelections,
} from '@src/lib/selections'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { isKclCommandValue } from '@src/lib/commandUtils'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

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
  world?.commandBarActor.stop()
  world?.settingsActor.stop()
})

const block = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [10mm, 0mm])
  right = line(start = [10mm, 0mm], end = [10mm, 20mm])
  top = line(start = [10mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
box = region(point = [5mm, 5mm], sketch = profile)
body = extrude(box, length = 5mm, tagEnd = $capEnd)
`

it.each(['body.faces.capEnd', 'body.sketch.tags.bottom'])(
  'restores omitted placement when editing a datum on %s',
  async (face) => {
    const code =
      block + `gdt::datum(face = ${face}, name = "A", fontSize = 1mm)`
    const state = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const operation = getAllOperations(state.operations).find(
      (op) => op.type === 'StdLibCall' && op.name === 'gdt::datum'
    )
    if (!operation) throw new Error('Missing datum operation')
    const edit = await enterEditFlow({
      operation,
      code,
      artifactGraph: state.artifactGraph,
      rustContext: world.rustContext,
    })
    if (isErr(edit)) throw edit
    if (edit.type !== 'Find and select command')
      throw new Error('Missing edit command')
    const defaults = edit.data.argDefaultValues
    if (!defaults || !isSelections(defaults.faces))
      throw new Error('Missing datum faces')
    const result = await modelingCommandCodemods['GDT Datum'].run({
      ast: state.ast,
      args: { ...defaults, faces: defaults.faces, name: 'B' },
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain(`face = ${face}`)
    expect(output).toContain('name = "B"')
    expect(output).toContain('fontSize = 1mm')
    if (face === 'body.faces.capEnd') {
      expect(output).toContain('framePlane = XZ')
      expect(output).toContain('framePosition = [15, 15]')
    } else {
      expect(output).not.toContain('framePlane =')
      expect(output).toContain('framePosition = [7.5, -7.5]')
    }
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30_000
)

it('preserves explicit zero placement and font expressions when editing', async () => {
  const code =
    block +
    `textHeight = 1mm
gdt::datum(face = body.faces.capEnd, name = "A", framePosition = [0mm, 0mm], framePlane = YZ, fontSize = textHeight)`
  const state = await getAstAndArtifactGraph(
    code,
    world.instance,
    world.kclManager
  )
  expect(world.kclManager.errors).toEqual([])
  const operation = getAllOperations(state.operations).find(
    (op) => op.type === 'StdLibCall' && op.name === 'gdt::datum'
  )
  if (!operation) throw new Error('Missing datum operation')
  const edit = await enterEditFlow({
    operation,
    code,
    artifactGraph: state.artifactGraph,
    rustContext: world.rustContext,
  })
  if (isErr(edit)) throw edit
  if (edit.type !== 'Find and select command')
    throw new Error('Missing edit command')
  const send = vi.spyOn(world.engineCommandManager, 'sendSceneCommand')
  try {
    const defaults = edit.data.argDefaultValues
    if (!defaults || !isSelections(defaults.faces))
      throw new Error('Missing datum faces')
    const result = await modelingCommandCodemods['GDT Datum'].run({
      ast: state.ast,
      args: { ...defaults, faces: defaults.faces, name: 'B' },
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain('framePosition = [0mm, 0mm]')
    expect(output).toContain('framePlane = YZ')
    expect(output).toContain('fontSize = textHeight')
    expect(send).not.toHaveBeenCalled()
  } finally {
    send.mockRestore()
  }
})

it.each([
  {
    name: 'straight',
    model: block,
    edge: '{ sideFaces = [body.sketch.tags.bottom, body.faces.capEnd] }',
    position: '[0, 10]',
    plane: undefined,
  },
  {
    name: 'vertical',
    model: block,
    edge: '{ sideFaces = [body.sketch.tags.bottom, body.sketch.tags.left] }',
    position: '[0, 5]',
    plane: 'XZ',
  },
  {
    name: 'circular',
    model: `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
profile = sketch(on = XY) {
  rim = circle(center = [0mm, 0mm], start = [5mm, 0mm])
}
disk = region(point = [0mm, 0mm], sketch = profile)
body = extrude(disk, length = 5mm, tagEnd = $capEnd)
`,
    edge: '{ sideFaces = [body.sketch.tags.rim, body.faces.capEnd] }',
    position: undefined,
    plane: undefined,
  },
])(
  'uses the selected $name edge bounds when creating and editing a distance',
  async ({ model, edge, position, plane }) => {
    const code =
      model +
      `gdt::distance(edges = [${edge}], tolerance = 0.1mm, fontSize = 1mm)`
    const state = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const operation = getAllOperations(state.operations).find(
      (op) => op.type === 'StdLibCall' && op.name === 'gdt::distance'
    )
    if (!operation) throw new Error('Missing distance operation')
    const edit = await enterEditFlow({
      operation,
      code,
      artifactGraph: state.artifactGraph,
      rustContext: world.rustContext,
    })
    if (isErr(edit)) throw edit
    if (edit.type !== 'Find and select command')
      throw new Error('Missing edit command')
    const defaults = edit.data.argDefaultValues
    if (!defaults || !isSelections(defaults.objects))
      throw new Error('Missing distance objects')
    if (!isKclCommandValue(defaults.tolerance))
      throw new Error('Missing tolerance')
    const data: ModelingCommandSchema['GDT Distance'] = {
      ...defaults,
      objects: defaults.objects,
      tolerance: defaults.tolerance,
    }
    const query = vi.spyOn(world.engineCommandManager, 'sendSceneCommand')
    try {
      const edited = await modelingCommandCodemods['GDT Distance'].run({
        ast: state.ast,
        args: data,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
      })
      if (isErr(edited)) throw edited
      const boundsCommand = query.mock.calls
        .map(([request]) =>
          request.type === 'modeling_cmd_req' ? request.cmd : undefined
        )
        .find((command) => command?.type === 'bounding_box')
      if (boundsCommand?.type !== 'bounding_box')
        throw new Error('Missing selected-edge bounds')
      expect(boundsCommand.entity_ids).toHaveLength(1)
      const response = await world.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'query_entity_type',
          entity_id: boundsCommand.entity_ids[0],
        },
      })
      if (!isModelingResponse(response))
        throw new Error('Missing selected edge')
      expect(response.resp.data.modeling_response).toMatchObject({
        type: 'query_entity_type',
        data: { reference: { type: 'edge' } },
      })
      const edgeResponse = response.resp.data.modeling_response
      if (edgeResponse.type !== 'query_entity_type')
        throw new Error('Missing edge reference')
      const selectionEvent = await getEventForQueryEntityTypeWithPoint(
        { reference: edgeResponse.data.reference },
        {
          engineCommandManager: world.engineCommandManager,
          kclManager: world.kclManager,
          rustContext: world.rustContext,
          wasmInstance: world.instance,
        }
      )
      if (
        selectionEvent?.type !== 'Set selection' ||
        selectionEvent.data.selectionType !== 'singleCodeCursor'
      )
        throw new Error('Missing clicked edge selection')
      query.mockClear()
      const created = await modelingCommandCodemods['GDT Distance'].run({
        ast: state.ast,
        args: {
          objects: {
            graphSelections: [selectionEvent.data.selection],
            otherSelections: [],
          },
          tolerance: defaults.tolerance,
          fontSize: data.fontSize,
        },
        kclManager: world.kclManager,
        wasmInstance: world.instance,
      })
      if (isErr(created)) throw created
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({ cmd: boundsCommand })
      )
      const createdCode = recast(created.modifiedAst, world.instance)
      if (isErr(createdCode)) throw createdCode
      if (position) expect(createdCode).toContain(`framePosition = ${position}`)
      if (plane) expect(createdCode).toContain(`framePlane = ${plane}`)
      const output = recast(edited.modifiedAst, world.instance)
      if (isErr(output)) throw output
      expect(output.replace(/\s/g, '')).toContain(
        `edges = [${edge}]`.replace(/\s/g, '')
      )
      expect(output).toContain('fontSize = 1mm')
      if (position) expect(output).toContain(`framePosition = ${position}`)
      if (plane) expect(output).toContain(`framePlane = ${plane}`)
      await getAstAndArtifactGraph(output, world.instance, world.kclManager)
      expect(world.kclManager.errors).toEqual([])
    } finally {
      query.mockRestore()
    }
  },
  30_000
)
