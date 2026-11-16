/** Shared background visibility control; its owner stores dimming rather than visibility. */
export function SketchBackgroundOpacityControl({
  dimming,
  onDimmingChange,
}: {
  dimming: number
  onDimmingChange: (dimming: number) => void
}) {
  const streamVisibilityPercent = Math.round((1 - dimming) * 100)
  return (
    <div className="rounded border b-3 bg-2/80 px-2 py-1 backdrop-blur-sm">
      <div className="text-[10px] text-2">Background Opacity</div>
      <input
        aria-label="Sketch background opacity"
        type="range"
        min="0"
        max="100"
        step="1"
        value={streamVisibilityPercent}
        onChange={(event) =>
          onDimmingChange((100 - Number(event.target.value)) / 100)
        }
        className="w-32 cursor-pointer"
      />
    </div>
  )
}
