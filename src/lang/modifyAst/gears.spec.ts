import type { KclManager } from '@src/lang/KclManager'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import {
  addHelicalGear,
  addHerringboneGear,
  addRingGear,
  addSpurGear,
} from '@src/lang/modifyAst/gears'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndNoEngineConnection()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

async function toKclValue(value: string): Promise<KclCommandValue> {
  return (await stringToKclExpression(
    value,
    rustContextInThisFile
  )) as KclCommandValue
}

describe('gears.test.ts', () => {
  const settings = `@settings(experimentalFeatures = allow)`

  it('should delete a standalone gear call selected by its call expression range', async () => {
    const code = `${settings}
gear001 = gear::spur(
  nTeeth = 21,
  module = 1.5,
  pressureAngle = 14deg,
  gearHeight = 6,
)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      instanceInThisFile,
      kclManagerInThisFile
    )
    const execState = await enginelessExecutor(ast, rustContextInThisFile)
    const callStart = code.indexOf('gear::spur(')
    const range = topLevelRange(callStart, code.length)
    const result = await deleteFromSelection(
      ast,
      {
        codeRef: codeRefFromRange(range, ast),
        artifact: { type: 'segment' } as never,
      },
      execState.variables,
      artifactGraph,
      instanceInThisFile
    )
    if (err(result)) throw result

    const newCode = recast(result, instanceInThisFile)
    expect(newCode).toBe(`${settings}\n`)
  })

  describe('Testing addHelicalGear', () => {
    it('should add a standalone helical gear call', async () => {
      const { ast } = await getAstAndArtifactGraph(
        settings,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHelicalGear({
        ast,
        nTeeth: await toKclValue('10'),
        module: await toKclValue('2'),
        pressureAngle: await toKclValue('20deg'),
        helixAngle: await toKclValue('35deg'),
        gearHeight: await toKclValue('7'),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::helical(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  helixAngle = 35deg,
  gearHeight = 7,
)`)
    })

    it('should edit a standalone helical gear call', async () => {
      const code = `${settings}
gear001 = gear::helical(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  helixAngle = 35deg,
  gearHeight = 7,
)`
      const { ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHelicalGear({
        ast,
        nTeeth: await toKclValue('12'),
        module: await toKclValue('2.5'),
        pressureAngle: await toKclValue('22deg'),
        helixAngle: await toKclValue('30deg'),
        gearHeight: await toKclValue('9'),
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::helical(
  nTeeth = 12,
  module = 2.5,
  pressureAngle = 22deg,
  helixAngle = 30deg,
  gearHeight = 9,
)`)
    })
  })

  describe('Testing addHerringboneGear', () => {
    it('should add a standalone herringbone gear call', async () => {
      const { ast } = await getAstAndArtifactGraph(
        settings,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHerringboneGear({
        ast,
        nTeeth: await toKclValue('10'),
        module: await toKclValue('2'),
        pressureAngle: await toKclValue('20deg'),
        gearHeight: await toKclValue('5'),
        helixAngle: await toKclValue('40deg'),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::herringbone(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  gearHeight = 5,
  helixAngle = 40deg,
)`)
    })

    it('should edit a standalone herringbone gear call', async () => {
      const code = `${settings}
gear001 = gear::herringbone(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  gearHeight = 5,
  helixAngle = 40deg,
)`
      const { ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHerringboneGear({
        ast,
        nTeeth: await toKclValue('12'),
        module: await toKclValue('2.5'),
        pressureAngle: await toKclValue('22deg'),
        gearHeight: await toKclValue('7'),
        helixAngle: await toKclValue('45deg'),
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::herringbone(
  nTeeth = 12,
  module = 2.5,
  pressureAngle = 22deg,
  gearHeight = 7,
  helixAngle = 45deg,
)`)
    })
  })

  describe('Testing addSpurGear', () => {
    it('should add a standalone spur gear call', async () => {
      const { ast } = await getAstAndArtifactGraph(
        settings,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addSpurGear({
        ast,
        nTeeth: await toKclValue('21'),
        module: await toKclValue('1.5'),
        pressureAngle: await toKclValue('14deg'),
        gearHeight: await toKclValue('6'),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::spur(
  nTeeth = 21,
  module = 1.5,
  pressureAngle = 14deg,
  gearHeight = 6,
)`)
    })

    it('should edit a standalone spur gear call', async () => {
      const code = `${settings}
gear001 = gear::spur(
  nTeeth = 21,
  module = 1.5,
  pressureAngle = 14deg,
  gearHeight = 6,
)`
      const { ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addSpurGear({
        ast,
        nTeeth: await toKclValue('24'),
        module: await toKclValue('2'),
        pressureAngle: await toKclValue('20deg'),
        gearHeight: await toKclValue('8'),
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::spur(
  nTeeth = 24,
  module = 2,
  pressureAngle = 20deg,
  gearHeight = 8,
)`)
    })
  })

  describe('Testing addRingGear', () => {
    it('should add a standalone ring gear call', async () => {
      const { ast } = await getAstAndArtifactGraph(
        settings,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addRingGear({
        ast,
        nTeeth: await toKclValue('40'),
        module: await toKclValue('1.5'),
        pressureAngle: await toKclValue('14deg'),
        helixAngle: await toKclValue('-25deg'),
        gearHeight: await toKclValue('5'),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::ring(
  nTeeth = 40,
  module = 1.5,
  pressureAngle = 14deg,
  helixAngle = -25deg,
  gearHeight = 5,
)`)
    })

    it('should edit a standalone ring gear call', async () => {
      const code = `${settings}
gear001 = gear::ring(
  nTeeth = 40,
  module = 1.5,
  pressureAngle = 14deg,
  helixAngle = -25deg,
  gearHeight = 5,
)`
      const { ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addRingGear({
        ast,
        nTeeth: await toKclValue('48'),
        module: await toKclValue('1.75'),
        pressureAngle: await toKclValue('20deg'),
        helixAngle: await toKclValue('-30deg'),
        gearHeight: await toKclValue('7'),
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`gear001 = gear::ring(
  nTeeth = 48,
  module = 1.75,
  pressureAngle = 20deg,
  helixAngle = -30deg,
  gearHeight = 7,
)`)
    })
  })
})
