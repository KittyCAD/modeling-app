import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import {
  addNamedView,
  type NamedViewCameraSnapshot,
  updateNamedViewCamera,
} from '@src/lang/modifyAst/namedViews'
import { assertParse, recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { prepareNamedViewEditCommand } from '@src/lib/kclNamedViewEdit'
import type RustContext from '@src/lib/rustContext'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instance: ModuleType = null!
let engineCommandManager: ConnectionManager = null!
let rustContext: RustContext = null!

beforeEach(async () => {
  if (instance) return
  ;({ instance, engineCommandManager, rustContext } =
    await buildTheWorldAndNoEngineConnection())
})

afterAll(() => {
  engineCommandManager?.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

async function kclValue(value: string): Promise<KclCommandValue> {
  const result = await stringToKclExpression(value, rustContext)
  if (err(result)) throw result
  if ('errors' in result) throw new Error('Could not parse the KCL value')
  return result
}

describe('addNamedView', () => {
  const settings = '@settings(kclVersion = 3.0)'

  it('adds an oriented named view with camera options', async () => {
    const ast = assertParse(settings, instance)
    const result = addNamedView({
      ast,
      artifactGraph: new Map(),
      name: 'Inspection view',
      orientation: 'Front',
      target: await kclValue('[1, 2, 3]'),
      distance: await kclValue('200mm'),
      projection: 'Perspective',
      baseline: 'Show',
      wasmInstance: instance,
    })
    if (err(result)) throw result

    await enginelessExecutor(result.modifiedAst, rustContext)
    expect(
      recast(result.modifiedAst, instance)
    ).toContain(`view001 = view::named(
  "Inspection view",
  camera = view::oriented(
    view::Orientation::Front,
    target = [1, 2, 3],
    distance = 200mm,
    projection = view::Projection::Perspective,
  ),
  baseline = view::Visibility::Show,
)`)
  })

  it('writes selected visibility exceptions as object references', async () => {
    const code = `${settings}

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
}
region001 = region(segments = [sketch001.line1])
extrude001 = extrude(region001, length = 5mm)`
    const ast = assertParse(code, instance)
    const execState = await enginelessExecutor(ast, rustContext)
    const sweep = [...execState.artifactGraph.values()].find(
      (artifact) => artifact.type === 'sweep'
    )
    if (!sweep) throw new Error('Expected a sweep artifact')

    const result = addNamedView({
      ast,
      artifactGraph: execState.artifactGraph,
      name: 'Isolate body',
      orientation: 'Isometric',
      projection: 'Orthographic',
      baseline: 'Hide',
      except: {
        graphSelections: [{ artifact: sweep, codeRef: sweep.codeRef }],
        otherSelections: [],
      },
      wasmInstance: instance,
    })
    if (err(result)) throw result

    const nextExecState = await enginelessExecutor(
      result.modifiedAst,
      rustContext
    )
    expect(
      recast(result.modifiedAst, instance)
    ).toContain(`view001 = view::named(
  "Isolate body",
  camera = view::oriented(view::Orientation::Isometric, projection = view::Projection::Orthographic),
  baseline = view::Visibility::Hide,
  except = [extrude001],
)`)
    expect(
      [...nextExecState.artifactGraph.values()].some(
        (artifact) => artifact.type === 'namedView'
      )
    ).toBe(true)
  })

  it('edits name and camera while preserving framing expressions and exceptions', async () => {
    const code = `${settings}

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
}
region001 = region(segments = [sketch001.line1])
extrude001 = extrude(region001, length = 5mm)
exceptions = [extrude001]
orientation = view::Orientation::Front
projection = view::Projection::Perspective
baseline = view::Visibility::Show

view001 = view::named(
  "Inspection view",
  camera = view::oriented(
    orientation,
    target = [1 + 2, 3, 4],
    distance = 200mm,
    projection = projection,
  ),
  baseline = baseline,
  except = exceptions,
)`
    const ast = assertParse(code, instance)
    const execState = await enginelessExecutor(ast, rustContext)
    const artifact = [...execState.artifactGraph.values()].find(
      (candidate) => candidate.type === 'namedView'
    )
    if (!artifact || artifact.type !== 'namedView') {
      throw new Error('Expected a named view artifact')
    }

    const event = await prepareNamedViewEditCommand({
      artifact,
      // Missing preview artifacts must not erase the authored exceptions.
      artifactGraph: new Map(),
      ast,
      code,
      rustContext,
    })
    if (err(event)) throw event
    const defaults = event.data.argDefaultValues
    expect(defaults).toMatchObject({
      name: 'Inspection view',
      except: undefined,
    })

    const result = addNamedView({
      ast,
      artifactGraph: execState.artifactGraph,
      ...defaults,
      name: 'Updated view',
      orientation: 'Top',
      wasmInstance: instance,
    })
    if (err(result)) throw result

    const updatedCode = recast(result.modifiedAst, instance)
    if (err(updatedCode)) throw updatedCode
    expect(updatedCode.match(/view::named/g)).toHaveLength(1)
    expect(updatedCode).toContain('"Updated view"')
    expect(updatedCode).toContain('    view::Orientation::Top,')
    expect(updatedCode).toContain(
      '    projection = view::Projection::Perspective,'
    )
    expect(updatedCode).toContain('  baseline = view::Visibility::Show,')
    expect(updatedCode).toContain('target = [1 + 2, 3, 4]')
    expect(updatedCode).toContain('distance = 200mm')
    expect(updatedCode).toContain('except = exceptions')
    await enginelessExecutor(result.modifiedAst, rustContext)
  })

  it('keeps a custom camera helper when editing a view', async () => {
    const code = `${settings}
fn oriented(@orientation: view::Orientation) {
  return view::oriented(orientation, distance = 123mm)
}
view001 = view::named("Inspection view", camera = oriented(view::Orientation::Front), baseline = view::Visibility::Show)`
    const ast = assertParse(code, instance)
    const execState = await enginelessExecutor(ast, rustContext)
    const artifact = [...execState.artifactGraph.values()].find(
      (candidate) => candidate.type === 'namedView'
    )
    if (!artifact || artifact.type !== 'namedView') {
      throw new Error('Expected a named view artifact')
    }

    const event = await prepareNamedViewEditCommand({
      artifact,
      artifactGraph: execState.artifactGraph,
      ast,
      code,
      rustContext,
    })
    if (err(event)) throw event
    expect(event.data.argDefaultValues).toMatchObject({
      orientation: undefined,
      projection: undefined,
    })

    const result = addNamedView({
      ast,
      artifactGraph: execState.artifactGraph,
      ...event.data.argDefaultValues,
      name: 'Renamed view',
      baseline: 'Hide',
      wasmInstance: instance,
    })
    if (err(result)) throw result
    const updatedCode = recast(result.modifiedAst, instance)
    expect(updatedCode).toContain('camera = oriented(view::Orientation::Front)')
    expect(updatedCode).toContain('"Renamed view"')
    expect(updatedCode).toContain('view::Visibility::Hide')
    const updated = await enginelessExecutor(result.modifiedAst, rustContext)
    const updatedView = [...updated.artifactGraph.values()].find(
      (candidate) => candidate.type === 'namedView'
    )
    expect(updatedView?.camera.distance).toBe(123)
  })
})

describe('updateNamedViewCamera', () => {
  const code = `@settings(kclVersion = 3.0)

view001 = view::named(
  "Inspection view",
  camera = view::oriented(
    view::Orientation::Front,
    distance = 200mm,
    projection = view::Projection::Perspective,
  ),
  baseline = view::Visibility::Show,
)`

  it('replaces only the camera with the current directed camera', async () => {
    const ast = assertParse(code, instance)
    const camera: NamedViewCameraSnapshot = {
      look: {
        type: 'directed',
        direction: { x: 0.25, y: -0.5, z: -0.75, units: null },
        up: { x: 0, y: 0, z: 1, units: null },
      },
      target: { x: 10, y: 20, z: 30, units: 'mm' },
      distance: 125.5,
      projection: 'orthographic',
    }
    const modifiedAst = updateNamedViewCamera({
      ast,
      pathToNode: createPathToNodeForLastVariable(ast, false),
      camera,
      wasmInstance: instance,
    })
    if (err(modifiedAst)) throw modifiedAst

    await enginelessExecutor(modifiedAst, rustContext)
    const updatedCode = recast(modifiedAst, instance)
    if (err(updatedCode)) throw updatedCode
    expect(updatedCode).toContain(`camera = view::directed(
    [0.25, -0.5, -0.75],
    up = [0, 0, 1],
    target = [10mm, 20mm, 30mm],
    distance = 125.5mm,
    projection = view::Projection::Orthographic,
  )`)
    expect(updatedCode).toContain('"Inspection view"')
    expect(updatedCode).toContain('baseline = view::Visibility::Show')

    const commandResult = addNamedView({
      ast: assertParse('@settings(kclVersion = 3.0)', instance),
      artifactGraph: new Map(),
      name: 'Inspection view',
      cameraMode: 'directed',
      camera,
      baseline: 'Show',
      wasmInstance: instance,
    })
    if (err(commandResult)) throw commandResult
    expect(recast(commandResult.modifiedAst, instance)).toBe(updatedCode)

    const orientedResult = addNamedView({
      ast,
      artifactGraph: new Map(),
      nodeToEdit: createPathToNodeForLastVariable(ast, false),
      name: 'Inspection view',
      cameraMode: 'oriented',
      camera,
      orientation: 'Top',
      projection: 'Perspective',
      baseline: 'Show',
      wasmInstance: instance,
    })
    if (err(orientedResult)) throw orientedResult
    const orientedCode = recast(orientedResult.modifiedAst, instance)
    expect(orientedCode).toContain('view::oriented(view::Orientation::Top')
    expect(orientedCode).not.toContain('view::directed(')
  })
})
