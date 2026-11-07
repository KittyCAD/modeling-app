import {
  matchesEditor,
  type EditorMatcher,
  type EditorMatchContext,
} from '@src/lib/editors/matching'
import type {
  ExecutorCapability,
  ExecutorViewContribution,
} from '@src/lib/executors/registry/contract'

function matchingViews(
  matches: (matcher: EditorMatcher) => boolean,
  capabilities: readonly ExecutorCapability[],
  views: readonly ExecutorViewContribution[]
): readonly ExecutorViewContribution[] {
  return views
    .filter(
      (view) =>
        matches(view.matches) &&
        capabilities.some(
          (capability) =>
            capability.id === view.capabilityId && matches(capability.matches)
        )
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}

/** A view is available when both it and its backing capability match the source. */
export function viewsForSource(
  context: EditorMatchContext,
  capabilities: readonly ExecutorCapability[],
  views: readonly ExecutorViewContribution[]
) {
  return matchingViews(
    (matcher) => matchesEditor(matcher, context),
    capabilities,
    views
  )
}

/** Unread files remain candidates for predicates until their contents can be checked. */
export function candidateViewsForSource(
  src: string,
  capabilities: readonly ExecutorCapability[],
  views: readonly ExecutorViewContribution[]
) {
  return matchingViews(
    (matcher) =>
      typeof matcher === 'function' ||
      matchesEditor(matcher, { src, contents: '' }),
    capabilities,
    views
  )
}
