export const guardrailRuleNames = new Set([
  'zds/no-artificial-delay',
  'zds/no-long-ui-animation',
  'zds/no-manual-cache-reset',
  'zds/performance-exceptions',
])

export const propertyName = (node) => {
  if (!node.computed && node.property?.type === 'Identifier') {
    return node.property.name
  }
  if (node.property?.type === 'Literal') return node.property.value
  if (!node.computed && node.key?.type === 'Identifier') return node.key.name
  if (node.key?.type === 'Literal') return node.key.value
  return undefined
}

export function bindingFor(sourceCode, node) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const binding = scope.set.get(node.name)
    if (binding) return binding
  }
  return undefined
}

export function staticValue(sourceCode, node, seen = new Set()) {
  if (!node) return undefined
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const value = staticValue(sourceCode, node.argument, seen)
    return typeof value === 'number' ? -value : undefined
  }
  if (node.type !== 'Identifier') return undefined
  const binding = bindingFor(sourceCode, node)
  if (!binding || seen.has(binding)) return undefined
  seen.add(binding)
  const definition = binding.defs[0]
  if (definition?.type !== 'Variable' || definition.parent.kind !== 'const') {
    return undefined
  }
  return staticValue(sourceCode, definition.node.init, seen)
}

export function exceptionFor(sourceCode, node, categories, claimed) {
  const line = node.loc.start.line
  return sourceCode.getAllComments().some((comment) => {
    if (comment.loc.end.line !== line - 1 && comment.loc.start.line !== line) {
      return false
    }
    const match = comment.value
      .trim()
      .match(/^zds-performance-exception: ([a-z-]+) -- (\S[\s\S]*)$/)
    if (!match || !categories.has(match[1]) || match[2].trim().length < 20)
      return false
    if (claimed.has(comment) && claimed.get(comment) !== node) return false
    claimed.set(comment, node)
    return true
  })
}

export const timerExceptionCategories = new Set([
  'network-deadline',
  'connection-retry',
  'external-protocol',
  'idle-lifecycle',
  'activity-indicator',
  'storage-batching',
  'render-observation',
  'resource-cleanup',
  'input-protocol',
  'background-polling',
  'feedback-lifetime',
  'resource-retry',
])

export const animationExceptionCategories = new Set(['activity-indicator'])
