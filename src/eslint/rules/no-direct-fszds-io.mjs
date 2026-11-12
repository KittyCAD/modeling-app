const FS_ZDS_MODULES = new Set([
  '@src/lib/fs-zds',
  '@src/lib/fs-zds/index',
  '@src/lib/fs-zds/index.ts',
])

/**
 * Members that describe paths or locate application directories without
 * reading or mutating their contents.
 *
 * Keeping this as an allowlist makes additions to the raw adapter unavailable
 * to application code until they are deliberately classified here.
 */
const PATH_ONLY_MEMBERS = new Set([
  'basename',
  'dirname',
  'extname',
  'getPath',
  'join',
  'relative',
  'resolve',
  'sep',
])

const propertyName = (node) => {
  if (!node.computed && node.property.type === 'Identifier') {
    return node.property.name
  }
  if (node.computed && node.property.type === 'Literal') {
    return node.property.value
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep coordinated application filesystem access behind FileOperations.',
    },
    messages: {
      directFileSystemIo:
        'Use FileOperations. Access to fsZds.{{method}} bypasses filesystem coordination.',
      dynamicFileSystemAccess:
        'Use FileOperations. Dynamic fsZds property access cannot be verified as a path-only operation.',
      escapedFileSystem:
        'Use FileOperations. Do not pass, alias, or destructure the raw fsZds adapter.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode

    /**
     * Resolve the nearest lexical binding so a local value that shadows an
     * fsZds import is not mistaken for the imported adapter.
     */
    const isFsZdsReference = (node) => {
      if (node.type !== 'Identifier') {
        return false
      }

      for (
        let scope = sourceCode.getScope(node);
        scope !== null;
        scope = scope.upper
      ) {
        const variable = scope.set.get(node.name)
        if (!variable) {
          continue
        }

        return variable.defs.some(
          (definition) =>
            definition.type === 'ImportBinding' &&
            (definition.node.type === 'ImportDefaultSpecifier' ||
              (definition.node.type === 'ImportSpecifier' &&
                definition.node.imported.type === 'Identifier' &&
                definition.node.imported.name === 'default')) &&
            FS_ZDS_MODULES.has(definition.parent.source.value)
        )
      }

      return false
    }

    return {
      Identifier(node) {
        if (!isFsZdsReference(node)) {
          return
        }

        if (
          node.parent.type === 'ImportDefaultSpecifier' ||
          node.parent.type === 'ImportSpecifier'
        ) {
          return
        }

        if (
          node.parent.type === 'MemberExpression' &&
          node.parent.object === node
        ) {
          const member = propertyName(node.parent)
          if (typeof member !== 'string') {
            context.report({
              node: node.parent,
              messageId: 'dynamicFileSystemAccess',
            })
            return
          }

          if (PATH_ONLY_MEMBERS.has(member)) {
            return
          }

          context.report({
            node: node.parent,
            messageId: 'directFileSystemIo',
            data: { method: member },
          })
          return
        }

        context.report({
          node,
          messageId: 'escapedFileSystem',
        })
      },
    }
  },
}

export default rule
