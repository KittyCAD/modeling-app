import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createLocalName } from '@src/lang/create'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addExtrude } from '@src/lang/modifyAst/sweeps'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import { getBooleanOptions, resolveBooleanValue } from '@src/lib/booleanInput'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { enterEditFlow } from '@src/lib/operations'
import { enginelessExecutor } from '@src/lib/testHelpers'
import {
  assertNotErr,
  buildTheWorldAndConnectToEngine,
} from '@src/unitTestUtils'

const profileCode = `@settings(kclVersion = 3.0)
mirrorEnabled = false
count = 2
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])`

describe('boolean parameter inputs', () => {
  let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
  beforeAll(async () => {
    world = await buildTheWorldAndConnectToEngine({
      webrtc: false,
      pool: 'cpu',
    })
  })
  beforeEach(async () => {
    await world.rustContext.execute(
      assertParse(
        '@settings(kclVersion = 3.0)\nmirrorEnabled = false\ncount = 2',
        world.instance
      ),
      jsAppSettings(world.settingsActor)
    )
  })
  afterAll(() => {
    world.commandBarActor.stop()
    world.settingsActor.stop()
    world.engineCommandManager.tearDown({
      route: 'user-requested',
      initiatedBy: 'client',
    })
  })

  it('offers only boolean parameters defined before the edited feature', async () => {
    const code = `${profileCode}
body001 = extrude(region001, length = 5mm)
later = true`
    const ast = assertParse(code, world.instance)
    const exec = await enginelessExecutor(ast, world.rustContext)
    const start = code.indexOf('extrude(')
    const nodeToEdit = getNodePathFromSourceRange(ast, [
      start,
      code.indexOf('\nlater'),
      0,
    ])
    const input = {
      required: false,
      currentValue: undefined,
      ast,
      variables: exec.variables,
      nodeToEdit,
      wasmInstance: world.instance,
    }
    const options = getBooleanOptions(input)
    expect(options.map((option) => option.name)).toEqual([
      'Use default',
      'On',
      'Off',
      'mirrorEnabled (Off)',
    ])
    expect(getBooleanOptions({ ...input, required: true })[0].name).toBe('On')
    const reference = options[3].value
    expect(reference).toMatchObject({
      valueText: 'mirrorEnabled',
      valueCalculated: 'false',
      valueAst: { type: 'Name' },
    })
    expect(
      getBooleanOptions({ ...input, currentValue: reference })[3].value
    ).toBe(reference)
  })

  it('preserves a false-valued binding through editing and clearing', async () => {
    const expression = 'mirrorEnabled'
    const code = `${profileCode}
body001 = extrude(region001, length = 5mm, symmetric = ${expression})`
    const ast = assertParse(code, world.instance)
    const exec = await enginelessExecutor(ast, world.rustContext)
    const operation = getAllOperations(exec.operations).find(
      (operation) =>
        operation.type === 'StdLibCall' && operation.name === 'extrude'
    )
    expect(operation).toBeDefined()
    if (!operation) return
    const edit = await enterEditFlow({
      operation,
      code,
      artifactGraph: exec.artifactGraph,
      rustContext: world.rustContext,
    })
    assertNotErr(edit)
    if (edit.type !== 'Find and select command')
      throw new Error('Expected edit command')
    const symmetric: unknown = edit.data.argDefaultValues?.symmetric
    expect(symmetric).toMatchObject({
      valueText: expression,
      valueCalculated: 'false',
    })
    if (!isKclCommandValue(symmetric))
      throw new Error('Expected boolean expression')
    const length = {
      valueAst: createLocalName('count'),
      valueText: 'count',
      valueCalculated: '2',
    }
    const common = {
      ast,
      sketches: { graphSelections: [], otherSelections: [] },
      artifactGraph: exec.artifactGraph,
      length,
      nodeToEdit: createPathToNodeForLastVariable(ast, false),
      wasmInstance: world.instance,
    }
    const saved = addExtrude({ ...common, symmetric })
    assertNotErr(saved)
    expect(recast(saved.modifiedAst, world.instance)).toContain(
      `symmetric = ${expression}`
    )
    const cleared = addExtrude({ ...common, symmetric: undefined })
    assertNotErr(cleared)
    expect(recast(cleared.modifiedAst, world.instance)).not.toContain(
      'symmetric ='
    )
  })

  it('reevaluates bindings and rejects numeric or missing values', async () => {
    const ast = assertParse(profileCode, world.instance)
    await enginelessExecutor(ast, world.rustContext)
    const binding = {
      valueAst: createLocalName('mirrorEnabled'),
      valueText: 'mirrorEnabled',
      valueCalculated: 'true',
    }
    expect(await resolveBooleanValue(binding, world.rustContext)).toMatchObject(
      { valueText: 'mirrorEnabled', valueCalculated: 'false' }
    )
    expect(await resolveBooleanValue(false, world.rustContext)).toBe(false)
    expect(
      await resolveBooleanValue(undefined, world.rustContext)
    ).toBeUndefined()
    expect(
      await resolveBooleanValue(
        { ...binding, valueText: 'count' },
        world.rustContext
      )
    ).toBeInstanceOf(Error)
    expect(
      await resolveBooleanValue(
        { ...binding, valueText: 'missing' },
        world.rustContext
      )
    ).toBeInstanceOf(Error)
  })
})
