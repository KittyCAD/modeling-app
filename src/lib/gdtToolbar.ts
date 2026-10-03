import type { ToolbarItem } from '@src/lib/toolbar'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { CommandSystemService } from '@src/registry/contracts/commands'

type GdtToolbarItem = ToolbarItem & {
  title: string
  onClick: () => void
}

/** GD&T actions shared by the modeling dropdown and DFM Review toolbar. */
export function createGdtToolbarItems(
  commands: Pick<CommandSystemService, 'send'>
): GdtToolbarItem[] {
  const items: GdtToolbarItem[] = [
    {
      id: 'gdt-flatness',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Flatness', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Flatness',
      icon: 'gdtFlatness',
      description:
        'Specifies flatness tolerance - how much a surface can deviate from perfectly flat.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-flatness'),
        },
      ],
    },
    {
      id: 'gdt-straightness',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Straightness', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Straightness',
      icon: 'gdtStraightness',
      description:
        'Specifies straightness tolerance - how much a face or edge can deviate from perfectly straight.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-straightness'),
        },
      ],
    },
    {
      id: 'gdt-circularity',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Circularity', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Circularity',
      icon: 'gdtCircularity',
      description:
        'Specifies circularity tolerance - how much a round face or edge can deviate from a perfect circle.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-circularity'),
        },
      ],
    },
    {
      id: 'gdt-cylindricity',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Cylindricity', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Cylindricity',
      icon: 'gdtCylindricity',
      description:
        'Specifies cylindricity tolerance - how much a round face or edge can deviate from a perfect cylinder.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-cylindricity'),
        },
      ],
    },
    {
      id: 'gdt-datum',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Datum', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Datum',
      icon: 'gdtDatum',
      description:
        'Establishes a reference surface for other GD&T measurements.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-datum'),
        },
      ],
    },
    {
      id: 'gdt-profile',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Profile', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Profile',
      icon: 'gdtProfile',
      description:
        'Specifies how much a surface or edge can deviate from its ideal shape.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-profile'),
        },
      ],
    },
    {
      id: 'gdt-position',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Position', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Position',
      icon: 'gdtPosition',
      description:
        'Controls location tolerance of holes, pins, and other features.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-position'),
        },
      ],
    },
    {
      id: 'gdt-concentricity',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: 'GDT Concentricity',
            groupId: 'modeling',
          },
        }),
      status: 'available',
      title: 'Concentricity',
      icon: 'gdtConcentricity',
      description:
        'Controls how closely a feature axis aligns with a datum axis.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-concentricity'),
        },
      ],
    },
    {
      id: 'gdt-symmetry',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: 'GDT Symmetry',
            groupId: 'modeling',
          },
        }),
      status: 'available',
      title: 'Symmetry',
      icon: 'gdtSymmetry',
      description:
        'Controls how closely median points align with a datum center plane.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-symmetry'),
        },
      ],
    },
    {
      id: 'gdt-runout',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: 'GDT Runout',
            groupId: 'modeling',
          },
        }),
      status: 'available',
      title: 'Runout',
      icon: 'gdtRunout',
      description:
        'Controls how much a round feature may vary as it rotates around a datum axis.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-runout'),
        },
      ],
    },
    {
      id: 'gdt-angularity',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: 'GDT Angularity',
            groupId: 'modeling',
          },
        }),
      status: 'available',
      title: 'Angularity',
      icon: 'angle',
      description:
        'Specifies how much a feature may deviate from an orientation at a basic angle.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-angularity'),
        },
      ],
    },
    {
      id: 'gdt-perpendicularity',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: 'GDT Perpendicularity',
            groupId: 'modeling',
          },
        }),
      status: 'available',
      title: 'Perpendicularity',
      icon: 'perpendicular',
      description:
        'Specifies how perpendicular one feature must be to another.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL(
            '/docs/kcl-std/functions/std-gdt-perpendicularity'
          ),
        },
      ],
    },
    {
      id: 'gdt-parallelism',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: 'GDT Parallelism',
            groupId: 'modeling',
          },
        }),
      status: 'available',
      title: 'Parallelism',
      icon: 'parallel',
      description: 'Specifies how parallel one feature must be to another.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-parallelism'),
        },
      ],
    },
    {
      id: 'gdt-distance',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Distance', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Distance',
      icon: 'dimension',
      description:
        'Adds distance annotations to edge lengths or between two entities.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-distance'),
        },
      ],
    },
    {
      id: 'gdt-annotation',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Annotation', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Annotation',
      icon: 'text',
      description:
        'Adds text annotations for manufacturing instructions or inspection requirements.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-annotation'),
        },
      ],
    },
    {
      id: 'gdt-note',
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name: 'GDT Note', groupId: 'modeling' },
        }),
      status: 'available',
      title: 'Note',
      icon: 'note',
      description:
        'Adds a free-floating note on a plane, not attached to any geometry.',
      links: [
        {
          label: 'KCL docs',
          url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-note'),
        },
      ],
    },
  ]

  return items.sort((a, b) => a.title.localeCompare(b.title))
}
