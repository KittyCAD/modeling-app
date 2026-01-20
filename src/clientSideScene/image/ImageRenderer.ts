import type { Quaternion } from 'three'
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Texture,
} from 'three'
import type {
  ImageManager,
  ImageEntry,
} from '@src/clientSideScene/image/ImageManager'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { ImageTransformHandler } from '@src/clientSideScene/image/ImageTransformHandler'

export const IMAGE_RENDERER_GROUP = 'ImageRendererGroup'

type ImageMesh = Mesh<PlaneGeometry, MeshBasicMaterial>

export class ImageRenderer {
  private readonly imageManager: ImageManager
  private readonly sceneInfra: SceneInfra
  public readonly transformHandler: ImageTransformHandler

  public readonly planeGeometry: PlaneGeometry
  private readonly group: Group
  private readonly loadedTextures: Map<string, Texture> = new Map()
  private readonly meshes: Map<string, ImageMesh> = new Map()

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this.imageManager = imageManager
    this.sceneInfra = sceneInfra

    this.group = new Group()
    this.group.name = IMAGE_RENDERER_GROUP
    this.group.layers.set(SKETCH_LAYER)
    this.sceneInfra.scene.add(this.group)
    this.planeGeometry = new PlaneGeometry()

    this.transformHandler = new ImageTransformHandler(imageManager, sceneInfra)

    imageManager.imagesChanged.subscribe(this.onImagesChanged)
    this.onImagesChanged()
  }

  private readonly onImagesChanged = () => {
    void this.updateImages()
  }

  private readonly updateImages = async () => {
    const images = await this.imageManager.getImages()

    for (const image of images) {
      let mesh = this.meshes.get(image.path)
      if (!mesh) {
        mesh = this.createImageMesh(image)
        if (mesh) {
          this.meshes.set(image.path, mesh)
          this.group.add(mesh)
        }
      }
      if (mesh) {
        mesh.visible = image.visible
        mesh.scale.set(image.width, image.height, 1)
        mesh.position.set(image.x, image.y, 0)
        mesh.rotation.z = image.rotation ?? 0
        console.log(image.x, image.y)
      }
    }

    const unusedMeshes = Array.from(this.meshes)
      .filter(([path]) => !images.some((image) => image.path === path))
      .map(([_path, mesh]) => mesh)
    this.disposeMeshes(unusedMeshes)
  }

  private createImageMesh(image: ImageEntry): ImageMesh {
    const material = new MeshBasicMaterial({
      transparent: true,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })

    const mesh = new Mesh(this.planeGeometry, material)
    mesh.userData = {
      image,
    }
    mesh.name = `ReferenceImage_${image.path}`
    mesh.layers.set(SKETCH_LAYER)
    mesh.renderOrder = 999
    mesh.scale.set(image.width, image.height, 1)
    mesh.position.set(image.x, image.y, 0.1)
    mesh.rotation.z = image.rotation ?? 0

    this.imageManager
      .getImageFullPath(image.path)
      .then(async (fullPath) => {
        try {
          let texture = this.loadedTextures.get(image.path)
          if (!texture) {
            texture = await this.loadTexture(fullPath)
            this.loadedTextures.set(image.path, texture)
          }
          material.map = texture
          material.needsUpdate = true
        } catch (error) {
          console.error(`Failed to load image: ${image.path}`, error)
          return undefined
        }
      })
      .catch((e) => {
        console.error(e)
      })

    return mesh
  }

  private async loadTexture(path: string): Promise<Texture> {
    if (!window.electron) {
      return Promise.reject(new Error('Electron API not available'))
    }

    // Read the file as binary data and create a Blob URL
    const imageData = await window.electron.readFile(path)
    const extension = path.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeType = getMimeType(extension)
    const blob = new Blob([new Uint8Array(imageData)], { type: mimeType })
    const blobUrl = URL.createObjectURL(blob)

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const texture = new Texture(img)
        texture.needsUpdate = true
        URL.revokeObjectURL(blobUrl)
        resolve(texture)
      }
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl)
        reject(new Error(`Failed to load image: ${path}`))
      }
      img.src = blobUrl
    })
  }

  setImageVisibility(imagePath: string, visible: boolean): void {
    const mesh = this.meshes.get(imagePath)
    if (mesh) {
      mesh.visible = visible
    }
  }

  setQuaternion(quaternion: Quaternion): void {
    this.group.setRotationFromQuaternion(quaternion)
  }

  private disposeMeshes(meshes: ImageMesh[]): void {
    for (const mesh of meshes) {
      this.group.remove(mesh)
      mesh.material.dispose()
      for (const [path, m] of this.meshes) {
        if (m === mesh) {
          this.meshes.delete(path)
          break
        }
      }
    }
  }

  public dispose() {
    this.sceneInfra.scene.remove(this.group)

    this.disposeMeshes(Array.from(this.meshes.values()))
    this.meshes.clear()
    for (const [, texture] of this.loadedTextures) {
      texture.dispose()
    }
    this.loadedTextures.clear()

    this.planeGeometry.dispose()
  }
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  }
  return mimeTypes[extension] ?? 'image/png'
}
