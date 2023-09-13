import { lexer, asyncLexer } from './tokeniser'
import { initPromise } from './rust'

beforeAll(() => initPromise)

describe('testing lexer', () => {
  it('async lexer works too', async () => {
    const code = '1  + 2'
    const code2 = `const yo = {key: 'value'}`
    const code3 = `const yo = 45 /* this is a comment
const ya = 6 */
const yi=45`
    expect(await asyncLexer(code)).toEqual(lexer(code))
    expect(await asyncLexer(code2)).toEqual(lexer(code2))
    expect(await asyncLexer(code3)).toEqual(lexer(code3))
  })
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
      "keyword      'fn'       from 0   to 2",
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
        "operator     '-'        from 0   to 1",
   "number       '1'        from 1   to 2",
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
  it('testing piping operator', () => {
    const result = stringSummaryLexer(`sketch mySketch {
      lineTo(2, 3)
    } |> rx(45, %)`)
    expect(result).toEqual([
      "word         'sketch'   from 0   to 6",
      "whitespace   ' '        from 6   to 7",
      "word         'mySketch' from 7   to 15",
      "whitespace   ' '        from 15  to 16",
      "brace        '{'        from 16  to 17",
      "whitespace   '\n      '  from 17  to 24",
      "word         'lineTo'   from 24  to 30",
      "brace        '('        from 30  to 31",
      "number       '2'        from 31  to 32",
      "comma        ','        from 32  to 33",
      "whitespace   ' '        from 33  to 34",
      "number       '3'        from 34  to 35",
      "brace        ')'        from 35  to 36",
      "whitespace   '\n    '    from 36  to 41",
      "brace        '}'        from 41  to 42",
      "whitespace   ' '        from 42  to 43",
      "operator     '|>'       from 43  to 45",
      "whitespace   ' '        from 45  to 46",
      "word         'rx'       from 46  to 48",
      "brace        '('        from 48  to 49",
      "number       '45'       from 49  to 51",
      "comma        ','        from 51  to 52",
      "whitespace   ' '        from 52  to 53",
      "operator     '%'        from 53  to 54",
      "brace        ')'        from 54  to 55",
    ])
  })
  it('testing array declaration', () => {
    const result = stringSummaryLexer(`const yo = [1, 2]`)
    expect(result).toEqual([
      "keyword      'const'    from 0   to 5",
      "whitespace   ' '        from 5   to 6",
      "word         'yo'       from 6   to 8",
      "whitespace   ' '        from 8   to 9",
      "operator     '='        from 9   to 10",
      "whitespace   ' '        from 10  to 11",
      "brace        '['        from 11  to 12",
      "number       '1'        from 12  to 13",
      "comma        ','        from 13  to 14",
      "whitespace   ' '        from 14  to 15",
      "number       '2'        from 15  to 16",
      "brace        ']'        from 16  to 17",
    ])
  })
  it('testing object declaration', () => {
    const result = stringSummaryLexer(`const yo = {key: 'value'}`)
    expect(result).toEqual([
      "keyword      'const'    from 0   to 5",
      "whitespace   ' '        from 5   to 6",
      "word         'yo'       from 6   to 8",
      "whitespace   ' '        from 8   to 9",
      "operator     '='        from 9   to 10",
      "whitespace   ' '        from 10  to 11",
      "brace        '{'        from 11  to 12",
      "word         'key'      from 12  to 15",
      "colon        ':'        from 15  to 16",
      "whitespace   ' '        from 16  to 17",
      "string       ''value''  from 17  to 24",
      "brace        '}'        from 24  to 25",
    ])
  })
  it('testing object property access', () => {
    const result = stringSummaryLexer(`const yo = {key: 'value'}
const prop = yo.key
const prop2 = yo['key']
const key = 'key'
const prop3 = yo[key]`)
    expect(result).toEqual([
      "keyword      'const'    from 0   to 5",
      "whitespace   ' '        from 5   to 6",
      "word         'yo'       from 6   to 8",
      "whitespace   ' '        from 8   to 9",
      "operator     '='        from 9   to 10",
      "whitespace   ' '        from 10  to 11",
      "brace        '{'        from 11  to 12",
      "word         'key'      from 12  to 15",
      "colon        ':'        from 15  to 16",
      "whitespace   ' '        from 16  to 17",
      "string       ''value''  from 17  to 24",
      "brace        '}'        from 24  to 25",
      "whitespace   '\n'        from 25  to 26",
      "keyword      'const'    from 26  to 31",
      "whitespace   ' '        from 31  to 32",
      "word         'prop'     from 32  to 36",
      "whitespace   ' '        from 36  to 37",
      "operator     '='        from 37  to 38",
      "whitespace   ' '        from 38  to 39",
      "word         'yo'       from 39  to 41",
      "period       '.'        from 41  to 42",
      "word         'key'      from 42  to 45",
      "whitespace   '\n'        from 45  to 46",
      "keyword      'const'    from 46  to 51",
      "whitespace   ' '        from 51  to 52",
      "word         'prop2'    from 52  to 57",
      "whitespace   ' '        from 57  to 58",
      "operator     '='        from 58  to 59",
      "whitespace   ' '        from 59  to 60",
      "word         'yo'       from 60  to 62",
      "brace        '['        from 62  to 63",
      "string       ''key''    from 63  to 68",
      "brace        ']'        from 68  to 69",
      "whitespace   '\n'        from 69  to 70",
      "keyword      'const'    from 70  to 75",
      "whitespace   ' '        from 75  to 76",
      "word         'key'      from 76  to 79",
      "whitespace   ' '        from 79  to 80",
      "operator     '='        from 80  to 81",
      "whitespace   ' '        from 81  to 82",
      "string       ''key''    from 82  to 87",
      "whitespace   '\n'        from 87  to 88",
      "keyword      'const'    from 88  to 93",
      "whitespace   ' '        from 93  to 94",
      "word         'prop3'    from 94  to 99",
      "whitespace   ' '        from 99  to 100",
      "operator     '='        from 100 to 101",
      "whitespace   ' '        from 101 to 102",
      "word         'yo'       from 102 to 104",
      "brace        '['        from 104 to 105",
      "word         'key'      from 105 to 108",
      "brace        ']'        from 108 to 109",
    ])
  })
  it('testing tokenising line comments', () => {
    const result = stringSummaryLexer(`const yo = 45 // this is a comment
const yo = 6`)
    expect(result).toEqual([
      "keyword      'const'    from 0   to 5",
      "whitespace   ' '        from 5   to 6",
      "word         'yo'       from 6   to 8",
      "whitespace   ' '        from 8   to 9",
      "operator     '='        from 9   to 10",
      "whitespace   ' '        from 10  to 11",
      "number       '45'       from 11  to 13",
      "whitespace   ' '        from 13  to 14",
      "lineComment  '// this is a comment' from 14  to 34",
      "whitespace   '\n'        from 34  to 35",
      "keyword      'const'    from 35  to 40",
      "whitespace   ' '        from 40  to 41",
      "word         'yo'       from 41  to 43",
      "whitespace   ' '        from 43  to 44",
      "operator     '='        from 44  to 45",
      "whitespace   ' '        from 45  to 46",
      "number       '6'        from 46  to 47",
    ])
  })
  it('testing tokenising line comments by itself', () => {
    const result = stringSummaryLexer(`log('hi')
// comment on a line by itself
const yo=45`)
    expect(result).toEqual([
      "word         'log'      from 0   to 3",
      "brace        '('        from 3   to 4",
      "string       ''hi''     from 4   to 8",
      "brace        ')'        from 8   to 9",
      "whitespace   '\n'        from 9   to 10",
      "lineComment  '// comment on a line by itself' from 10  to 40",
      "whitespace   '\n'        from 40  to 41",
      "keyword      'const'    from 41  to 46",
      "whitespace   ' '        from 46  to 47",
      "word         'yo'       from 47  to 49",
      "operator     '='        from 49  to 50",
      "number       '45'       from 50  to 52",
    ])
  })
  it('testing tokenising block comments', () => {
    const result = stringSummaryLexer(`const yo = 45 /* this is a comment
const ya = 6 */
const yi=45`)
    expect(result).toEqual([
      "keyword      'const'    from 0   to 5",
      "whitespace   ' '        from 5   to 6",
      "word         'yo'       from 6   to 8",
      "whitespace   ' '        from 8   to 9",
      "operator     '='        from 9   to 10",
      "whitespace   ' '        from 10  to 11",
      "number       '45'       from 11  to 13",
      "whitespace   ' '        from 13  to 14",
      `blockComment '/* this is a comment
const ya = 6 */' from 14  to 50`,
      "whitespace   '\n'        from 50  to 51",
      "keyword      'const'    from 51  to 56",
      "whitespace   ' '        from 56  to 57",
      "word         'yi'       from 57  to 59",
      "operator     '='        from 59  to 60",
      "number       '45'       from 60  to 62",
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
