const FS_ZDS_MODULE = '@src/lib/fs-zds'
const FILE_OPERATION_METHODS = new Set([
  'access',
  'cp',
  'mkdir',
  'readFile',
  'readdir',
  'rename',
  'rm',
  'stat',
  'writeFile',
])

const memberName = (node) => {
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
        'Use FileOperations. Direct fsZds.{{method}} calls bypass filesystem coordination.',
    },
    schema: [],
  },
  create(context) {
    const importedNames = new Set()

    return {
      ImportDeclaration(node) {
        if (node.source.value !== FS_ZDS_MODULE) {
          return
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            importedNames.add(specifier.local.name)
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.object.type !== 'Identifier' ||
          !importedNames.has(callee.object.name)
        ) {
          return
        }

        const method = memberName(callee)
        if (typeof method !== 'string' || !FILE_OPERATION_METHODS.has(method)) {
          return
        }

        context.report({
          node: callee,
          messageId: 'directFileSystemIo',
          data: { method },
        })
      },
    }
  },
}

export default rule
