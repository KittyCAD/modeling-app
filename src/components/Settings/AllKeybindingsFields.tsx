import type { ForwardedRef } from 'react'
import { forwardRef } from 'react'
import { useLocation } from 'react-router-dom'

import type { InteractionMapItem } from '@src/lib/settings/initialKeybindings'
import {
  interactionMap,
  sortInteractionMapByCategory,
} from '@src/lib/settings/initialKeybindings'

type AllKeybindingsFieldsProps = object

export const AllKeybindingsFields = forwardRef(
  (
    _props: AllKeybindingsFieldsProps,
    scrollRef: ForwardedRef<HTMLDivElement>
  ) => {
    // This is how we will get the interaction map from the context
    // in the future whene franknoirot/editable-hotkeys is merged.
    // const { state } = useInteractionMapContext()

    return (
      <div className="relative overflow-y-auto pb-16">
        <div ref={scrollRef} className="flex flex-col gap-12">
          {Object.entries(interactionMap)
            .sort(sortInteractionMapByCategory)
            .map(([category, categoryItems]) => (
              <div className="flex flex-col gap-4 px-2 pr-4">
                <h2
                  id={`category-${category.replaceAll(/\s/g, '-')}`}
                  className="text-xl mt-6 first-of-type:mt-0 capitalize font-bold"
                >
                  {category}
                </h2>
                {categoryItems.map((item) => (
                  <KeybindingField
                    key={category + '-' + item.name}
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
      className={
        'flex gap-16 justify-between items-start py-1 px-2 -my-1 -mx-2 ' +
        (location.hash === `#${item.name}`
          ? 'bg-primary/5 dark:bg-chalkboard-90'
          : '')
      }
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
