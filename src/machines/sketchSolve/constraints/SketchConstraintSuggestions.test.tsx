import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  CONSTRAINT_SUGGESTION_FEATURE_NAMES,
  SUGGESTION_RANKER_MODEL_KEY,
} from '@src/machines/sketchSolve/constraints/constraintSuggestionRanker'
import { SketchConstraintSuggestions } from '@src/machines/sketchSolve/constraints/SketchConstraintSuggestions'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActorRefFrom } from 'xstate'

const rankSuggestions = vi.hoisted(() => vi.fn())
const metricsKey = 'sketch-constraint-suggestions-poc-v1'

vi.mock('@src/machines/sketchSolve/constraints/constraintSuggestions', () => ({
  rankConstraintSuggestions: rankSuggestions,
}))
vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: () => ({}),
}))
vi.mock('@src/lib/trap', () => ({
  reportRejection: vi.fn(),
}))
vi.mock('@xstate/react', () => ({
  useSelector: (
    actor: { getSnapshot: () => unknown },
    selector: (snapshot: unknown) => unknown
  ) => selector(actor.getSnapshot()),
}))

function createActor() {
  const sceneGraphDelta = {
    new_graph: { objects: [] },
  } as unknown as SceneGraphDelta
  const state = {
    context: {
      selectedIds: [3],
      sketchExecOutcome: { sceneGraphDelta },
      sketchId: 10,
      rustContext: {},
      kclManager: {
        systemDeps: { settings: {} },
        fileSettings: { defaultLengthUnit: 'Mm' },
      },
    },
    matches: (value: string) => value === 'move and select',
  }
  const actor = {
    getSnapshot: () => state,
    send: vi.fn(),
  } as unknown as ActorRefFrom<typeof sketchSolveMachine>
  return { actor, state }
}

describe('SketchConstraintSuggestions', () => {
  beforeEach(() => {
    rankSuggestions.mockReset()
    sessionStorage.removeItem(metricsKey)
    sessionStorage.removeItem(SUGGESTION_RANKER_MODEL_KEY)
  })

  it('applies a solver-approved suggestion only after acceptance', async () => {
    rankSuggestions.mockResolvedValue([
      {
        toolName: 'horizontalConstraintTool',
        label: 'Make horizontal',
        explanation: 'Line is nearly horizontal',
        payload: { type: 'Horizontal', line: 3 },
        score: 0.8,
      },
    ])
    const { actor, state } = createActor()
    render(<SketchConstraintSuggestions actor={actor} disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    expect(actor.send).not.toHaveBeenCalled()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make horizontal' })
    )

    expect(actor.send).toHaveBeenCalledWith({
      type: 'apply suggested constraint',
      data: {
        payload: { type: 'Horizontal', line: 3 },
        selectedIds: [3],
        sceneGraphDelta: state.context.sketchExecOutcome.sceneGraphDelta,
      },
    })
    expect(
      JSON.parse(sessionStorage.getItem(metricsKey) ?? '{}')
    ).toMatchObject({
      counts: { requested: 1, manualRequested: 1, shown: 1, accepted: 1 },
      byConstraintType: { Horizontal: { shown: 1, accepted: 1 } },
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(rankSuggestions).toHaveBeenCalledOnce()
  })

  it('checks a settled selection automatically without applying it', async () => {
    rankSuggestions.mockResolvedValue([
      {
        label: 'Make horizontal',
        explanation: 'Line is nearly horizontal',
        payload: { type: 'Horizontal', line: 3 },
        score: 0.8,
      },
    ])
    const { actor } = createActor()
    render(<SketchConstraintSuggestions actor={actor} disabled={false} />)

    expect(rankSuggestions).not.toHaveBeenCalled()
    await screen.findByRole('button', { name: 'Make horizontal' })
    expect(rankSuggestions).toHaveBeenCalledOnce()
    expect(actor.send).not.toHaveBeenCalled()
    expect(
      JSON.parse(sessionStorage.getItem(metricsKey) ?? '{}')
    ).toMatchObject({
      counts: { requested: 1, autoRequested: 1, shown: 1 },
    })
  })

  it('drops suggestions when the sketch selection changes during preview', async () => {
    let resolveSuggestions: (value: unknown[]) => void = () => {}
    rankSuggestions.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        resolveSuggestions = resolve
      })
    )
    const { actor, state } = createActor()
    render(<SketchConstraintSuggestions actor={actor} disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    state.context.selectedIds = [4]
    resolveSuggestions([
      {
        toolName: 'horizontalConstraintTool',
        label: 'Make horizontal',
        payload: { type: 'Horizontal', line: 3 },
        score: 0.8,
      },
    ])

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Suggest' })).toBeEnabled()
    )
    expect(screen.queryByRole('button', { name: 'Make horizontal' })).toBeNull()
    expect(actor.send).not.toHaveBeenCalled()
    expect(
      JSON.parse(sessionStorage.getItem(metricsKey) ?? '{}')
    ).toMatchObject({
      counts: { requested: 1 },
    })
  })

  it('drops an in-flight result when the sketch panel unmounts', async () => {
    let resolveSuggestions: (value: unknown[]) => void = () => {}
    rankSuggestions.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        resolveSuggestions = resolve
      })
    )
    const { actor } = createActor()
    const view = render(
      <SketchConstraintSuggestions actor={actor} disabled={false} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    view.unmount()
    await act(async () => {
      resolveSuggestions([
        {
          label: 'Make horizontal',
          payload: { type: 'Horizontal', line: 3 },
          score: 0.8,
        },
      ])
    })
    expect(
      JSON.parse(sessionStorage.getItem(metricsKey) ?? '{}')
    ).not.toMatchObject({ counts: { shown: 1 } })
  })

  it('copies an unreviewed template without sketch geometry', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    rankSuggestions.mockResolvedValue([
      {
        label: 'Make horizontal',
        explanation: 'Line is nearly horizontal',
        payload: { type: 'Horizontal', line: 3 },
        score: 0.8,
        features: {
          normalizedResidual: 0.2,
          previewMovementRatio: 0.01,
          freePointFraction: 0.5,
        },
      },
    ])
    const { actor, state } = createActor()
    render(<SketchConstraintSuggestions actor={actor} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy review template' })
    )
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const copied = JSON.parse(writeText.mock.calls[0][0])
    expect(copied).toMatchObject({
      source_ref: 'FILL_IN',
      expected_action: 'unreviewed',
      selection_ids: [3],
      candidates: [
        {
          constraint_type: 'Horizontal',
          candidate_payload: { type: 'Horizontal', line: 3 },
          normalizedResidual: 0.2,
          previewMovementRatio: 0.01,
          freePointFraction: 0.5,
          label: 'unreviewed',
          dimension_edit_probe: {
            driver: 'FILL_IN',
            before: 'FILL_IN',
            after: 'FILL_IN',
            invariant: 'FILL_IN',
          },
        },
      ],
    })
    expect(JSON.stringify(copied)).not.toContain('new_graph')
    expect(actor.send).not.toHaveBeenCalled()
    state.context.selectedIds = [4]
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy review template' })
    )
    expect(writeText).toHaveBeenCalledOnce()
  })

  it('uses a local reviewed model to order the displayed suggestions', async () => {
    const weights = Array(CONSTRAINT_SUGGESTION_FEATURE_NAMES.length).fill(0)
    weights[5] = 2
    sessionStorage.setItem(
      SUGGESTION_RANKER_MODEL_KEY,
      JSON.stringify({
        schema_version: 1,
        feature_names: CONSTRAINT_SUGGESTION_FEATURE_NAMES,
        weights,
      })
    )
    rankSuggestions.mockResolvedValue(
      (['Horizontal', 'Vertical'] as const).map((type, index) => ({
        label: `Make ${type.toLowerCase()}`,
        explanation: `Near ${type.toLowerCase()}`,
        payload: { type, line: 3 },
        score: 0.9 - index * 0.1,
        features: {
          normalizedResidual: 0.1 + index * 0.1,
          previewMovementRatio: 0,
          freePointFraction: 1,
        },
      }))
    )
    const { actor } = createActor()
    render(<SketchConstraintSuggestions actor={actor} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    await screen.findByRole('button', { name: 'Make vertical' })
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.textContent?.startsWith('Make '))
        .map((button) => button.textContent)
    ).toEqual(['Make vertical', 'Make horizontal'])
    expect(
      JSON.parse(sessionStorage.getItem(metricsKey) ?? '{}')
    ).toMatchObject({ counts: { modelRanked: 1 } })
  })
})
