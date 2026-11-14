import { Registry } from '@kittycad/registry'
import { ViewportAnnotationOverlay } from '@src/components/ViewportAnnotationOverlay'
import { zoodleService } from '@src/registry/contracts/zoodle'
import { createZoodleRuntimeExtension } from '@src/registry/extensions/engineScene/zoodleRuntimeExtension'
import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

it('keeps a contrasting cursor matched to the pen and eraser sizes', () => {
  const session = {
    imageDataUrl: 'data:image/png;base64,aGVsbG8=',
    onCancel: vi.fn(),
    onSend: vi.fn(),
  }
  const registry = new Registry()
  registry.configure([createZoodleRuntimeExtension(session)])
  const zoodle = registry.get(zoodleService)
  const { unmount } = render(
    <ViewportAnnotationOverlay {...session} zoodle={zoodle} />
  )
  const canvas = screen.getByTestId('viewport-annotation-canvas')
  const cursorImage = () => {
    const match = canvas.style.cursor.match(
      /url\("data:image\/svg\+xml,([^"]+)"\)/
    )
    if (!match) throw new Error('Expected a custom brush cursor')
    return new DOMParser().parseFromString(
      decodeURIComponent(match[1]),
      'image/svg+xml'
    )
  }

  try {
    expect(cursorImage().querySelector('circle')?.getAttribute('r')).toBe('1')
    expect(cursorImage().querySelector('[stroke="black"]')).not.toBeNull()
    expect(cursorImage().querySelector('[stroke="white"]')).not.toBeNull()

    act(() => zoodle.setBrushSize(12))
    expect(cursorImage().querySelector('circle')?.getAttribute('r')).toBe('6')

    act(() => zoodle.equipTool('erase'))
    expect(cursorImage().querySelector('circle')?.getAttribute('r')).toBe('24')
    expect(canvas.style.cursor).toContain('26 26, crosshair')

    act(() => zoodle.setBrushSize(1))
    expect(cursorImage().querySelector('circle')?.getAttribute('r')).toBe('2')
  } finally {
    unmount()
    registry[Symbol.dispose]()
  }
})
