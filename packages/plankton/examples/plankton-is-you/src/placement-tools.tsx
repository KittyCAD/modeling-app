import * as Popover from '@radix-ui/react-popover'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import type { Brush } from './board-edit'
import type { Definition } from './game'
import { TileArt } from './tile-art'
import { IconButton } from './ui'

export function PlacementTools({
  definitions,
  brush,
  tool,
  onBrush,
  onTool,
  onAccept,
  onCancel,
}: {
  definitions: readonly Definition[]
  brush: Brush
  tool: 'add' | 'delete'
  onBrush(brush: Brush): void
  onTool(tool: 'add' | 'delete'): void
  onAccept(): void
  onCancel(): void
}) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const definition = definitions.find((item) => item.id === brush.type)
  useHotkeys(
    'escape',
    onCancel,
    {
      enabled: !paletteOpen,
      preventDefault: true,
      // The palette can close before this same Escape reaches the document hook.
      ignoreEventWhen: (event) =>
        event.defaultPrevented ||
        (event.target instanceof Element &&
          !!event.target.closest('.placement-palette')),
    },
    [onCancel]
  )
  return (
    <div
      className="placement-tools"
      role="toolbar"
      aria-label="Placement tools"
    >
      <Popover.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Popover.Trigger asChild>
          <button
            aria-label={`Add tiles: ${brush.type} ${brush.kind}`}
            aria-pressed={tool === 'add'}
            onClick={() => onTool('add')}
          >
            {definition && (
              <TileArt definition={definition} kind={brush.kind} />
            )}
            <Plus className="brush-plus" size={12} />
            <small>Add</small>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="placement-palette"
            aria-label="Tile palette"
            side="left"
            align="start"
            sideOffset={10}
            collisionPadding={8}
          >
            <h2>Choose a tile</h2>
            <div className="vocabulary">
              {definitions.flatMap((item) =>
                (item.kind === 'entity'
                  ? (['entity', 'word'] as const)
                  : (['word'] as const)
                ).map((kind) => (
                  <button
                    key={`${item.id}-${kind}`}
                    aria-label={`Place ${item.id} ${kind}`}
                    aria-pressed={brush.type === item.id && brush.kind === kind}
                    onClick={() => {
                      onBrush({ type: item.id, kind })
                      setPaletteOpen(false)
                    }}
                  >
                    <TileArt definition={item} kind={kind} />
                    <small>{kind}</small>
                  </button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <IconButton
        icon={Trash2}
        label="Delete tiles"
        aria-pressed={tool === 'delete'}
        onClick={() => onTool('delete')}
      />
      <IconButton icon={Check} label="Accept board edits" onClick={onAccept} />
      <IconButton icon={X} label="Cancel board edits" onClick={onCancel} />
    </div>
  )
}
