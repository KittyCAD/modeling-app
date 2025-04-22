import {
  interactionMap,
  sortInteractionMapByCategory,
} from '@src/lib/settings/initialKeybindings'

interface KeybindingSectionsListProps {
  scrollRef: React.RefObject<HTMLDivElement>
}

export function KeybindingsSectionsList({
  scrollRef,
}: KeybindingSectionsListProps) {
  return (
    <div className="flex w-32 flex-col gap-3 pr-2 py-1 border-0 border-r border-r-chalkboard-20 dark:border-r-chalkboard-90">
      {Object.entries(interactionMap)
        .sort(sortInteractionMapByCategory)
        .map(([category]) => (
          <button
            key={category}
            onClick={() =>
              scrollRef.current
                ?.querySelector(`#category-${category.replaceAll(/\s/g, '-')}`)
                ?.scrollIntoView({
                  block: 'center',
                  behavior: 'smooth',
                })
            }
            className="capitalize text-left border-none px-1"
          >
            {category}
          </button>
        ))}
    </div>
  )
}
