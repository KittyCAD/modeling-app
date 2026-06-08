import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { assertParse, recast } from '@src/lang/wasm'
import {
  getDefaultGdtTolerance,
  modelingMachineCommandConfig,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  createSelectionFromPathArtifact,
  enginelessExecutor,
  getKclCommandValue,
} from '@src/lib/testHelpers'
import { isArray } from '@src/lib/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/modelingWorkflows', () => ({
  mockExecAstAndReportErrors: vi.fn(async () => undefined),
}))

describe('GDT Datum Default Name', () => {
  it('should work with command bar when datum A already exists', async () => {
    // Test command bar integration with existing datum
    const codeWithDatum = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "A")`

    const { instance } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(codeWithDatum, instance)

    // Should return 'B' since 'A' is already used
    expect(getNextAvailableDatumName(ast)).toBe('B')
  })
})

describe('GDT tolerance defaults', () => {
  it('uses the current file unit for the tolerance input default', () => {
    const modelingContext = {
      kclManager: {
        fileSettings: {
          defaultLengthUnit: 'in',
        },
      },
    } as unknown as ModelingMachineContext

    expect(getDefaultGdtTolerance({}, modelingContext)).toBe('0.1in')
    expect(getDefaultGdtTolerance({})).toBe('0.1mm')
  })

  it('wires the unit-aware default into tolerance-bearing GD&T commands', () => {
    const commandNames = [
      'GDT Flatness',
      'GDT Position',
      'GDT Profile',
      'GDT Distance',
      'GDT Perpendicularity',
      'GDT Parallelism',
    ] as const

    for (const commandName of commandNames) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      expect(commandConfig.args?.tolerance).toMatchObject({
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
      })
      expect(
        commandConfig.args?.tolerance?.valueSummary?.({
          valueCalculated: '2.54mm',
          valueText: '0.1in',
        } as KclCommandValue)
      ).toBe('0.1in')
    }
  })
})

describe('Extrude command config', () => {
  it('marks direction experimental and enables experimental features during review', async () => {
    const commandConfig = modelingMachineCommandConfig.Extrude
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Extrude should have a single command config')
    }

    expect(commandConfig.args?.direction).toMatchObject({
      inputType: 'vector3d',
      status: 'experimental',
    })

    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 1)
  |> xLine(length = 1)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const ast = assertParse(code, instance)
    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const pathArtifacts = [...artifactGraph.values()].filter(
      (artifact) => artifact.type === 'path'
    )
    const sketches = createSelectionFromPathArtifact(pathArtifacts)
    const length = await getKclCommandValue('1', instance, rustContext)
    const direction = await getKclCommandValue(
      '[0, 0, 1]',
      instance,
      rustContext
    )

    const result = await commandConfig.reviewValidation?.(
      {
        argumentsToSubmit: {
          sketches,
          length,
          direction,
        },
        wasmInstancePromise: Promise.resolve(instance),
      } as any,
      {
        getSnapshot: () => ({
          context: {
            engineCommandManager: { connection: { connected: true } },
            kclManager: {
              ast,
              artifactGraph,
              code,
              fileSettings: {
                experimentalFeatures: { type: 'Deny' },
              },
            },
            rustContext,
          },
        }),
      } as any
    )

    if (result instanceof Error) {
      throw result
    }
    const reviewedAst = vi
      .mocked(mockExecAstAndReportErrors)
      .mock.calls.at(-1)?.[0]
    if (!reviewedAst) {
      throw new Error('Expected mock execution to receive an AST')
    }

    const reviewedCode = recast(reviewedAst, instance)
    expect(reviewedCode).toContain('@settings(experimentalFeatures = allow)')
    expect(reviewedCode).toContain('direction = [0, 0, 1]')
  })
})
