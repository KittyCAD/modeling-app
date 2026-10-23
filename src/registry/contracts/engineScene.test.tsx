import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import {
  EngineSceneViewExtensionOverlay,
  type EngineSceneExtensionContext,
  type EngineSceneViewExtension,
} from '@src/registry/contracts/engineScene'

afterEach(cleanup)

it('removes inactive contributions and their empty zones when context changes', () => {
  const extensions: EngineSceneViewExtension[] = [
    { id: 'toolbar', zone: 'top', Component: () => <div>Toolbar</div> },
    {
      id: 'browser',
      zone: 'left',
      Component: () => <div>Browser</div>,
      shouldRegister: (context) => context.sketchSolveStreamDimming > 0,
    },
  ]
  const context = { sketchSolveStreamDimming: 1 } as EngineSceneExtensionContext
  const view = render(
    <EngineSceneViewExtensionOverlay {...context} extensions={extensions} />
  )
  expect(view.getByText('Browser')).toBeTruthy()

  view.rerender(
    <EngineSceneViewExtensionOverlay
      {...context}
      sketchSolveStreamDimming={0}
      extensions={extensions}
    />
  )
  expect(view.queryByText('Browser')).toBeNull()
  expect(
    view.container.querySelector(
      '[data-engine-scene-view-extension-zone="left"]'
    )
  ).toBeNull()
  expect(view.getByText('Toolbar')).toBeTruthy()

  view.rerender(
    <EngineSceneViewExtensionOverlay {...context} extensions={[]} />
  )
  expect(view.container.firstElementChild?.getAttribute('aria-hidden')).toBe(
    'true'
  )
})
