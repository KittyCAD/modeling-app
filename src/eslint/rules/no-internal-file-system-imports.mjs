const INTERNAL_FILE_SYSTEM_MODULE = '@src/lib/fileSystem/fileSystem'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep the backing filesystem adapter internal to the fileSystem implementation.',
    },
    messages: {
      internalFileSystemImport:
        'Import the public FileOperations surface instead. FileSystem is an internal adapter over fsZds.',
    },
    schema: [],
  },
  create(context) {
    const reportIfInternalFileSystem = (node) => {
      if (
        node.source &&
        typeof node.source.value === 'string' &&
        (node.source.value === INTERNAL_FILE_SYSTEM_MODULE ||
          node.source.value === `${INTERNAL_FILE_SYSTEM_MODULE}.ts`)
      ) {
        context.report({
          node: node.source,
          messageId: 'internalFileSystemImport',
        })
      }
    }

    return {
      ExportAllDeclaration: reportIfInternalFileSystem,
      ExportNamedDeclaration: reportIfInternalFileSystem,
      ImportExpression: reportIfInternalFileSystem,
      ImportDeclaration: reportIfInternalFileSystem,
    }
  },
}

export default rule
