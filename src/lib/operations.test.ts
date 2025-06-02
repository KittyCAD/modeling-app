import type { NodePath } from '@rust/kcl-lib/bindings/NodePath'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { topLevelRange } from '@src/lang/util'

import {
  assertParse,
  defaultNodePath,
  defaultSourceRange,
  nodePathFromRange,
  type SourceRange,
} from '@src/lang/wasm'
import { filterOperations, getOperationVariableName } from '@src/lib/operations'

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
})

function rangeOfText(fullCode: string, target: string): SourceRange {
  const start = fullCode.indexOf(target)
  if (start === -1) {
    throw new Error(`Could not find \`${target}\` in: ${fullCode}`)
  }
  return topLevelRange(start, start + target.length)
}

async function buildNodePath(code: string, target: string): Promise<NodePath> {
  const sourceRange = rangeOfText(code, target)
  const program = assertParse(code)
  return (await nodePathFromRange(program, sourceRange)) ?? defaultNodePath()
}

describe('variable name of operations', () => {
  it('finds the variable name with simple assignment', async () => {
    const op = stdlib('stdLibFn')
    if (op.type !== 'StdLibCall') {
      throw new Error('Expected operation to be a StdLibCall')
    }
    const code = `myVar = stdLibFn()`
    // Make the path match the code.
    op.nodePath = await buildNodePath(code, 'stdLibFn()')

    const program = assertParse(code)
    const variableName = getOperationVariableName(op, program)
    expect(variableName).toBe('myVar')
  })
  it('finds the variable name inside a function with simple assignment', async () => {
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
    op.nodePath = await buildNodePath(code, 'stdLibFn()')

    const program = assertParse(code)
    const variableName = getOperationVariableName(op, program)
    expect(variableName).toBe('myVar')
  })
  it("finds the variable name when it's the last in a pipeline", async () => {
    const op = stdlib('stdLibFn')
    if (op.type !== 'StdLibCall') {
      throw new Error('Expected operation to be a StdLibCall')
    }
    const code = `myVar = foo()
  |> stdLibFn()
`
    // Make the path match the code.
    op.nodePath = await buildNodePath(code, 'stdLibFn()')

    const program = assertParse(code)
    const variableName = getOperationVariableName(op, program)
    expect(variableName).toBe('myVar')
  })
  it("finds nothing when it's not the last in a pipeline", async () => {
    const op = stdlib('stdLibFn')
    if (op.type !== 'StdLibCall') {
      throw new Error('Expected operation to be a StdLibCall')
    }
    const code = `myVar = foo()
  |> stdLibFn()
  |> bar()
`
    // Make the path match the code.
    op.nodePath = await buildNodePath(code, 'stdLibFn()')

    const program = assertParse(code)
    const variableName = getOperationVariableName(op, program)
    expect(variableName).toBeUndefined()
  })
})
