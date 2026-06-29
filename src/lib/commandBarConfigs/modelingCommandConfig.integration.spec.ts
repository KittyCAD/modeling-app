import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { assertParse } from '@src/lang/wasm'
import type { Artifact } from '@src/lang/wasm'
import {
  extrudeSelectionRequiresBodyType,
  extrudeUsesExperimentalFeatures,
  getDefaultGdtTolerance,
  modelingMachineCommandConfig,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

function selectionsForArtifact(artifact?: Artifact): Selections {
  return {
    graphSelections: [
      {
        artifact,
        codeRef: { range: [0, 1, 0], pathToNode: [] },
      },
    ],
    otherSelections: [],
  }
}

function parsedLength(value = '5'): KclCommandValue {
  return {
    valueAst: {},
    valueText: value,
    valueCalculated: value,
  } as KclCommandValue
}

function bodyTypeRequiredForCommand(
  commandName: 'Extrude' | 'Sweep' | 'Loft' | 'Revolve',
  argumentsToSubmit: Record<string, unknown>
): boolean {
  const commandConfig = modelingMachineCommandConfig[commandName]
  if (!commandConfig || isArray(commandConfig)) {
    throw new Error(`${commandName} should have a single command config`)
  }

  const bodyTypeArg = commandConfig.args?.bodyType
  if (!bodyTypeArg) {
    throw new Error(`${commandName} should expose bodyType`)
  }

  return typeof bodyTypeArg.required === 'function'
    ? bodyTypeArg.required({ argumentsToSubmit })
    : bodyTypeArg.required
}

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
      'GDT Angularity',
      'GDT Concentricity',
      'GDT Symmetry',
      'GDT Runout',
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

  it('requires datums for datum-axis GD&T commands', () => {
    for (const commandName of [
      'GDT Concentricity',
      'GDT Symmetry',
      'GDT Runout',
    ] as const) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      expect(commandConfig.args?.datums).toMatchObject({
        inputType: 'kcl',
        required: true,
      })
    }
  })
})

describe('Extrude bodyType argument', () => {
  it('requires bodyType when extruding sketch segments after length is confirmed', () => {
    expect(
      bodyTypeRequiredForCommand('Extrude', {
        sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        length: parsedLength(),
      })
    ).toBe(true)
  })

  it('requires bodyType when extruding sweep edges after length is confirmed', () => {
    expect(
      bodyTypeRequiredForCommand('Extrude', {
        sketches: selectionsForArtifact({ type: 'sweepEdge' } as Artifact),
        length: parsedLength(),
      })
    ).toBe(true)
  })

  it('uses experimental features for sweep edge profile extrudes', () => {
    expect(
      extrudeUsesExperimentalFeatures({
        sketches: selectionsForArtifact({ type: 'sweepEdge' } as Artifact),
      })
    ).toBe(true)
  })

  it('keeps bodyType optional for sketch segments before length is confirmed', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
          length: '5',
        },
      })
    ).toBe(false)
  })

  it('keeps bodyType optional for closed extrude profiles and regions', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'solid2d' } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(false)

    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({
            type: 'path',
            subType: 'region',
          } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(false)
  })

  it('requires bodyType for valid segment selections before artifact data is available', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact(),
          length: parsedLength(),
        },
      })
    ).toBe(true)
  })
})

describe('Sweep-like bodyType argument', () => {
  it('requires bodyType for sweep segment profiles after the path is selected', () => {
    expect(
      bodyTypeRequiredForCommand('Sweep', {
        sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        path: selectionsForArtifact({ type: 'path' } as Artifact),
      })
    ).toBe(true)
  })

  it('checks sweep profiles without treating the path segment as a surface profile', () => {
    expect(
      bodyTypeRequiredForCommand('Sweep', {
        sketches: selectionsForArtifact({ type: 'solid2d' } as Artifact),
        path: selectionsForArtifact({ type: 'segment' } as Artifact),
      })
    ).toBe(false)
  })

  it('requires bodyType for loft and revolve segment profiles', () => {
    for (const commandName of ['Loft', 'Revolve'] as const) {
      expect(
        bodyTypeRequiredForCommand(commandName, {
          sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        })
      ).toBe(true)
    }
  })

  it('keeps bodyType optional for closed profiles and regions', () => {
    for (const artifact of [
      { type: 'solid2d' },
      { type: 'path', subType: 'region' },
    ] as Artifact[]) {
      expect(
        profileSelectionRequiresBodyType({
          argumentsToSubmit: {
            sketches: selectionsForArtifact(artifact),
          },
        })
      ).toBe(false)
    }
  })
})
