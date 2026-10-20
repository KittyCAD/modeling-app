import path from 'node:path'
import { bindingFor, staticValue } from './performance-policy.mjs'

const nativeOwner = '/src/lib/rustContext/index.ts'
const registryOwner = '/src/lib/rustContext/registry/extension.ts'
const fixtureOwner = '/src/unitTestUtils.ts'
const recoveryOwner = '/src/lib/exceptions.ts'
const moduleProperties = new Set([
  'wasmInstancePromise',
  'wasmPromise',
  'activeWasmInstance',
])

const generatedModule = (source) =>
  typeof source === 'string' &&
  /(?:^|\/)kcl-wasm-lib\/pkg\/kcl_wasm_lib(?:\.js)?$/.test(source)

function sourceModule(source, filename, suffix) {
  if (typeof source !== 'string') return false
  if (source === `@src/${suffix}` || source === `@src/${suffix}.ts`) return true
  if (!source.startsWith('.')) return false
  const resolved = path.resolve(path.dirname(filename), source)
  return [`/src/${suffix}`, `/src/${suffix}.ts`].some((end) =>
    resolved.endsWith(end)
  )
}

function unwrap(node) {
  while (
    node &&
    [
      'AwaitExpression',
      'ChainExpression',
      'TSNonNullExpression',
      'TSAsExpression',
      'TSTypeAssertion',
      'TSSatisfiesExpression',
    ].includes(node.type)
  )
    node = node.argument ?? node.expression
  return node
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep Wasm runtime allocation and callback cloning in the owned lifecycle adapter.',
    },
    schema: [],
    messages: {
      native:
        'Native Wasm Context allocation and cloning belong only in src/lib/rustContext/index.ts. Use the registry-owned RustContext service; do not extract its runtime factory.',
      wrapper:
        'RustContext construction belongs only in src/lib/rustContext/registry/extension.ts. Import its type or use the existing registry service.',
      opaque:
        'Do not access unknown Wasm module properties or re-export its runtime factory. Use named non-constructor exports.',
      recovery:
        'Wasm replacement belongs only in src/lib/exceptions.ts after a genuine runtime crash. Reuse the owned runtime instead of recreating it.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    const filename = context.filename.replaceAll('\\', '/')
    if (
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filename) ||
      filename.endsWith(fixtureOwner)
    )
      return {}

    const ownsNative = filename.endsWith(nativeOwner)
    const ownsWrapper = filename.endsWith(registryOwner)
    const ownsRecovery = filename.endsWith(recoveryOwner)
    const wrapperModule = (source) =>
      sourceModule(source, filename, 'lib/wasm_lib_wrapper')
    const rustContextModule = (source) =>
      sourceModule(source, filename, 'lib/rustContext') ||
      sourceModule(source, filename, 'lib/rustContext/index')
    const wasmUtilsModule = (source) =>
      sourceModule(source, filename, 'lang/wasmUtils')
    const report = (node, messageId) => context.report({ node, messageId })
    const nameOf = (node) =>
      node.computed
        ? staticValue(sourceCode, node.property ?? node.key)
        : (node.property ?? node.key)?.name

    function importedName(identifier, acceptsSource, expected) {
      if (identifier?.type !== 'Identifier') return false
      const definition = bindingFor(sourceCode, identifier)?.defs[0]
      return (
        definition?.type === 'ImportBinding' &&
        acceptsSource(definition.parent.source.value) &&
        (definition.node.imported?.name ?? definition.node.imported?.value) ===
          expected
      )
    }

    function hasType(annotation, kind) {
      if (!annotation) return false
      if (annotation.type === 'TSTypeAnnotation')
        return hasType(annotation.typeAnnotation, kind)
      if (annotation.type === 'TSUnionType')
        return annotation.types.some((type) => hasType(type, kind))
      if (annotation.type !== 'TSTypeReference') return false
      if (
        kind === 'module' &&
        importedName(annotation.typeName, wrapperModule, 'ModuleType')
      )
        return true
      if (
        kind === 'instance' &&
        importedName(annotation.typeName, generatedModule, 'Context')
      )
        return true
      return (
        annotation.typeName.type === 'Identifier' &&
        annotation.typeName.name === 'Promise' &&
        (annotation.typeArguments?.params ?? []).some((type) =>
          hasType(type, kind)
        )
      )
    }

    function isGetter(node, seen = new Set()) {
      node = unwrap(node)
      if (
        importedName(node, wrapperModule, 'getModule') ||
        importedName(node, wasmUtilsModule, 'initialiseWasm') ||
        importedName(node, wasmUtilsModule, 'restartWasmModule')
      )
        return true
      if (
        node?.type === 'MemberExpression' &&
        node.object.type === 'Identifier'
      ) {
        const definition = bindingFor(sourceCode, node.object)?.defs[0]
        if (
          definition?.type === 'ImportBinding' &&
          definition.node.type === 'ImportNamespaceSpecifier'
        ) {
          const source = definition.parent.source.value
          return (
            (wrapperModule(source) && nameOf(node) === 'getModule') ||
            (wasmUtilsModule(source) &&
              ['initialiseWasm', 'restartWasmModule'].includes(nameOf(node)))
          )
        }
      }
      if (node?.type !== 'Identifier') return false
      const binding = bindingFor(sourceCode, node)
      if (!binding || seen.has(binding)) return false
      seen.add(binding)
      const definition = binding.defs[0]
      return (
        definition?.type === 'Variable' &&
        definition.parent.kind === 'const' &&
        isGetter(definition.node.init, seen)
      )
    }

    function originates(node, kind, seen = new Set()) {
      node = unwrap(node)
      if (!node) return false
      if (node.type === 'ImportExpression')
        return (
          (kind === 'module' &&
            generatedModule(staticValue(sourceCode, node.source) ?? '')) ||
          (kind === 'utilities' &&
            wasmUtilsModule(staticValue(sourceCode, node.source) ?? ''))
        )
      if (node.type === 'MemberExpression')
        return kind === 'module' && moduleProperties.has(nameOf(node))
      if (node.type === 'CallExpression') {
        if (kind === 'module' && isGetter(node.callee)) return true
        return (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Promise' &&
          nameOf(node.callee) === 'resolve' &&
          originates(node.arguments[0], kind, seen)
        )
      }
      if (node.type === 'NewExpression' && kind === 'instance')
        return (
          node.callee.type === 'MemberExpression' &&
          nameOf(node.callee) === 'Context' &&
          originates(node.callee.object, 'module', seen)
        )
      if (node.type !== 'Identifier') return false
      const binding = bindingFor(sourceCode, node)
      if (!binding || seen.has(binding)) return false
      seen.add(binding)
      if (binding.identifiers.some((id) => hasType(id.typeAnnotation, kind)))
        return true
      const definition = binding.defs[0]
      if (definition?.type === 'ImportBinding')
        return (
          definition.node.type === 'ImportNamespaceSpecifier' &&
          ((kind === 'module' &&
            generatedModule(definition.parent.source.value)) ||
            (kind === 'utilities' &&
              wasmUtilsModule(definition.parent.source.value)))
        )
      if (
        kind === 'module' &&
        definition?.type === 'Variable' &&
        definition.parent.kind === 'const' &&
        definition.node.id.type === 'ObjectPattern' &&
        definition.node.id.properties.some((property) => {
          if (property.type !== 'Property') return false
          const local =
            property.value.type === 'AssignmentPattern'
              ? property.value.left
              : property.value
          return (
            binding.identifiers.includes(local) &&
            moduleProperties.has(nameOf(property))
          )
        })
      )
        return true
      return (
        definition?.type === 'Variable' &&
        definition.parent.kind === 'const' &&
        originates(definition.node.init, kind, seen)
      )
    }

    function isReflectGetter(node, seen = new Set()) {
      node = unwrap(node)
      if (node?.type === 'MemberExpression')
        return (
          node.object.type === 'Identifier' &&
          node.object.name === 'Reflect' &&
          !bindingFor(sourceCode, node.object)?.defs.length &&
          nameOf(node) === 'get'
        )
      if (node?.type !== 'Identifier') return false
      const binding = bindingFor(sourceCode, node)
      if (!binding || seen.has(binding)) return false
      seen.add(binding)
      const definition = binding.defs[0]
      return (
        definition?.type === 'Variable' &&
        definition.parent.kind === 'const' &&
        isReflectGetter(definition.node.init, seen)
      )
    }

    function checkProperty(node, object, name, computed = false) {
      if (
        !ownsRecovery &&
        (name === 'replaceWasmInstance' ||
          (name === 'restartWasmModule' && originates(object, 'utilities')))
      )
        report(node, 'recovery')
      if (ownsNative) return
      if (originates(object, 'module')) {
        if (name === 'Context') report(node, 'native')
        else if (computed && name === undefined) report(node, 'opaque')
      } else if (
        name === 'cloneWithExecuteCallbacks' &&
        originates(object, 'instance')
      )
        report(node, 'native')
    }

    function checkImportOrExport(node) {
      const source = node.source?.value
      if (typeof source !== 'string') return
      if (node.importKind === 'type' || node.exportKind === 'type') return
      const specifiers = (node.specifiers ?? []).filter(
        (specifier) =>
          specifier.importKind !== 'type' && specifier.exportKind !== 'type'
      )
      if (rustContextModule(source) && !ownsWrapper)
        for (const specifier of specifiers) report(specifier, 'wrapper')
      if (wasmUtilsModule(source) && !ownsRecovery)
        for (const specifier of specifiers) {
          const imported = specifier.imported ?? specifier.local
          if ((imported?.name ?? imported?.value) === 'restartWasmModule')
            report(specifier, 'recovery')
        }
      if (!generatedModule(source) || ownsNative) return
      for (const specifier of specifiers) {
        const imported = specifier.imported ?? specifier.local
        if ((imported?.name ?? imported?.value) === 'Context')
          report(specifier, 'native')
      }
    }

    return {
      ImportDeclaration: checkImportOrExport,
      ExportNamedDeclaration: checkImportOrExport,
      ExportAllDeclaration(node) {
        if (node.exportKind === 'type') return
        if (generatedModule(node.source.value) && !ownsNative)
          report(node, 'opaque')
        if (rustContextModule(node.source.value) && !ownsWrapper)
          report(node, 'wrapper')
        if (wasmUtilsModule(node.source.value) && !ownsRecovery)
          report(node, 'recovery')
      },
      ImportExpression(node) {
        if (
          rustContextModule(staticValue(sourceCode, node.source) ?? '') &&
          !ownsWrapper
        )
          report(node, 'wrapper')
      },
      MemberExpression(node) {
        checkProperty(node, node.object, nameOf(node), node.computed)
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern') return
        for (const property of node.id.properties)
          if (property.type === 'Property')
            checkProperty(
              property,
              node.init,
              nameOf(property),
              property.computed
            )
      },
      CallExpression(node) {
        if (isReflectGetter(node.callee))
          checkProperty(
            node,
            node.arguments[0],
            staticValue(sourceCode, node.arguments[1]),
            true
          )
      },
    }
  },
}
