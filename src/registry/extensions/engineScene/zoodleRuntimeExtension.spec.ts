import { Registry } from '@kittycad/registry'
import {
  engineSceneRuntimeExtensionsSlot,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
  mergeEngineSceneClassNames,
} from '@src/registry/contracts/engineScene'
import { zoodleService } from '@src/registry/contracts/zoodle'
import { describe, expect, it, vi } from 'vitest'
import engineSceneExtension from '.'
import { activateZoodleRuntimeExtension } from './zoodleRuntimeExtension'

describe('zoodle runtime extension', () => {
  it('insets the engine stream while Zoodle is active', () => {
    const registry = new Registry()
    registry.configure([
      engineSceneExtension,
      engineSceneRuntimeExtensionsSlot.of(),
    ])

    activateZoodleRuntimeExtension(registry, {
      imageDataUrl: 'data:image/png;base64,aGVsbG8=',
      onCancel: vi.fn(),
      onSend: vi.fn(),
    })

    expect(registry.get(engineSceneStreamLayersValueSpec)).toHaveLength(1)
    expect(
      mergeEngineSceneClassNames(
        registry.get(engineSceneStreamClassNamesValueSpec)
      )
    ).toBe(
      'absolute inset-4 z-20 rounded-lg transition-all duration-150 ease-out before:content-[""] before:absolute before:-inset-4 before:bg-ml-green'
    )
  })

  it('provides a session-scoped Zoodle tool service', () => {
    const registry = new Registry()
    registry.configure([
      engineSceneExtension,
      engineSceneRuntimeExtensionsSlot.of(),
    ])

    activateZoodleRuntimeExtension(registry, {
      imageDataUrl: 'data:image/png;base64,aGVsbG8=',
      onCancel: vi.fn(),
      onSend: vi.fn(),
    })

    const zoodle = registry.get(zoodleService)

    expect(zoodle.activeToolKey.value).toBe('drawOrange')
    expect(zoodle.toolDefinitions.drawOrange).toMatchObject({
      type: 'draw',
      color: '#ff8800',
    })
    expect(zoodle.toolDefinitions.erase).toMatchObject({
      type: 'erase',
      lineWidthMultiplier: 4,
    })

    zoodle.equipTool('erase')

    expect(zoodle.activeToolKey.value).toBe('erase')
  })
})
