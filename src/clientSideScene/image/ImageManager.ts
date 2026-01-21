import { signal } from '@preact/signals-core'
import { joinOSPaths } from '@src/lib/paths'
import type { settingsActor } from '@src/lib/singletons'

export const IMAGES_FOLDER_NAME = 'zds_images'
const IMAGES_JSON_FILE_NAME = 'images.json'
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'svg',
  'webp',
])

export interface ImageEntry {
  fileName: string
  visible: boolean
  x: number
  y: number
  width: number
  height: number
  rotation?: number // radians
  locked?: boolean
}

interface ImagesJSON {
  images: ImageEntry[]
}

type SettingsActor = typeof settingsActor

export class ImageManager {
  static isSupportedImageFile(file: File): boolean {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    return SUPPORTED_IMAGE_EXTENSIONS.has(extension)
  }

  /**
   * Signal that increments whenever images are added, deleted, or modified (position, locked, etc)
   */
  readonly imagesChanged = signal(0)

  readonly selected = signal<ImageEntry | undefined>(undefined)

  private images:
    | {
        projectPath: string
        // imageFolderPath: string
        // imageJSONPath: string
        list: ImageEntry[]
      }
    | undefined

  // Subscribes to settingsActor for project path. Not in the constructor because of circular dependencies..
  public init(settingsActor: SettingsActor) {
    let currentPathValue = ''
    settingsActor.subscribe((state) => {
      const projectPath = state.context.currentProject?.path ?? ''
      if (projectPath !== currentPathValue) {
        currentPathValue = projectPath
        if (projectPath) {
          readImagesJSON(projectPath)
            .then((imageFileContent) => {
              this.images = {
                projectPath,
                list: imageFileContent.images,
              }
              this.imagesChanged.value++
            })
            .catch((e) => {
              console.error(e)
            })
        } else {
          // Path became falsy (user closed the project) ->
          // Start waiting for a new valid path (when user opens a project)
          currentPathValue = ''
          this.images = undefined
          this.imagesChanged.value++
        }
      }
    })
  }

  public setSelected(image: ImageEntry | undefined) {
    this.selected.value = image
  }

  public getImages() {
    return this.images
  }

  private async ensureImagesFolderExists(): Promise<
    ImageManager['images'] | undefined
  > {
    if (!window.electron) {
      return
    }

    if (!this.images?.projectPath) {
      return
    }
    const imageFolderPath = getImageFolderPath(this.images.projectPath)
    await window.electron.mkdir(imageFolderPath, { recursive: true })
    return this.images
  }

  async addImage(
    file: File,
    position: { x: number; y: number; width: number; height: number }
  ): Promise<void> {
    if (!window.electron) return

    // Write the image file into the image folder
    const images = await this.ensureImagesFolderExists()
    if (!images) return

    const imageFileName = file.name
    if (!images.list.some((img) => img.fileName === imageFileName)) {
      const arrayBuffer = await file.arrayBuffer()
      const imagePath = getImageFilePath(images.projectPath, imageFileName)
      await window.electron.writeFile(imagePath, new Uint8Array(arrayBuffer))

      images.list.push({
        fileName: imageFileName,
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        rotation: 0,
        visible: true,
        locked: false,
      })

      await this.saveToFile()
    }
  }

  // async getImages(): Promise<ImageEntry[]> {
  //   const content = await this.readContentFile()
  //   return content.images
  // }

  async updateImage(
    imageFileName: string,
    imageUpdate: Partial<Omit<ImageEntry, 'fileName'>>
  ) {
    if (this.images) {
      const index = this.images.list.findIndex(
        (img) => img.fileName === imageFileName
      )
      if (index >= 0) {
        const image = this.images.list[index]
        // Note: creating a new object is possible too but then we need to stop keeping references to
        // ImageEntry in mesh.userData and ImageList.tsx
        Object.assign(image, imageUpdate)
        this.unselectImageIfLocked()
        await this.saveToFile()
      } else {
        console.error("Can't find image data, maybe project has been closed?")
      }
    } else {
      console.error("Can't find images list, maybe project has been closed?")
    }
  }

  private unselectImageIfLocked() {
    const selected = this.selected.value
    if (selected) {
      const selectedImage = this.images?.list.find(
        (image) => image.fileName === this.selected.value?.fileName
      )
      if (selectedImage?.locked) {
        this.selected.value = undefined
      }
    }
  }

  async moveImage(imageFileName: string, targetIndex: number) {
    if (!this.images) {
      console.error("Can't find images list, maybe project has been closed?")
      return
    }

    const list = this.images.list
    const index = list.findIndex((img) => img.fileName === imageFileName)
    if (index < 0) {
      console.error("Can't find image data, maybe project has been closed?")
      return
    }

    const clampedIndex = Math.max(0, Math.min(targetIndex, list.length - 1))
    if (clampedIndex === index) {
      return
    }

    const [image] = list.splice(index, 1)
    list.splice(clampedIndex, 0, image)
    await this.saveToFile()
    this.imagesChanged.value++
  }

  async deleteImage(imageFileName: string): Promise<void> {
    if (!window.electron) return
    if (!this.images) return

    // Delete the file
    const fullPath = getImageFilePath(this.images.projectPath, imageFileName)
    if (fullPath) {
      try {
        await window.electron.rm(fullPath)
      } catch {
        // File may not exist, continue to remove from content.json
      }
    }

    this.images.list = this.images.list.filter(
      (img) => img.fileName !== imageFileName
    )
    await this.saveToFile()
  }

  public async saveToFile() {
    if (!window.electron) return
    if (!this.images) return

    const fileContent: ImagesJSON = {
      images: this.images.list,
    }

    const imageFilePath = getImageJSONPath(this.images.projectPath)
    const jsonString = JSON.stringify(fileContent, null, 2)
    await window.electron.writeFile(imageFilePath, jsonString)
  }
}

async function readImagesJSON(projectPath: string): Promise<ImagesJSON> {
  if (!window.electron) {
    return {
      images: [],
    }
  }

  const imageJSONPath = getImageJSONPath(projectPath)
  try {
    const content = await window.electron.readFile(imageJSONPath, 'utf-8')
    return JSON.parse(content) as ImagesJSON
  } catch (e) {
    console.error(e)
    return {
      images: [],
    }
  }
}

// eg. "/Users/joe/Documents/zoo-design-studio-projects/untitled-104/zoo_images"
function getImageFolderPath(projectPath: string) {
  return joinOSPaths(projectPath, IMAGES_FOLDER_NAME)
}

// eg. "/Users/joe/Documents/zoo-design-studio-projects/untitled-104/zoo_images/images.json"
function getImageJSONPath(projectPath: string) {
  return joinOSPaths(getImageFolderPath(projectPath), IMAGES_JSON_FILE_NAME)
}

export function getImageFilePath(projectPath: string, imageFileName: string) {
  return joinOSPaths(getImageFolderPath(projectPath), imageFileName)
}
