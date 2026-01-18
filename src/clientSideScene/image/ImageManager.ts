import { signal, type Signal } from '@preact/signals-react'
import { joinOSPaths } from '@src/lib/paths'
import type { settingsActor } from '@src/lib/singletons'

export const IMAGES_FOLDER = 'zoo_images'
const CONTENT_FILE = 'content.json'
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'svg',
  'webp',
])

export interface ImageEntry {
  path: string
  visible: boolean
  x: number
  y: number
  width: number
  height: number
}

interface ImageContent {
  images: ImageEntry[]
}

type SettingsActor = typeof settingsActor

export class ImageManager {
  /** Signal that increments whenever images are added, deleted, or modified */
  readonly imagesChanged: Signal<number> = signal(0)

  private projectPath: Promise<string> | string
  private projectPathResolve: Function | undefined

  constructor(settingsActor: SettingsActor) {
    let currentPathValue =
      settingsActor.getSnapshot().context.currentProject?.path ?? ''

    this.projectPath = new Promise((resolve) => {
      if (currentPathValue) {
        // path is already valid
        resolve(currentPathValue)
      } else {
        // settings is still loading, wait for it
        this.projectPathResolve = resolve
      }
    })

    settingsActor.subscribe((state) => {
      const newPath = state.context.currentProject?.path ?? null
      if (newPath) {
        if (newPath !== currentPathValue) {
          // project path changed
          if (this.projectPathResolve) {
            currentPathValue = newPath
            this.projectPathResolve(newPath)
            this.projectPathResolve = undefined
          }
          this.projectPath = newPath
        }
      } else {
        // Wait for a new valid path
        this.projectPath = new Promise((resolve) => {
          this.projectPathResolve = resolve
        })
      }
      // Notify listeners that images may have changed (new project)
      this.imagesChanged.value++
    })
  }

  private async getImagesFolderPath(): Promise<string> {
    const projectPath = await this.projectPath
    return joinOSPaths(projectPath, IMAGES_FOLDER)
  }

  private async getContentFilePath(): Promise<string> {
    const imagesFolderPath = await this.getImagesFolderPath()
    return joinOSPaths(imagesFolderPath, CONTENT_FILE)
  }

  async getImageFullPath(imagePath: string): Promise<string> {
    const imagesFolderPath = await this.getImagesFolderPath()
    return joinOSPaths(imagesFolderPath, imagePath)
  }

  static isSupportedImageFile(file: File): boolean {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    return SUPPORTED_IMAGE_EXTENSIONS.has(extension)
  }

  private async ensureImagesFolderExists(): Promise<boolean> {
    if (!window.electron) {
      return false
    }
    const imagesFolderPath = await this.getImagesFolderPath()
    if (!imagesFolderPath) {
      return false
    }
    await window.electron.mkdir(imagesFolderPath, { recursive: true })
    return true
  }

  private async readContentFile(): Promise<ImageContent> {
    if (!window.electron) {
      return {
        images: [],
      }
    }

    const contentFilePath = await this.getContentFilePath()
    if (!contentFilePath) {
      return {
        images: [],
      }
    }

    try {
      const content = await window.electron.readFile(contentFilePath, 'utf-8')
      return JSON.parse(content) as ImageContent
    } catch {
      return {
        images: [],
      }
    }
  }

  private async writeContentFile(content: ImageContent): Promise<void> {
    if (!window.electron) return
    const contentFilePath = await this.getContentFilePath()
    if (!contentFilePath) {
      return
    }
    const jsonString = JSON.stringify(content, null, 2)
    await window.electron.writeFile(contentFilePath, jsonString)
  }

  async addImage(
    file: File,
    position: { x: number; y: number; width: number; height: number }
  ): Promise<void> {
    if (!window.electron) return

    const folderExists = await this.ensureImagesFolderExists()
    if (!folderExists) return

    const imagesFolderPath = await this.getImagesFolderPath()
    if (!imagesFolderPath) return

    const arrayBuffer = await file.arrayBuffer()
    const destinationPath = joinOSPaths(imagesFolderPath, file.name)
    await window.electron.writeFile(
      destinationPath,
      new Uint8Array(arrayBuffer)
    )

    // add to JSON
    const content = await this.readContentFile()
    const existingIndex = content.images.findIndex(
      (img) => img.path === file.name
    )
    if (existingIndex === -1) {
      content.images.push({
        path: file.name,
        visible: true,
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
      })
      await this.writeContentFile(content)
    }

    // Notify listeners that images have changed
    this.imagesChanged.value++
  }

  async getImages(): Promise<ImageEntry[]> {
    const content = await this.readContentFile()
    return content.images
  }

  async setImageVisibility(imagePath: string, visible: boolean): Promise<void> {
    const content = await this.readContentFile()
    const image = content.images.find((img) => img.path === imagePath)
    if (image) {
      image.visible = visible
      await this.writeContentFile(content)
    }
  }

  async deleteImage(imagePath: string): Promise<void> {
    if (!window.electron) return

    // Delete the file
    const fullPath = await this.getImageFullPath(imagePath)
    if (fullPath) {
      try {
        await window.electron.rm(fullPath)
      } catch {
        // File may not exist, continue to remove from content.json
      }
    }

    // Remove from content.json
    const content = await this.readContentFile()
    content.images = content.images.filter((img) => img.path !== imagePath)
    await this.writeContentFile(content)

    // Notify listeners that images have changed
    this.imagesChanged.value++
  }
}
