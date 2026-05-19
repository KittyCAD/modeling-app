import { useSignals } from '@preact/signals-react/runtime'
import type { ForwardedRef } from 'react'
import { forwardRef } from 'react'
import { useLocation } from 'react-router-dom'

import { useApp } from '@src/lib/boot'
import type { InteractionMapItem } from '@src/lib/settings/initialKeybindings'
import {
  interactionMap,
  sortInteractionMapByCategory,
} from '@src/lib/settings/initialKeybindings'
import { platform } from '@src/lib/utils'
import type { KeymapItem } from '@src/registry/contracts/keymap'
import { keymapValueSpec } from '@src/registry/contracts/keymap'

type AllKeybindingsFieldsProps = object

const keymapCategoryById: Record<string, keyof typeof interactionMap> = {
  'command-palette.open': 'Command Palette',
  'command-palette.close': 'Command Palette',
  'settings.open': 'Settings',
  'settings.project': 'Settings',
  'settings.user': 'Settings',
  'view.top': 'Modeling',
  'view.right': 'Modeling',
  'view.front': 'Modeling',
  'view.back': 'Modeling',
  'view.bottom': 'Modeling',
  'view.left': 'Modeling',
  'view.zoom-to-fit': 'Modeling',
  'view.reset': 'Modeling',
}

const keymapDisplayOrder = Object.keys(keymapCategoryById)

const keymapModifierDisplay: Record<string, string> = {
  alt: 'Alt',
  cmd: 'Command',
  command: 'Command',
  control: 'Control',
  ctrl: 'Control',
  meta: 'Meta',
  mod: platform() === 'macos' ? 'Command' : 'Control',
  option: 'Option',
  shift: 'Shift',
}

export const AllKeybindingsFields = forwardRef(
  (
    _props: AllKeybindingsFieldsProps,
    scrollRef: ForwardedRef<HTMLDivElement>
  ) => {
    useSignals()
    const { registry } = useApp()
    const keymapItemsByCategory = getKeymapItemsByCategory(
      registry.signal(keymapValueSpec).value.items
    )
    const interactionMapWithKeymaps = mergeInteractionMapWithKeymapItems(
      interactionMap,
      keymapItemsByCategory
    )

    return (
      <div className="relative overflow-y-auto pb-16">
        <div ref={scrollRef} className="flex flex-col gap-12">
          {Object.entries(interactionMapWithKeymaps)
            .sort(sortInteractionMapByCategory)
            .map(([category, categoryItems]) => (
              <div key={category} className="flex flex-col gap-4 px-2 pr-4">
                <h2
                  id={`category-${category.replaceAll(/\s/g, '-')}`}
                  className="text-xl mt-6 first-of-type:mt-0 capitalize font-bold"
                >
                  {category}
                </h2>
                {categoryItems.map((item) => (
                  <KeybindingField
                    key={`${category}-${item.name}`}
                    category={category}
                    item={item}
                  />
                ))}
              </div>
            ))}
        </div>
      </div>
    )
  }
)

function mergeInteractionMapWithKeymapItems(
  baseInteractionMap: typeof interactionMap,
  keymapItemsByCategory: Partial<
    Record<keyof typeof interactionMap, InteractionMapItem[]>
  >
) {
  return Object.fromEntries(
    Object.entries(baseInteractionMap).map(([category, items]) => [
      category,
      [...items, ...(keymapItemsByCategory[category] ?? [])],
    ])
  ) as typeof interactionMap
}

function getKeymapItemsByCategory(items: readonly KeymapItem[]) {
  const displayItems: Partial<
    Record<keyof typeof interactionMap, InteractionMapItem[]>
  > = {}

  for (const item of items.toSorted(compareKeymapItemsForDisplay)) {
    const category = getKeymapItemCategory(item)

    displayItems[category] = [
      ...(displayItems[category] ?? []),
      {
        name: item.id,
        sequence: item.keystrokes.map(formatKeymapChord).join(' '),
        title: item.title,
        description: item.command,
      },
    ]
  }

  return displayItems
}

function getKeymapItemCategory(item: KeymapItem) {
  return keymapCategoryById[item.id] ?? 'Miscellaneous'
}

function compareKeymapItemsForDisplay(a: KeymapItem, b: KeymapItem) {
  const aIndex = keymapDisplayOrder.indexOf(a.id)
  const bIndex = keymapDisplayOrder.indexOf(b.id)

  if (aIndex === -1 && bIndex === -1) {
    return a.title.localeCompare(b.title)
  }
  if (aIndex === -1) {
    return 1
  }
  if (bIndex === -1) {
    return -1
  }

  return aIndex - bIndex
}

function formatKeymapChord(chord: string) {
  return chord
    .split('+')
    .map((part) => formatKeymapChordPart(part.trim()))
    .join('+')
}

function formatKeymapChordPart(part: string) {
  const normalized = part.toLowerCase()
  const modifierDisplay = keymapModifierDisplay[normalized]
  if (modifierDisplay) {
    return modifierDisplay
  }

  if (normalized.length === 1 && /[a-z]/.test(normalized)) {
    return normalized.toUpperCase()
  }

  return part
}

function KeybindingField({
  item,
  category,
}: {
  item: InteractionMapItem
  category: string
}) {
  const location = useLocation()

  return (
    <div
      className={`flex gap-16 justify-between items-start py-1 px-2 -my-1 -mx-2 ${
        location.hash === `#${item.name}`
          ? 'bg-primary/5 dark:bg-chalkboard-90'
          : ''
      }`}
      id={item.name}
    >
      <div>
        <h3 className="text-lg font-normal capitalize tracking-wide">
          {item.title}
        </h3>
        <p className="text-xs text-chalkboard-60 dark:text-chalkboard-50">
          {item.description}
        </p>
      </div>
      <div className="flex-1 flex flex-wrap justify-end gap-3">
        {item.sequence.split(' ').map((chord, i) => (
          <kbd
            key={`${category}-${item.name}-${chord}-${i}`}
            className="py-0.5 px-1.5 rounded bg-primary/10 dark:bg-chalkboard-80"
          >
            {chord}
          </kbd>
        ))}
      </div>
    </div>
  )
}
