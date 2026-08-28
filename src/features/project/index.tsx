import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed, useComputed } from '@preact/signals'
import { StatusDot } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { commandsValueSpec } from '@src/contracts/commands'
import type { LayoutNode } from '@src/contracts/layout'
import {
  layoutAreasValueSpec,
  layoutPresetsValueSpec,
  layoutService,
} from '@src/contracts/layout'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import {
  locationSourcesValueSpec,
  urlRoutesValueSpec,
} from '@src/contracts/navigation'
import { projectSessionService } from '@src/contracts/projectSession'
import { screensValueSpec, statusBarItemsValueSpec } from '@src/contracts/shell'
import { ProjectScreen } from '@src/features/project/ProjectScreen'
import {
  CODE_AREA_ID,
  EXPLORER_AREA_ID,
  INFO_AREA_ID,
  PROJECT_LAYOUT_PRESET,
  VIEWPORT_AREA_ID,
} from '@src/features/project/areaIds'
import { CodeArea } from '@src/features/project/areas/CodeArea'
import { FileExplorer } from '@src/features/project/areas/FileExplorer'
import { ProjectInfo } from '@src/features/project/areas/ProjectInfo'
import { ViewportArea } from '@src/features/project/areas/ViewportArea'

/**
 * The default project arrangement.
 *
 * The model is the centre and takes whatever is left over; the code panel and
 * the title block are rails around it. That ordering is the point: this is a CAD
 * app, so the one thing that should never be dismissable is the geometry — and
 * the editor, which used to hold half the window permanently, is now a panel you
 * can put away.
 *
 * The file tree does not appear here. It is hosted inside the code panel (see
 * `CodeArea`), listed on the rail that owns its state but drawn in there.
 *
 * Expressed as data so it can be persisted, migrated, and swapped for another
 * preset.
 */
function buildModelingLayout(): LayoutNode {
  return {
    type: 'dock',
    id: 'project.dock',
    start: {
      type: 'rail',
      id: 'project.rail.start',
      side: 'inline-start',
      areaIds: [CODE_AREA_ID, EXPLORER_AREA_ID],
      openAreaIds: [CODE_AREA_ID, EXPLORER_AREA_ID],
      size: 620,
      // A code panel is still cramped at the rail default of 720, and it has a
      // file strip inside it taking its own share.
      minExtent: 320,
      maxExtent: 1200,
    },
    end: {
      type: 'rail',
      id: 'project.rail.end',
      side: 'inline-end',
      areaIds: [INFO_AREA_ID],
      openAreaIds: [],
      size: 300,
      maxExtent: 420,
    },
    center: {
      type: 'area',
      id: 'project.center.viewport',
      areaId: VIEWPORT_AREA_ID,
    },
  }
}

function ExecutingField() {
  const sessions = useService(projectSessionService)

  const executing = useComputed(
    () => sessions.current.value?.executingBuffer.value ?? null
  )
  const name = useComputed(() => executing.value?.name.value ?? null)

  return (
    <span class="zds-status-field">
      <StatusDot
        tone={name.value ? 'ok' : 'idle'}
        label={name.value ? `Executing ${name.value}` : 'Nothing is executing'}
      />
      <span class="zds-status-field__name">exec</span>
      <span class="zds-status-field__value">{name.value ?? 'none'}</span>
    </span>
  )
}

function BufferField() {
  const sessions = useService(projectSessionService)

  const count = useComputed(
    () => sessions.current.value?.buffers.value.length ?? 0
  )

  return (
    <span class="zds-status-field">
      <span class="zds-status-field__name">buffers</span>
      <span class="zds-status-field__value">{count}</span>
    </span>
  )
}

/**
 * The project workspace: screen, areas, layout preset, and routing.
 *
 * Its location source sits at order 0, ahead of home's catch-all, so an open
 * project is what the URL reflects whenever there is one.
 */
export default defineRegistryItemFactory((ctx) => {
  // Lazy for the same reason as elsewhere: resolving a service inside a factory
  // body happens while the graph is still being flattened.
  const sessions = () => ctx.services.get(projectSessionService)

  const hasProject = computed(() => sessions().current.value !== null)

  const location = computed(() => {
    const session = sessions().current.value
    if (!session) return null
    return {
      kind: 'project' as const,
      projectId: session.project.value.id,
      // Project-relative, and absent for a scratch buffer, which has no path to
      // put in a URL at all.
      filePath: session.activeBufferPath.value ?? undefined,
    }
  })

  const toggleAreaCommand = (areaId: string, title: string, shortcut: string) =>
    provide(commandsValueSpec, {
      id: `layout.toggle.${areaId}`,
      title,
      category: 'View',
      icon: 'sidebarLeft' as const,
      shortcut,
      enabled: hasProject,
      run: () => ctx.services.get(layoutService).toggleArea(areaId),
    })

  return {
    item: defineRuntimeRegistryItem({
      id: 'project',
      provides: [
        provide(screensValueSpec, {
          id: 'project',
          order: 0,
          active: hasProject,
          render: () => <ProjectScreen />,
        }),

        provide(layoutAreasValueSpec, {
          id: EXPLORER_AREA_ID,
          title: 'Files',
          icon: 'folder',
          shortcut: '⌘⇧1',
          // Drawn by the code panel, not by the rail. Still an area, so its
          // width, its open state and its toggle stay with the layout service.
          hostedBy: CODE_AREA_ID,
          render: () => <FileExplorer />,
        }),
        provide(layoutAreasValueSpec, {
          id: CODE_AREA_ID,
          title: 'Code',
          icon: 'fileCode',
          shortcut: '⌘1',
          chrome: 'bare',
          render: () => <CodeArea />,
        }),
        provide(layoutAreasValueSpec, {
          id: VIEWPORT_AREA_ID,
          title: 'Model',
          icon: 'cube',
          chrome: 'bare',
          render: () => <ViewportArea />,
        }),
        provide(layoutAreasValueSpec, {
          id: INFO_AREA_ID,
          title: 'Project',
          icon: 'info',
          shortcut: '⌘2',
          render: () => <ProjectInfo />,
        }),

        provide(layoutPresetsValueSpec, {
          id: PROJECT_LAYOUT_PRESET,
          title: 'Modeling',
          build: buildModelingLayout,
        }),

        provide(locationSourcesValueSpec, {
          id: 'project',
          order: 0,
          location,
        }),
        provide(urlRoutesValueSpec, {
          id: 'project',
          order: 0,
          toPath: (current) => {
            if (current.kind !== 'project') return null
            const base = `/project/${encodeURIComponent(current.projectId)}`
            return current.filePath
              ? `${base}?file=${encodeURIComponent(current.filePath)}`
              : base
          },
          load: async (url) => {
            const match = url.pathname.match(/^\/project\/([^/]+)$/)
            if (!match) return false

            const session = await sessions().open(decodeURIComponent(match[1]))
            if (!session) return true

            const file = url.searchParams.get('file')

            if (!file) {
              // Absence is part of what the URL describes. Without this, going
              // Back to a fileless URL would leave the buffer on screen and the
              // URL and the view would disagree — the one thing this design is
              // meant to make impossible. The buffer stays open; only the
              // selection clears, which is the point of separating the two.
              session.setActiveBuffer(null)
              return true
            }

            // A bad file should not stop the project from opening.
            await session.openFile(file).catch((error) => {
              console.warn(`project: could not open "${file}"`, error)
            })
            return true
          },
        }),

        provide(statusBarItemsValueSpec, {
          id: 'project.executing',
          zone: 'start',
          order: 0,
          visible: hasProject,
          render: () => <ExecutingField />,
        }),
        provide(statusBarItemsValueSpec, {
          id: 'project.buffers',
          zone: 'start',
          order: 10,
          visible: hasProject,
          render: () => <BufferField />,
        }),

        toggleAreaCommand(CODE_AREA_ID, 'Toggle code panel', '⌘1'),
        toggleAreaCommand(INFO_AREA_ID, 'Toggle project panel', '⌘2'),

        /**
         * Files, which is a toggle with one wrinkle.
         *
         * The tree lives inside the code panel, so revealing it while that panel
         * is closed would open something nobody can see. Asking for files when
         * there is no code panel means asking for both.
         */
        provide(commandsValueSpec, {
          id: `layout.toggle.${EXPLORER_AREA_ID}`,
          title: 'Toggle files',
          category: 'View',
          icon: 'folder',
          shortcut: '⌘⇧1',
          enabled: hasProject,
          run: () => {
            const layout = ctx.services.get(layoutService)
            if (!layout.isAreaOpen(CODE_AREA_ID).value) {
              layout.openArea(CODE_AREA_ID)
              layout.openArea(EXPLORER_AREA_ID)
              return
            }
            layout.toggleArea(EXPLORER_AREA_ID)
          },
        }),

        provide(keybindingsValueSpec, {
          combo: 'Mod+1',
          commandId: `layout.toggle.${CODE_AREA_ID}`,
        }),
        provide(keybindingsValueSpec, {
          combo: 'Mod+Shift+1',
          commandId: `layout.toggle.${EXPLORER_AREA_ID}`,
        }),
        provide(keybindingsValueSpec, {
          combo: 'Mod+2',
          commandId: `layout.toggle.${INFO_AREA_ID}`,
        }),
      ],
    }),
  }
}, 'project')
