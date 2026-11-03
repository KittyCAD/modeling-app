import type { Artifact } from '@src/lang/wasm'
import { signal } from '@preact/signals-core'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  type FeatureTreeExecution,
  emptyFeatureTreeExecution,
} from '@src/lib/featureTree/execution'
import { createFeatureTreeService } from '@src/lib/featureTree/registry/service'
import type { ExecutingEditor } from '@src/registry/contracts/projectSession'
import { describe, expect, it, vi } from 'vitest'

function parameter(
  name: string
): Extract<Operation, { type: 'VariableDeclaration' }> {
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

it('derives hierarchy and live expansion without any mounted rows', () => {
  const current = editor()
  const moduleOperation: Operation = {
    type: 'ModuleInstance',
    name: 'part',
    moduleId: 1,
    nodePath: { steps: [] },
    sourceRange: [0, 10, 0],
  }
  const child: Operation = { ...parameter('width'), sourceRange: [0, 10, 1] }
  current.featureTree.value = {
    ...current.featureTree.value,
    operations: { map: { 0: [moduleOperation], 1: [child] } },
  }
  const service = createFeatureTreeService(signal(current), () => false)
  const rows = service.model.value.operationRows
  const branch = rows.find(
    (row) => row.kind === 'operation' && row.operation === moduleOperation
  )!
  const leaf = rows.find(
    (row) => row.kind === 'operation' && row.operation === child
  )!
  expect(leaf.parentId).toBe(branch.id)
  expect(
    service.featureNodes.value.find((node) => node.id === leaf.id)?.parentId
  ).toBe(branch.id)
  expect(service.defaultExpandedIds.value).toContain(branch.id)
  current.featureTree.value = {
    ...current.featureTree.value,
    liveActiveModuleId: 2,
  }
  expect(service.defaultExpandedIds.value).not.toContain(branch.id)
  current.featureTree.value = {
    ...current.featureTree.value,
    liveActiveModuleId: 1,
  }
  expect(service.defaultExpandedIds.value).toContain(branch.id)
})

it('keeps pattern-copy identity, hide state and selection separate from a shared artifact', () => {
  const current = editor()
  const pattern: Artifact = {
    type: 'pattern',
    id: 'pattern',
    subType: 'linear',
    sourceId: 'source',
    copyIds: ['copy-1', 'copy-2'],
    copyFaceIds: [],
    copyEdgeIds: [],
    codeRef: { range: [0, 10, 0], pathToNode: [], nodePath: { steps: [] } },
  }
  const hide: Operation = {
    type: 'StdLibCall',
    name: 'hide',
    unlabeledArg: {
      value: { type: 'ImportedGeometry', artifact_id: 'copy-2' },
      sourceRange: [0, 10, 0],
    },
    labeledArgs: {},
    nodePath: { steps: [] },
    sourceRange: [0, 10, 0],
    isError: false,
  }
  current.featureTree.value = {
    ...current.featureTree.value,
    artifactGraph: new Map([[pattern.id, pattern]]),
    completedOperations: { map: { 0: [hide] } },
    selections: {
      graphSelections: [{ engineEntityId: 'copy-2' }],
      otherSelections: [],
    },
  }
  const service = createFeatureTreeService(signal(current), () => false)
  expect(
    service.model.value.bodies.map((body) => [
      body.id,
      body.patternIndex,
      body.hideOperation,
    ])
  ).toEqual([
    ['copy-1', 1, undefined],
    ['copy-2', 2, hide],
  ])
  expect(service.selectedIds.value).toEqual(['body:copy-2'])
  current.featureTree.value = {
    ...current.featureTree.value,
    artifactGraph: new Map(),
  }
  expect(service.bodyNodes.value).toEqual([])
  expect(service.selectedIds.value).toEqual([])
})

it('uses the same variable and value-detail label rules as the pane presentation', () => {
  const current = editor()
  const dimension = parameter('width')
  const extrude: Operation = {
    type: 'StdLibCall',
    name: 'extrude',
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: { steps: [] },
    sourceRange: [11, 20, 0],
    isError: false,
  }
  current.featureTree.value = {
    ...current.featureTree.value,
    operations: { map: { 0: [dimension, extrude] } },
    operationDescriptions: new Map([
      [
        'VariableDeclaration-width-0-10-0',
        { name: 'Parameter', variableName: 'width' },
      ],
      [
        'StdLibCall-extrude-11-20-0',
        { name: 'Extrude', variableName: 'extrude001' },
      ],
    ]),
  }
  const service = createFeatureTreeService(signal(current), () => false)
  expect(service.featureNodes.value.map((node) => node.label)).toEqual([
    'Parameter',
    'extrude001',
  ])
})
