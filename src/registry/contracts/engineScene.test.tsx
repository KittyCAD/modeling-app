import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  EngineSceneViewExtensionOverlay,
  EngineSceneZones,
  engineSceneViewExtensionZones,
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

it('renders all six zones with independent caller contexts', () => {
  interface Context {
    name: string
    select: (name: string) => void
  }
  const selectFirst = vi.fn()
  const selectSecond = vi.fn()
  const extensions = engineSceneViewExtensionZones.map<
    EngineSceneViewExtension<Context>
  >((zone) => ({
    id: zone,
    zone,
    Component: ({ name, select }) => (
      <button onClick={() => select(name)}>
        {name} {zone}
      </button>
    ),
  }))
  const view = render(
    <>
      <EngineSceneZones
        extensions={extensions}
        context={{ name: 'First', select: selectFirst }}
      />
      <EngineSceneZones
        extensions={extensions}
        context={{ name: 'Second', select: selectSecond }}
      />
    </>
  )
  for (const zone of engineSceneViewExtensionZones) {
    expect(
      view.container.querySelectorAll(
        `[data-engine-scene-view-extension-zone="${zone}"]`
      )
    ).toHaveLength(2)
  }
  fireEvent.click(view.getByRole('button', { name: 'First top' }))
  expect(selectFirst).toHaveBeenCalledExactlyOnceWith('First')
  expect(selectSecond).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Second bottom' }))
  expect(selectSecond).toHaveBeenCalledExactlyOnceWith('Second')
})
