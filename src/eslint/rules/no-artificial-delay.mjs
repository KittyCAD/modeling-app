import {
  bindingFor,
  exceptionFor,
  propertyName,
  timerExceptionCategories,
} from './performance-policy.mjs'

const delayNames = new Set([
  'setTimeout',
  'setInterval',
  'setImmediate',
  'sleep',
  'delay',
  'wait',
  'debounce',
  'throttle',
  'deferredCallback',
  'useDebounce',
  'useDebouncedCallback',
  'useThrottle',
  'waitForTimeout',
])

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Reject artificial interaction delays, including unknown timings.',
    },
    schema: [],
    messages: {
      delay:
        '{{name}} can delay an interaction. Remove the wait; functional deadlines/lifecycle timers require an adjacent, specific zds-performance-exception comment.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    const claimed = new Map()
    const report = (node, name) => {
      if (exceptionFor(sourceCode, node, timerExceptionCategories, claimed))
        return
      context.report({ node, messageId: 'delay', data: { name } })
    }
    const delayedName = (node, seen = new Set()) => {
      if (node.type === 'MemberExpression') {
        const name = propertyName(node)
        return delayNames.has(name) ? name : undefined
      }
      if (node.type !== 'Identifier') return undefined
      if (delayNames.has(node.name)) return node.name
      const binding = bindingFor(sourceCode, node)
      if (!binding || seen.has(binding)) return undefined
      seen.add(binding)
      const definition = binding.defs[0]
      if (definition?.type === 'ImportBinding') {
        const imported = definition.node.imported
        const name = imported?.name ?? imported?.value
        if (delayNames.has(name)) return name
        if (
          definition.node.type === 'ImportDefaultSpecifier' &&
          /(?:^|[/.-])(debounce|throttle|sleep|delay)(?:$|[/.])/.test(
            definition.parent.source.value
          )
        )
          return definition.parent.source.value
      }
      if (definition?.type === 'Variable' && definition.node.init) {
        if (definition.node.id.type === 'ObjectPattern') {
          const property = definition.node.id.properties.find(
            (item) => item.type === 'Property' && item.value === definition.name
          )
          const name = property && propertyName(property)
          return delayNames.has(name) ? name : undefined
        }
        return delayedName(definition.node.init, seen)
      }
      return undefined
    }
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          propertyName(node.callee) === 'timeout' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'AbortSignal'
        ) {
          report(node, 'AbortSignal.timeout')
          return
        }
        const name = delayedName(node.callee)
        if (name) report(node, name)
      },
      Property(node) {
        const name = propertyName(node)
        if (name === 'after' && node.value.type === 'ObjectExpression') {
          report(node, 'XState after')
        }
      },
      JSXAttribute(node) {
        if (['delay', 'showAfter', 'hideAfter'].includes(node.name.name)) {
          report(node, node.name.name)
        }
      },
    }
  },
}
