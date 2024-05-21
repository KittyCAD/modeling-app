import { useInteractionMapContext } from 'hooks/useInteractionMapContext'

export function AllKeybindingsFields() {
  const { state } = useInteractionMapContext()
  return (
    <div className="relative overflow-y-auto">
      <div className="flex flex-col gap-4 px-2">
        {state.context.interactionMap.map((item) => (
          <div
            key={item.ownerId + '-' + item.name}
            className="flex gap-2 justify-between"
          >
            <h3>{item.title}</h3>
            <div className="flex gap-3">
              {item.sequence.split(' ').map((chord) => (
                <kbd
                  key={`${item.ownerId}-${item.name}-${chord}`}
                  className="py-0.5 px-1.5 rounded bg-primary/10 dark:bg-chalkboard-80"
                >
                  {chord}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
