const ITERATOR_DECLARATION_FILE = /[/\\]lib\.esnext\.iterator\.d\.ts$/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Iterator Helpers because they are unavailable in supported browsers.',
    },
    messages: {
      unsupportedIteratorHelper:
        'Iterator.{{methodName}}() is not supported by every target browser. Use a broadly supported iterable or Array.from() instead.',
    },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      return {}
    }

    const checker = services.program.getTypeChecker()

    return {
      'CallExpression > MemberExpression.callee'(node) {
        const methodName = node.computed
          ? node.property.value
          : node.property.name
        if (typeof methodName !== 'string') {
          return
        }

        const typescriptNode = services.esTreeNodeToTSNodeMap.get(node.object)
        const objectType = checker.getTypeAtLocation(typescriptNode)
        const method = checker.getPropertyOfType(objectType, methodName)
        const declarations = method?.getDeclarations() ?? []
        const isIteratorHelper = declarations.some((declaration) =>
          ITERATOR_DECLARATION_FILE.test(declaration.getSourceFile().fileName)
        )

        if (isIteratorHelper) {
          context.report({
            node,
            messageId: 'unsupportedIteratorHelper',
            data: { methodName },
          })
        }
      },
    }
  },
}

export default rule
