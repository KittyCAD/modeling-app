import {
  isBlockEnd,
  isBlockStart,
  isNumber,
  isOperator,
  isParanEnd,
  isParanStart,
  isString,
  isWhitespace,
  isWord,
  isComma,
  lexer,
} from './tokeniser'

describe('testing helpers', () => {
  it('test is number', () => {
    expect(isNumber('1')).toBe(true)
    expect(isNumber('5?')).toBe(true)
    expect(isNumber('5 + 6')).toBe(true)
    expect(isNumber('5 + a')).toBe(true)
    expect(isNumber('-5')).toBe(true)
    expect(isNumber('5.5')).toBe(true)
    expect(isNumber('-5.5')).toBe(true)
    
    expect(isNumber('a')).toBe(false)
    expect(isNumber('?')).toBe(false)
    expect(isNumber('?5')).toBe(false)
  })
  it('test is whitespace', () => {
    expect(isWhitespace(' ')).toBe(true)
    expect(isWhitespace('  ')).toBe(true)
    expect(isWhitespace(' a')).toBe(true)
    expect(isWhitespace('a ')).toBe(true)

    expect(isWhitespace('a')).toBe(false)
    expect(isWhitespace('?')).toBe(false)
  })
  it('test is word', () => {
    expect(isWord('a')).toBe(true)
    expect(isWord('a ')).toBe(true)
    expect(isWord('a5')).toBe(true)
    expect(isWord('a5a')).toBe(true)

    expect(isWord('5')).toBe(false)
    expect(isWord('5a')).toBe(false)
    expect(isWord('5a5')).toBe(false)
  })
  it('test is string', () => {
    expect(isString('""')).toBe(true)
    expect(isString('"a"')).toBe(true)
    expect(isString('"a" ')).toBe(true)
    expect(isString('"a"5')).toBe(true)
    expect(isString("'a'5")).toBe(true)
    expect(isString('"with escaped \\" backslash"')).toBe(true)

    expect(isString('"')).toBe(false)
    expect(isString('"a')).toBe(false)
    expect(isString('a"')).toBe(false)
    expect(isString(' "a"')).toBe(false)
    expect(isString('5"a"')).toBe(false)
  })
  it('test is operator', () => {
    expect(isOperator('+')).toBe(true)
    expect(isOperator('+ ')).toBe(true)
    expect(isOperator('-')).toBe(true)
    expect(isOperator('<=')).toBe(true)
    expect(isOperator('<= ')).toBe(true)
    expect(isOperator('>=')).toBe(true)
    expect(isOperator('>= ')).toBe(true)
    expect(isOperator('> ')).toBe(true)
    expect(isOperator('< ')).toBe(true)
    expect(isOperator('| ')).toBe(true)
    expect(isOperator('|> ')).toBe(true)
    expect(isOperator('^ ')).toBe(true)
    expect(isOperator('% ')).toBe(true)
    expect(isOperator('+* ')).toBe(true)

    expect(isOperator('5 + 5')).toBe(false)
    expect(isOperator('a')).toBe(false)
    expect(isOperator('a+')).toBe(false)
    expect(isOperator('a+5')).toBe(false)
    expect(isOperator('5a+5')).toBe(false)
    expect(isOperator(', newVar')).toBe(false)
    expect(isOperator(',')).toBe(false)
  })
  it('test is paran start', () => {
    expect(isParanStart('(')).toBe(true)
    expect(isParanStart('( ')).toBe(true)
    expect(isParanStart('(5')).toBe(true)
    expect(isParanStart('(5 ')).toBe(true)
    expect(isParanStart('(5 + 5')).toBe(true)
    expect(isParanStart('(5 + 5)')).toBe(true)
    expect(isParanStart('(5 + 5) ')).toBe(true)

    expect(isParanStart('5')).toBe(false)
    expect(isParanStart('5 + 5')).toBe(false)
    expect(isParanStart('5( + 5)')).toBe(false)
    expect(isParanStart(' ( + 5)')).toBe(false)
  })
  it('test is paran end', () => {
    expect(isParanEnd(')')).toBe(true)
    expect(isParanEnd(') ')).toBe(true)
    expect(isParanEnd(')5')).toBe(true)
    expect(isParanEnd(')5 ')).toBe(true)

    expect(isParanEnd('5')).toBe(false)
    expect(isParanEnd('5 + 5')).toBe(false)
    expect(isParanEnd('5) + 5')).toBe(false)
    expect(isParanEnd(' ) + 5')).toBe(false)
  })
  it('test is block start', () => {
    expect(isBlockStart('{')).toBe(true)
    expect(isBlockStart('{ ')).toBe(true)
    expect(isBlockStart('{5')).toBe(true)
    expect(isBlockStart('{a')).toBe(true)
    expect(isBlockStart('{5 ')).toBe(true)

    expect(isBlockStart('5')).toBe(false)
    expect(isBlockStart('5 + 5')).toBe(false)
    expect(isBlockStart('5{ + 5')).toBe(false)
    expect(isBlockStart('a{ + 5')).toBe(false)
    expect(isBlockStart(' { + 5')).toBe(false)
  })
  it('test is block end', () => {
    expect(isBlockEnd('}')).toBe(true)
    expect(isBlockEnd('} ')).toBe(true)
    expect(isBlockEnd('}5')).toBe(true)
    expect(isBlockEnd('}5 ')).toBe(true)

    expect(isBlockEnd('5')).toBe(false)
    expect(isBlockEnd('5 + 5')).toBe(false)
    expect(isBlockEnd('5} + 5')).toBe(false)
    expect(isBlockEnd(' } + 5')).toBe(false)
  })
  it('test is comma', () => {
    expect(isComma(',')).toBe(true)
    expect(isComma(', ')).toBe(true)
    expect(isComma(',5')).toBe(true)
    expect(isComma(',5 ')).toBe(true)

    expect(isComma('5')).toBe(false)
    expect(isComma('5 + 5')).toBe(false)
    expect(isComma('5, + 5')).toBe(false)
    expect(isComma(' , + 5')).toBe(false)
  })
})

describe('testing lexer', () => {
  it('test lexer', () => {
    expect(stringSummaryLexer('1  + 2')).toEqual([
      "number       '1'        from 0   to 1",
      "whitespace   '  '       from 1   to 3",
      "operator     '+'        from 3   to 4",
      "whitespace   ' '        from 4   to 5",
      "number       '2'        from 5   to 6",
    ])
    expect(stringSummaryLexer('54 + 22500 + 6')).toEqual([
      "number       '54'       from 0   to 2",
      "whitespace   ' '        from 2   to 3",
      "operator     '+'        from 3   to 4",
      "whitespace   ' '        from 4   to 5",
      "number       '22500'    from 5   to 10",
      "whitespace   ' '        from 10  to 11",
      "operator     '+'        from 11  to 12",
      "whitespace   ' '        from 12  to 13",
      "number       '6'        from 13  to 14",
    ])
    expect(stringSummaryLexer('a + bo + t5 - 6')).toEqual([
      "word         'a'        from 0   to 1",
      "whitespace   ' '        from 1   to 2",
      "operator     '+'        from 2   to 3",
      "whitespace   ' '        from 3   to 4",
      "word         'bo'       from 4   to 6",
      "whitespace   ' '        from 6   to 7",
      "operator     '+'        from 7   to 8",
      "whitespace   ' '        from 8   to 9",
      "word         't5'       from 9   to 11",
      "whitespace   ' '        from 11  to 12",
      "operator     '-'        from 12  to 13",
      "whitespace   ' '        from 13  to 14",
      "number       '6'        from 14  to 15",
    ])
    expect(stringSummaryLexer('a + "a str" - 6')).toEqual([
      "word         'a'        from 0   to 1",
      "whitespace   ' '        from 1   to 2",
      "operator     '+'        from 2   to 3",
      "whitespace   ' '        from 3   to 4",
      'string       \'"a str"\'  from 4   to 11',
      "whitespace   ' '        from 11  to 12",
      "operator     '-'        from 12  to 13",
      "whitespace   ' '        from 13  to 14",
      "number       '6'        from 14  to 15",
    ])
    expect(stringSummaryLexer("a + 'str'")).toEqual([
      "word         'a'        from 0   to 1",
      "whitespace   ' '        from 1   to 2",
      "operator     '+'        from 2   to 3",
      "whitespace   ' '        from 3   to 4",
      "string       ''str''    from 4   to 9",
    ])
    expect(stringSummaryLexer("a +'str'")).toEqual([
      "word         'a'        from 0   to 1",
      "whitespace   ' '        from 1   to 2",
      "operator     '+'        from 2   to 3",
      "string       ''str''    from 3   to 8",
    ])

    expect(stringSummaryLexer('a + (sick)')).toEqual([
      "word         'a'        from 0   to 1",
      "whitespace   ' '        from 1   to 2",
      "operator     '+'        from 2   to 3",
      "whitespace   ' '        from 3   to 4",
      "brace        '('        from 4   to 5",
      "word         'sick'     from 5   to 9",
      "brace        ')'        from 9   to 10",
    ])

    expect(stringSummaryLexer('a + { sick}')).toEqual([
      "word         'a'        from 0   to 1",
      "whitespace   ' '        from 1   to 2",
      "operator     '+'        from 2   to 3",
      "whitespace   ' '        from 3   to 4",
      "brace        '{'        from 4   to 5",
      "whitespace   ' '        from 5   to 6",
      "word         'sick'     from 6   to 10",
      "brace        '}'        from 10  to 11",
    ])

    expect(stringSummaryLexer("log('hi')")).toEqual([
      "word         'log'      from 0   to 3",
      "brace        '('        from 3   to 4",
      "string       ''hi''     from 4   to 8",
      "brace        ')'        from 8   to 9",
    ])
    expect(stringSummaryLexer("log('hi', 'hello')")).toEqual([
      "word         'log'      from 0   to 3",
      "brace        '('        from 3   to 4",
      "string       ''hi''     from 4   to 8",
      "comma        ','        from 8   to 9",
      "whitespace   ' '        from 9   to 10",
      "string       ''hello''  from 10  to 17",
      "brace        ')'        from 17  to 18",
    ])
    expect(stringSummaryLexer('fn funcName = (param1, param2) => {}')).toEqual([
      "word         'fn'       from 0   to 2",
      "whitespace   ' '        from 2   to 3",
      "word         'funcName' from 3   to 11",
      "whitespace   ' '        from 11  to 12",
      "operator     '='        from 12  to 13",
      "whitespace   ' '        from 13  to 14",
      "brace        '('        from 14  to 15",
      "word         'param1'   from 15  to 21",
      "comma        ','        from 21  to 22",
      "whitespace   ' '        from 22  to 23",
      "word         'param2'   from 23  to 29",
      "brace        ')'        from 29  to 30",
      "whitespace   ' '        from 30  to 31",
      "operator     '=>'       from 31  to 33",
      "whitespace   ' '        from 33  to 34",
      "brace        '{'        from 34  to 35",
      "brace        '}'        from 35  to 36",
    ])
  })
  it('test negative and decimal numbers', () => {
    expect(stringSummaryLexer('-1')).toEqual([
      "number       '-1'       from 0   to 2",
    ])
    expect(stringSummaryLexer('-1.5')).toEqual([
      "number       '-1.5'     from 0   to 4",
    ])
    expect(stringSummaryLexer('1.5')).toEqual([
      "number       '1.5'      from 0   to 3",
    ])
    expect(stringSummaryLexer('1.5 + 2.5')).toEqual([
      "number       '1.5'      from 0   to 3",
      "whitespace   ' '        from 3   to 4",
      "operator     '+'        from 4   to 5",
      "whitespace   ' '        from 5   to 6",
      "number       '2.5'      from 6   to 9",
    ])
    expect(stringSummaryLexer('1.5 - 2.5')).toEqual([
      "number       '1.5'      from 0   to 3",
      "whitespace   ' '        from 3   to 4",
      "operator     '-'        from 4   to 5",
      "whitespace   ' '        from 5   to 6",
      "number       '2.5'      from 6   to 9",
    ])
    expect(stringSummaryLexer('1.5 + -2.5')).toEqual([
      "number       '1.5'      from 0   to 3",
      "whitespace   ' '        from 3   to 4",
      "operator     '+'        from 4   to 5",
      "whitespace   ' '        from 5   to 6",
      "number       '-2.5'     from 6   to 10",
    ])
    expect(stringSummaryLexer('-1.5 + 2.5')).toEqual([
      "number       '-1.5'     from 0   to 4",
      "whitespace   ' '        from 4   to 5",
      "operator     '+'        from 5   to 6",
      "whitespace   ' '        from 6   to 7",
      "number       '2.5'      from 7   to 10",
    ])

  })
})

// helpers

const stringSummaryLexer = (input: string) =>
  lexer(input).map(
    ({ type, value, start, end }) =>
      `${type.padEnd(12, ' ')} ${`'${value}'`.padEnd(10, ' ')} from ${String(
        start
      ).padEnd(3, ' ')} to ${end}`
  )
