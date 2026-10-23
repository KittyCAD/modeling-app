import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import {
  recordSuggestionMetric,
  recordSuggestionPreviewTime,
} from '@src/machines/sketchSolve/constraints/constraintSuggestionMetrics'
import {
  rankConstraintSuggestionsWithModel,
  readLocalConstraintSuggestionRankerModel,
} from '@src/machines/sketchSolve/constraints/constraintSuggestionRanker'
import { createConstraintSuggestionReviewTemplate } from '@src/machines/sketchSolve/constraints/constraintSuggestionReview'
import {
  type ConstraintSuggestion,
  rankConstraintSuggestions,
} from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { useSelector } from '@xstate/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActorRefFrom } from 'xstate'

const AUTO_SUGGEST_DELAY_MS = 350

type SuggestionResult = {
  sceneGraphDelta: SceneGraphDelta
  selectionKey: string
  suggestions: ConstraintSuggestion[]
}

export function SketchConstraintSuggestions({
  actor,
  disabled,
}: {
  actor: ActorRefFrom<typeof sketchSolveMachine>
  disabled: boolean
}) {
  const selectionKey = useSelector(actor, (state) =>
    state.context.selectedIds.join('|')
  )
  const sceneGraphDelta = useSelector(
    actor,
    (state) => state.context.sketchExecOutcome?.sceneGraphDelta
  )
  const canSuggest = useSelector(
    actor,
    (state) =>
      state.matches('move and select') && state.context.selectedIds.length > 0
  )
  const [result, setResult] = useState<SuggestionResult | null>(null)
  const [loadingFor, setLoadingFor] = useState<{
    sceneGraphDelta: SceneGraphDelta
    selectionKey: string
  } | null>(null)
  const requestId = useRef(0)
  const accepting = useRef(false)
  const autoTimer = useRef<number | null>(null)
  const loading =
    loadingFor !== null &&
    loadingFor.sceneGraphDelta === sceneGraphDelta &&
    loadingFor.selectionKey === selectionKey
  const visibleResult =
    result !== null &&
    result.sceneGraphDelta === sceneGraphDelta &&
    result.selectionKey === selectionKey &&
    canSuggest &&
    !disabled
      ? result
      : null

  const requestSuggestions = useCallback(
    async (source: 'automatic' | 'manual') => {
      if (source === 'manual' && autoTimer.current !== null) {
        window.clearTimeout(autoTimer.current)
        autoTimer.current = null
      }
      const current = actor.getSnapshot()
      const currentDelta = current.context.sketchExecOutcome?.sceneGraphDelta
      if (
        !current.matches('move and select') ||
        current.context.selectedIds.length === 0 ||
        !currentDelta
      ) {
        return
      }

      const currentSelectionKey = current.context.selectedIds.join('|')
      const currentRequestId = ++requestId.current
      const isCurrent = () => {
        const latest = actor.getSnapshot()
        return (
          currentRequestId === requestId.current &&
          latest.matches('move and select') &&
          latest.context.sketchExecOutcome?.sceneGraphDelta === currentDelta &&
          latest.context.selectedIds.join('|') === currentSelectionKey
        )
      }
      accepting.current = false
      recordSuggestionMetric('requested')
      recordSuggestionMetric(
        source === 'automatic' ? 'autoRequested' : 'manualRequested'
      )
      const startedAt = performance.now()
      setLoadingFor({
        sceneGraphDelta: currentDelta,
        selectionKey: currentSelectionKey,
      })
      setResult(null)
      try {
        const suggestions = await rankConstraintSuggestions({
          selectionIds: current.context.selectedIds,
          sketchId: current.context.sketchId,
          objects: currentDelta.new_graph.objects,
          rustContext: current.context.rustContext,
          settings: jsAppSettings(
            current.context.kclManager.systemDeps.settings
          ),
          units: baseUnitToNumericSuffix(
            current.context.kclManager.fileSettings.defaultLengthUnit
          ),
          onCheck: (event) => {
            recordSuggestionMetric(event.type, event.constraintType)
          },
          isCurrent,
        })
        if (!isCurrent()) {
          return
        }
        const localModel = readLocalConstraintSuggestionRankerModel()
        if (localModel instanceof Error) {
          reportRejection(localModel)
        }
        const rankedSuggestions =
          localModel && !(localModel instanceof Error)
            ? rankConstraintSuggestionsWithModel(suggestions, localModel)
            : suggestions
        if (localModel && !(localModel instanceof Error)) {
          recordSuggestionMetric('modelRanked')
        }
        for (const suggestion of rankedSuggestions) {
          recordSuggestionMetric('shown', suggestion.payload.type)
        }
        setResult({
          sceneGraphDelta: currentDelta,
          selectionKey: currentSelectionKey,
          suggestions: rankedSuggestions,
        })
      } catch (error) {
        reportRejection(error)
      } finally {
        recordSuggestionPreviewTime(performance.now() - startedAt)
        if (currentRequestId === requestId.current) {
          setLoadingFor(null)
        }
      }
    },
    [actor]
  )

  useEffect(() => {
    if (disabled || !canSuggest || !sceneGraphDelta || !selectionKey) {
      return
    }
    const timeout = window.setTimeout(() => {
      autoTimer.current = null
      void requestSuggestions('automatic')
    }, AUTO_SUGGEST_DELAY_MS)
    autoTimer.current = timeout
    return () => {
      window.clearTimeout(timeout)
      if (autoTimer.current === timeout) {
        autoTimer.current = null
      }
      requestId.current += 1
    }
  }, [canSuggest, disabled, requestSuggestions, sceneGraphDelta, selectionKey])

  const acceptSuggestion = useCallback(
    (suggestion: ConstraintSuggestion) => {
      const current = actor.getSnapshot()
      if (
        accepting.current ||
        disabled ||
        !result ||
        !current.matches('move and select') ||
        current.context.sketchExecOutcome?.sceneGraphDelta !==
          result.sceneGraphDelta ||
        current.context.selectedIds.join('|') !== result.selectionKey
      ) {
        return
      }
      accepting.current = true
      recordSuggestionMetric('accepted', suggestion.payload.type)
      actor.send({
        type: 'apply suggested constraint',
        data: {
          payload: suggestion.payload,
          selectedIds: [...current.context.selectedIds],
          sceneGraphDelta: result.sceneGraphDelta,
        },
      })
      setResult(null)
    },
    [actor, disabled, result]
  )

  return (
    <div className="relative">
      <button
        type="button"
        className="px-2 py-1 rounded border border-chalkboard-30 dark:border-chalkboard-70 hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 disabled:opacity-50"
        disabled={disabled || loading || !canSuggest}
        onClick={() => {
          void requestSuggestions('manual')
        }}
      >
        {loading ? 'Checking...' : 'Suggest'}
      </button>
      {visibleResult && (
        <div className="absolute top-full right-0 mt-2 z-30 min-w-48 p-2 rounded border border-chalkboard-30 dark:border-chalkboard-70 bg-chalkboard-10 dark:bg-chalkboard-90 shadow-lg">
          {visibleResult.suggestions.length === 0 ? (
            <p className="text-xs m-0">No safe suggestions.</p>
          ) : (
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">Constraint suggestions</legend>
              {visibleResult.suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.label}
                  className="text-left px-2 py-1 rounded hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80"
                  title={suggestion.explanation}
                  onClick={() => acceptSuggestion(suggestion)}
                >
                  {suggestion.label}
                </button>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            className="text-xs mt-2 px-2 py-1 rounded hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80"
            onClick={() => {
              const current = actor.getSnapshot()
              if (
                !current.matches('move and select') ||
                current.context.sketchExecOutcome?.sceneGraphDelta !==
                  visibleResult.sceneGraphDelta ||
                current.context.selectedIds.join('|') !==
                  visibleResult.selectionKey
              ) {
                reportRejection(
                  new Error('Sketch selection changed; check suggestions again')
                )
                return
              }
              const reviewTemplate = createConstraintSuggestionReviewTemplate(
                current.context.selectedIds,
                visibleResult.suggestions
              )
              void Promise.resolve()
                .then(() =>
                  navigator.clipboard.writeText(JSON.stringify(reviewTemplate))
                )
                .catch(reportRejection)
            }}
          >
            Copy review template
          </button>
        </div>
      )}
    </div>
  )
}
