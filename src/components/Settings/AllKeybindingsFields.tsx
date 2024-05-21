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
            <p>{item.sequence}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
