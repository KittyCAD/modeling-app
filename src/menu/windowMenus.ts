import {
  buildAndSetMenuForFallback,
  buildAndSetMenuForModelingPage,
  buildAndSetMenuForProjectPage,
  setMenuItemEnabled,
} from '@src/menu'
import type { FileMenuActions } from '@src/menu/fileRole'
import { isMac } from '@src/menu/utils'
import { BrowserWindow, Menu } from 'electron'

export type AppMenuPage = 'project' | 'modeling' | 'fallback'

export function isAppMenuPage(page: unknown): page is AppMenuPage {
  return page === 'project' || page === 'modeling' || page === 'fallback'
}

export class WindowMenuManager {
  private readonly windowMenuPages = new WeakMap<BrowserWindow, AppMenuPage>()
  private readonly disabledWindowMenuIds = new WeakMap<
    BrowserWindow,
    Set<string>
  >()
  private readonly windowMenus = new Map<number, Menu>()
  private oldMenus: Menu[] = []

  constructor(private readonly actions: FileMenuActions) {}

  get nativeWindowMenusForTests() {
    return this.windowMenus
  }

  clearWindow(targetWindow: BrowserWindow) {
    this.windowMenuPages.delete(targetWindow)
    this.disabledWindowMenuIds.delete(targetWindow)
    this.windowMenus.delete(targetWindow.id)
  }

  rebuildWindowMenu(targetWindow: BrowserWindow) {
    const page = this.windowMenuPages.get(targetWindow)
    if (page) {
      this.buildAndSetMenuForWindow(targetWindow, page)
    }
  }

  setWindowMenuPage(targetWindow: BrowserWindow, page: AppMenuPage) {
    this.windowMenuPages.set(targetWindow, page)
    this.buildAndSetMenuForWindow(targetWindow, page)
  }

  updateMenuStateForWindow(
    targetWindow: BrowserWindow,
    menuId: string,
    enabled: boolean
  ) {
    let disabledMenuIds = this.disabledWindowMenuIds.get(targetWindow)
    if (!disabledMenuIds) {
      disabledMenuIds = new Set<string>()
      this.disabledWindowMenuIds.set(targetWindow, disabledMenuIds)
    }

    if (enabled) {
      disabledMenuIds.delete(menuId)
    } else {
      disabledMenuIds.add(menuId)
    }

    if (!isMac || BrowserWindow.getFocusedWindow() === targetWindow) {
      setMenuItemEnabled(this.getMenuForWindow(targetWindow), menuId, enabled)
    }
  }

  private buildAndSetMenuForWindow(
    targetWindow: BrowserWindow,
    page: AppMenuPage
  ) {
    const oldMenu = this.getMenuForWindow(targetWindow)
    if (oldMenu) {
      this.oldMenus.push(oldMenu)
    }

    let menu: Menu
    if (page === 'project') {
      menu = buildAndSetMenuForProjectPage(targetWindow, this.actions)
    } else if (page === 'modeling') {
      menu = buildAndSetMenuForModelingPage(targetWindow, this.actions)
    } else {
      menu = buildAndSetMenuForFallback(targetWindow, this.actions)
    }

    this.windowMenus.set(targetWindow.id, menu)
    this.applyMenuStateForWindow(targetWindow)
    this.scheduleMenuGC()
  }

  private getMenuForWindow(targetWindow: BrowserWindow) {
    if (isMac) {
      return Menu.getApplicationMenu()
    }

    return this.windowMenus.get(targetWindow.id)
  }

  private applyMenuStateForWindow(targetWindow: BrowserWindow) {
    const disabledMenuIds = this.disabledWindowMenuIds.get(targetWindow)
    if (!disabledMenuIds) {
      return
    }

    for (const menuId of disabledMenuIds) {
      setMenuItemEnabled(this.getMenuForWindow(targetWindow), menuId, false)
    }
  }

  private scheduleMenuGC() {
    setTimeout(() => {
      this.oldMenus = []
    }, 10000)
  }
}
