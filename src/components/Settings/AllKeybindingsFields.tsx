import type { ForwardedRef } from 'react'
import { forwardRef } from 'react'
import { useLocation } from 'react-router-dom'
import { interactionMapCategoriesInOrder } from '@src/lib/settings/initialKeybindings'
import { shortcutService } from '@src/lib/singletons'
import type { Shortcut } from '@src/lib/shortcuts'

type AllKeybindingsFieldsProps = object

export const AllKeybindingsFields = forwardRef(
  (
    _props: AllKeybindingsFieldsProps,
    scrollRef: ForwardedRef<HTMLDivElement>
  ) => {
    return (
      <div className="relative overflow-y-auto pb-16">
        <div ref={scrollRef} className="flex flex-col gap-12">
          {interactionMapCategoriesInOrder.map((category) => (
            <div className="flex flex-col gap-4 px-2 pr-4" key={category}>
              <h2
                id={`category-${category.replaceAll(/\s/g, '-')}`}
                className="text-xl mt-6 first-of-type:mt-0 capitalize font-bold"
              >
                {category}
              </h2>
              {shortcutService.shortcuts
                .values()
                .filter((item) => item.category === category)
                .toArray()
                .map((item) => (
                  <KeybindingField
                    key={`category-${item.id}`}
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
  item: Shortcut
  category: string
}) {
  const location = useLocation()

  return (
    <div
      className={
        'grid grid-cols-2 gap-16 py-1 px-2 -mx-2 ' +
        (location.hash === `#${item.id}`
          ? 'bg-primary/5 dark:bg-chalkboard-90'
          : '')
      }
      id={item.id}
    >
      <div className="flex-grow-0">
        <h3 className="text-lg font-normal capitalize tracking-wide">
          {item.title}
        </h3>
        <p className="text-sm text-chalkboard-60 dark:text-chalkboard-50">
          {item.description}
        </p>
      </div>
      <div className="flex-1 flex flex-col gap-3">
        <div className="flex flex-wrap justify-end gap-3">
          {item.sequence.split(' ').map((chord, i) => (
            <kbd
              key={`${category}-${item.id}-${chord}-${i}`}
              className="hotkey"
            >
              {chord}
            </kbd>
          ))}
        </div>
        <p className="text-xs text-chalkboard-60 dark:text-chalkboard-50 text-right">
          {item.enabledDescription}
        </p>
      </div>
    </div>
  )
}
