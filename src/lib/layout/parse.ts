import type {
  Action,
  BaseLayout,
  Layout,
  Orientation,
  PaneLayout,
  Side,
  SimpleLayout,
  SplitLayout,
} from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import { isArray } from '@src/lib/utils'
import { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import { isErr } from '@src/lib/trap'
import { isCustomIconName } from '@src/components/CustomIcon'
import { actionTypeRegistry } from '@src/lib/layout/actionTypeRegistry'

export function parseLayoutFromJsonString(
  layoutString: string
): Layout | Error {
  try {
    const layoutWithMetadata = JSON.parse(layoutString)
    if (
      !(
        'version' in layoutWithMetadata &&
        layoutWithMetadata.version === 'v1' &&
        'layout' in layoutWithMetadata &&
        layoutWithMetadata.layout
      )
    ) {
      return new Error('Invalid layout persistence metadata')
    }

    const parseResult = parseLayoutInner(layoutWithMetadata.layout)

    return !isErr(parseResult) ? parseResult : new Error('invalid layout')
  } catch (e) {
    return new Error(`Failed to parse layout from disk ${String(e)}`)
  }
}

export function parseLayoutInner(l: unknown): Layout | Error {
  const basicResult = parseBaseLayout(l)
  if (isErr(basicResult)) {
    console.error(basicResult)
    return basicResult
  }

  switch (basicResult.type) {
    case LayoutType.Simple:
      return parseSimpleLayout(basicResult)
    case LayoutType.Splits:
      return parseSplitLayout(basicResult)
    case LayoutType.Panes:
      return parsePaneLayout(basicResult)
  }
}

function validateLayoutType(l: string): l is LayoutType {
  return Object.values(LayoutType).includes(l as LayoutType)
}
function validateAreaType(a: unknown): a is keyof typeof areaTypeRegistry {
  return Object.keys(areaTypeRegistry).includes(
    a as keyof typeof areaTypeRegistry
  )
}
function validateActionType(a: unknown): a is keyof typeof actionTypeRegistry {
  return Object.keys(actionTypeRegistry).includes(
    a as keyof typeof actionTypeRegistry
  )
}

/** Basic record (object) type narrowing */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/**
 * Healable properties: `id`, `label`
 * Fatal: `type`
 */
function parseBaseLayout(layout: unknown): Error | BaseLayout {
  if (!isRecord(layout)) {
    return new Error('Invalid layout')
  }

  // Invalid layout type is fatal
  if (typeof layout.type !== 'string') {
    return new Error('Layout is missing type')
  }

  if (!validateLayoutType(layout.type)) {
    return new Error(`Layout has invalid type "${layout.type}"`)
  }

  // Heal an invalid ID
  const id =
    'id' in layout && typeof layout.id === 'string'
      ? layout.id
      : crypto.randomUUID()
  // Heal an invalid label
  const label =
    'label' in layout && typeof layout.label === 'string'
      ? layout.label
      : 'Unlabeled area'

  return {
    ...layout,
    type: layout.type,
    id,
    label,
  }
}

/**
 * Healable properties: `id`, `label` from BaseLayout
 * Fatal: `areaType`
 */
export function parseSimpleLayout(layout: BaseLayout): SimpleLayout | Error {
  // Must have a registered areaType, fatal if not
  const hasValidAreaType =
    'areaType' in layout && validateAreaType(layout.areaType)
  if (!hasValidAreaType) {
    return new Error('Invalid area type in simple layout')
  }

  return layout as SimpleLayout
}

/** For use in type narrowing */
function isOrientation(o: unknown): o is Orientation {
  return typeof o === 'string' && (o === 'block' || o === 'inline')
}

/**
 * Healable properties:
 *  - `children`: drop invalid children
 *  - `sizes`: fall back to even division
 * Fatal: `areaType`
 */
export function parseSplitLayout(
  layout: BaseLayout & Partial<Omit<SplitLayout, 'type'>>
): SplitLayout | Error {
  // No children is fatal
  if (!isArray(layout.children)) {
    return new Error('Split layout with no children, invalid')
  }

  // Invalid orientation is healable
  const orientation = isOrientation(layout.orientation)
    ? layout.orientation
    : 'inline'

  // Drop catastrophically erroring children
  const newChildren: Layout[] = []
  const newSizes: number[] = []
  // Iterate in reverse to not mess up size indices
  for (let i = layout.children.length - 1; i >= 0; i--) {
    const parsedChild = parseLayoutInner(layout.children[i])
    if (!isErr(parsedChild)) {
      newChildren.unshift(parsedChild)
      if (isArray(layout.sizes)) {
        newSizes.unshift(layout.sizes[i])
      }
    }
  }

  // Invalid sizes is healable, divide space evenly
  const hasValidSizes =
    isArray(newSizes) &&
    newSizes.length === layout.children.length &&
    newSizes.reduce((a, b) => a + b, 0) === 100
  const length = layout.children.length
  const fallbackSizes: number[] = length
    ? new Array(length).fill(100 / length)
    : []
  const sizes =
    isArray(layout.sizes) && hasValidSizes ? layout.sizes : fallbackSizes

  return {
    ...layout,
    type: LayoutType.Splits,
    children: newChildren,
    orientation,
    sizes,
  } satisfies SplitLayout
}

/** For type narrowing */
function validateSide(s: unknown): s is Side {
  return (
    typeof s === 'string' &&
    ['inline-start', 'inline-end', 'block-start', 'block-end'].includes(s)
  )
}

/**
 * Healable properties: `id`, `label`
 * Fatal: `actionType`, `icon`
 */
export function parseAction(action: unknown): Action | Error {
  if (!isRecord(action)) {
    return new Error('Action is not object')
  }

  // Heal an invalid ID
  const id = typeof action.id === 'string' ? action.id : crypto.randomUUID()

  // Heal invalid label
  const label =
    typeof action.label === 'string' ? action.label : 'Unlabeled action'

  // Invalid actionType is fatal
  if (
    !(
      typeof action.actionType === 'string' &&
      validateActionType(action.actionType)
    )
  ) {
    return new Error(
      `Layout has ${action.actionType ? 'invalid' : 'missing'} type ${action.actionType ?? ''}`
    )
  }

  // Having a missing or invalid icon is fatal
  if (!(typeof action.icon === 'string' && isCustomIconName(action.icon))) {
    return new Error(
      `Layout has ${action.actionType ? 'invalid' : 'missing'} type ${action.actionType ?? ''}`
    )
  }

  return {
    actionType: action.actionType,
    icon: action.icon,
    id,
    label,
  } satisfies Action
}

/**
 * Healable properties:
 *  - `children`: drop invalid children
 *  - `sizes`: fall back to even division
 * Fatal: `areaType`
 */
function parsePaneLayout(
  layout: Omit<BaseLayout, 'type'> & Partial<Omit<PaneLayout, 'type'>>
): PaneLayout | Error {
  // No children is fatal
  if (!isArray(layout.children)) {
    return new Error('Pane layout with no children, invalid')
  }

  // Invalid side is healable, default to the inline-start (left in LTR)
  const side = validateSide(layout.side) ? layout.side : 'block-start'

  // Invalid orientation is healable
  const splitOrientation = isOrientation(layout.splitOrientation)
    ? layout.splitOrientation
    : 'block'

  // Drop catastrophically erroring children
  const newChildren: PaneLayout['children'] = []
  const newSizes: number[] = []
  // Iterate in reverse to not mess up size indices
  for (let i = layout.children.length - 1; i >= 0; i--) {
    const child = layout.children[i]
    const parsedChild = parseLayoutInner(child)
    if (
      !isErr(parsedChild) &&
      typeof child.icon === 'string' &&
      isCustomIconName(child.icon)
    ) {
      newChildren.unshift({
        ...parsedChild,
        icon: child.icon,
      })
      // Add to our new sizes array if this child is an active index as well
      if (isArray(layout.sizes) && isArray(layout.activeIndices)) {
        const indexToUnshift = layout.activeIndices.indexOf(i)
        if (indexToUnshift >= 0) {
          newSizes.unshift(layout.sizes[indexToUnshift])
        }
      }
    }
  }

  // Invalid active indices is healable, just make the first active
  const activeIndices =
    isArray(layout.activeIndices) &&
    layout.activeIndices.every(Number.isSafeInteger) &&
    layout.activeIndices.every((a) => a >= 0 && a < newChildren.length)
      ? layout.activeIndices
      : [0]

  // Invalid sizes is healable, divide space evenly
  const length = activeIndices.length
  const fallbackSizes: number[] = length
    ? new Array(length).fill(100 / length)
    : []
  const sizes =
    isArray(newSizes) &&
    newSizes.length === activeIndices.length &&
    newSizes.reduce((a, b) => a + b, 0) === 100
      ? newSizes
      : fallbackSizes

  // Drop catastrophically erroring actions
  // TODO: propogate errors as warnings
  const actions: NonNullable<PaneLayout['actions']> = []
  if ('actions' in layout && isArray(layout.actions)) {
    // Iterate in reverse so we can remove without messing up indices
    for (let i = layout.actions.length - 1; i >= 0; i--) {
      const action = layout.actions[i]
      const parsedAction = parseAction(action)
      if (!isErr(parsedAction)) {
        // We assign over in case the parsing healed anything
        actions.unshift(parsedAction)
      } else {
        console.error(`ACTION PARSE ERROR ${parsedAction.message}`)
      }
    }
  }

  return {
    ...layout,
    type: LayoutType.Panes,
    actions,
    activeIndices,
    children: newChildren,
    side,
    sizes,
    splitOrientation,
  } satisfies PaneLayout
}
