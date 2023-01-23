import { findTokensBetweenStatements } from './nonAstTokenHelpers'
import { Token } from './tokeniser'
import { BodyItem } from './abstractSyntaxTree'

describe('verify code', () => {
  it('should find tokens between statements', () => {
    const statement1 = {
      type: 'yoyo',
      start: 105,
      end: 111,
    }

    const statement2 = {
      type: 'yoyo',
      start: 150,
      end: 156,
    }

    const tokens: Token[] = [
      {
        type: 'word',
        value: 'yoyo',
        start: 100,
        end: 104,
      },
      {
        type: 'whitespace',
        value: ' ',
        start: 111,
        end: 115,
      },
      {
        type: 'linecomment',
        value: '// this is a comment',
        start: 115,
        end: 119,
      },
      {
        type: 'whitespace',
        value: ' ',
        start: 157,
        end: 161,
      },
    ]
    const result = findTokensBetweenStatements(statement1, statement2, tokens)
    // should grab the middle two tokens an the start and end tokens are less than the first statement
    // and greater than the second statement respectively
    expect(result).toEqual([
      { type: 'whitespace', value: ' ', start: 111, end: 115 },
      {
        type: 'linecomment',
        value: '// this is a comment',
        start: 115,
        end: 119,
      },
    ])
  })
  it('propert test with our types', () => {
    const tokens: Token[] = [
      {
        type: 'whitespace',
        value: '\n',
        start: 37,
        end: 38,
      },
      {
        type: 'linecomment',
        value: '// this is a comment',
        start: 38,
        end: 58,
      },
      {
        type: 'whitespace',
        value: '\n',
        start: 58,
        end: 59,
      },
    ]

    const statement1: BodyItem = {
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
                start: 13,
                end: 35,
                key: {
                  type: 'Identifier',
                  start: 13,
                  end: 14,
                  name: 'a',
                },
                value: {
                  type: 'ObjectExpression',
                  start: 16,
                  end: 35,
                  properties: [
                    {
                      type: 'ObjectProperty',
                      start: 18,
                      end: 33,
                      key: {
                        type: 'Identifier',
                        start: 18,
                        end: 19,
                        name: 'b',
                      },
                      value: {
                        type: 'ObjectExpression',
                        start: 21,
                        end: 33,
                        properties: [
                          {
                            type: 'ObjectProperty',
                            start: 23,
                            end: 31,
                            key: {
                              type: 'Identifier',
                              start: 23,
                              end: 24,
                              name: 'c',
                            },
                            value: {
                              type: 'Literal',
                              start: 26,
                              end: 31,
                              value: '123',
                              raw: "'123'",
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
        },
      ],
    }

    const statement2: BodyItem = {
      type: 'VariableDeclaration',
      start: 59,
      end: 74,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 65,
          end: 74,
          id: {
            type: 'Identifier',
            start: 65,
            end: 68,
            name: 'key',
          },
          init: {
            type: 'Literal',
            start: 71,
            end: 74,
            value: 'c',
            raw: "'c'",
          },
        },
      ],
    }

    const result = findTokensBetweenStatements(statement1, statement2, tokens)
    expect(result).toEqual([
      {
        type: 'whitespace',
        value: '\n',
        start: 37,
        end: 38,
      },
      {
        type: 'linecomment',
        value: '// this is a comment',
        start: 38,
        end: 58,
      },
      {
        type: 'whitespace',
        value: '\n',
        start: 58,
        end: 59,
      },
    ])
  })
})
