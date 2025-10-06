import { shortcutService } from '@src/lib/singletons'

export function DebugShortcutsRoute() {
  return (
    <div className="p-4 max-w-4xl">
      <h1 className="text-2xl">Shortcuts</h1>
      <p>
        Current sequence: <code>{shortcutService.currentSequence}</code>
      </p>
      <ul>
        {shortcutService.shortcuts
          .entries()
          .toArray()
          .map(([seq, config]) => (
            <li key={seq}>
              {seq}: {config.title}
            </li>
          ))}
      </ul>
    </div>
  )
}
