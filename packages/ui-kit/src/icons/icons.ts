/**
 * Icon set.
 *
 * Drawn on a 16px grid, stroked rather than filled, at a deliberately thin
 * 1.25px weight so the glyphs read like drafting linework next to the hairline
 * seams of the chassis rather than like a mobile app's icon set.
 *
 * Paths only — the renderer lives in `components/icon.ts` — so this module
 * stays free of DOM concerns and can be consumed by anything.
 */

export const iconPaths = {
  // Navigation and disclosure
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronLeft: 'M10 3.5 5.5 8 10 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  chevronUp: 'M3.5 10 8 5.5 12.5 10',
  arrowUpRight: 'M5.5 10.5 10.5 5.5M6.5 5.5h4v4',
  arrowLeft: 'M9.5 4 5.5 8l4 4M5.5 8h6',

  // Files and projects
  folder:
    'M2 4.5A1 1 0 0 1 3 3.5h3l1.2 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
  file: 'M4 2.5h4.5L12 6v7.5H4zM8.5 2.5V6H12',
  fileCode:
    'M4 2.5h4.5L12 6v7.5H4zM8.5 2.5V6H12M6.5 9 5.5 10.5l1 1.5M9.5 9l1 1.5-1 1.5',
  sheet: 'M3 2.5h10v11H3zM3 10.5h10M9.5 10.5v3',

  // Modeling
  cube: 'M8 2 14 5.25v5.5L8 14 2 10.75v-5.5zM2 5.25 8 8.5l6-3.25M8 8.5V14',
  layers: 'M8 2 14 5.25 8 8.5 2 5.25zM2 8.25 8 11.5l6-3.25',
  sketch:
    'M3 13 13 3M3 13h.01M13 3h.01M3.5 13a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0M13.5 3a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0',
  grid: 'M2.5 2.5h11v11h-11zM2.5 6.167h11M2.5 9.833h11M6.167 2.5v11M9.833 2.5v11',
  dimension: 'M2 8h12M2 5.5v5M14 5.5v5',

  // Actions
  plus: 'M8 3.5v9M3.5 8h9',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  search:
    'M7.25 11.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5M10.5 10.5 13.5 13.5',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4M8 1.5v1.6M8 12.9v1.6M2.9 8H1.5M14.5 8h-1.4M4.4 4.4 3.3 3.3M12.7 12.7l-1.1-1.1M11.6 4.4l1.1-1.1M3.3 12.7l1.1-1.1',
  trash: 'M3.5 5h9M6 5V3.5h4V5M4.5 5l.5 8.5h6l.5-8.5',
  pencil: 'M11 3l2 2-7.5 7.5-2.5.5.5-2.5z',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.7M13 3v2.5h-2.5',
  play: 'M5.5 3.5l7 4.5-7 4.5z',
  command:
    'M5.5 3.5a1.5 1.5 0 1 0 1.5 1.5v6a1.5 1.5 0 1 0 1.5-1.5H5a1.5 1.5 0 1 1 1.5 1.5V5A1.5 1.5 0 1 1 5 6.5h6',

  // Chrome
  sidebarLeft: 'M2.5 3h11v10h-11zM6.5 3v10',
  sidebarRight: 'M2.5 3h11v10h-11zM9.5 3v10',
  panelBottom: 'M2.5 3h11v10h-11zM2.5 9.5h11',
  home: 'M2.5 7 8 2.5 13.5 7v6.5h-11zM6.25 13.5V9.5h3.5v4',
  moreHorizontal: 'M4 8h.01M8 8h.01M12 8h.01',
  terminal: 'M2.5 3h11v10h-11zM5 7l1.75 1.75L5 10.5M8.75 10.5h2.5',

  // State
  warning: 'M8 2.5 14.5 13.5h-13zM8 6.5v3.25M8 11.75h.01',
  error: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M8 5.5v3.25M8 10.75h.01',
  info: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M8 7.5v3.25M8 5.25h.01',
  dot: 'M8 5.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5',
  unplugged: 'M6 2.5v3.5M10 2.5v3.5M4.5 6h7v1.5a3.5 3.5 0 0 1-7 0zM8 11v2.5',

  // Theme
  sun: 'M8 10.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1',
  moon: 'M13 10.2A5.5 5.5 0 0 1 5.8 3a5.5 5.5 0 1 0 7.2 7.2',
  monitor: 'M2.5 3h11v7.5h-11zM6 13.5h4M8 10.5v3',
} as const

export type IconName = keyof typeof iconPaths

export const iconNames = Object.keys(iconPaths) as IconName[]
