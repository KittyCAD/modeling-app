/** Flag raw UI neutral colors; palette definitions and unmigrated components stay outside the scope. */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer shared theme-independent appearance utilities.',
    },
    schema: [],
    messages: {
      palette:
        'Use a shared appearance role instead of {{utility}} (for example bg-2, text-2, or b-4). Add missing roles centrally; explain deliberate palette exceptions locally.',
    },
  },
  create(context) {
    function check(text, offset) {
      const utilities =
        /\b(?:bg|text|border(?:-[xytrblse])?|outline|ring(?:-offset)?|divide|fill|stroke|decoration|caret)-chalkboard-\d+(?:\/(?:\d+|\[[^\]]+\]))?/g
      for (const match of text.matchAll(utilities)) {
        const start = offset + match.index
        context.report({
          loc: {
            start: context.sourceCode.getLocFromIndex(start),
            end: context.sourceCode.getLocFromIndex(start + match[0].length),
          },
          messageId: 'palette',
          data: { utility: match[0] },
        })
      }
    }
    if (context.sourceCode.parserServices.css) {
      return {
        Program() {
          context.sourceCode.parserServices.css.walkAtRules('apply', (node) => {
            check(
              node.params,
              node.source.start.offset + node.toString().indexOf(node.params)
            )
          })
        },
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string')
          check(context.sourceCode.getText(node), node.range[0])
      },
      TemplateElement(node) {
        check(context.sourceCode.getText(node), node.range[0])
      },
    }
  },
}
export default rule
