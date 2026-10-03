import {
  Registry,
  Slot,
  createPlugin,
  defineRegistryItem,
  pluginsValueSpec,
} from '@kittycad/registry'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  mountClientScene: vi.fn(),
  unmountClientScene: vi.fn(),
  mountCustomScene: vi.fn(),
  unmountCustomScene: vi.fn(),
}))

vi.mock('@src/lib/boot', () => ({ useApp: mocks.useApp }))
vi.mock('@src/clientSideScene/ClientSideSceneComp', () => ({
  ClientSideScene: ({
    sketchSolveStreamDimming,
  }: {
    sketchSolveStreamDimming: number
  }) => {
    useEffect(() => {
      mocks.mountClientScene()
      return mocks.unmountClientScene
    }, [])
    return <div>Engine interaction scene: {sketchSolveStreamDimming}</div>
  },
}))

import { ModeScene } from '@src/components/ModeScene'
import type { EngineSceneExtensionContext } from '@src/registry/contracts/engineScene'
import { modesService, provideMode } from '@src/registry/contracts/modes'
import modesRegistryItem from '@src/registry/extensions/modes'

// Scene routing only forwards machine state; these scenes never read it.
const context: EngineSceneExtensionContext = {
  modelingState: null!,
  modelingSend: vi.fn(),
  sketchSolveStreamDimming: 0.3,
  setSketchSolveStreamDimming: vi.fn(),
}

function CustomScene({
  sketchSolveStreamDimming,
}: EngineSceneExtensionContext) {
  useEffect(() => {
    mocks.mountCustomScene()
    return mocks.unmountCustomScene
  }, [])
  return <div>Custom review scene: {sketchSolveStreamDimming}</div>
}

describe('ModeScene', () => {
  let registry: Registry
  let pluginSlot: Slot

  beforeEach(() => {
    registry = new Registry()
    pluginSlot = new Slot()
    registry.configure([modesRegistryItem, pluginSlot.of()])
    mocks.useApp.mockReturnValue({
      registry,
      settings: {
        useSettings: () => ({
          modeling: {
            mouseControls: { current: 'Zoo' },
            enableTouchControls: { current: true },
          },
        }),
      },
    })
  })

  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
    vi.clearAllMocks()
  })

  async function installReviewMode(Scene?: typeof CustomScene) {
    await act(async () => {
      await registry.reconfigureAsync(pluginSlot, [
        createPlugin({
          id: 'review-plugin',
          title: 'Review',
          description: 'Review the current model.',
          items: [
            defineRegistryItem({
              provides: [
                provideMode({
                  id: 'review',
                  label: 'Review',
                  toolbar: [],
                  Scene,
                }),
              ],
            }),
          ],
        }),
      ])
    })
  }

  async function renderScene() {
    const result = render(<ModeScene {...context} />)
    await screen.findByText('Engine interaction scene: 0.3')
    return result
  }

  it('keeps the same client scene mounted across toolbar-only and built-in sketch modes', async () => {
    await installReviewMode()
    await renderScene()
    const modes = registry.get(modesService)

    act(() => {
      modes.setMode('review')
    })
    act(() => modes.syncModelingMode('onlyCancel'))
    act(() => modes.syncModelingMode('sketching'))
    act(() => modes.syncModelingMode('sketchSolve'))
    act(() => modes.syncModelingMode('modeling'))
    act(() => {
      modes.setMode('modeling')
    })

    expect(
      screen.getByText('Engine interaction scene: 0.3')
    ).toBeInTheDocument()
    expect(mocks.mountClientScene).toHaveBeenCalledTimes(1)
    expect(mocks.unmountClientScene).not.toHaveBeenCalled()
  })

  it('mounts a plugin scene with viewport context and returns to the engine client scene on exit', async () => {
    await installReviewMode(CustomScene)
    await renderScene()
    const modes = registry.get(modesService)

    act(() => {
      modes.setMode('review')
    })

    expect(screen.getByText('Custom review scene: 0.3')).toBeInTheDocument()
    expect(screen.queryByText('Engine interaction scene: 0.3')).toBeNull()
    expect(mocks.mountCustomScene).toHaveBeenCalledTimes(1)
    expect(mocks.unmountClientScene).toHaveBeenCalledTimes(1)

    act(() => {
      modes.setMode('modeling')
    })

    expect(
      screen.getByText('Engine interaction scene: 0.3')
    ).toBeInTheDocument()
    expect(mocks.unmountCustomScene).toHaveBeenCalledTimes(1)
    expect(mocks.mountClientScene).toHaveBeenCalledTimes(2)
  })

  it('unmounts an active plugin scene when the plugin is disabled', async () => {
    await installReviewMode(CustomScene)
    await renderScene()
    act(() => {
      registry.get(modesService).setMode('review')
    })
    const [plugin] = registry.get(pluginsValueSpec)

    await act(async () => registry.get(plugin.service).disable())

    expect(
      screen.getByText('Engine interaction scene: 0.3')
    ).toBeInTheDocument()
    expect(mocks.unmountCustomScene).toHaveBeenCalledTimes(1)
    expect(registry.get(modesService).selectedModeId.value).toBe('modeling')
  })

  it('does not remount the inherited client scene when a toolbar-only plugin is disabled', async () => {
    await installReviewMode()
    await renderScene()
    act(() => {
      registry.get(modesService).setMode('review')
    })
    const [plugin] = registry.get(pluginsValueSpec)

    await act(async () => registry.get(plugin.service).disable())

    expect(mocks.mountClientScene).toHaveBeenCalledTimes(1)
    expect(mocks.unmountClientScene).not.toHaveBeenCalled()
  })
})
