import { appendValueSpec, defineContract } from '@kittycad/registry'

/**
 * What the streamed engine needs that a renderer in general does not.
 *
 * The scene surface and its camera live in `scene.ts`, because a local renderer
 * has both. This file is only for the parts that exist because the scene is
 * rendered somewhere else and arrives as video.
 */

export const engineSceneContract = defineContract({
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

export const { streamParamsValueSpec } = engineSceneContract
