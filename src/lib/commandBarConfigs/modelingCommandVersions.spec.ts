import { createActor, type Actor } from 'xstate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({ useApp: vi.fn(), useSingletons: vi.fn() }))
import { assertParse, recast } from '@src/lang/wasm'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { isErr } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { runModelingCodemod } from '@src/lang/modifyAst/modelingCodemod'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import {
  modelingMachineCommandConfig,
  type ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { createMachineCommand } from '@src/lib/createMachineCommand'
import { isArray } from '@src/lib/utils'
import { modelingMachine } from '@src/machines/modelingMachine'
import { MODE_MODELING_COMMAND_SCOPE } from '@src/registry/contracts/commands'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('modeling command KCL versions', () => {
  let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
  let actor: Actor<typeof modelingMachine>

  beforeEach(async () => {
    world = await buildTheWorldAndNoEngineConnection()
    await parseCode('@settings(kclVersion = 2.0)')
    actor = createActor(modelingMachine, {
      input: { ...world, wasmInstance: world.instance },
    }).start()
  })

  afterEach(() => {
    actor.stop()
    world.commandBarActor.stop()
    world.settingsActor.stop()
  })

  async function parseCode(code: string) {
    world.kclManager.updateCodeEditor(code, {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
    })
    return world.kclManager.safeParse(code)
  }

  function command(name: 'Fillet' | 'Sweep', send = vi.fn()) {
    const result = createMachineCommand<
      typeof modelingMachine,
      ModelingCommandSchema
    >({
      groupId: 'modeling',
      type: name,
      state: actor.getSnapshot(),
      actor,
      send,
      commandBarConfig: modelingMachineCommandConfig,
      defaultScopes: [MODE_MODELING_COMMAND_SCOPE],
      showExperimentalCommands: true,
    })
    if (!result || isArray(result)) throw new Error('Expected a single command')
    return result
  }

  it('hides unavailable fields without removing authored edit arguments', async () => {
    await parseCode('@settings(kclVersion = 3.0)')
    const send = vi.fn()
    const sweep = command('Sweep', send)
    expect(sweep.args).not.toHaveProperty('relativeTo')
    expect(sweep.args).not.toHaveProperty('version')
    world.commandBarActor.send({ type: 'Open' })
    world.commandBarActor.send({
      type: 'Select command',
      data: {
        command: sweep,
        argDefaultValues: {
          nodeToEdit: [],
          version: '1',
          relativeTo: 'TRAJECTORY',
        },
      },
    })
    const values = world.commandBarActor.getSnapshot().context.argumentsToSubmit
    sweep.onSubmit(values)
    expect(send).toHaveBeenCalledWith({
      type: 'Sweep',
      data: expect.objectContaining({
        nodeToEdit: [],
        version: '1',
        relativeTo: 'TRAJECTORY',
      }),
    })
  })

  it('filters fields using the last parsed version and resets on parse failure or clear', async () => {
    const version = world.kclManager.kclProgramVersionSignal
    expect(version.value).toBe('2.0')
    const fillet = command('Fillet')
    expect(fillet.args).toHaveProperty('version')
    expect(fillet.args).not.toHaveProperty('tangentChain')

    world.kclManager.updateCodeEditor('@settings(kclVersion = 3.0)', {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
    })
    expect(version.value).toBe('2.0')
    await world.kclManager.safeParse(world.kclManager.code)
    expect(version.value).toBe('3.0')
    const v3Args = command('Fillet').args
    expect(v3Args).not.toHaveProperty('version')
    expect(v3Args).toHaveProperty('tangentChain')
    expect(await parseCode('@settings(kclVersion = 3.0)\nx =')).toBeNull()
    expect(version.value).toBeNull()
    const unknownVersionArgs = command('Fillet').args
    expect(unknownVersionArgs).toHaveProperty('radius')
    expect(unknownVersionArgs).not.toHaveProperty('version')
    expect(unknownVersionArgs).not.toHaveProperty('tangentChain')
    await parseCode('@settings(kclVersion = 3.0)')
    expect(version.value).toBe('3.0')
    world.kclManager.clearAst()
    expect(version.value).toBeNull()
  })

  it.each(['2.0', '3.0'])(
    'generates supported Sweep defaults in KCL %s',
    async (version) => {
      const code = `@settings(kclVersion = ${version})
profile = sketch(on = XY) {
  circle1 = circle(center = [0, 0], radius = 1)
}
trajectory = sketch(on = XZ) {
  line1 = line(start = [0, 0], end = [0, 10])
}`
      const ast = assertParse(code, world.instance)
      const selection = (index: number): Selections => {
        const node = ast.body[index]
        return {
          graphSelections: [
            { codeRef: codeRefFromRange([node.start, node.end, 0], ast) },
          ],
          otherSelections: [],
        }
      }
      const result = await runModelingCodemod({
        codemod: modelingCommandCodemods.Sweep,
        commandArgs: { sketches: selection(0), path: selection(1) },
        kclManager: world.kclManager,
        wasmInstance: world.instance,
        sourceSnapshot: { code, ast },
      })
      if (isErr(result)) throw result
      const generated = recast(result.modifiedAst, world.instance)
      expect(generated).toContain('sweep(')
      if (version === '2.0') expect(generated).toContain('version = 2')
      else expect(generated).not.toContain('version =')
    }
  )
})
