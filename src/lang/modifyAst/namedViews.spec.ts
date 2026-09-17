import { addNamedView } from '@src/lang/modifyAst/namedViews'
import { assertParse, recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { stringToKclExpression } from '@src/lib/kclHelpers'
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
  engineCommandManager?.tearDown()
})

async function kclValue(value: string): Promise<KclCommandValue> {
  return (await stringToKclExpression(value, rustContext)) as KclCommandValue
}

describe('addNamedView', () => {
  const settings = '@settings(kclVersion = 2.0, experimentalFeatures = allow)'

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
})
