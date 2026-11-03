import { signal } from '@preact/signals-core'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  type FeatureTreeExecution,
  emptyFeatureTreeExecution,
} from '@src/lib/featureTree/execution'
import { createFeatureTreeService } from '@src/lib/featureTree/registry/service'
import type { ExecutingEditor } from '@src/registry/contracts/projectSession'
import { describe, expect, it, vi } from 'vitest'

function parameter(name: string): Operation {
  return {
    type: 'VariableDeclaration',
    name,
    value: { type: 'String', value: name },
    visibility: 'default',
    nodePath: { steps: [] },
    sourceRange: [0, 10, 0],
  }
}
function editor(code = 'current code') {
  return {
    featureTree: signal(emptyFeatureTreeExecution()),
    code: signal(code),
    hasEditsSinceLastExecution: signal(false),
    isExecuting: signal(false),
    executionElapsedMs: signal<number | null>(null),
    selectionStatusLabel: signal(''),
    showExperimentalFeaturesStatusBarItem: signal(false),
    getPendingCommandCount: () => 0,
    executeCode: vi.fn(async () => {}),
    updateCode: vi.fn(),
  } satisfies ExecutingEditor
}

describe('feature tree data service', () => {
  it('switches editor sources and clears the model when the executing editor leaves', () => {
    const first = editor('first')
    const second = editor('second')
    first.featureTree.value = {
      ...first.featureTree.value,
      operations: { map: { 0: [parameter('first')] } },
    }
    second.featureTree.value = {
      ...second.featureTree.value,
      operations: { map: { 0: [parameter('second')] } },
    }
    const active = signal<ExecutingEditor | undefined>(first)
    const service = createFeatureTreeService(active, () => false)
    expect(service.model.value.code).toBe('first')
    expect(service.model.value.operations).toContainEqual(parameter('first'))
    active.value = second
    first.featureTree.value = emptyFeatureTreeExecution()
    expect(service.model.value.code).toBe('second')
    expect(service.model.value.operations).toContainEqual(parameter('second'))
    active.value = undefined
    expect(service.model.value.operations).toEqual([])
    expect(service.model.value.bodies).toEqual([])
    expect(service.model.value.code).toBe('')
  })

  it('prefers live operations, the longest failed result, then the last good parse reference', () => {
    const current = editor()
    const state: FeatureTreeExecution = {
      ...emptyFeatureTreeExecution(),
      operations: { map: { 0: [parameter('live')] } },
      failedOperations: [{ map: { 0: [parameter('failed')] } }, { map: {} }],
      lastSuccessfulOperations: { map: { 0: [parameter('last good')] } },
      lastSuccessfulCode: 'last good code',
    }
    current.featureTree.value = state
    const service = createFeatureTreeService(signal(current), () => false)
    expect(service.model.value.operations).toContainEqual(parameter('failed'))
    current.isExecuting.value = true
    expect(service.model.value.operations).toContainEqual(parameter('live'))
    current.isExecuting.value = false
    current.featureTree.value = { ...state, hasParseErrors: true }
    expect(service.model.value.operations).toContainEqual(
      parameter('last good')
    )
    expect(service.model.value).toMatchObject({
      code: 'last good code',
      readOnly: true,
      showingStaleTree: true,
    })
    current.featureTree.value = {
      ...state,
      hasParseErrors: true,
      lastSuccessfulOperations: { map: {} },
    }
    expect(service.model.value.showingStaleTree).toBe(false)
  })

  it('responds to unrendered edits without rebuilding domain data in a view', () => {
    const current = editor()
    const disabled = signal(false)
    current.featureTree.value = {
      ...current.featureTree.value,
      lastSuccessfulCode: 'executed code',
    }
    const service = createFeatureTreeService(
      signal(current),
      () => disabled.value
    )
    expect(service.model.value).toMatchObject({
      code: 'current code',
      readOnly: false,
    })
    disabled.value = true
    expect(service.model.value).toMatchObject({
      code: 'executed code',
      readOnly: true,
      disabledForUnrenderedChanges: true,
    })
    disabled.value = false
    expect(service.model.value.readOnly).toBe(false)
  })
})
