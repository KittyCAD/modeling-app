import postcss from 'postcss'

// PostCSS owns CSS syntax and locations. The empty ESTree program lets ESLint
// apply its normal rule/config/inline-comment machinery to the real CSS AST.
export default {
  meta: { name: 'zds-postcss', version: '1.0.0' },
  parseForESLint(text, options = {}) {
    const root = postcss.parse(text, { from: options.filePath })
    const lines = text.split('\n')
    const end = { line: lines.length, column: lines.at(-1).length }
    const comments = []
    root.walkComments((comment) => {
      comments.push({
        type: 'Block',
        value: comment.text,
        range: [comment.source.start.offset, comment.source.end.offset],
        loc: {
          start: {
            line: comment.source.start.line,
            column: comment.source.start.column - 1,
          },
          end: {
            line: comment.source.end.line,
            column: comment.source.end.column,
          },
        },
      })
    })
    return {
      ast: {
        type: 'Program',
        body: [],
        sourceType: 'module',
        range: [0, text.length],
        loc: { start: { line: 1, column: 0 }, end },
        tokens: [],
        comments,
      },
      services: { css: root },
    }
  },
}
