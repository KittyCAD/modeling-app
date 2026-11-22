import { Popover } from '@headlessui/react'
import type { LocalViewportOptions } from '@src/clientSideScene/localRenderer/viewportOptions'
import { DEFAULT_LOCAL_VIEWPORT_OPTIONS } from '@src/clientSideScene/localRenderer/viewportOptions'

interface Props {
  options: LocalViewportOptions
  onChange: (options: LocalViewportOptions) => void
  showEdges: boolean
  onShowEdgesChange: (visible: boolean) => void
  enableSSAO: boolean
  onEnableSSAOChange: (enabled: boolean) => void
}

export function LocalViewportControls({
  options,
  onChange,
  showEdges,
  onShowEdgesChange,
  enableSSAO,
  onEnableSSAOChange,
}: Props) {
  return (
    <Popover className="absolute bottom-0 right-full mr-3 pointer-events-auto">
      <Popover.Button className="rounded border b-4 bg-2 px-3 py-1.5 text-xs text-1 shadow-sm hover:bg-3 whitespace-nowrap">
        Viewport
      </Popover.Button>
      <Popover.Panel className="absolute bottom-full right-0 mb-2 w-64 max-h-[70vh] overflow-y-auto rounded-lg border b-4 bg-2 p-4 text-sm text-1 shadow-lg">
        <h2 className="mb-3 font-semibold">Local Viewport</h2>
        <fieldset className="space-y-2.5">
          <legend className="mb-2 text-xs text-2">Visibility</legend>
          <label className="flex items-center justify-between gap-3">
            B-rep Bodies
            <input
              type="checkbox"
              checked={options.showBreps}
              onChange={(event) =>
                onChange({ ...options, showBreps: event.target.checked })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            Body Edges
            <input
              type="checkbox"
              checked={showEdges}
              disabled={!options.showBreps}
              onChange={(event) => onShowEdgesChange(event.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            Sketches and Curves
            <input
              type="checkbox"
              checked={options.showSketches}
              onChange={(event) =>
                onChange({ ...options, showSketches: event.target.checked })
              }
            />
          </label>
        </fieldset>
        <fieldset className="mt-4 space-y-3 border-t b-4 pt-3">
          <legend className="px-1 text-xs text-2">Appearance</legend>
          <label className="block space-y-1">
            <span>Render Resolution</span>
            <select
              className="w-full rounded border b-4 bg-1 px-2 py-1 text-1"
              value={options.resolutionScale}
              onChange={(event) => {
                const resolutionScale = Number(event.target.value)
                if (
                  resolutionScale === 1 ||
                  resolutionScale === 1.5 ||
                  resolutionScale === 2
                ) {
                  onChange({ ...options, resolutionScale })
                }
              }}
            >
              <option value="1">Native (100%)</option>
              <option value="1.5">High (150%)</option>
              <option value="2">Ultra (200%)</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            Shading
            <select
              className="rounded border b-4 bg-1 px-2 py-1 text-1"
              value={options.style}
              onChange={(event) => {
                const style = event.target.value
                if (
                  style === 'shaded' ||
                  style === 'faceted' ||
                  style === 'wireframe'
                )
                  onChange({ ...options, style })
              }}
            >
              <option value="shaded">Smooth</option>
              <option value="faceted">Faceted</option>
              <option value="wireframe">Wireframe</option>
            </select>
          </label>
          <label className="block">
            <span className="flex justify-between">
              Brightness <span>{options.brightness}%</span>
            </span>
            <input
              aria-label="Brightness"
              className="mt-2 w-full"
              type="range"
              min="25"
              max="200"
              step="5"
              value={options.brightness}
              onChange={(event) =>
                onChange({ ...options, brightness: event.target.valueAsNumber })
              }
            />
          </label>
          <label className="block">
            <span className="flex justify-between">
              Color Contrast <span>{options.contrast}%</span>
            </span>
            <input
              aria-label="Color Contrast"
              className="mt-2 w-full"
              type="range"
              min="50"
              max="200"
              step="5"
              value={options.contrast}
              onChange={(event) =>
                onChange({ ...options, contrast: event.target.valueAsNumber })
              }
            />
          </label>
          <label className="block">
            <span className="flex justify-between">
              Surface Opacity <span>{options.opacity}%</span>
            </span>
            <input
              className="mt-2 w-full"
              type="range"
              min="10"
              max="100"
              step="5"
              value={options.opacity}
              onChange={(event) =>
                onChange({ ...options, opacity: event.target.valueAsNumber })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            Ambient Occlusion
            <input
              type="checkbox"
              checked={enableSSAO}
              disabled={options.style === 'wireframe' || options.opacity < 100}
              onChange={(event) => onEnableSSAOChange(event.target.checked)}
            />
          </label>
        </fieldset>
        <button
          type="button"
          className="mt-4 w-full rounded border b-4 px-2 py-1.5 hover:bg-3"
          onClick={() => {
            onChange({ ...DEFAULT_LOCAL_VIEWPORT_OPTIONS })
            onShowEdgesChange(true)
            onEnableSSAOChange(true)
          }}
        >
          Reset Viewport
        </button>
      </Popover.Panel>
    </Popover>
  )
}
