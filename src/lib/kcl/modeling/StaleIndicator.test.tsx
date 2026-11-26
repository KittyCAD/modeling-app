import { emptyExecState } from '@src/lang/wasm'
import type { KclViewExecutionState } from '@src/lib/kcl/modeling/viewExecution'
import '@src/lib/projectSession/next/testFeature'
import { signal } from '@preact/signals-core'
import { act, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Registry, contribute } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorViewsFacet,
  editorTabIndicatorsFacet,
  editorReadOnlyPoliciesFacet,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { requireSuccess } from '@src/lib/editors/testViews'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { LayoutType } from '@src/lib/layout/types'
import { createStaleModelIndicator } from '@src/lib/kcl/modeling/StaleIndicator'

it('shows each Modeling tab’s freshness independently of sibling and Code views', async () => {
  const registry = new Registry()
  const freshness = createStaleModelIndicator(
    (instance) =>
      registry.required(editorsService).viewState(instance).value.selected
        ?.id === 'kcl.modeling'
  )
  await registry.configure([
    editorsExtension,
    contribute(editorViewsFacet, () =>
      defineEditorView({
        id: 'kcl.modeling',
        label: 'Modeling',
        matches: '*',
        Component: () => null,
      })
    ),
    contribute(editorTabIndicatorsFacet, () => freshness.indicator),
    contribute(editorReadOnlyPoliciesFacet, () => ({
      id: 'locked',
      matches: '*' as const,
      readOnly: signal(true),
    })),
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor('source'))
  const first = requireSuccess(editors.createView(editor, 'kcl.modeling'))
  const second = requireSuccess(editors.createView(editor, 'kcl.modeling'))
  const code = requireSuccess(editors.createView(editor, 'editors.code'))
  const model = emptyExecState()
  const firstResult = signal<KclViewExecutionState>({
    running: true,
    stale: true,
  })
  const secondResult = signal<KclViewExecutionState>({
    running: false,
    stale: false,
    result: model,
  })
  const stopFirst = freshness.track(first, firstResult)
  const stopSecond = freshness.track(second, secondResult)
  const stopCode = freshness.track(
    code,
    signal({ running: false, stale: true, result: model })
  )
  const mounted = render(
    <EditorsPane
      editors={editors}
      indicators={registry.observe(editorTabIndicatorsFacet)}
      layout={{
        id: 'editors',
        label: 'Editors',
        type: LayoutType.Simple,
        areaType: 'editors',
      }}
    />
  )
  try {
    const [firstTab, secondTab, codeTab] = screen.getAllByRole('tab')
    expect(within(firstTab).queryByText('Stale')).not.toBeInTheDocument()
    act(() => {
      firstResult.value = { running: false, stale: true, result: model }
    })
    expect(within(firstTab).getByText('Stale')).toHaveAttribute(
      'title',
      'Model is out of date.'
    )
    act(() => {
      firstResult.value = { ...firstResult.peek(), running: true }
    })
    expect(within(firstTab).getByText('Stale')).toBeInTheDocument()
    expect(within(secondTab).queryByText('Stale')).not.toBeInTheDocument()
    expect(within(codeTab).queryByText('Stale')).not.toBeInTheDocument()
    expect(screen.getAllByText('Read-only')).toHaveLength(3)
    act(() => {
      firstResult.value = { running: false, stale: false, result: model }
      secondResult.value = { running: false, stale: true, result: model }
    })
    expect(within(firstTab).queryByText('Stale')).not.toBeInTheDocument()
    expect(within(secondTab).getByText('Stale')).toBeInTheDocument()
    await act(async () => {
      requireSuccess(editors.setView(second.id, 'editors.code'))
    })
    expect(within(secondTab).queryByText('Stale')).not.toBeInTheDocument()
    await act(async () => {
      requireSuccess(editors.setView(second.id, 'kcl.modeling'))
    })
    expect(
      within(screen.getAllByRole('tab')[1]).getByText('Stale')
    ).toBeInTheDocument()
    act(stopSecond)
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
  } finally {
    mounted.unmount()
    stopFirst()
    stopSecond()
    stopCode()
    await registry.dispose()
  }
})
