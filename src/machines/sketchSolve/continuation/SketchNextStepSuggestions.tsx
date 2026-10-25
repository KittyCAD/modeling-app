import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { reportRejection } from '@src/lib/trap'
import { suggestSketchContinuations } from '@src/machines/sketchSolve/continuation/sketchContinuationSuggestions'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { useSelector } from '@xstate/react'
import { useState } from 'react'
import type { ActorRefFrom } from 'xstate'

export function SketchNextStepSuggestions({
  actor,
  disabled,
}: {
  actor: ActorRefFrom<typeof sketchSolveMachine>
  disabled: boolean
}) {
  const sceneGraphDelta = useSelector(
    actor,
    (state) => state.context.sketchExecOutcome?.sceneGraphDelta
  )
  const canAdd = useSelector(
    actor,
    (state) =>
      state.matches('move and select') &&
      state.context.continuationPending !== true
  )
  const [dismissedFor, setDismissedFor] = useState<SceneGraphDelta | null>(null)
  if (!sceneGraphDelta) return null

  const snapshot = actor.getSnapshot()
  const ideas = suggestSketchContinuations(
    snapshot.context.sketchId,
    sceneGraphDelta.new_graph.objects,
    baseUnitToNumericSuffix(
      snapshot.context.kclManager.fileSettings.defaultLengthUnit
    )
  )
  if (ideas.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        className="px-2 py-1 rounded border border-chalkboard-30 dark:border-chalkboard-70 hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80"
        onClick={() =>
          setDismissedFor(
            dismissedFor === sceneGraphDelta ? null : sceneGraphDelta
          )
        }
      >
        Sketch ideas
      </button>
      {dismissedFor !== sceneGraphDelta && (
        <div className="absolute top-full left-0 mt-2 z-30 w-72 p-3 rounded border border-chalkboard-30 dark:border-chalkboard-70 bg-chalkboard-10 dark:bg-chalkboard-90 shadow-lg">
          <div className="flex items-center justify-between mb-1">
            <strong className="text-xs">
              Ideas for this sketch (experimental)
            </strong>
            <button
              type="button"
              className="text-xs px-1"
              aria-label="Dismiss sketch ideas"
              onClick={() => setDismissedFor(sceneGraphDelta)}
            >
              Close
            </button>
          </div>
          <p className="text-xs m-0 mb-2">
            Choose an idea to add it to this sketch.
          </p>
          <div className="flex gap-2">
            {ideas.map((idea) => (
              <button
                type="button"
                key={idea.id}
                aria-label={idea.label}
                className="flex-1 min-w-0 p-1 rounded border border-chalkboard-30 dark:border-chalkboard-70 hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 disabled:opacity-50"
                title={idea.description}
                disabled={disabled || !canAdd}
                onClick={() => {
                  const current = actor.getSnapshot()
                  if (
                    !current.matches('move and select') ||
                    current.context.sketchExecOutcome?.sceneGraphDelta !==
                      sceneGraphDelta
                  ) {
                    reportRejection(
                      new Error('Sketch changed; wait for fresh ideas')
                    )
                    return
                  }
                  actor.send({
                    type: 'apply suggested geometry',
                    data: { segment: idea.segment, sceneGraphDelta },
                  })
                }}
              >
                <svg
                  viewBox="0 0 100 100"
                  className="w-full h-20"
                  role="img"
                  aria-label={idea.description}
                >
                  <rect
                    x="10"
                    y="10"
                    width="80"
                    height="80"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <circle
                    cx={idea.preview.x}
                    cy={idea.preview.y}
                    r={idea.preview.radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="3 2"
                  />
                </svg>
                <span className="block text-xs">{idea.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
