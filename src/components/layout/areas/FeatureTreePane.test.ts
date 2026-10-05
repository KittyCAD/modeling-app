import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  defaultNodePath,
  type OperationsByModule,
  type SourceRange,
} from '@src/lang/wasm'
import {
  buildOperationTree,
  findSameVisibleStdLibOperationAfterSourceChange,
  isOperationTreeBranch,
  type OperationTree,
  type OperationTreeBranch,
  type OperationTreeNode,
} from '@src/lib/featureTreeOperationTree'
import * as operationGrouping from '@src/lib/operationGrouping'
import { afterEach, describe, expect, it, vi } from 'vitest'

type ExpandedTreeNode =
  | Operation
  | Operation[]
  | {
      parent: OperationTreeBranch['parent']
      children: ExpandedTreeNode[]
    }

function expandOperationTree(tree: OperationTree): ExpandedTreeNode[] {
  const expand = (nodes: OperationTreeNode[]): ExpandedTreeNode[] =>
    nodes.map((node) =>
      isOperationTreeBranch(node)
        ? { parent: node.parent, children: expand(tree.getChildren(node)) }
        : node
    )
  return expand(tree.nodes)
}

function branch(node: OperationTreeNode): OperationTreeBranch {
  if (!isOperationTreeBranch(node)) throw new Error('Expected a module branch')
  return node
}

afterEach(() => vi.restoreAllMocks())

type StdLibCallOperation = Extract<Operation, { type: 'StdLibCall' }>

function createModuleInstanceOperation(
  moduleId: number,
  sourceRange: [number, number, number],
  name = `module${moduleId}`
): Operation {
  return {
    type: 'ModuleInstance',
    name,
    moduleId,
    nodePath: defaultNodePath(),
    sourceRange,
  }
}

function createVariableDeclarationOperation(
  sourceRange: [number, number, number],
  name: string
): Operation {
  return {
    type: 'VariableDeclaration',
    name,
    value: { type: 'Number', value: 42 } as any,
    visibility: 'default',
    nodePath: defaultNodePath(),
    sourceRange,
  }
}

function createStdLibCallOperation(
  name: string,
  sourceRange: SourceRange
): StdLibCallOperation {
  return {
    type: 'StdLibCall',
    name,
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: defaultNodePath(),
    sourceRange,
    isError: false,
  }
}

function createSketchBlockBegin(sourceRange: SourceRange): Operation {
  return {
    type: 'GroupBegin',
    group: {
      type: 'SketchBlock',
      sketchId: 1,
    },
    nodePath: defaultNodePath(),
    sourceRange,
  }
}

function createGroupEnd(): Operation {
  return {
    type: 'GroupEnd',
  }
}

describe('buildOperationTree', () => {
  it('does not filter or group closed modules, and reuses unchanged module grouping', () => {
    const root = [createModuleInstanceOperation(1, [0, 10, 0])]
    const child = [createModuleInstanceOperation(2, [0, 10, 1])]
    const grandchild = [createVariableDeclarationOperation([0, 10, 2], 'width')]
    const operationsByModule = { map: { 0: root, 1: child, 2: grandchild } }
    const filtering = vi.spyOn(operationGrouping, 'filterOperations')
    const grouping = vi.spyOn(operationGrouping, 'groupNestedOperations')
    const tree = buildOperationTree(operationsByModule, 0)

    expect(filtering.mock.calls.map(([operations]) => operations)).toEqual([
      root,
    ])
    expect(grouping.mock.calls.map(([, operations]) => operations)).toEqual([
      root,
    ])
    expect(tree.nodes[0]).not.toHaveProperty('children')

    const children = tree.getChildren(branch(tree.nodes[0]))
    expect(grouping.mock.calls.map(([, operations]) => operations)).toEqual([
      root,
      child,
    ])
    expect(tree.getChildren(branch(tree.nodes[0]))).toBe(children)
    expect(tree.getModuleAncestors(2)).toEqual([1, 2])
    expect(grouping).toHaveBeenCalledTimes(2)

    const updatedTree = buildOperationTree(
      {
        map: {
          ...operationsByModule.map,
          2: [
            ...grandchild,
            createVariableDeclarationOperation([11, 20, 2], 'height'),
          ],
        },
      },
      0
    )
    const updatedChildren = updatedTree.getChildren(
      branch(updatedTree.nodes[0])
    )
    expect(grouping).toHaveBeenCalledTimes(2)
    expect(updatedTree.getChildren(branch(updatedChildren[0]))).toMatchObject([
      { name: 'width' },
      { name: 'height' },
    ])
    expect(grouping).toHaveBeenCalledTimes(3)
  })

  it('keeps duplicate imports as leaves regardless of expansion order', () => {
    const sharedInFirst = createModuleInstanceOperation(
      3,
      [0, 10, 1],
      'sharedFirst'
    )
    const sharedInSecond = createModuleInstanceOperation(
      3,
      [0, 10, 2],
      'sharedSecond'
    )
    const tree = buildOperationTree(
      {
        map: {
          0: [
            createModuleInstanceOperation(1, [0, 10, 0]),
            createModuleInstanceOperation(2, [11, 20, 0]),
          ],
          1: [sharedInFirst],
          2: [sharedInSecond],
          3: [createVariableDeclarationOperation([0, 10, 3], 'length')],
        },
      },
      0
    )

    expect(tree.getChildren(branch(tree.nodes[1]))).toEqual([sharedInSecond])
    expect(tree.getChildren(branch(tree.nodes[0]))).toEqual([
      { parent: sharedInFirst },
    ])
    expect(tree.getModuleAncestors(3)).toEqual([1, 3])
  })

  it('keeps imports hidden in function groups accessible as lazy root branches', () => {
    const hiddenImport = createModuleInstanceOperation(2, [10, 20, 1], 'hidden')
    const functionBegin: Operation = {
      type: 'GroupBegin',
      group: {
        type: 'FunctionCall',
        name: 'createPart',
        functionSourceRange: [0, 30, 1],
        unlabeledArg: null,
        labeledArgs: {},
      },
      sourceRange: [0, 30, 1],
      nodePath: defaultNodePath(),
    }
    const root = [createModuleInstanceOperation(1, [0, 10, 0])]
    const tree = buildOperationTree(
      {
        map: {
          0: root,
          1: [functionBegin, hiddenImport, createGroupEnd()],
          2: [createVariableDeclarationOperation([0, 10, 2], 'width')],
        },
      },
      0
    )

    expect(tree.nodes).toEqual([{ parent: root[0] }, { parent: hiddenImport }])
    expect(tree.getModuleAncestors(2)).toEqual([2])
    expect(tree.getChildren(branch(tree.nodes[1]))).toMatchObject([
      { name: 'width' },
    ])
  })

  it('does not add fallback rows for imports already shown inside complete sketch groups', () => {
    const tree = buildOperationTree(
      {
        map: {
          0: [createModuleInstanceOperation(1, [0, 10, 0])],
          1: [
            createSketchBlockBegin([0, 30, 1]),
            createModuleInstanceOperation(2, [10, 20, 1]),
            createGroupEnd(),
          ],
          2: [createVariableDeclarationOperation([0, 10, 2], 'width')],
        },
      },
      0
    )

    expect(tree.nodes).toHaveLength(1)
    expect(tree.getChildren(branch(tree.nodes[0]))[0]).toMatchObject([
      { type: 'GroupBegin' },
      { type: 'ModuleInstance', moduleId: 2 },
      { type: 'GroupEnd' },
    ])
  })

  it('recomputes fallback placement when a live sketch group completes', () => {
    const root = [createModuleInstanceOperation(1, [0, 10, 0])]
    const sketch = [
      createSketchBlockBegin([0, 30, 1]),
      createModuleInstanceOperation(2, [10, 20, 1]),
    ]
    const live = buildOperationTree({ map: { 0: root, 1: sketch } }, 0)
    expect(live.nodes).toHaveLength(2)
    const complete = buildOperationTree(
      { map: { 0: root, 1: [...sketch, createGroupEnd()] } },
      0
    )
    expect(complete.nodes).toHaveLength(1)
  })

  it('treats cycles as leaf references and handles missing or empty modules', () => {
    const backToRoot = createModuleInstanceOperation(0, [0, 10, 1])
    const selfImport = createModuleInstanceOperation(1, [11, 20, 1])
    const tree = buildOperationTree(
      {
        map: {
          0: [
            createModuleInstanceOperation(1, [0, 10, 0]),
            createModuleInstanceOperation(2, [11, 20, 0]),
            createModuleInstanceOperation(3, [21, 30, 0]),
          ],
          1: [backToRoot, selfImport],
          2: [],
        },
      },
      0
    )

    expect(tree.getChildren(branch(tree.nodes[0]))).toEqual([
      backToRoot,
      selfImport,
    ])
    expect(tree.getChildren(branch(tree.nodes[1]))).toEqual([])
    expect(tree.getChildren(branch(tree.nodes[2]))).toEqual([])
    expect(tree.getModuleAncestors(0)).toEqual([])
    expect(tree.getModuleAncestors(100)).toEqual([])
  })

  it('picks up a module that arrives in a later live snapshot', () => {
    const root = [createModuleInstanceOperation(1, [0, 10, 0])]
    const before = buildOperationTree({ map: { 0: root } }, 0)
    expect(before.getChildren(branch(before.nodes[0]))).toEqual([])
    const after = buildOperationTree(
      {
        map: {
          0: root,
          1: [createVariableDeclarationOperation([0, 10, 1], 'length')],
        },
      },
      0
    )
    expect(after.getChildren(branch(after.nodes[0]))).toMatchObject([
      { name: 'length' },
    ])
    expect(before.getChildren(branch(before.nodes[0]))).toEqual([])
  })

  it('nests imported module operations under the root module instance', () => {
    const operationsByModule: OperationsByModule = {
      map: {
        0: [createModuleInstanceOperation(1, [0, 10, 0], 'Parameters')],
        1: [createVariableDeclarationOperation([0, 11, 1], 'length')],
      },
    }

    const tree = expandOperationTree(buildOperationTree(operationsByModule, 0))

    expect(tree[0]).toMatchObject({
      parent: { name: 'Parameters' },
      children: [{ name: 'length' }],
    })
  })

  it('deduplicates ModuleInstance when multiple modules import the same module', () => {
    const operationsByModule: OperationsByModule = {
      map: {
        0: [createModuleInstanceOperation(1, [0, 10, 0], 'first')],
        2: [createModuleInstanceOperation(1, [0, 11, 2], 'second')],
      },
    }

    const tree = expandOperationTree(buildOperationTree(operationsByModule, 0))

    // Module 1 is expanded once (from module 0's "first" reference).
    // Module 2's "second" reference to the same module is not added
    // as a top-level branch.
    expect(JSON.stringify(tree)).toContain('first')
    expect(JSON.stringify(tree)).not.toContain('second')
  })

  it('car wheel assembly: modules first, children nested, parameters deduped', () => {
    // Models the car-wheel-assembly import graph:
    //   main.kcl (module 0)
    //     import * from "parameters.kcl"          -> module 1
    //     import "brake-rotor.kcl" as brakeRotor  -> module 2
    //     import "car-tire.kcl" as carTire        -> module 3
    //     import "car-wheel.kcl" as carWheel      -> module 4
    //     import "lug-nut.kcl" as lugNut          -> module 5
    //   Each of modules 2-5 also imports parameters.kcl (module 1).
    //
    // Expected tree from root (module 0):
    //   parameters (expanded, with children)
    //   brakeRotor (expanded, children include parameters as leaf)
    //   carTire    (expanded, children include parameters as leaf)
    //   carWheel   (expanded, children include parameters as leaf)
    //   lugNut     (expanded, children include parameters as leaf)

    const PARAMS = 1
    const ROTOR = 2
    const TIRE = 3
    const WHEEL = 4
    const LUG = 5

    const operationsByModule: OperationsByModule = {
      map: {
        // main.kcl operations
        0: [
          createModuleInstanceOperation(PARAMS, [0, 30, 0], 'parameters'),
          createModuleInstanceOperation(ROTOR, [31, 70, 0], 'brakeRotor'),
          createModuleInstanceOperation(TIRE, [71, 100, 0], 'carTire'),
          createModuleInstanceOperation(WHEEL, [101, 140, 0], 'carWheel'),
          createModuleInstanceOperation(LUG, [141, 170, 0], 'lugNut'),
        ],
        // parameters.kcl operations
        [PARAMS]: [
          createVariableDeclarationOperation([0, 20, PARAMS], 'lugCount'),
          createVariableDeclarationOperation([21, 40, PARAMS], 'wheelRadius'),
        ],
        // brake-rotor.kcl operations
        [ROTOR]: [
          createModuleInstanceOperation(PARAMS, [0, 30, ROTOR], 'parameters'),
          createVariableDeclarationOperation([31, 50, ROTOR], 'rotorSketch'),
        ],
        // car-tire.kcl operations
        [TIRE]: [
          createModuleInstanceOperation(PARAMS, [0, 30, TIRE], 'parameters'),
          createVariableDeclarationOperation([31, 50, TIRE], 'tireSketch'),
        ],
        // car-wheel.kcl operations
        [WHEEL]: [
          createModuleInstanceOperation(PARAMS, [0, 30, WHEEL], 'parameters'),
          createVariableDeclarationOperation([31, 50, WHEEL], 'wheelSketch'),
        ],
        // lug-nut.kcl operations
        [LUG]: [
          createModuleInstanceOperation(PARAMS, [0, 30, LUG], 'parameters'),
          createVariableDeclarationOperation([31, 50, LUG], 'lugSketch'),
        ],
      },
    }

    const tree = expandOperationTree(buildOperationTree(operationsByModule, 0))

    // 1. Imports come first: the first 5 items are module instances
    //    (parameters, brakeRotor, carTire, carWheel, lugNut)
    expect(tree.length).toBe(5)

    // 2. First item: parameters is expanded with children
    expect(tree[0]).toMatchObject({
      parent: { name: 'parameters', moduleId: PARAMS },
      children: [{ name: 'lugCount' }, { name: 'wheelRadius' }],
    })

    // 3. brakeRotor is expanded; its parameters reference is a leaf (not a branch)
    const brakeRotor = tree[1] as any
    expect(brakeRotor.parent).toMatchObject({
      name: 'brakeRotor',
      moduleId: ROTOR,
    })
    // parameters inside brakeRotor should be a leaf operation, not an expanded branch
    const brakeRotorParams = brakeRotor.children.find(
      (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
    )
    expect(brakeRotorParams).toBeDefined()
    expect(brakeRotorParams).not.toHaveProperty('children')

    // 4. Same for carTire
    const carTire = tree[2] as any
    expect(carTire.parent).toMatchObject({
      name: 'carTire',
      moduleId: TIRE,
    })
    const carTireParams = carTire.children.find(
      (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
    )
    expect(carTireParams).toBeDefined()
    expect(carTireParams).not.toHaveProperty('children')

    // 5. Same for carWheel
    const carWheel = tree[3] as any
    expect(carWheel.parent).toMatchObject({
      name: 'carWheel',
      moduleId: WHEEL,
    })
    const carWheelParams = carWheel.children.find(
      (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
    )
    expect(carWheelParams).toBeDefined()
    expect(carWheelParams).not.toHaveProperty('children')

    // 6. Same for lugNut
    const lugNut = tree[4] as any
    expect(lugNut.parent).toMatchObject({
      name: 'lugNut',
      moduleId: LUG,
    })
    const lugNutParams = lugNut.children.find(
      (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
    )
    expect(lugNutParams).toBeDefined()
    expect(lugNutParams).not.toHaveProperty('children')
  })
})

describe('findSameVisibleStdLibOperationAfterSourceChange', () => {
  it('selects the operation at the same visible module-local index', () => {
    const firstBefore = createStdLibCallOperation('fillet', [0, 10, 0])
    const clickedBefore = createStdLibCallOperation('fillet', [20, 30, 0])
    const firstAfter = createStdLibCallOperation('fillet', [0, 20, 0])
    const clickedAfter = createStdLibCallOperation('fillet', [30, 50, 0])

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [firstBefore, clickedBefore],
      afterOperations: [firstAfter, clickedAfter],
    })

    expect(result).toBe(clickedAfter)
  })

  it('uses all visible operations in the module for the index', () => {
    const precedingOperationBefore = createStdLibCallOperation(
      'extrude',
      [0, 10, 0]
    )
    const clickedBefore = createStdLibCallOperation('fillet', [20, 30, 0])
    const precedingOperationAfter = createStdLibCallOperation(
      'extrude',
      [0, 20, 0]
    )
    const clickedAfter = createStdLibCallOperation('fillet', [30, 50, 0])

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [precedingOperationBefore, clickedBefore],
      afterOperations: [precedingOperationAfter, clickedAfter],
    })

    expect(result).toBe(clickedAfter)
  })

  it('matches only operations from the clicked operation module', () => {
    const rootFilletBefore = createStdLibCallOperation('fillet', [0, 10, 0])
    const clickedBefore = createStdLibCallOperation('fillet', [0, 10, 1])
    const rootFilletAfter = createStdLibCallOperation('fillet', [0, 20, 0])
    const clickedAfter = createStdLibCallOperation('fillet', [0, 20, 1])

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [rootFilletBefore, clickedBefore],
      afterOperations: [rootFilletAfter, clickedAfter],
    })

    expect(result).toBe(clickedAfter)
  })

  it('uses feature-tree-visible operations for the ordinal', () => {
    const hiddenBefore = createStdLibCallOperation('fillet', [10, 20, 0])
    const clickedBefore = createStdLibCallOperation('fillet', [30, 40, 0])
    const hiddenAfter = createStdLibCallOperation('fillet', [10, 30, 0])
    const clickedAfter = createStdLibCallOperation('fillet', [40, 60, 0])

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [
        createSketchBlockBegin([0, 10, 0]),
        hiddenBefore,
        createGroupEnd(),
        clickedBefore,
      ],
      afterOperations: [
        createSketchBlockBegin([0, 10, 0]),
        hiddenAfter,
        createGroupEnd(),
        clickedAfter,
      ],
    })

    expect(result).toBe(clickedAfter)
  })

  it('fails closed when the visible operation count changes', () => {
    const firstBefore = createStdLibCallOperation('fillet', [0, 10, 0])
    const clickedBefore = createStdLibCallOperation('fillet', [20, 30, 0])
    const firstAfter = createStdLibCallOperation('fillet', [0, 20, 0])

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [firstBefore, clickedBefore],
      afterOperations: [firstAfter],
    })

    expect(result).toBeUndefined()
  })

  it('fails closed when the target slot has a different operation name', () => {
    const firstBefore = createStdLibCallOperation('fillet', [0, 10, 0])
    const clickedBefore = createStdLibCallOperation('fillet', [20, 30, 0])
    const firstAfter = createStdLibCallOperation('fillet', [0, 20, 0])
    const changedSlotAfter = createStdLibCallOperation('chamfer', [30, 50, 0])

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [firstBefore, clickedBefore],
      afterOperations: [firstAfter, changedSlotAfter],
    })

    expect(result).toBeUndefined()
  })

  it('fails closed when the target slot has a different operation type', () => {
    const firstBefore = createStdLibCallOperation('fillet', [0, 10, 0])
    const clickedBefore = createStdLibCallOperation('fillet', [20, 30, 0])
    const firstAfter = createStdLibCallOperation('fillet', [0, 20, 0])
    const changedSlotAfter = createVariableDeclarationOperation(
      [30, 50, 0],
      'radius'
    )

    const result = findSameVisibleStdLibOperationAfterSourceChange({
      operation: clickedBefore,
      beforeOperations: [firstBefore, clickedBefore],
      afterOperations: [firstAfter, changedSlotAfter],
    })

    expect(result).toBeUndefined()
  })
})
