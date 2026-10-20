import { bindingFor, propertyName, staticValue } from './performance-policy.mjs'

const methods = new Set(['clearSceneAndBustCache', 'bustCacheAndResetScene'])
const resetName = (context, node) =>
  node.computed
    ? staticValue(context.sourceCode, node.property ?? node.key)
    : propertyName(node)

function isDocumentedWrapper(context, node) {
  if (
    propertyName(node) !== 'bustCacheAndResetScene' ||
    !context.filename
      .replaceAll('\\', '/')
      .endsWith('/src/lib/rustContext/index.ts') ||
    node.object.type !== 'Identifier' ||
    node.object.name !== 'instance' ||
    node.parent.type !== 'CallExpression' ||
    node.parent.callee !== node
  )
    return false
  let owner = node.parent
  while (owner && owner.type !== 'MethodDefinition') owner = owner.parent
  if (!owner || propertyName(owner) !== 'clearSceneAndBustCache') return false
  const binding = bindingFor(context.sourceCode, node.object)
  const definition = binding?.defs[0]
  const initializer = definition?.node.init
  if (
    definition?.type !== 'Variable' ||
    definition.parent.kind !== 'const' ||
    initializer?.type !== 'AwaitExpression' ||
    initializer.argument.type !== 'CallExpression' ||
    initializer.argument.callee.type !== 'MemberExpression' ||
    initializer.argument.callee.object.type !== 'ThisExpression' ||
    propertyName(initializer.argument.callee) !== '_checkContextInstance'
  )
    return false
  let declarationOwner = definition.node
  while (declarationOwner && declarationOwner.type !== 'MethodDefinition')
    declarationOwner = declarationOwner.parent
  if (
    declarationOwner !== owner ||
    owner.parent.parent.id?.name !== 'RustContext'
  )
    return false
  const warning = context.sourceCode.getCommentsBefore(owner).at(-1)
  return Boolean(
    warning?.value.includes(
      'NO ONE CAN CALL THIS FUNCTION WITHOUT FIRST ASKING @jessfraz'
    )
  )
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Keep execution cache validity owned by Rust.' },
    schema: [],
    messages: {
      reset:
        'Do not call or alias {{method}}. Rust owns cache validity. Manual cache resets require explicit approval from @jessfraz; do not use them to repair navigation, file edits, or settings.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const method = resetName(context, node)
        if (!methods.has(method) || isDocumentedWrapper(context, node)) return
        context.report({ node, messageId: 'reset', data: { method } })
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !methods.has(node.callee.name))
          return
        context.report({
          node,
          messageId: 'reset',
          data: { method: node.callee.name },
        })
      },
      Property(node) {
        if (
          node.parent.type !== 'ObjectPattern' ||
          !methods.has(resetName(context, node))
        )
          return
        context.report({
          node,
          messageId: 'reset',
          data: { method: resetName(context, node) },
        })
      },
    }
  },
}
