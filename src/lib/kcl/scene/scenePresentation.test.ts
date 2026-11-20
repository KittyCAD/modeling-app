import { createSceneSelection } from '@src/lib/scene/selection'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { createScenePresentationPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import type {
  SceneConnection,
  ScenePresentation,
} from '@src/lib/kcl/scene/connection'
import {
  createSceneElement,
  createSceneViewport,
} from '@src/lib/kcl/scene/scenePresentation'
import {
  createTestKclRuntime,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Themes } from '@src/lib/theme'

function setup(presentation: ScenePresentation) {
  const settings = createTestSettings()
  settings.current.peek().modeling.mouseControls.user = 'Zoo'
  settings.current.peek().modeling.cameraOrbit.user = 'spherical'
  const manager = new ConnectionManager({ settingsActor: settings.actor })
  manager.streamDimensions = { width: 800, height: 600 }
  const send = vi.spyOn(manager, 'sendSceneCommand').mockResolvedValue(null)
  const preferences = createScenePresentationPreferences(
    () => settings.current.value
  )
  const infra = new SceneInfra(manager, new Promise<ModuleType>(() => {}), () =>
    settings.current.peek()
  )
  const element = createSceneElement()
  document.body.append(element)
  const canvas = infra.renderer.domElement
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  })
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600)
  )
  const connection: SceneConnection = {
    id: 'pointer-test',
    presentation,
    mediaStream: undefined,
    send: manager.sendSceneCommand.bind(manager),
    attachVideo: () => () => {},
    resize: async () => {},
    dispose: () => {},
  }
  const viewport = createSceneViewport(
    {
      element,
      connection,
      manager,
      sceneInfra: infra,
      selection: createSceneSelection(
        { pick: async () => undefined, present: async () => {} },
        []
      ),
      model: createTestKclRuntime(),
      settings,
    },
    presentation,
    preferences,
    () => false
  )
  if (viewport instanceof Error) throw viewport
  onTestFinished(() => {
    viewport.dispose()
    infra.camControls.dispose()
    preferences.dispose()
    element.remove()
    vi.restoreAllMocks()
  })
  return { viewport, canvas, camera: infra.camControls, send, settings }
}

function pointer(
  canvas: HTMLElement,
  type: string,
  x: number,
  y: number,
  buttons: number
) {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
      buttons,
      clientX: x,
      clientY: y,
    })
  )
}

it.each(['local', 'streamed'] as const)(
  'keeps the browser menu from interrupting a Zoo orbit in the %s viewport',
  async (presentation) => {
    const { viewport, canvas, camera, send } = setup(presentation)
    await viewport.applySettings()
    send.mockClear()
    const before = camera.camera.position.clone()
    const target = camera.target.clone()
    pointer(canvas, 'pointerdown', 400, 300, 2)
    const menu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
    })
    canvas.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    pointer(canvas, 'pointermove', 480, 350, 2)
    pointer(canvas, 'pointerup', 480, 350, 0)
    if (presentation === 'local') {
      expect(camera.camera.position.distanceTo(before)).toBeGreaterThan(1)
      expect(camera.camera.position.distanceTo(target)).toBeCloseTo(
        before.distanceTo(target)
      )
      expect(camera.target.equals(target)).toBe(true)
      expect(send).not.toHaveBeenCalled()
    } else {
      const commands = send.mock.calls.flatMap(([command]) =>
        command.type === 'modeling_cmd_req' ? [command.cmd] : []
      )
      expect(commands).toEqual([
        expect.objectContaining({
          type: 'camera_drag_start',
          interaction: 'rotate',
          window: { x: 400, y: 300 },
        }),
        expect.objectContaining({
          type: 'camera_drag_move',
          interaction: 'rotate',
          window: { x: 480, y: 350 },
        }),
        expect.objectContaining({
          type: 'camera_drag_end',
          interaction: 'rotate',
          window: { x: 480, y: 350 },
        }),
      ])
    }
    expect(camera.isDragging).toBe(false)
  }
)

it('resizes the Three.js canvas when pixel density changes and removes the listener on disposal', async () => {
  const changes = new EventTarget()
  const media = {
    matches: false,
    media: '',
    onchange: null,
    addEventListener: changes.addEventListener.bind(changes),
    removeEventListener: changes.removeEventListener.bind(changes),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: changes.dispatchEvent.bind(changes),
  } satisfies MediaQueryList
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  const { viewport, camera } = setup('local')
  const resized = vi.spyOn(camera, 'onWindowResize')
  changes.dispatchEvent(new Event('change'))
  expect(resized).toHaveBeenCalledOnce()
  viewport.dispose()
  changes.dispatchEvent(new Event('change'))
  expect(resized).toHaveBeenCalledOnce()
})

it.each([
  ['Mozilla/5.0 Version/18.0 Safari/605.1.15', true],
  ['Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36', false],
])('retains Safari video sizing for %s', (userAgent, safari) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(String(userAgent))
  const { viewport, canvas } = setup('streamed')
  const video = canvas.parentElement?.querySelector('video')
  expect(video?.className.includes('safariVideo')).toBe(safari)
  viewport.dispose()
})

it.each(['local', 'streamed'] as const)(
  'keeps %s camera input and projection intact when appearance changes',
  async (presentation) => {
    const { viewport, camera, settings } = setup(presentation)
    await viewport.applySettings()
    const touch = vi.spyOn(camera, 'initTouchControls')
    const projection = vi.spyOn(camera, 'setCameraProjection')
    const guards = camera.interactionGuards
    settings.current.peek().app.theme.user = Themes.Light
    settings.current.peek().modeling.viewportRendering.user = 'retrocad'
    await viewport.applySettings()
    expect(camera.interactionGuards).toBe(guards)
    expect(touch).not.toHaveBeenCalled()
    expect(projection).not.toHaveBeenCalled()
    settings.current.peek().modeling.enableTouchControls.user = false
    await viewport.applySettings()
    expect(touch).toHaveBeenCalledExactlyOnceWith(false)
    expect(projection).not.toHaveBeenCalled()
    await viewport.applySettings()
    expect(touch).toHaveBeenCalledOnce()
  }
)
