import { parseExpression, reversePolishNotation } from './astMathExpressions'
import { lexer } from './tokeniser'
import { initPromise } from './rust'

beforeAll(() => initPromise)

describe('parseExpression', () => {
  it('parses a simple expression', () => {
    const result = parseExpression(lexer('1 + 2'))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 0,
      end: 5,
      left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
      right: { type: 'Literal', value: 2, raw: '2', start: 4, end: 5 },
    })
  })
  it('parses a more complex expression + followed by *', () => {
    const tokens = lexer('1 + 2 * 3')
    const result = parseExpression(tokens)
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 0,
      end: 9,
      left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
      right: {
        type: 'BinaryExpression',
        operator: '*',
        start: 4,
        end: 9,
        left: { type: 'Literal', value: 2, raw: '2', start: 4, end: 5 },
        right: { type: 'Literal', value: 3, raw: '3', start: 8, end: 9 },
      },
    })
  })
  it('parses a more complex expression with parentheses: 1 * ( 2 + 3 )', () => {
    const result = parseExpression(lexer('1 * ( 2 + 3 )'))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '*',
      start: 0,
      end: 13,
      left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
      right: {
        type: 'BinaryExpression',
        operator: '+',
        start: 6,
        end: 11,
        left: { type: 'Literal', value: 2, raw: '2', start: 6, end: 7 },
        right: { type: 'Literal', value: 3, raw: '3', start: 10, end: 11 },
      },
    })
  })
  it('parses a more complex expression with parentheses with more', () => {
    const result = parseExpression(lexer('1 * ( 2 + 3 ) / 4'))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '/',
      start: 0,
      end: 17,
      left: {
        type: 'BinaryExpression',
        operator: '*',
        start: 0,
        end: 13,
        left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
        right: {
          type: 'BinaryExpression',
          operator: '+',
          start: 6,
          end: 11,
          left: { type: 'Literal', value: 2, raw: '2', start: 6, end: 7 },
          right: { type: 'Literal', value: 3, raw: '3', start: 10, end: 11 },
        },
      },
      right: { type: 'Literal', value: 4, raw: '4', start: 16, end: 17 },
    })
  })
  it('same as last one but with a 1 + at the start', () => {
    const result = parseExpression(lexer('1 + ( 2 + 3 ) / 4'))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 0,
      end: 17,
      left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
      right: {
        type: 'BinaryExpression',
        operator: '/',
        start: 4,
        end: 17,
        left: {
          type: 'BinaryExpression',
          operator: '+',
          start: 6,
          end: 11,
          left: { type: 'Literal', value: 2, raw: '2', start: 6, end: 7 },
          right: { type: 'Literal', value: 3, raw: '3', start: 10, end: 11 },
        },
        right: { type: 'Literal', value: 4, raw: '4', start: 16, end: 17 },
      },
    })
  })
  it('nested braces', () => {
    const result = parseExpression(lexer('1 * (( 2 + 3 ) / 4 + 5 )'))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '*',
      start: 0,
      end: 24,
      left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
      right: {
        type: 'BinaryExpression',
        operator: '+',
        start: 5,
        end: 22,
        left: {
          type: 'BinaryExpression',
          operator: '/',
          start: 5,
          end: 18,
          left: {
            type: 'BinaryExpression',
            operator: '+',
            start: 7,
            end: 12,
            left: { type: 'Literal', value: 2, raw: '2', start: 7, end: 8 },
            right: {
              type: 'Literal',
              value: 3,
              raw: '3',
              start: 11,
              end: 12,
            },
          },
          right: { type: 'Literal', value: 4, raw: '4', start: 17, end: 18 },
        },
        right: { type: 'Literal', value: 5, raw: '5', start: 21, end: 22 },
      },
    })
  })
  it('multiple braces around the same thing', () => {
    const result = parseExpression(lexer('1 * ((( 2 + 3 )))'))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '*',
      start: 0,
      end: 17,
      left: { type: 'Literal', value: 1, raw: '1', start: 0, end: 1 },
      right: {
        type: 'BinaryExpression',
        operator: '+',
        start: 8,
        end: 13,
        left: { type: 'Literal', value: 2, raw: '2', start: 8, end: 9 },
        right: { type: 'Literal', value: 3, raw: '3', start: 12, end: 13 },
      },
    })
  })
  it('multiple braces around a sing literal', () => {
    const code = '2 + (((3)))'
    const result = parseExpression(lexer(code))
    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 0,
      end: code.indexOf(')))') + 3,
      left: { type: 'Literal', value: 2, raw: '2', start: 0, end: 1 },
      right: { type: 'Literal', value: 3, raw: '3', start: 7, end: 8 },
    })
  })
})

describe('reversePolishNotation', () => {
  it('converts a simple expression', () => {
    const result = reversePolishNotation(lexer('1 + 2'))
    expect(result).toEqual([
      { type: 'number', value: '1', start: 0, end: 1 },
      { type: 'number', value: '2', start: 4, end: 5 },
      { type: 'operator', value: '+', start: 2, end: 3 },
    ])
  })
  it('converts a more complex expression', () => {
    const result = reversePolishNotation(lexer('1 + 2 * 3'))
    expect(result).toEqual([
      { type: 'number', value: '1', start: 0, end: 1 },
      { type: 'number', value: '2', start: 4, end: 5 },
      { type: 'number', value: '3', start: 8, end: 9 },
      { type: 'operator', value: '*', start: 6, end: 7 },
      { type: 'operator', value: '+', start: 2, end: 3 },
    ])
  })
  it('converts a more complex expression with parentheses', () => {
    const result = reversePolishNotation(lexer('1 * ( 2 + 3 )'))
    expect(result).toEqual([
      { type: 'number', value: '1', start: 0, end: 1 },
      { type: 'brace', value: '(', start: 4, end: 5 },
      { type: 'number', value: '2', start: 6, end: 7 },
      { type: 'number', value: '3', start: 10, end: 11 },
      { type: 'operator', value: '+', start: 8, end: 9 },
      { type: 'brace', value: ')', start: 12, end: 13 },
      { type: 'operator', value: '*', start: 2, end: 3 },
    ])
  })
})
