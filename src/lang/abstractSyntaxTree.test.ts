import { KCLError } from './errors'
import { initPromise, parse } from './wasm'

beforeAll(() => initPromise)

describe('testing AST', () => {
  test('5 + 6', () => {
    const result = parse('5 +6')
    delete (result as any).nonCodeMeta
    expect(result.body).toEqual([
      {
        type: 'ExpressionStatement',
        start: 0,
        end: 4,
        expression: {
          type: 'BinaryExpression',
          start: 0,
          end: 4,
          left: {
            type: 'Literal',
            start: 0,
            end: 1,
            value: 5,
            raw: '5',
          },
          operator: '+',
          right: {
            type: 'Literal',
            start: 3,
            end: 4,
            value: 6,
            raw: '6',
          },
        },
      },
    ])
  })
  test('const myVar = 5', () => {
    const { body } = parse('const myVar = 5')
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 5,
              raw: '5',
            },
          },
        ],
      },
    ])
  })
  test('multi-line', () => {
    const code = `const myVar = 5
const newVar = myVar + 1
`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 5,
              raw: '5',
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 16,
        end: 40,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 40,
            id: {
              type: 'Identifier',
              start: 22,
              end: 28,
              name: 'newVar',
            },
            init: {
              type: 'BinaryExpression',
              start: 31,
              end: 40,
              left: {
                type: 'Identifier',
                start: 31,
                end: 36,
                name: 'myVar',
              },
              operator: '+',
              right: {
                type: 'Literal',
                start: 39,
                end: 40,
                value: 1,
                raw: '1',
              },
            },
          },
        ],
      },
    ])
  })
})

describe('testing function declaration', () => {
  test('fn funcN = (a, b) => {return a + b}', () => {
    const { body } = parse(
      ['fn funcN = (a, b) => {', '  return a + b', '}'].join('\n')
    )
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 39,
        kind: 'fn',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 39,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 39,
              params: [
                {
                  type: 'Identifier',
                  start: 12,
                  end: 13,
                  name: 'a',
                },
                {
                  type: 'Identifier',
                  start: 15,
                  end: 16,
                  name: 'b',
                },
              ],
              body: {
                start: 21,
                end: 39,
                body: [
                  {
                    type: 'ReturnStatement',
                    start: 25,
                    end: 37,
                    argument: {
                      type: 'BinaryExpression',
                      start: 32,
                      end: 37,
                      left: {
                        type: 'Identifier',
                        start: 32,
                        end: 33,
                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 36,
                        end: 37,
                        name: 'b',
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ])
  })
  test('call expression assignment', () => {
    const code = `fn funcN = (a, b) => { return a + b }
const myVar = funcN(1, 2)`
    const { body } = parse(code)
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        kind: 'fn',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 37,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 37,
              params: [
                {
                  type: 'Identifier',
                  start: 12,
                  end: 13,
                  name: 'a',
                },
                {
                  type: 'Identifier',
                  start: 15,
                  end: 16,
                  name: 'b',
                },
              ],
              body: {
                start: 21,
                end: 37,
                body: [
                  {
                    type: 'ReturnStatement',
                    start: 23,
                    end: 35,
                    argument: {
                      type: 'BinaryExpression',
                      start: 30,
                      end: 35,
                      left: {
                        type: 'Identifier',
                        start: 30,
                        end: 31,
                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 34,
                        end: 35,
                        name: 'b',
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 38,
        end: 63,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 44,
            end: 63,
            id: {
              type: 'Identifier',
              start: 44,
              end: 49,
              name: 'myVar',
            },
            init: {
              type: 'CallExpression',
              start: 52,
              end: 63,
              callee: {
                type: 'Identifier',
                start: 52,
                end: 57,
                name: 'funcN',
              },
              arguments: [
                {
                  type: 'Literal',
                  start: 58,
                  end: 59,
                  value: 1,
                  raw: '1',
                },
                {
                  type: 'Literal',
                  start: 61,
                  end: 62,
                  value: 2,
                  raw: '2',
                },
              ],
              optional: false,
            },
          },
        ],
      },
    ])
  })
})

describe('testing pipe operator special', () => {
  test('pipe operator with sketch', () => {
    let code = `const mySketch = startSketchAt([0, 0])
  |> lineTo([2, 3], %)
  |> lineTo({ to: [0, 1], tag: "myPath" }, %)
  |> lineTo([1, 1], %)
  |> rx(45, %)
`
    const { body } = parse(code)
    delete (body[0] as any).declarations[0].init.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 145,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 145,
            id: { type: 'Identifier', start: 6, end: 14, name: 'mySketch' },
            init: {
              type: 'PipeExpression',
              start: 17,
              end: 145,
              body: [
                {
                  type: 'CallExpression',
                  start: 17,
                  end: 38,
                  callee: {
                    type: 'Identifier',
                    start: 17,
                    end: 30,
                    name: 'startSketchAt',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 31,
                      end: 37,
                      elements: [
                        {
                          type: 'Literal',
                          start: 32,
                          end: 33,
                          value: 0,
                          raw: '0',
                        },
                        {
                          type: 'Literal',
                          start: 35,
                          end: 36,
                          value: 0,
                          raw: '0',
                        },
                      ],
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 44,
                  end: 61,
                  callee: {
                    type: 'Identifier',
                    start: 44,
                    end: 50,
                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 51,
                      end: 57,
                      elements: [
                        {
                          type: 'Literal',
                          start: 52,
                          end: 53,
                          value: 2,
                          raw: '2',
                        },
                        {
                          type: 'Literal',
                          start: 55,
                          end: 56,
                          value: 3,
                          raw: '3',
                        },
                      ],
                    },
                    { type: 'PipeSubstitution', start: 59, end: 60 },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 67,
                  end: 107,
                  callee: {
                    type: 'Identifier',
                    start: 67,
                    end: 73,
                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ObjectExpression',
                      start: 74,
                      end: 103,
                      properties: [
                        {
                          type: 'ObjectProperty',
                          start: 76,
                          end: 86,
                          key: {
                            type: 'Identifier',
                            start: 76,
                            end: 78,
                            name: 'to',
                          },
                          value: {
                            type: 'ArrayExpression',
                            start: 80,
                            end: 86,
                            elements: [
                              {
                                type: 'Literal',
                                start: 81,
                                end: 82,
                                value: 0,
                                raw: '0',
                              },
                              {
                                type: 'Literal',
                                start: 84,
                                end: 85,
                                value: 1,
                                raw: '1',
                              },
                            ],
                          },
                        },
                        {
                          type: 'ObjectProperty',
                          start: 88,
                          end: 101,
                          key: {
                            type: 'Identifier',
                            start: 88,
                            end: 91,
                            name: 'tag',
                          },
                          value: {
                            type: 'Literal',
                            start: 93,
                            end: 101,
                            value: 'myPath',
                            raw: '"myPath"',
                          },
                        },
                      ],
                    },
                    { type: 'PipeSubstitution', start: 105, end: 106 },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 113,
                  end: 130,
                  callee: {
                    type: 'Identifier',
                    start: 113,
                    end: 119,
                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 120,
                      end: 126,
                      elements: [
                        {
                          type: 'Literal',
                          start: 121,
                          end: 122,
                          value: 1,
                          raw: '1',
                        },
                        {
                          type: 'Literal',
                          start: 124,
                          end: 125,
                          value: 1,
                          raw: '1',
                        },
                      ],
                    },
                    { type: 'PipeSubstitution', start: 128, end: 129 },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 136,
                  end: 145,
                  callee: {
                    type: 'Identifier',
                    start: 136,
                    end: 138,
                    name: 'rx',
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 139,
                      end: 141,
                      value: 45,
                      raw: '45',
                    },
                    { type: 'PipeSubstitution', start: 143, end: 144 },
                  ],
                  optional: false,
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('pipe operator with binary expression', () => {
    let code = `const myVar = 5 + 6 |> myFunc(45, %)`
    const { body } = parse(code)
    delete (body as any)[0].declarations[0].init.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 36,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 36,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
            },
            init: {
              type: 'PipeExpression',
              start: 14,
              end: 36,
              body: [
                {
                  type: 'BinaryExpression',
                  start: 14,
                  end: 19,
                  left: {
                    type: 'Literal',
                    start: 14,
                    end: 15,
                    value: 5,
                    raw: '5',
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 18,
                    end: 19,
                    value: 6,
                    raw: '6',
                  },
                },
                {
                  type: 'CallExpression',
                  start: 23,
                  end: 36,
                  callee: {
                    type: 'Identifier',
                    start: 23,
                    end: 29,
                    name: 'myFunc',
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 30,
                      end: 32,
                      value: 45,
                      raw: '45',
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 34,
                      end: 35,
                    },
                  ],
                  optional: false,
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('array expression', () => {
    let code = `const yo = [1, '2', three, 4 + 5]`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 33,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 33,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
            },
            init: {
              type: 'ArrayExpression',
              start: 11,
              end: 33,
              elements: [
                {
                  type: 'Literal',
                  start: 12,
                  end: 13,
                  value: 1,
                  raw: '1',
                },
                {
                  type: 'Literal',
                  start: 15,
                  end: 18,
                  value: '2',
                  raw: "'2'",
                },
                {
                  type: 'Identifier',
                  start: 20,
                  end: 25,
                  name: 'three',
                },
                {
                  type: 'BinaryExpression',
                  start: 27,
                  end: 32,
                  left: {
                    type: 'Literal',
                    start: 27,
                    end: 28,
                    value: 4,
                    raw: '4',
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 31,
                    end: 32,
                    value: 5,
                    raw: '5',
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('object expression ast', () => {
    const code = [
      'const three = 3',
      "const yo = {aStr: 'str', anum: 2, identifier: three, binExp: 4 + 5}",
    ].join('\n')
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'three',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 3,
              raw: '3',
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 16,
        end: 83,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 83,
            id: {
              type: 'Identifier',
              start: 22,
              end: 24,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 27,
              end: 83,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 28,
                  end: 39,
                  key: {
                    type: 'Identifier',
                    start: 28,
                    end: 32,
                    name: 'aStr',
                  },
                  value: {
                    type: 'Literal',
                    start: 34,
                    end: 39,
                    value: 'str',
                    raw: "'str'",
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 41,
                  end: 48,
                  key: {
                    type: 'Identifier',
                    start: 41,
                    end: 45,
                    name: 'anum',
                  },
                  value: {
                    type: 'Literal',
                    start: 47,
                    end: 48,
                    value: 2,
                    raw: '2',
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 50,
                  end: 67,
                  key: {
                    type: 'Identifier',
                    start: 50,
                    end: 60,
                    name: 'identifier',
                  },
                  value: {
                    type: 'Identifier',
                    start: 62,
                    end: 67,
                    name: 'three',
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 69,
                  end: 82,
                  key: {
                    type: 'Identifier',
                    start: 69,
                    end: 75,
                    name: 'binExp',
                  },
                  value: {
                    type: 'BinaryExpression',
                    start: 77,
                    end: 82,
                    left: {
                      type: 'Literal',
                      start: 77,
                      end: 78,
                      value: 4,
                      raw: '4',
                    },
                    operator: '+',
                    right: {
                      type: 'Literal',
                      start: 81,
                      end: 82,
                      value: 5,
                      raw: '5',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('nested object expression ast', () => {
    const code = `const yo = {key: {
  key2: 'value'
}}`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 37,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 37,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 36,
                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    name: 'key',
                  },
                  value: {
                    type: 'ObjectExpression',
                    start: 17,
                    end: 36,
                    properties: [
                      {
                        type: 'ObjectProperty',
                        start: 21,
                        end: 34,
                        key: {
                          type: 'Identifier',
                          start: 21,
                          end: 25,
                          name: 'key2',
                        },
                        value: {
                          type: 'Literal',
                          start: 27,
                          end: 34,
                          value: 'value',
                          raw: "'value'",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('object expression with array ast', () => {
    const code = `const yo = {key: [1, '2']}`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 26,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 25,
                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    name: 'key',
                  },
                  value: {
                    type: 'ArrayExpression',
                    start: 17,
                    end: 25,
                    elements: [
                      {
                        type: 'Literal',
                        start: 18,
                        end: 19,
                        value: 1,
                        raw: '1',
                      },
                      {
                        type: 'Literal',
                        start: 21,
                        end: 24,
                        value: '2',
                        raw: "'2'",
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression simple', () => {
    const code = `const prop = yo.one.two`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 23,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 23,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 23,
              computed: false,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  name: 'one',
                },
              },
              property: {
                type: 'Identifier',
                start: 20,
                end: 23,
                name: 'two',
              },
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression with square braces', () => {
    const code = `const prop = yo.one["two"]`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 26,
              computed: false,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  name: 'one',
                },
              },
              property: {
                type: 'Literal',
                start: 20,
                end: 25,
                value: 'two',
                raw: '"two"',
              },
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression with two square braces literal and identifier', () => {
    const code = `const prop = yo["one"][two]`
    const { body } = parse(code)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 27,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 27,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 27,
              computed: true,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 22,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                },
                property: {
                  type: 'Literal',
                  start: 16,
                  end: 21,
                  value: 'one',
                  raw: '"one"',
                },
              },
              property: {
                type: 'Identifier',
                start: 23,
                end: 26,
                name: 'two',
              },
            },
          },
        ],
      },
    ])
  })
})

describe('nests binary expressions correctly', () => {
  it('works with the simple case', () => {
    const code = `const yo = 1 + 2`
    const { body } = parse(code)
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 16,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 16,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 16,
            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              value: 1,
              raw: '1',
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 15,
              end: 16,
              value: 2,
              raw: '2',
            },
          },
        },
      ],
    })
  })
  it('should nest according to precedence with multiply first', () => {
    // should be binExp { binExp { lit-1 * lit-2 } + lit}
    const code = `const yo = 1 * 2 + 3`
    const { body } = parse(code)
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 20,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            left: {
              type: 'BinaryExpression',
              start: 11,
              end: 16,
              left: {
                type: 'Literal',
                start: 11,
                end: 12,
                value: 1,
                raw: '1',
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 15,
                end: 16,
                value: 2,
                raw: '2',
              },
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 19,
              end: 20,
              value: 3,
              raw: '3',
            },
          },
        },
      ],
    })
  })
  it('should nest according to precedence with sum first', () => {
    // should be binExp { lit-1 + binExp { lit-2 * lit-3 } }
    const code = `const yo = 1 + 2 * 3`
    const { body } = parse(code)
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 20,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              value: 1,
              raw: '1',
            },
            operator: '+',
            right: {
              type: 'BinaryExpression',
              start: 15,
              end: 20,
              left: {
                type: 'Literal',
                start: 15,
                end: 16,
                value: 2,
                raw: '2',
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 19,
                end: 20,
                value: 3,
                raw: '3',
              },
            },
          },
        },
      ],
    })
  })
  it('should nest properly with two operators of equal precedence', () => {
    const code = `const yo = 1 + 2 - 3`
    const { body } = parse(code)
    expect((body[0] as any).declarations[0].init).toEqual({
      type: 'BinaryExpression',
      start: 11,
      end: 20,
      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          value: 1,
          raw: '1',
        },
        operator: '+',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          value: 2,
          raw: '2',
        },
      },
      operator: '-',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        value: 3,
        raw: '3',
      },
    })
  })
  it('should nest properly with two operators of equal (but higher) precedence', () => {
    const code = `const yo = 1 * 2 / 3`
    const { body } = parse(code)
    expect((body[0] as any).declarations[0].init).toEqual({
      type: 'BinaryExpression',
      start: 11,
      end: 20,
      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          value: 1,
          raw: '1',
        },
        operator: '*',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          value: 2,
          raw: '2',
        },
      },
      operator: '/',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        value: 3,
        raw: '3',
      },
    })
  })
  it('should nest properly with longer example', () => {
    const code = `const yo = 1 + 2 * (3 - 4) / 5 + 6`
    const { body } = parse(code)
    const init = (body[0] as any).declarations[0].init
    expect(init).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 11,
      end: 34,
      left: {
        type: 'BinaryExpression',
        operator: '+',
        start: 11,
        end: 30,
        left: { type: 'Literal', value: 1, raw: '1', start: 11, end: 12 },
        right: {
          type: 'BinaryExpression',
          operator: '/',
          start: 15,
          end: 30,
          left: {
            type: 'BinaryExpression',
            operator: '*',
            start: 15,
            end: 25,
            left: { type: 'Literal', value: 2, raw: '2', start: 15, end: 16 },
            right: {
              type: 'BinaryExpression',
              operator: '-',
              start: 20,
              end: 25,
              left: { type: 'Literal', value: 3, raw: '3', start: 20, end: 21 },
              right: {
                type: 'Literal',
                value: 4,
                raw: '4',
                start: 24,
                end: 25,
              },
            },
          },
          right: { type: 'Literal', value: 5, raw: '5', start: 29, end: 30 },
        },
      },
      right: { type: 'Literal', value: 6, raw: '6', start: 33, end: 34 },
    })
  })
})

describe('check nonCodeMeta data is attached to the AST correctly', () => {
  it('comments between expressions', () => {
    const code = `
const yo = { a: { b: { c: '123' } } }
// this is a comment
const key = 'c'`
    const nonCodeMetaInstance = {
      type: 'NonCodeNode',
      start: code.indexOf('\n// this is a comment'),
      end: code.indexOf('const key') - 1,
      value: {
        type: 'blockComment',
        style: 'line',
        value: 'this is a comment',
      },
    }
    const { nonCodeMeta } = parse(code)
    expect(nonCodeMeta.nonCodeNodes[0][0]).toEqual(nonCodeMetaInstance)

    // extra whitespace won't change it's position (0) or value (NB the start end would have changed though)
    const codeWithExtraStartWhitespace = '\n\n\n' + code
    const { nonCodeMeta: nonCodeMeta2 } = parse(codeWithExtraStartWhitespace)
    expect(nonCodeMeta2.nonCodeNodes[0][0].value).toStrictEqual(
      nonCodeMetaInstance.value
    )
    expect(nonCodeMeta2.nonCodeNodes[0][0].start).not.toBe(
      nonCodeMetaInstance.start
    )
  })
  it('comments nested within a block statement', () => {
    const code = `const mySketch = startSketchAt([0,0])
  |> lineTo({ to: [0, 1], tag: 'myPath' }, %)
  |> lineTo([1, 1], %) /* this is
      a comment
      spanning a few lines */
  |> lineTo({ to: [1,0], tag: "rightPath" }, %)
  |> close(%)
`

    const { body } = parse(code)
    const indexOfSecondLineToExpression = 2
    const sketchNonCodeMeta = (body as any)[0].declarations[0].init.nonCodeMeta
      .nonCodeNodes
    expect(sketchNonCodeMeta[indexOfSecondLineToExpression][0]).toEqual({
      type: 'NonCodeNode',
      start: 106,
      end: 163,
      value: {
        type: 'inlineComment',
        style: 'block',
        value: 'this is\n      a comment\n      spanning a few lines',
      },
    })
  })
  it('comments in a pipe expression', () => {
    const code = [
      'const mySk1 = startSketchAt([0, 0])',
      '  |> lineTo([1, 1], %)',
      '  |> lineTo({to: [0, 1], tag: "myPath"}, %)',
      '  |> lineTo([1, 1], %)',
      '// a comment',
      '  |> rx(90, %)',
    ].join('\n')

    const { body } = parse(code)
    const sketchNonCodeMeta = (body[0] as any).declarations[0].init.nonCodeMeta
      .nonCodeNodes[3][0]
    expect(sketchNonCodeMeta).toEqual({
      type: 'NonCodeNode',
      start: 125,
      end: 138,
      value: {
        type: 'blockComment',
        value: 'a comment',
        style: 'line',
      },
    })
  })
})

describe('test UnaryExpression', () => {
  it('should parse a unary expression in simple var dec situation', () => {
    const code = `const myVar = -min(4, 100)`
    const { body } = parse(code)
    const myVarInit = (body?.[0] as any).declarations[0]?.init
    expect(myVarInit).toEqual({
      type: 'UnaryExpression',
      operator: '-',
      start: 14,
      end: 26,
      argument: {
        type: 'CallExpression',
        start: 15,
        end: 26,
        callee: { type: 'Identifier', start: 15, end: 18, name: 'min' },
        arguments: [
          { type: 'Literal', start: 19, end: 20, value: 4, raw: '4' },
          { type: 'Literal', start: 22, end: 25, value: 100, raw: '100' },
        ],
        optional: false,
      },
    })
  })
})

describe('testing nested call expressions', () => {
  it('callExp in a binExp in a callExp', () => {
    const code = 'const myVar = min(100, 1 + legLen(5, 3))'
    const { body } = parse(code)
    const myVarInit = (body?.[0] as any).declarations[0]?.init
    expect(myVarInit).toEqual({
      type: 'CallExpression',
      start: 14,
      end: 40,
      callee: { type: 'Identifier', start: 14, end: 17, name: 'min' },
      arguments: [
        { type: 'Literal', start: 18, end: 21, value: 100, raw: '100' },
        {
          type: 'BinaryExpression',
          operator: '+',
          start: 23,
          end: 39,
          left: { type: 'Literal', value: 1, raw: '1', start: 23, end: 24 },
          right: {
            type: 'CallExpression',
            start: 27,
            end: 39,
            callee: { type: 'Identifier', start: 27, end: 33, name: 'legLen' },
            arguments: [
              { type: 'Literal', start: 34, end: 35, value: 5, raw: '5' },
              { type: 'Literal', start: 37, end: 38, value: 3, raw: '3' },
            ],
            optional: false,
          },
        },
      ],
      optional: false,
    })
  })
})

describe('should recognise callExpresions in binaryExpressions', () => {
  const code = "xLineTo(segEndX('seg02', %) + 1, %)"
  it('should recognise the callExp', () => {
    const { body } = parse(code)
    const callExpArgs = (body?.[0] as any).expression?.arguments
    expect(callExpArgs).toEqual([
      {
        type: 'BinaryExpression',
        operator: '+',
        start: 8,
        end: 31,
        left: {
          type: 'CallExpression',
          start: 8,
          end: 27,
          callee: { type: 'Identifier', start: 8, end: 15, name: 'segEndX' },
          arguments: [
            {
              type: 'Literal',
              start: 16,
              end: 23,
              value: 'seg02',
              raw: "'seg02'",
            },
            { type: 'PipeSubstitution', start: 25, end: 26 },
          ],
          optional: false,
        },
        right: { type: 'Literal', value: 1, raw: '1', start: 30, end: 31 },
      },
      { type: 'PipeSubstitution', start: 33, end: 34 },
    ])
  })
})

describe('parsing errors', () => {
  it('should return an error when there is a unexpected closed curly brace', async () => {
    const code = `const myVar = startSketchAt([}], %)`

    let _theError
    try {
      const result = expect(parse(code))
    } catch (e) {
      _theError = e
    }
    const theError = _theError as any
    expect(theError).toEqual(
      new KCLError('syntax', 'Unexpected token', [[27, 28]])
    )
  })
})
