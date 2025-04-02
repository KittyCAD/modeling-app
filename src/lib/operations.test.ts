import type { Operation } from '@rust/kcl-lib/bindings/Operation'

import { defaultSourceRange } from '@src/lang/wasm'
import { filterOperations } from '@src/lib/operations'

function stdlib(name: string): Operation {
  return {
    type: 'StdLibCall',
    name,
    unlabeledArg: null,
    labeledArgs: {},
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
    sourceRange: defaultSourceRange(),
  }
}
function userReturn(): Operation {
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
