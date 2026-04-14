import type { NodePath } from '@rust/kcl-lib/bindings/NodePath'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { topLevelRange } from '@src/lang/util'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { join } from 'path'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

import {
  type SourceRange,
  assertParse,
  defaultNodePath,
  nodePathFromRange,
} from '@src/lang/wasm'
import {
  filterOperations,
  getOperationVariableName,
  groupNestedOperations,
  groupOperationTypeStreaks,
} from '@src/lib/operations'
import { expect, describe, it } from 'vitest'

function stdlib(name: string): Operation {
  return {
    type: 'StdLibCall',
    name,
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: defaultNodePath(),
    sourceRange: defaultSourceRange(),
    isError: false,
  }
}

function sketchBlockBegin(index = 0): Operation {
  return {
    type: 'GroupBegin',
    group: {
      type: 'SketchBlock',
      sketchId: index + 1,
    },
    nodePath: defaultNodePath(),
    sourceRange: defaultSourceRange(),
  }
}

function sketchBlockEnd(): Operation {
  return {
    type: 'GroupEnd',
  }
}

function userCall(name: string): Operation {
  return {
    type: 'GroupBegin',
    group: {
      type: 'FunctionCall',
      name,
      functionSourceRange: defaultSourceRange(),
      unlabeledArg: null,
      labeledArgs: {},
    },
    nodePath: defaultNodePath(),
    sourceRange: defaultSourceRange(),
  }
}

function userReturn(): Operation {
  return {
    type: 'GroupEnd',
  }
}

function moduleBegin(name: string): Operation {
  return {
    type: 'GroupBegin',
    group: {
      type: 'ModuleInstance',
      name,
      moduleId: 0,
    },
    nodePath: defaultNodePath(),
    sourceRange: defaultSourceRange(),
  }
}

function moduleEnd(): Operation {
  return {
    type: 'GroupEnd',
  }
}

describe('operations.test.ts', () => {
  describe('operations filtering', () => {
    it('drops stdlib operations inside a user-defined function call', async () => {
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        stdlib('std2'),
        stdlib('std3'),
        userReturn(),
        stdlib('std4'),
        stdlib('std5'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        userCall('foo'),
        stdlib('std4'),
        stdlib('std5'),
      ])
    })
    it('drops user-defined function calls that contain no stdlib operations', async () => {
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        userReturn(),
        stdlib('std2'),
        userCall('bar'),
        userReturn(),
        stdlib('std3'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([stdlib('std1'), stdlib('std2'), stdlib('std3')])
    })
    it('does not drop module instances that contain no operations', async () => {
      const operations = [
        stdlib('std1'),
        moduleBegin('foo'),
        moduleEnd(),
        stdlib('std2'),
        moduleBegin('bar'),
        moduleEnd(),
        stdlib('std3'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        moduleBegin('foo'),
        stdlib('std2'),
        moduleBegin('bar'),
        stdlib('std3'),
      ])
    })
    it('preserves user-defined function calls at the end of the list', async () => {
      const operations = [stdlib('std1'), userCall('foo')]
      const actual = filterOperations(operations)
      expect(actual).toEqual([stdlib('std1'), userCall('foo')])
    })
    it('drops all user-defined function return operations', async () => {
      // The returns allow us to group operations with the call, but we never
      // display the returns.
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        stdlib('std2'),
        userReturn(),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std5'),
        stdlib('std6'),
        userReturn(),
        stdlib('std7'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        userCall('foo'),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std7'),
      ])
    })
    it('correctly filters with nested function calls', async () => {
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        stdlib('std2'),
        userReturn(),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std5'),
        userCall('foo3-nested'),
        stdlib('std6'),
        userReturn(),
        stdlib('std7'),
        userReturn(),
        stdlib('std8'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        userCall('foo'),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std8'),
      ])
    })

    it('keeps sketch group parent and excludes sketch group internals', async () => {
      const operations = [
        sketchBlockBegin(0),
        stdlib('line'),
        stdlib('coincident'),
        sketchBlockEnd(),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([sketchBlockBegin(0)])
    })
  })

  function rangeOfText(fullCode: string, target: string): SourceRange {
    const start = fullCode.indexOf(target)
    if (start === -1) {
      throw new Error(`Could not find \`${target}\` in: ${fullCode}`)
    }
    return topLevelRange(start, start + target.length)
  }

  async function buildNodePath(
    code: string,
    target: string,
    instance: ModuleType
  ): Promise<NodePath> {
    const sourceRange = rangeOfText(code, target)
    const program = assertParse(code, instance)
    return (
      (await nodePathFromRange(program, sourceRange, instance)) ??
      defaultNodePath()
    )
  }

  describe('variable name of operations', () => {
    it('finds the variable name with simple assignment', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `myVar = stdLibFn()`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()', instance)

      const program = assertParse(code, instance)
      const variableName = getOperationVariableName(op, program, instance)
      expect(variableName).toBe('myVar')
    })
    it('finds the variable name inside a function with simple assignment', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `fn myFunc() {
  myVar = stdLibFn()
  return 0
}
`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()', instance)

      const program = assertParse(code, instance)
      const variableName = getOperationVariableName(op, program, instance)
      expect(variableName).toBe('myVar')
    })
    it("finds the variable name when it's the last in a pipeline", async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `myVar = foo()
  |> stdLibFn()
`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()', instance)

      const program = assertParse(code, instance)
      const variableName = getOperationVariableName(op, program, instance)
      expect(variableName).toBe('myVar')
    })
    it("finds nothing when it's not the last in a pipeline", async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `myVar = foo()
  |> stdLibFn()
  |> bar()
`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()', instance)

      const program = assertParse(code, instance)
      const variableName = getOperationVariableName(op, program, instance)
      expect(variableName).toBeUndefined()
    })
    it('finds variable names for operations inside a sketch block', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -13.64mm, var 7.86mm], end = [var 0mm, var 18.94mm])
  horizontalDistance([line1.end, ORIGIN]) == 0mm
  line2 = line(start = [var -12.18mm, var -3.65mm], end = [var -13.64mm, var 7.86mm])
  coincident([line2.end, line1.start])
  point2 = point(at = [var 7.65mm, var 18.08mm])
  point1 = point(at = [var 9.37mm, var 7.94mm])
  verticalDistance([point1, point2]) == 0mm
  circle1 = circle(start = [var 10.57mm, var 2.96mm], center = [var 10.49mm, var 0mm])
  arc1 = arc(start = [var 1.04mm, var -8.29mm], end = [var -3.62mm, var -5.28mm], center = [var -3.42mm, var -10.09mm])
  coincident([arc1.end, line2.start])
}
`
      const program = assertParse(code, instance)

      const cases = [
        {
          name: 'line',
          target:
            'line(start = [var -13.64mm, var 7.86mm], end = [var 0mm, var 18.94mm])',
          expected: 'line1',
        },
        {
          name: 'line',
          target:
            'line(start = [var -12.18mm, var -3.65mm], end = [var -13.64mm, var 7.86mm])',
          expected: 'line2',
        },
        {
          name: 'point',
          target: 'point(at = [var 7.65mm, var 18.08mm])',
          expected: 'point2',
        },
        {
          name: 'point',
          target: 'point(at = [var 9.37mm, var 7.94mm])',
          expected: 'point1',
        },
        {
          name: 'arc',
          target:
            'arc(start = [var 1.04mm, var -8.29mm], end = [var -3.62mm, var -5.28mm], center = [var -3.42mm, var -10.09mm])',
          expected: 'arc1',
        },
        {
          name: 'circle',
          target:
            'circle(start = [var 10.57mm, var 2.96mm], center = [var 10.49mm, var 0mm])',
          expected: 'circle1',
        },
      ] as const

      for (const testCase of cases) {
        const op = stdlib(testCase.name)
        if (op.type !== 'StdLibCall') {
          throw new Error('Expected operation to be a StdLibCall')
        }
        op.nodePath = await buildNodePath(code, testCase.target, instance)

        const variableName = getOperationVariableName(op, program, instance)
        expect(variableName).toBe(testCase.expected)
      }
    })
  })

  /**
   * We don't have helpers for VariableDeclaration type Operations in this file,
   * so these tests just generate nonsense operation lists, but the grouping function
   * is generic enough to prove out our use case in the app.
   */
  describe('groupOperationTypeStreaks', () => {
    it('groups StdLibCall streaks separated by one item and leaves short streaks ungrouped', () => {
      const ops = [
        stdlib('s1'),
        stdlib('s2'),
        stdlib('s3'),
        // separator of a different type
        userCall('sep1'),
        // a longer streak that exceeds the min
        stdlib('s4'),
        stdlib('s5'),
        stdlib('s6'),
        stdlib('s7'),
        // another separator
        userCall('sep2'),
        // short streak under the minimum
        stdlib('s8'),
        stdlib('s9'),
      ]

      const actual = groupOperationTypeStreaks(ops, ['StdLibCall'], 3)

      expect(actual).toEqual([
        [stdlib('s1'), stdlib('s2'), stdlib('s3')],
        userCall('sep1'),
        [stdlib('s4'), stdlib('s5'), stdlib('s6'), stdlib('s7')],
        userCall('sep2'),
        stdlib('s8'),
        stdlib('s9'),
      ])
    })

    it('groups multiple operation types when listed in typesToGroup', () => {
      const ops = [
        // GroupBegin streak
        userCall('a'),
        userCall('b'),
        // StdLibCall streak
        stdlib('s1'),
        stdlib('s2'),
        // Module instance GroupBegin streak
        moduleBegin('m1'),
        moduleBegin('m2'),
        // separator not included in grouping
        userReturn(),
        // trailing single stdlib (below minLength of 2 if separated)
        stdlib('s3'),
      ]

      const actual = groupOperationTypeStreaks(
        ops,
        ['GroupBegin', 'StdLibCall'],
        2
      )

      expect(actual).toEqual([
        [userCall('a'), userCall('b')],
        [stdlib('s1'), stdlib('s2')],
        [moduleBegin('m1'), moduleBegin('m2')],
        userReturn(),
        stdlib('s3'),
      ])
    })
  })

  describe('groupNestedOperations', () => {
    it('groups contiguous operations from the same sketch block', () => {
      const allOps = [
        stdlib('offsetPlane'),
        sketchBlockBegin(1),
        stdlib('horizontal'),
        stdlib('vertical'),
        stdlib('coincident'),
        sketchBlockEnd(),
        stdlib('extrude'),
      ]
      const ops = groupOperationTypeStreaks(filterOperations(allOps), [
        'VariableDeclaration',
      ])

      const actual = groupNestedOperations(
        ops,
        allOps,
        (groupBegin) => groupBegin.group.type === 'SketchBlock'
      )

      expect(actual).toEqual([
        stdlib('offsetPlane'),
        [
          sketchBlockBegin(1),
          stdlib('horizontal'),
          stdlib('vertical'),
          stdlib('coincident'),
          sketchBlockEnd(),
        ],
        stdlib('extrude'),
      ])
    })

    it('keeps separate sketch blocks separate', () => {
      const allOps = [
        sketchBlockBegin(1),
        stdlib('horizontal'),
        stdlib('vertical'),
        sketchBlockEnd(),
        stdlib('offsetPlane'),
        sketchBlockBegin(2),
        stdlib('coincident'),
        sketchBlockEnd(),
        stdlib('extrude'),
      ]
      const ops = groupOperationTypeStreaks(filterOperations(allOps), [
        'VariableDeclaration',
      ])

      const actual = groupNestedOperations(
        ops,
        allOps,
        (groupBegin) => groupBegin.group.type === 'SketchBlock'
      )

      expect(actual).toEqual([
        [
          sketchBlockBegin(1),
          stdlib('horizontal'),
          stdlib('vertical'),
          sketchBlockEnd(),
        ],
        stdlib('offsetPlane'),
        [sketchBlockBegin(2), stdlib('coincident'), sketchBlockEnd()],
        stdlib('extrude'),
      ])
    })

    it('does not merge pre-grouped operation streaks into sketch block groups', () => {
      const allOps = [
        sketchBlockBegin(1),
        stdlib('horizontal'),
        stdlib('vertical'),
        sketchBlockEnd(),
      ]
      const ops = [[stdlib('a'), stdlib('b')], sketchBlockBegin(1)]

      const actual = groupNestedOperations(
        ops,
        allOps,
        (groupBegin) => groupBegin.group.type === 'SketchBlock'
      )

      expect(actual).toEqual([
        [stdlib('a'), stdlib('b')],
        [
          sketchBlockBegin(1),
          stdlib('horizontal'),
          stdlib('vertical'),
          sketchBlockEnd(),
        ],
      ])
    })
    it('can group any GroupBegin type with a predicate', () => {
      const allOps = [
        userCall('foo'),
        stdlib('inside'),
        userReturn(),
        stdlib('outside'),
      ]
      const ops = filterOperations(allOps)

      const actual = groupNestedOperations(
        ops,
        allOps,
        (groupBegin) => groupBegin.group.type === 'FunctionCall'
      )

      expect(actual).toEqual([
        [userCall('foo'), stdlib('inside'), userReturn()],
        stdlib('outside'),
      ])
    })
  })
})
