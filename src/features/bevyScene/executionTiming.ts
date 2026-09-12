import type { ModelingEngineKind } from '@src/features/bevyScene/settings'

/**
 * Quiet period before Bevy submits a changed project.
 *
 * Zoo retains the original conservative delay. Kclean has a local latest-wins
 * session that can cheaply supersede stale work, so it should react at roughly
 * interactive typing latency instead of making every settled edit wait half a
 * second before solving even begins.
 */
export function projectPushDebounceMs(engine: ModelingEngineKind): number {
  return engine === 'kclean' ? 100 : 500
}
