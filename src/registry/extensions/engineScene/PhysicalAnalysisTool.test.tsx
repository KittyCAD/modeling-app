import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useModelingContext = vi.hoisted(() => vi.fn())

vi.mock('@src/hooks/useModelingContext', () => ({ useModelingContext }))

// CopyTextButton reaches for the clipboard API, which happy-dom does not
// provide; the wrapper is irrelevant to the engine wiring under test.
vi.mock('@kittycad/ui-components', () => ({
  CopyTextButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Draggable: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

import { PhysicalAnalysisTool } from './PhysicalAnalysisTool'
import { physicalAnalysisService } from './physicalAnalysisService'

type SceneCommand = { cmd: Record<string, unknown> }

function modelingResponse(type: string, data: unknown) {
  return {
    resp: { type: 'modeling', data: { modeling_response: { type, data } } },
  }
}

function setupModelingContext(defaultLengthUnit: string | undefined) {
  const sentCommands: Array<Record<string, unknown>> = []
  const sendSceneCommand = vi.fn((request: SceneCommand) => {
    const cmd = request.cmd
    sentCommands.push(cmd)
    switch (cmd.type) {
      case 'volume':
        return Promise.resolve(modelingResponse('volume', { volume: 1000 }))
      case 'surface_area':
        return Promise.resolve(
          modelingResponse('surface_area', { surface_area: 600 })
        )
      case 'center_of_mass':
        return Promise.resolve(
          modelingResponse('center_of_mass', {
            center_of_mass: { x: 1, y: 2, z: 3 },
          })
        )
      case 'mass':
        return Promise.resolve(modelingResponse('mass', { mass: 7.85 }))
      default:
        return Promise.resolve(null)
    }
  })

  useModelingContext.mockReturnValue({
    state: {
      matches: (value: string) => value === 'idle',
      context: {
        engineCommandManager: { sendSceneCommand },
        kclManager: {
          fileSettings: { defaultLengthUnit },
          isExecutingSignal: { value: false },
        },
        store: {},
      },
    },
  })

  return { sentCommands, sendSceneCommand }
}

function setupDeferredModelingContext(defaultLengthUnit: string) {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const sendSceneCommand = vi.fn((request: SceneCommand) => {
    const cmd = request.cmd
    return gate.then(() => {
      switch (cmd.type) {
        case 'volume':
          return modelingResponse('volume', { volume: 1000 })
        case 'surface_area':
          return modelingResponse('surface_area', { surface_area: 600 })
        case 'center_of_mass':
          return modelingResponse('center_of_mass', {
            center_of_mass: { x: 1, y: 2, z: 3 },
          })
        default:
          return modelingResponse('mass', { mass: 7.85 })
      }
    })
  })

  useModelingContext.mockReturnValue({
    state: {
      matches: (value: string) => value === 'idle',
      context: {
        engineCommandManager: { sendSceneCommand },
        kclManager: {
          fileSettings: { defaultLengthUnit },
          isExecutingSignal: { value: false },
        },
        store: {},
      },
    },
  })

  return { release: () => release?.() }
}

describe('PhysicalAnalysisTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.localStorage.clear()
    physicalAnalysisService.reloadPreferences()
  })

  it('seeds the unit dropdowns from the file length unit', async () => {
    setupModelingContext('in')
    render(<PhysicalAnalysisTool />)

    expect(screen.getByTestId('physical-analysis-length-unit')).toHaveValue(
      'in'
    )
    expect(screen.getByTestId('physical-analysis-area-unit')).toHaveValue('in2')
    expect(screen.getByTestId('physical-analysis-volume-unit')).toHaveValue(
      'in3'
    )
    // Imperial length units seed the imperial mass and density units too.
    expect(screen.getByTestId('physical-analysis-mass-unit')).toHaveValue('lb')
    expect(screen.getByTestId('physical-analysis-density-unit')).toHaveValue(
      'lb:ft3'
    )
    expect(screen.getByTestId('physical-analysis-density')).toHaveValue(490)
  })

  it('analyzes the whole scene and renders every quantity', async () => {
    const { sentCommands } = setupModelingContext('mm')
    render(<PhysicalAnalysisTool />)

    await waitFor(() => {
      expect(sentCommands).toHaveLength(4)
    })

    // An empty entity_ids array is what tells the engine to use the whole
    // default scene rather than the current selection.
    for (const cmd of sentCommands) {
      expect(cmd.entity_ids).toEqual([])
    }

    expect(sentCommands).toEqual(
      expect.arrayContaining([
        { type: 'volume', entity_ids: [], output_unit: 'mm3' },
        { type: 'surface_area', entity_ids: [], output_unit: 'mm2' },
        { type: 'center_of_mass', entity_ids: [], output_unit: 'mm' },
        {
          type: 'mass',
          entity_ids: [],
          output_unit: 'g',
          material_density: 7850,
          material_density_unit: 'kg:m3',
        },
      ])
    )

    // Assert on the rendered values; the quantity names also appear as
    // dropdown labels, so they are not unique queries.
    await waitFor(() => {
      expect(screen.getByText('1,000')).toBeInTheDocument()
    })
    expect(screen.getByText('600')).toBeInTheDocument()
    expect(screen.getByText('7.85')).toBeInTheDocument()
    expect(screen.getByText('1, 2, 3')).toBeInTheDocument()

    // Units render as superscripts, not as a trailing ASCII 2 or 3.
    // Once in the unit dropdown, once against the result value.
    expect(screen.getAllByText('mm\u00b3')).toHaveLength(2)
    expect(screen.getAllByText('mm\u00b2')).toHaveLength(2)
    expect(screen.queryByText('mm3')).not.toBeInTheDocument()
    expect(screen.queryByText('mm2')).not.toBeInTheDocument()
  })

  it('uses persisted units in preference to the file length unit', async () => {
    physicalAnalysisService.setPreference('volumeUnit', 'l')
    physicalAnalysisService.setPreference('massUnit', 'kg')
    const { sentCommands } = setupModelingContext('mm')

    render(<PhysicalAnalysisTool />)

    await waitFor(() => {
      expect(sentCommands).toHaveLength(4)
    })

    expect(sentCommands).toEqual(
      expect.arrayContaining([
        { type: 'volume', entity_ids: [], output_unit: 'l' },
        // Untouched dropdowns still follow the file's unit.
        { type: 'surface_area', entity_ids: [], output_unit: 'mm2' },
      ])
    )
    expect(screen.getByTestId('physical-analysis-mass-unit')).toHaveValue('kg')
    expect(screen.getByTestId('physical-analysis-area-unit')).toHaveValue('mm2')
  })

  it('clears stale values and shows analyzing when a unit changes', async () => {
    const first = setupDeferredModelingContext('mm')
    render(<PhysicalAnalysisTool />)

    expect(screen.getByText('Analyzing...')).toBeInTheDocument()
    first.release()
    await waitFor(() => {
      expect(screen.getByText('1,000')).toBeInTheDocument()
    })
    expect(screen.queryByText('Analyzing...')).not.toBeInTheDocument()

    // Swap the volume unit; the old numbers no longer match the controls.
    const second = setupDeferredModelingContext('mm')
    fireEvent.change(screen.getByTestId('physical-analysis-volume-unit'), {
      target: { value: 'l' },
    })

    await waitFor(() => {
      expect(screen.getByText('Analyzing...')).toBeInTheDocument()
    })
    expect(screen.queryByText('1,000')).not.toBeInTheDocument()

    second.release()
    await waitFor(() => {
      expect(screen.getByText('1,000')).toBeInTheDocument()
    })
  })

  it('surfaces an engine error instead of results', async () => {
    setupModelingContext('mm')
    const { state } = useModelingContext()
    state.context.engineCommandManager.sendSceneCommand = vi.fn(() =>
      Promise.resolve([{ errors: [{ message: 'No solids in the scene' }] }])
    )

    render(<PhysicalAnalysisTool />)

    await waitFor(() => {
      expect(screen.getByText('No solids in the scene')).toBeInTheDocument()
    })
    expect(screen.queryByText('1,000')).not.toBeInTheDocument()
    expect(screen.queryByText('7.85')).not.toBeInTheDocument()
  })
})
