import { appendValueSpec, defineContract } from '@kittycad/registry'

/**
 * Something that reacts to input over the engine's video.
 *
 * The scene is rendered on the engine and streamed back, so the viewport is a
 * `<video>` element and every interaction with the model is a message to the
 * engine. That makes the element a shared surface: the camera wants drags and
 * the wheel, selection will want clicks, a measurement tool will want hovers.
 *
 * They are contributions rather than code inside the stream component so that
 * each one can be built, tested, and turned off on its own — and so the
 * component stays what it is, which is a video with a size.
 */
export interface SceneInteraction {
  id: string
  /** Lower attaches earlier, so an interaction can see events first. */
  order?: number
  /**
   * Bind to the element the stream is drawn on. Returns a disposer.
   *
   * Called again if the element is replaced, and disposed when the viewport
   * unmounts — an interaction must not assume it outlives the view.
   */
  attach: (element: HTMLElement) => (() => void) | void
}

export const engineSceneContract = defineContract({
  sceneInteractionsValueSpec: appendValueSpec<SceneInteraction>(
    'engineScene.interactions'
  ),
  /**
   * Query parameters for the stream URL.
   *
   * The engine builds its render pipeline when the socket opens, so ambient
   * occlusion and the scale grid cannot be changed by a command afterwards.
   * Contributing them keeps that knowledge with the preference rather than in
   * the connection, which has no business knowing what a preference is.
   *
   * A function, because it is called at connect time: a contribution evaluated
   * when the graph was built would carry whatever the preference was at startup.
   */
  streamParamsValueSpec: appendValueSpec<() => Record<string, string>>(
    'engineScene.streamParams'
  ),
})

export const { sceneInteractionsValueSpec, streamParamsValueSpec } =
  engineSceneContract
