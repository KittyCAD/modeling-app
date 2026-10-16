import type { ZooFeatureTree } from '@kittycad/ui-components/web-components'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { useApp } from '@src/lib/boot'
import {
  FeatureTree,
  FeatureTreeRow,
} from '@src/lib/featureTree/FeatureTreeView'
import { SceneBrowserAppearanceContext } from '@src/lib/sceneBrowser/appearance'
import {
  sceneBrowserSections,
  sceneBrowserAppearance,
  sceneBrowserService,
  SCENE_BROWSER_FOCUSED_SCOPE,
  TOGGLE_BROWSER_COMMAND,
} from '@src/lib/sceneBrowser/registry/contract'
import {
  commandScopeService,
  FILE_COMMAND_SCOPES,
} from '@src/registry/contracts/commands'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import { Resizable } from 're-resizable'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import '@src/lib/featureTree/FeatureTree.css'
import './SceneBrowser.css'

const SECTION_PREFIX = 'browser-section:'

/** A docked Browser has one scroll area, one tree, and one width shared by all sections. */
export function SceneBrowser() {
  useSignals()
  const { registry } = useApp()
  const platform = usePlatform()
  const keymap = registry.optional(keymapService)
  const shortcut = keymapKeystrokesDisplay(
    findKeymapItemForCommand(
      keymap?.keymap.value ?? registry.signal(keymapValueSpec).value,
      TOGGLE_BROWSER_COMMAND,
      FILE_COMMAND_SCOPES,
      registry.signal(keymapScopesValueSpec).value
    )?.keystrokes,
    platform
  )
  const sections = registry.signal(sceneBrowserSections).value
  const appearance = registry.signal(sceneBrowserAppearance).value
  const service = registry.get(sceneBrowserService)
  const scopes = registry.optional(commandScopeService)
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(new Set())
  const [width, setWidth] = useState(280)
  const asideRef = useRef<HTMLElement>(null)
  const [availableHeight, setAvailableHeight] = useState<number>()
  const [availableWidth, setAvailableWidth] = useState<number>()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const cleanup = useRef<() => void>(() => {})
  const contentId = useId()
  const tooltipId = useId()
  const collapsed = service.collapsed.value
  const previousCollapsed = useRef(collapsed)
  const mount = useCallback(
    (tree: ZooFeatureTree | null) => {
      cleanup.current()
      cleanup.current = () => {}
      service.setTree(tree)
      if (!tree) return
      const focus = () => scopes?.applyScope(SCENE_BROWSER_FOCUSED_SCOPE)
      const blur = (event: FocusEvent) => {
        if (!tree.contains(event.relatedTarget as Node | null))
          scopes?.removeScope(SCENE_BROWSER_FOCUSED_SCOPE)
      }
      const expand = (event: Event) => {
        const { nodeId, expanded } = (
          event as CustomEvent<{ nodeId: string; expanded: boolean }>
        ).detail
        if (!nodeId.startsWith(SECTION_PREFIX)) return
        const id = nodeId.slice(SECTION_PREFIX.length)
        setCollapsedSections((previous) => {
          if (previous.has(id) === !expanded) return previous
          const next = new Set(previous)
          if (expanded) next.delete(id)
          else next.add(id)
          return next
        })
      }
      tree.addEventListener('focusin', focus)
      tree.addEventListener('focusout', blur)
      tree.addEventListener('zoo-expand', expand)
      cleanup.current = () => {
        tree.removeEventListener('focusin', focus)
        tree.removeEventListener('focusout', blur)
        tree.removeEventListener('zoo-expand', expand)
        scopes?.removeScope(SCENE_BROWSER_FOCUSED_SCOPE)
      }
    },
    [service, scopes]
  )
  useLayoutEffect(() => {
    if (previousCollapsed.current !== collapsed) toggleRef.current?.focus()
    previousCollapsed.current = collapsed
  }, [collapsed])
  useLayoutEffect(() => {
    const scene =
      asideRef.current?.closest('[data-engine-scene-view-extension-zone]') ??
      asideRef.current?.parentElement
    if (!scene) return
    const overlay = scene.parentElement ?? scene
    const measure = () => {
      if (scene.clientHeight > 0) setAvailableHeight(scene.clientHeight)
      // re-resizable accepts numeric limits, not CSS calc() expressions.
      // The side zone shrink-wraps the Browser; its overlay owns scene width.
      if (overlay.clientWidth > 1) {
        const maxWidth = overlay.clientWidth - 1
        setAvailableWidth(maxWidth)
        setWidth((previous) => Math.min(previous, maxWidth))
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(scene)
    if (overlay !== scene) observer.observe(overlay)
    return () => observer.disconnect()
  }, [])
  if (!sections.length) return null
  return (
    <SceneBrowserAppearanceContext.Provider value={appearance}>
      <aside
        ref={asideRef}
        className={`scene-browser${collapsed ? ' is-collapsed' : ''}`}
        aria-label="Scene browser"
        data-appearance={appearance}
      >
        <button
          ref={toggleRef}
          type="button"
          className="scene-browser-title"
          aria-label={
            collapsed ? 'Expand scene browser' : 'Collapse scene browser'
          }
          aria-describedby={tooltipId}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => service.toggle()}
        >
          <CustomIcon
            name="sidebar"
            aria-hidden="true"
            className="scene-browser-toggle-icon"
          />
          {!collapsed && <span>Scene browser</span>}
          <Tooltip id={tooltipId} position="right" delay={250}>
            {collapsed ? 'Expand scene browser' : 'Collapse scene browser'}
            {shortcut && <kbd className="hotkey ml-2">{shortcut}</kbd>}
          </Tooltip>
        </button>
        {!collapsed && (
          <Resizable
            size={{ width, height: 'auto' }}
            style={{ minHeight: 0 }}
            minWidth={Math.min(200, availableWidth ?? 200)}
            maxWidth={availableWidth ?? '100vw'}
            enable={{ right: true }}
            onResizeStop={(_event, _direction, element) =>
              setWidth(element.offsetWidth)
            }
          >
            <div
              id={contentId}
              className="scene-browser-content"
              style={{
                maxHeight: availableHeight
                  ? Math.max(
                      0,
                      availableHeight -
                        (toggleRef.current?.clientHeight ?? 26) -
                        2
                    )
                  : undefined,
              }}
            >
              <FeatureTree label="Scene browser" onMount={mount}>
                {sections.map(({ id, title, Component, Menu }) => (
                  <FeatureTreeRow
                    key={id}
                    nodeId={`${SECTION_PREFIX}${id}`}
                    label={title}
                    defaultOpen={!collapsedSections.has(id)}
                    actions={Menu && <Menu />}
                    onSelect={() =>
                      setCollapsedSections((previous) => {
                        const next = new Set(previous)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }
                  >
                    <Component />
                  </FeatureTreeRow>
                ))}
              </FeatureTree>
            </div>
          </Resizable>
        )}
      </aside>
    </SceneBrowserAppearanceContext.Provider>
  )
}
