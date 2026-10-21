import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { signal } from '@preact/signals-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useModelingContext = vi.hoisted(() => vi.fn())

vi.mock('@src/hooks/useModelingContext', () => ({ useModelingContext }))

// CopyTextButton reaches for the clipboard API, which happy-dom does not
// provide; the wrapper is irrelevant to the engine wiring under test.
vi.mock('@kittycad/ui-components', () => ({
  CopyTextButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Draggable: ({
    children,
    style,
    'data-testid': testId,
  }: {
    children: React.ReactNode
    style?: React.CSSProperties
    'data-testid'?: string
  }) => (
    <div style={style} data-testid={testId}>
      {children}
    </div>
  ),
}))

import { measurementToolService } from '../measurementToolService'
import { activeViewSignal } from '@src/lib/kclNamedViewActivation'
import {
  PhysicalAnalysisDraggablePanel,
  PhysicalAnalysisTool,
} from './PhysicalAnalysisTool'
import { physicalAnalysisService } from './physicalAnalysisService'

type SceneCommand = { cmd: Record<string, unknown> }

function modelingResponse(type: string, data: unknown) {
  return {
    resp: { type: 'modeling', data: { modeling_response: { type, data } } },
  }
}

function setupModelingContext(defaultLengthUnit: string | undefined) {
  const sentCommands: Record<string, unknown>[] = []
  const sendSceneCommand = vi.fn(
    (
      request: SceneCommand
    ): Promise<ReturnType<typeof modelingResponse> | null> => {
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
    }
  )

  const path = signal('/project/main.kcl')
  const project = signal({ path: '/project' })
  const kclManager = {
    fileSettings: { defaultLengthUnit },
    isExecutingSignal: signal(false),
    engineSceneGenerationSignal: signal(1),
    systemDeps: { project },
    get path() {
      return path.value
    },
  }
  const engineCommandManager = {
    sendSceneCommand,
    connection: { id: 'first-session' },
  }
  const state = {
    matches: (value: string) => value === 'idle',
    context: {
      engineCommandManager,
      kclManager,
      store: {},
    },
  }
  useModelingContext.mockReturnValue({ state })

  return {
    sentCommands,
    sendSceneCommand,
    engineCommandManager,
    kclManager,
    path,
    project,
    state,
  }
}

function setupDeferredModelingContext(defaultLengthUnit: string) {
  const fixture = setupModelingContext(defaultLengthUnit)
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const send = fixture.sendSceneCommand.getMockImplementation()
  if (!send) expect.fail('The engine fixture must provide responses')
  fixture.sendSceneCommand.mockImplementation((request) =>
    gate.then(() => send(request))
  )

  return { ...fixture, release: () => release?.() }
}

describe('physical analysis tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.localStorage.clear()
    physicalAnalysisService.reloadPreferences()
    physicalAnalysisService.close()
    measurementToolService.close()
    activeViewSignal.value = null
  })

  it('updates uniform-density mass from the measured model without repeating kernel queries', async () => {
    const { sendSceneCommand } = setupModelingContext('mm')
    render(<PhysicalAnalysisTool />)
    await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
    expect(sendSceneCommand).toHaveBeenCalledTimes(4)

    const density = screen.getByTestId('physical-analysis-density')
    for (const [value, mass] of [
      ['1000', '1'],
      ['2000', '2'],
      ['1250', '1.25'],
    ]) {
      fireEvent.change(density, { target: { value } })
      await waitFor(() =>
        expect(screen.queryByText('Analyzing...')).not.toBeInTheDocument()
      )
      expect(sendSceneCommand).toHaveBeenCalledTimes(4)
      expect(screen.getByText(mass)).toBeInTheDocument()
      expect(screen.getByText('1,000')).toBeInTheDocument()
      expect(screen.getByText('600')).toBeInTheDocument()
      expect(screen.getByText('1, 2, 3')).toBeInTheDocument()
    }
  })

  it.each([
    {
      name: 'model/import execution generation',
      change: (fixture: ReturnType<typeof setupModelingContext>) => {
        fixture.kclManager.engineSceneGenerationSignal.value += 1
      },
    },
    {
      name: 'file',
      change: (fixture: ReturnType<typeof setupModelingContext>) => {
        fixture.path.value = '/project/other.kcl'
      },
    },
    {
      name: 'project',
      change: (fixture: ReturnType<typeof setupModelingContext>) => {
        fixture.project.value = { path: '/other-project' }
      },
    },
    {
      name: 'engine connection',
      change: (fixture: ReturnType<typeof setupModelingContext>) => {
        fixture.engineCommandManager.connection = { id: 'replacement-session' }
      },
    },
    {
      name: 'editor',
      change: (fixture: ReturnType<typeof setupModelingContext>) => {
        fixture.state.context.kclManager = { ...fixture.kclManager }
      },
    },
    {
      name: 'completed named-view visibility',
      change: () => {
        activeViewSignal.value = { name: 'Other body', moduleKey: 'Main' }
      },
    },
  ])(
    'remeasures after a $name change before reusing density results',
    async ({ change }) => {
      const fixture = setupModelingContext('mm')
      const { rerender } = render(<PhysicalAnalysisTool />)
      await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
      act(() => change(fixture))
      rerender(<PhysicalAnalysisTool />)
      await waitFor(() =>
        expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(8)
      )
      await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())

      fireEvent.change(screen.getByTestId('physical-analysis-density'), {
        target: { value: '1000' },
      })
      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
      expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(8)
    }
  )

  it('drops measurements while executing even before the scene generation advances', async () => {
    const fixture = setupModelingContext('mm')
    render(<PhysicalAnalysisTool />)
    await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
    act(() => {
      fixture.kclManager.isExecutingSignal.value = true
    })
    expect(screen.queryByText('7.85')).not.toBeInTheDocument()
    expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(4)
    act(() => {
      fixture.kclManager.isExecutingSignal.value = false
    })
    await waitFor(() =>
      expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(8)
    )
    await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
  })

  it('remeasures rather than scaling measurements expressed in different units', async () => {
    const { sendSceneCommand } = setupModelingContext('mm')
    render(<PhysicalAnalysisTool />)
    await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('physical-analysis-volume-unit'), {
      target: { value: 'l' },
    })
    await waitFor(() => expect(sendSceneCommand).toHaveBeenCalledTimes(8))
    expect(sendSceneCommand.mock.calls[4][0].cmd).toMatchObject({
      type: 'volume',
      output_unit: 'l',
    })
    await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('physical-analysis-density-unit'), {
      target: { value: 'lb:ft3' },
    })
    await waitFor(() => expect(sendSceneCommand).toHaveBeenCalledTimes(12))
    expect(sendSceneCommand.mock.calls[11][0].cmd).toMatchObject({
      type: 'mass',
      material_density_unit: 'lb:ft3',
    })
  })

  it('discards old-session replies and drains them before measuring the replacement', async () => {
    const fixture = setupDeferredModelingContext('mm')
    const { rerender } = render(<PhysicalAnalysisTool />)
    await waitFor(() =>
      expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(4)
    )
    const send = fixture.sendSceneCommand.getMockImplementation()
    if (!send) expect.fail('The engine fixture must provide responses')
    const current = Promise.withResolvers<undefined>()
    fixture.sendSceneCommand.mockImplementation((request) =>
      current.promise.then(() => send(request))
    )
    fixture.engineCommandManager.connection = { id: 'replacement-session' }
    rerender(<PhysicalAnalysisTool />)
    expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(4)
    await act(async () => fixture.release())
    await waitFor(() =>
      expect(fixture.sendSceneCommand).toHaveBeenCalledTimes(8)
    )
    expect(screen.queryByText('1,000')).not.toBeInTheDocument()
    expect(screen.getByText('Analyzing...')).toBeInTheDocument()
    await act(async () => current.resolve(undefined))
    await waitFor(() => expect(screen.getByText('7.85')).toBeInTheDocument())
  })

  it('applies density immediately, serializes requests, and publishes only the latest result', async () => {
    const consoleError = vi.spyOn(console, 'error')
    const { sendSceneCommand } = setupModelingContext('mm')
    const send = sendSceneCommand.getMockImplementation()
    if (!send) expect.fail('The engine fixture must provide responses')
    const pending: Array<{
      density: unknown
      resolve: (response: ReturnType<typeof modelingResponse>) => void
    }> = []
    sendSceneCommand.mockImplementation((request) => {
      if (request.cmd.type !== 'mass') return send(request)
      return new Promise<ReturnType<typeof modelingResponse>>((resolve) => {
        pending.push({ density: request.cmd.material_density, resolve })
      })
    })
    render(<PhysicalAnalysisTool />)
    await waitFor(() => expect(pending).toHaveLength(1))

    const density = screen.getByTestId('physical-analysis-density')
    fireEvent.change(density, { target: { value: '7' } })
    expect(physicalAnalysisService.preferences.peek().materialDensity).toBe(7)
    fireEvent.change(density, { target: { value: '8' } })
    expect(physicalAnalysisService.preferences.peek().materialDensity).toBe(8)
    expect(pending).toHaveLength(1)

    await act(async () => {
      pending[0].resolve(modelingResponse('mass', { mass: 7.85 }))
    })
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[1].density).toBe(8)
    expect(screen.queryByText('7.85')).not.toBeInTheDocument()
    expect(screen.getByText('Analyzing...')).toBeInTheDocument()

    await act(async () => {
      pending[1].resolve(modelingResponse('mass', { mass: 8 }))
    })
    await waitFor(() =>
      expect(screen.queryByText('Analyzing...')).not.toBeInTheDocument()
    )
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(pending).toHaveLength(2)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('drains sibling engine queries after a rejection before starting the latest density', async () => {
    const { sendSceneCommand } = setupModelingContext('mm')
    const send = sendSceneCommand.getMockImplementation()
    if (!send) expect.fail('The engine fixture must provide responses')
    let firstVolume = true
    let firstMass = true
    let release: (response: ReturnType<typeof modelingResponse>) => void =
      () => {}
    const mass = new Promise<ReturnType<typeof modelingResponse>>((resolve) => {
      release = resolve
    })
    sendSceneCommand.mockImplementation((request) => {
      if (request.cmd.type === 'volume' && firstVolume) {
        firstVolume = false
        return Promise.reject<ReturnType<typeof modelingResponse>>(
          new Error('Rejected volume query')
        )
      }
      if (request.cmd.type === 'mass' && firstMass) {
        firstMass = false
        return mass
      }
      return send(request)
    })
    render(<PhysicalAnalysisTool />)
    await waitFor(() => expect(sendSceneCommand).toHaveBeenCalledTimes(4))
    fireEvent.change(screen.getByTestId('physical-analysis-density'), {
      target: { value: '8' },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(sendSceneCommand).toHaveBeenCalledTimes(4)
    await act(async () => {
      release(modelingResponse('mass', { mass: 7.85 }))
    })
    await waitFor(() => expect(sendSceneCommand).toHaveBeenCalledTimes(8))
    expect(sendSceneCommand.mock.calls[7][0].cmd).toMatchObject({
      type: 'mass',
      material_density: 8,
    })
    await waitFor(() =>
      expect(screen.queryByText('Analyzing...')).not.toBeInTheDocument()
    )
    expect(screen.getByText('7.85')).toBeInTheDocument()
    expect(screen.queryByText('Rejected volume query')).not.toBeInTheDocument()
  })

  it('does not start queued analysis after the panel unmounts', async () => {
    const { release, sendSceneCommand } = setupDeferredModelingContext('mm')
    const { unmount } = render(<PhysicalAnalysisTool />)
    await waitFor(() => expect(sendSceneCommand).toHaveBeenCalledTimes(4))
    fireEvent.change(screen.getByTestId('physical-analysis-density'), {
      target: { value: '8' },
    })
    unmount()
    await act(async () => release())
    expect(sendSceneCommand).toHaveBeenCalledTimes(4)
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

  it('only offsets the panel when the measurement panel is open', () => {
    setupModelingContext('mm')
    physicalAnalysisService.open()
    const containerRef = { current: document.createElement('div') }
    const { rerender } = render(
      <PhysicalAnalysisDraggablePanel containerRef={containerRef} top={8} />
    )

    expect(screen.getByTestId('physical-analysis-draggable-panel')).toHaveStyle(
      { left: '8px' }
    )

    measurementToolService.open()
    rerender(
      <PhysicalAnalysisDraggablePanel containerRef={containerRef} top={8} />
    )

    expect(screen.getByTestId('physical-analysis-draggable-panel')).toHaveStyle(
      { left: '344px' }
    )
  })
})
