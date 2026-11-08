import postcss from 'postcss'

/** Let ESLint inspect @apply and honor local suppression comments without treating CSS as JS. */
export function parseForESLint(text) {
  const css = postcss.parse(text)
  const lines = text.split('\n')
  const comments = []
  css.walkComments((node) => {
    comments.push({
      type: 'Block',
      value: node.text,
      range: [node.source.start.offset, node.source.end.offset],
      loc: {
        start: {
          line: node.source.start.line,
          column: node.source.start.column - 1,
        },
        end: { line: node.source.end.line, column: node.source.end.column },
      },
    })
  })
  return {
    ast: {
      type: 'Program',
      sourceType: 'module',
      body: [],
      tokens: [],
      comments,
      range: [0, text.length],
      loc: {
        start: { line: 1, column: 0 },
        end: { line: lines.length, column: lines.at(-1).length },
      },
    },
    services: { css },
  }
}
