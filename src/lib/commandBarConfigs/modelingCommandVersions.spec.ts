import { createActor, type Actor } from 'xstate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiteral } from '@src/lang/create'

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
    world.kclManager.codeSignal.value = '@settings(kclVersion = 2.0)'
    actor = createActor(modelingMachine, {
      input: { ...world, wasmInstance: world.instance },
    }).start()
  })

  afterEach(() => {
    actor.stop()
    world.commandBarActor.stop()
    world.settingsActor.stop()
  })

  function command(name: 'Fillet' | 'Chamfer' | 'Sweep') {
    const result = createMachineCommand<
      typeof modelingMachine,
      ModelingCommandSchema
    >({
      groupId: 'modeling',
      type: name,
      state: actor.getSnapshot(),
      actor,
      send: vi.fn(),
      commandBarConfig: modelingMachineCommandConfig,
      defaultScopes: [MODE_MODELING_COMMAND_SCOPE],
      showExperimentalCommands: true,
    })
    if (isArray(result)) throw new Error('Expected a single command')
    return result
  }

  it.each<'Fillet' | 'Chamfer'>(['Fillet', 'Chamfer'])(
    'filters %s fields without changing the static drift contract',
    (name) => {
      const v2 = command(name)
      expect(v2?.args).toHaveProperty('version')
      expect(v2?.args).not.toHaveProperty('tangentChain')

      for (const version of ['3.0-preview', '3.0']) {
        world.kclManager.codeSignal.value = `@settings(kclVersion = "${version}")`
        const v3 = command(name)
        expect(v3?.args).not.toHaveProperty('version')
        expect(v3?.args).toHaveProperty('tangentChain')
      }
      const config = modelingMachineCommandConfig[name]
      if (!config || isArray(config))
        throw new Error('Expected a single config')
      expect(config.args).toHaveProperty('version')
      expect(config.args).toHaveProperty('tangentChain')
      expect(config.args).not.toHaveProperty('legacyMethod')
    }
  )

  it('hides unavailable fields without removing authored edit arguments', () => {
    world.kclManager.codeSignal.value = '@settings(kclVersion = "3.0-preview")'
    const sweep = command('Sweep')
    if (!sweep) throw new Error('Expected Sweep')
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
          relativeTo: 'trajectoryCurve',
        },
      },
    })
    const values = world.commandBarActor.getSnapshot().context.argumentsToSubmit
    expect(values).toHaveProperty('nodeToEdit')
    expect(values.version).toBe('1')
    expect(values.relativeTo).toBe('trajectoryCurve')
    expect(sweep.onSubmit({ version: '1' })).toBeUndefined()
  })

  it('tracks the source version without closing commands, and unsubscribes on stop', () => {
    expect(actor.getSnapshot().context.kclLanguageVersion).toBe('2.0')
    const fillet = command('Fillet')
    if (!fillet) throw new Error('Expected Fillet')
    world.commandBarActor.send({ type: 'Open' })
    world.commandBarActor.send({
      type: 'Select command',
      data: { command: fillet },
    })

    world.kclManager.codeSignal.value = '@settings(kclVersion = "3.0-preview")'
    expect(actor.getSnapshot().context.kclLanguageVersion).toBe('3.0-preview')
    expect(world.commandBarActor.getSnapshot().context.selectedCommand).toBe(
      fillet
    )
    world.kclManager.codeSignal.value = '@settings(kclVersion = 2.0)\nx ='
    expect(actor.getSnapshot().context.kclLanguageVersion).toBeNull()
    expect(command('Fillet')).not.toBeNull()
    expect(command('Fillet')?.args).not.toHaveProperty('tangentChain')
    world.kclManager.codeSignal.value = 'x = 1'
    expect(actor.getSnapshot().context.kclLanguageVersion).toBe('1.0')
    actor.stop()
    world.kclManager.codeSignal.value = '@settings(kclVersion = 2.0)'
    expect(actor.getSnapshot().context.kclLanguageVersion).toBe('1.0')
  })

  it.each(['2.0', '"3.0-preview"', '3.0'])(
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
      expect(generated).toContain('path = trajectory')
      expect(generated).toContain('translateProfileToPath = false')
      if (version === '2.0') expect(generated).toContain('version = 2')
      else expect(generated).not.toContain('version =')
    }
  )

  it.each<'Fillet' | 'Chamfer'>(['Fillet', 'Chamfer'])(
    'edits %s tangentChain without policing existing version arguments',
    async (name) => {
      const dimension = name === 'Fillet' ? 'radius' : 'length'
      const call = `${name.toLowerCase()}(body, ${dimension} = 1, tangentChain = true, version = 1)`
      const code = `@settings(kclVersion = 3.0)\npart = ${call}`
      const ast = assertParse(code, world.instance)
      const start = code.indexOf(call)
      const nodeToEdit = codeRefFromRange(
        [start, start + call.length, 0],
        ast
      ).pathToNode
      const size = {
        valueAst: createLiteral(1, world.instance),
        valueText: '1',
        valueCalculated: '1',
      }
      const args = {
        selection: { graphSelections: [], otherSelections: [] },
        radius: size,
        length: size,
        nodeToEdit,
        tangentChain: false,
        version: size,
      }
      for (const tangentChain of [false, true]) {
        const result = await runModelingCodemod({
          codemod: modelingCommandCodemods[name],
          commandArgs: { ...args, tangentChain },
          kclManager: world.kclManager,
          wasmInstance: world.instance,
          sourceSnapshot: { code, ast },
        })
        if (isErr(result)) throw result
        expect(recast(result.modifiedAst, world.instance)).toContain(
          `tangentChain = ${tangentChain}`
        )
        expect(recast(result.modifiedAst, world.instance)).toContain(
          'version = 1'
        )
      }
    }
  )
})
