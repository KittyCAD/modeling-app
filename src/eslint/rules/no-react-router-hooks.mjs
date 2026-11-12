const ROUTER_MODULE = 'react-router-dom'

/**
 * Router hooks expose serialized browser state to application consumers.
 * Keep existing dependencies visible through local migration exceptions.
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep application state independent of react-router-dom hooks.',
    },
    schema: [],
    messages: {
      routerHook:
        'Do not import or re-export {{name}} from react-router-dom. Read and change application state directly; keep URL parsing and publication at the browser boundary.',
      opaqueRouterImport:
        'Use explicit named imports or exports from react-router-dom so router hook dependencies can be enumerated.',
    },
  },
  create(context) {
    function checkSpecifiers(node) {
      if (node.source?.value !== ROUTER_MODULE) return

      for (const specifier of node.specifiers) {
        if (
          specifier.type === 'ImportNamespaceSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier'
        ) {
          context.report({ node: specifier, messageId: 'opaqueRouterImport' })
          continue
        }

        const imported = specifier.imported ?? specifier.local
        const name = imported.name ?? imported.value
        if (typeof name === 'string' && name.startsWith('use')) {
          context.report({
            node: specifier,
            messageId: 'routerHook',
            data: { name },
          })
        }
      }
    }

    function checkOpaqueImport(node) {
      if (node.source?.value === ROUTER_MODULE) {
        context.report({ node, messageId: 'opaqueRouterImport' })
      }
    }

    return {
      ImportDeclaration: checkSpecifiers,
      ExportNamedDeclaration: checkSpecifiers,
      ExportAllDeclaration: checkOpaqueImport,
      ImportExpression: checkOpaqueImport,
    }
  },
}

export default rule
