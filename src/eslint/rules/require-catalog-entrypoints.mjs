import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const catalogs = {
  'catalog.ts': {
    binding: 'bundledRegistryItemCatalog',
    directories: [
      ['registry/extensions', 'index.ts'],
      ['registry/plugins', 'index.ts'],
      ['lib', 'registry/index.ts'],
      ['lang', 'registry/index.ts'],
    ],
    importName: 'default',
  },
  'electronPlugins.ts': {
    binding: 'bundledElectronPluginRegistrations',
    directories: [['registry/plugins', 'electron.ts']],
    importName: 'register',
  },
}

function discoverEntrypoints(srcDirectory, directories) {
  return directories.flatMap(([directory, entrypoint]) => {
    const parent = path.join(srcDirectory, directory)
    if (!existsSync(parent)) return []
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name, entrypoint))
      .filter((entry) => existsSync(entry))
  })
}

/** Discovery checks catalog coverage without choosing the app's composition. */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require bundled extension entrypoints to have explicit catalog entries.',
    },
    schema: [],
    messages: {
      missingEntrypoint:
        'Entrypoint {{entrypoint}} is missing from {{catalog}}. Import its {{importName}} export and include it in {{binding}}. Default app activation is selected separately.',
    },
  },
  create(context) {
    const filename = context.filename
    const catalog = catalogs[path.basename(filename)]
    if (!catalog || path.basename(path.dirname(filename)) !== 'registry') {
      return {}
    }
    const srcDirectory = path.dirname(path.dirname(filename))
    const imports = new Map()
    const selectedBindings = new Set()

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return
        const source = node.source.value
        if (!source.startsWith('@src/') && !source.startsWith('.')) return
        const modulePath = source.startsWith('@src/')
          ? path.join(srcDirectory, source.slice('@src/'.length))
          : path.resolve(path.dirname(filename), source)
        const entrypoint = modulePath.endsWith('.ts')
          ? modulePath
          : existsSync(`${modulePath}.ts`)
            ? `${modulePath}.ts`
            : path.join(modulePath, 'index.ts')
        for (const specifier of node.specifiers) {
          const imported =
            specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : specifier.type === 'ImportSpecifier'
                ? (specifier.imported.name ?? specifier.imported.value)
                : undefined
          if (
            imported === catalog.importName &&
            specifier.importKind !== 'type'
          ) {
            imports.set(specifier.local.name, entrypoint)
          }
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || node.id.name !== catalog.binding)
          return
        let value = node.init
        while (
          value?.type === 'TSSatisfiesExpression' ||
          value?.type === 'TSAsExpression'
        ) {
          value = value.expression
        }
        const entries =
          value?.type === 'ObjectExpression'
            ? value.properties
                .filter((property) => property.type === 'Property')
                .map((property) => property.value)
            : value?.type === 'ArrayExpression'
              ? value.elements
              : []
        for (const entry of entries) {
          if (entry?.type === 'Identifier') selectedBindings.add(entry.name)
        }
      },
      'Program:exit'(node) {
        const registered = new Set(
          [...selectedBindings].map((binding) => imports.get(binding))
        )
        for (const entrypoint of discoverEntrypoints(
          srcDirectory,
          catalog.directories
        )) {
          if (registered.has(entrypoint)) continue
          context.report({
            node,
            messageId: 'missingEntrypoint',
            data: {
              entrypoint: path
                .relative(srcDirectory, entrypoint)
                .split(path.sep)
                .join('/'),
              catalog: path.basename(filename),
              importName: catalog.importName,
              binding: catalog.binding,
            },
          })
        }
      },
    }
  },
}
