import { KclScene } from '@src/lib/kcl/modeling/KclScene'
import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  createModelingInteractions,
  type ModelingInteractionSession,
} from '@src/lib/kcl/interactions'
import { streamedSketchPresentation } from '@src/lib/kcl/sketch/streamPresentation'
import { modelingTestContext } from '@src/lib/kcl/modeling/testContext'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'
import { Themes } from '@src/lib/theme'
import type { ModelingInteractionViewDefinition } from '@src/lib/kcl/interactionViews'

vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUSceneView', () => ({
  LocalWebGPUSceneView: () => null,
}))

function fixture(presentation: ScenePresentation = 'streamed') {
  const view = modelingTestContext()
  Object.assign(view.resource, { presentation })
  view.context.settings.current.peek().app.theme.user = Themes.Light
  const ready = signal(false)
  const session: ModelingInteractionSession = {
    id: 'kcl.sketch',
    viewActive: ready,
    toolbar: signal([]),
    prompt: signal('Pick a plane'),
    defaultPlanes: signal({ xy: true, xz: true, yz: true }),
    error: signal(undefined),
    escape: async () => {},
    dispose: vi.fn(async () => {}),
  }
  const definitions = signal<readonly ModelingInteractionViewDefinition[]>([
    streamedSketchPresentation,
  ])
  const host = createModelingInteractions(
    () => view.context,
    signal([
      {
        id: 'kcl.sketch',
        entries: [
          {
            id: 'start',
            name: 'Start Sketch',
            icon: 'sketch',
            createSession: async () => session,
          },
        ],
      },
    ]),
    definitions
  )
  view.context.interactions.dispose()
  Object.assign(view.context, { interactions: host })
  return {
    view,
    ready,
    host,
    definitions,
    dispose: () => {
      host.dispose()
      view.resource.element.remove()
      view.dispose()
    },
  }
}

it.each(['local', 'streamed'] as const)(
  'registers sketch background presentation only for an editing streamed session (%s)',
  async (presentation) => {
    const f = fixture(presentation)
    try {
      render(<KclScene context={f.view.context} />)
      await act(() => f.host.enter('start'))
      expect(
        screen.queryByRole('slider', { name: 'Sketch background opacity' })
      ).not.toBeInTheDocument()
      act(() => {
        f.ready.value = true
      })
      if (presentation === 'local') {
        expect(f.host.views.peek()).toEqual([])
        expect(
          screen.queryByTestId('sketch-stream-dimming')
        ).not.toBeInTheDocument()
        return
      }
      const slider = screen.getByRole('slider', {
        name: 'Sketch background opacity',
      })
      expect(slider).toHaveValue('20')
      const tint = screen.getByTestId('sketch-stream-dimming')
      expect(tint.parentElement).toBe(f.view.resource.element)
      expect(tint).toHaveStyle({
        opacity: '0.8',
        backgroundColor: 'rgb(250, 250, 250)',
      })
      fireEvent.change(slider, { target: { value: '65' } })
      expect(tint).toHaveStyle({ opacity: '0.35' })
      act(() => {
        f.view.context.settings.current.peek().app.theme.user = Themes.Dark
      })
      expect(tint).toHaveStyle({ backgroundColor: 'rgb(30, 30, 30)' })
      act(() => {
        f.ready.value = false
      })
      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('sketch-stream-dimming')
      ).not.toBeInTheDocument()
    } finally {
      f.dispose()
    }
  }
)

it('retains each session adjustment across React remounts and other extension registrations', async () => {
  const first = fixture(),
    second = fixture()
  try {
    await first.host.enter('start')
    await second.host.enter('start')
    first.ready.value = second.ready.value = true
    const mounted = render(
      <>
        <KclScene context={first.view.context} />
        <KclScene context={second.view.context} />
      </>
    )
    const sliders = screen.getAllByRole('slider')
    fireEvent.change(sliders[0], { target: { value: '70' } })
    expect(sliders[1]).toHaveValue('20')
    mounted.unmount()
    const dispose = vi.fn()
    act(() => {
      first.definitions.value = [
        ...first.definitions.peek(),
        {
          id: 'extra',
          matches: () => true,
          create: () => ({ Component: () => <span>Extra</span>, dispose }),
        },
      ]
    })
    render(
      <>
        <KclScene context={first.view.context} />
        <KclScene context={second.view.context} />
      </>
    )
    expect(screen.getAllByRole('slider')[0]).toHaveValue('70')
    act(() => {
      first.definitions.value = []
    })
    expect(dispose).toHaveBeenCalledOnce()
    expect(screen.queryByText('Extra')).not.toBeInTheDocument()
    expect(screen.getAllByRole('slider')).toHaveLength(1)
    expect(screen.getByRole('slider')).toHaveValue('20')
    await act(() => second.host.close())
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('sketch-stream-dimming')
    ).not.toBeInTheDocument()
  } finally {
    first.dispose()
    second.dispose()
  }
})
