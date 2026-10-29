import postcss from 'postcss'
import {
  animationExceptionCategories,
  bindingFor,
  exceptionFor,
  propertyName,
  staticValue,
} from './performance-policy.mjs'

const timePattern = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(ms|s)$/
const durationProperties = new Set([
  'animation-duration',
  'transition-duration',
])
const delayProperties = new Set(['animation-delay', 'transition-delay'])
const normalizeProperty = (name) =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

function time(value) {
  if (value === 0 || value === '0') return 0
  if (typeof value === 'number') return value
  const match = typeof value === 'string' && value.trim().match(timePattern)
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : undefined
}

function iterations(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function timingProblem(property, value, iterationValue = '1') {
  if (typeof value !== 'string' && typeof value !== 'number') return true
  if (typeof value === 'string' && /\b(?:var|calc|env)\(/.test(value))
    return true
  const entries = postcss.list.comma(String(value))
  const counts = postcss.list.comma(String(iterationValue))
  return entries.some((entry, index) => {
    const count = iterations(counts[index % counts.length])
    if (delayProperties.has(property)) return time(entry) !== 0
    if (durationProperties.has(property)) {
      const duration = time(entry)
      return (
        duration === undefined ||
        duration < 0 ||
        duration > 100 ||
        (property.startsWith('animation')
          ? count === undefined || duration * count > 100
          : duration > 100)
      )
    }
    if (property === 'animation' || property === 'transition') {
      if (/\b(?:inherit|revert|revert-layer)\b/.test(entry)) return true
      if (entry === 'none') return false
      const words = postcss.list.space(entry)
      const times = words.filter(
        (word) => timePattern.test(word) || word === '0'
      )
      if (times.length > 2 || (times[1] !== undefined && time(times[1]) !== 0))
        return true
      const duration = times.length ? time(times[0]) : 0
      let iterationCount = count
      if (property === 'animation') {
        const explicitCount = words.find(
          (word) =>
            word === 'infinite' || /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(word)
        )
        if (explicitCount !== undefined)
          iterationCount = iterations(explicitCount)
      }
      return (
        duration === undefined ||
        duration < 0 ||
        duration > 100 ||
        (property === 'animation'
          ? iterationCount === undefined || duration * iterationCount > 100
          : duration > 100)
      )
    }
    return false
  })
}

function hasNonzeroDelay(property, value) {
  if (delayProperties.has(property)) return timingProblem(property, value)
  if (
    !['animation', 'transition'].includes(property) ||
    typeof value !== 'string'
  )
    return false
  return postcss.list.comma(value).some((entry) => {
    const times = postcss.list
      .space(entry)
      .filter((word) => timePattern.test(word) || word === '0')
    return times.length > 1 && time(times[1]) !== 0
  })
}

const knownTiming = (value) =>
  typeof value === 'number' ||
  (typeof value === 'string' && !/\b(?:var|calc|env)\(/.test(value))

const knownIterations = (value) =>
  value !== undefined &&
  postcss.list
    .comma(String(value))
    .every((count) => count === 'infinite' || iterations(count) !== undefined)

function canExceptActivity(property, value, count) {
  if (
    !knownTiming(value) ||
    (typeof value === 'string' &&
      /\b(?:inherit|revert|revert-layer)\b/.test(value)) ||
    !knownIterations(count) ||
    hasNonzeroDelay(property, value)
  )
    return false
  if (durationProperties.has(property))
    return postcss.list.comma(String(value)).every((entry) => {
      const duration = time(entry)
      return duration !== undefined && duration >= 0
    })
  if (['animation', 'transition'].includes(property)) {
    return postcss.list.comma(String(value)).every((entry) =>
      postcss.list
        .space(entry)
        .filter((word) => timePattern.test(word))
        .every((word) => time(word) >= 0)
    )
  }
  return true
}

function isClassText(node) {
  for (let owner = node.parent; owner; owner = owner.parent) {
    if (owner.type === 'JSXAttribute')
      return /className$|^(?:enter|leave)(?:From|To)?$/i.test(owner.name.name)
    if (
      owner.type === 'Property' &&
      /className$|^(?:enter|leave)(?:From|To)?$/i.test(propertyName(owner))
    )
      return true
    if (
      owner.type === 'CallExpression' &&
      owner.callee.type === 'Identifier' &&
      /^(?:cn|clsx|classNames|twMerge|cva)$/.test(owner.callee.name)
    )
      return true
    if (owner.type === 'VariableDeclarator' && owner.id.type === 'Identifier')
      return /class(?:es|names)?$/i.test(owner.id.name)
  }
  return false
}

function importedComponent(sourceCode, node, moduleName, seen = new Set()) {
  if (
    node.type === 'JSXMemberExpression' &&
    node.object.type === 'JSXIdentifier'
  ) {
    const binding = bindingFor(sourceCode, node.object)
    const definition = binding?.defs[0]
    if (
      definition?.type === 'ImportBinding' &&
      definition.node.type === 'ImportNamespaceSpecifier' &&
      definition.parent.source.value === moduleName
    )
      return node.property.name
    return undefined
  }
  if (!['JSXIdentifier', 'Identifier'].includes(node.type)) return undefined
  const binding = bindingFor(sourceCode, node)
  if (!binding || seen.has(binding)) return undefined
  seen.add(binding)
  const definition = binding.defs[0]
  if (
    definition?.type === 'ImportBinding' &&
    definition.parent.source.value === moduleName
  )
    return definition.node.imported?.name ?? definition.node.imported?.value
  if (definition?.type === 'Variable' && definition.node.init)
    return importedComponent(sourceCode, definition.node.init, moduleName, seen)
  return undefined
}

function usesAppToastRenderer(sourceCode, element) {
  const childrenAttribute = element.openingElement.attributes.find(
    (attribute) =>
      attribute.type === 'JSXAttribute' && attribute.name.name === 'children'
  )
  const expressions =
    childrenAttribute?.value?.type === 'JSXExpressionContainer'
      ? [childrenAttribute.value.expression]
      : element.children
          .filter((child) => child.type === 'JSXExpressionContainer')
          .map((child) => child.expression)
  return expressions.some((expression) => {
    if (
      !['ArrowFunctionExpression', 'FunctionExpression'].includes(
        expression.type
      )
    )
      return false
    const returned =
      expression.body.type === 'BlockStatement'
        ? expression.body.body.find(
            (statement) => statement.type === 'ReturnStatement'
          )?.argument
        : expression.body
    return (
      returned?.type === 'JSXElement' &&
      importedComponent(
        sourceCode,
        returned.openingElement.name,
        '@src/components/AppToast'
      ) === 'AppToast'
    )
  })
}

function classProblems(text, classText) {
  const classes = text.trim().split(/\s+/)
  const results = []
  const durationClasses = classes.filter((value) =>
    /(?:^|:)!?duration-/.test(value)
  )
  for (const token of classes) {
    const utility = token.replace(/^(?:[^\[\]\s]+:)+/, '').replace(/^!/, '')
    if (/^(?:duration|delay)-/.test(utility)) {
      const [kind, ...parts] = utility.split('-')
      const raw = parts.join('-')
      const value = /^\d+$/.test(raw)
        ? Number(raw)
        : raw.startsWith('[') && raw.endsWith(']')
          ? time(raw.slice(1, -1))
          : undefined
      if (value === undefined || (kind === 'delay' ? value !== 0 : value > 100))
        results.push(token)
    } else if (
      classText &&
      /^transition(?:-(?:all|colors|opacity|shadow|transform|\[.+\]))?$/.test(
        utility
      )
    ) {
      // Tailwind's implicit transition duration is 150ms. A complete literal
      // must explicitly override that default with a <=100ms duration.
      if (
        !durationClasses.some((value) =>
          /^!?duration-(?:0|75|100|\[(?:0|[\d.]+(?:ms|s))\])$/.test(value)
        )
      )
        results.push(token)
    } else if (
      utility.startsWith('animate-') &&
      utility !== 'animate-none' &&
      (classText || utility.startsWith('animate-['))
    ) {
      if (utility.startsWith('animate-[') && utility.endsWith(']')) {
        if (
          timingProblem('animation', utility.slice(9, -1).replaceAll('_', ' '))
        )
          results.push(token)
      } else {
        // Built-ins and named custom animations have implicit timing. Activity
        // indicators must state their functional exception at the use site.
        results.push(token)
      }
    } else if (utility.startsWith('[') && utility.endsWith(']')) {
      const colon = utility.indexOf(':')
      const property = utility.slice(1, colon)
      if (
        (durationProperties.has(property) ||
          delayProperties.has(property) ||
          ['animation', 'transition'].includes(property)) &&
        timingProblem(
          property,
          utility.slice(colon + 1, -1).replaceAll('_', ' ')
        )
      )
        results.push(token)
    }
  }
  return results
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Cap finite UI animation/transition duration at 100ms and require zero delay.',
    },
    schema: [],
    messages: {
      timing:
        '{{property}} must have a known total duration <=100ms and zero delay. Only functional activity indicators may use a single-site, reasoned exception.',
      toastDefaults:
        'react-hot-toast defaults exceed 100ms. Use the real AppToast renderer and app-toaster position-wrapper override; do not render the library ToastBar/ToastIcon defaults.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    const claimed = new Map()
    const report = (node, property, allowActivity = true) => {
      if (
        allowActivity &&
        exceptionFor(sourceCode, node, animationExceptionCategories, claimed)
      )
        return
      context.report({ node, messageId: 'timing', data: { property } })
    }
    const checkClass = (node, value, classText = isClassText(node)) => {
      for (const property of classProblems(value, classText)) {
        const noDelay = !/(?:^|:)!?delay-|(?:animation|transition)-delay:/.test(
          property
        )
        const unknown = /\b(?:var|calc|env)\(|(?:duration|delay)-$/.test(
          property
        )
        const arbitrary = property.match(/\[(animation|transition):(.+)\]/)
        report(
          node,
          property,
          noDelay &&
            !unknown &&
            !(
              arbitrary &&
              hasNonzeroDelay(arbitrary[1], arbitrary[2].replaceAll('_', ' '))
            )
        )
      }
    }
    const checkProperties = (properties) => {
      const iteration = properties.find(
        (item) => item.name === 'animation-iteration-count'
      )
      for (const item of properties) {
        if (
          durationProperties.has(item.name) ||
          delayProperties.has(item.name) ||
          ['animation', 'transition'].includes(item.name)
        ) {
          const count = iteration ? iteration.value : '1'
          if (
            (item.name.startsWith('animation') && !knownIterations(count)) ||
            timingProblem(item.name, item.value, count)
          )
            report(
              item.node,
              item.name,
              canExceptActivity(item.name, item.value, count)
            )
        }
        if (
          item.name === 'animation-iteration-count' &&
          !properties.some((other) =>
            ['animation', 'animation-duration'].includes(other.name)
          ) &&
          iterations(item.value) !== 1
        )
          report(item.node, item.name, knownIterations(item.value))
      }
    }
    return {
      Program() {
        const root = sourceCode.parserServices.css
        if (!root) return
        root.walkRules((rule) => {
          const properties = []
          rule.each((node) => {
            if (node.type !== 'decl') return
            properties.push({
              name: node.prop.replace(/^-(?:webkit|moz)-/, ''),
              value: node.value,
              node: {
                type: 'CSSDeclaration',
                loc: {
                  start: {
                    line: node.source.start.line,
                    column: node.source.start.column - 1,
                  },
                  end: {
                    line: node.source.end.line,
                    column: node.source.end.column,
                  },
                },
              },
            })
          })
          checkProperties(properties)
        })
        root.walkAtRules('apply', (node) =>
          checkClass(
            {
              type: 'CSSApply',
              loc: {
                start: {
                  line: node.source.start.line,
                  column: node.source.start.column - 1,
                },
                end: {
                  line: node.source.end.line,
                  column: node.source.end.column,
                },
              },
            },
            node.params,
            true
          )
        )
      },
      ObjectExpression(node) {
        const properties = node.properties.flatMap((property) => {
          const name = property.type === 'Property' && propertyName(property)
          return typeof name === 'string'
            ? [
                {
                  name: normalizeProperty(name),
                  value: staticValue(sourceCode, property.value),
                  node: property,
                },
              ]
            : []
        })
        checkProperties(properties)
      },
      AssignmentExpression(node) {
        if (node.left.type !== 'MemberExpression') return
        const name = propertyName(node.left)
        if (typeof name !== 'string') return
        checkProperties([
          {
            name: normalizeProperty(name),
            value: staticValue(sourceCode, node.right),
            node,
          },
        ])
      },
      Literal(node) {
        if (typeof node.value === 'string') checkClass(node, node.value)
      },
      TemplateLiteral(node) {
        // Inspect literal fragments too: interpolating the number in duration-*
        // produces an unknown duration, not a way around the cap.
        for (const quasi of node.quasis)
          checkClass(quasi, quasi.value.cooked ?? quasi.value.raw)
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          propertyName(node.callee) === 'setProperty'
        ) {
          const name = staticValue(sourceCode, node.arguments[0])
          if (typeof name === 'string')
            checkProperties([
              { name, value: staticValue(sourceCode, node.arguments[1]), node },
            ])
        }
        if (
          node.callee.type !== 'MemberExpression' ||
          propertyName(node.callee) !== 'animate' ||
          node.arguments.length === 0
        )
          return
        const options = node.arguments[1]
        if (options?.type === 'ObjectExpression') {
          const get = (name, fallback) => {
            const property = options.properties.find(
              (item) => item.type === 'Property' && propertyName(item) === name
            )
            return property ? staticValue(sourceCode, property.value) : fallback
          }
          const duration = get('duration')
          const count = get('iterations', 1)
          const noDelay = get('delay', 0) === 0 && get('endDelay', 0) === 0
          const known =
            typeof duration === 'number' &&
            typeof count === 'number' &&
            Number.isFinite(duration) &&
            Number.isFinite(count)
          const spread = options.properties.some(
            (property) => property.type === 'SpreadElement'
          )
          if (
            !known ||
            duration < 0 ||
            duration > 100 ||
            count < 0 ||
            duration * count > 100 ||
            !noDelay ||
            spread
          )
            report(
              node,
              'Web Animation timing',
              known && noDelay && !spread && duration >= 0 && count >= 0
            )
        } else {
          const duration = staticValue(sourceCode, options)
          if (typeof duration !== 'number' || duration < 0 || duration > 100)
            report(
              node,
              'Web Animation duration',
              typeof duration === 'number' &&
                Number.isFinite(duration) &&
                duration >= 0
            )
        }
      },
      JSXElement(node) {
        const component = importedComponent(
          sourceCode,
          node.openingElement.name,
          'react-hot-toast'
        )
        if (component === 'ToastBar' || component === 'ToastIcon') {
          context.report({
            node: node.openingElement,
            messageId: 'toastDefaults',
          })
        }
        if (component !== 'Toaster') return
        const container = node.openingElement.attributes.find(
          (attribute) =>
            attribute.type === 'JSXAttribute' &&
            attribute.name.name === 'containerClassName'
        )
        const value =
          container?.value?.type === 'JSXExpressionContainer'
            ? staticValue(sourceCode, container.value.expression)
            : container?.value?.value
        if (
          typeof value !== 'string' ||
          !value.split(/\s+/).includes('app-toaster') ||
          !usesAppToastRenderer(sourceCode, node)
        )
          context.report({
            node: node.openingElement,
            messageId: 'toastDefaults',
          })
      },
      JSXAttribute(node) {
        if (
          ![
            'enterTimeout',
            'exitTimeout',
            'transitionDuration',
            'animationDuration',
            'transitionDelay',
            'animationDelay',
          ].includes(node.name.name)
        )
          return
        const value =
          node.value?.type === 'JSXExpressionContainer'
            ? staticValue(sourceCode, node.value.expression)
            : node.value?.value
        const property = normalizeProperty(node.name.name)
        if (
          timingProblem(
            property.endsWith('timeout') ? 'transition-duration' : property,
            value
          )
        )
          report(
            node,
            property,
            canExceptActivity(
              property.endsWith('timeout') ? 'transition-duration' : property,
              value,
              '1'
            )
          )
      },
    }
  },
}
