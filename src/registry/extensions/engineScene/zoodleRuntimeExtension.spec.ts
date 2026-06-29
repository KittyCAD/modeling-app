import { Registry } from '@kittycad/registry'
import {
  engineSceneRuntimeExtensionsSlot,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
  mergeEngineSceneClassNames,
} from '@src/registry/contracts/engineScene'
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
      'absolute inset-4 z-20 overflow-hidden rounded-lg !bg-ml-green ring-4 ring-ml-green transition-all duration-300 ease-out'
    )
  })
})
