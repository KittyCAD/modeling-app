import { v4 as uuidv4 } from 'uuid'
import { faFileExport, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from './ActionButton'
import Modal from 'react-modal'
import React from 'react'
import { useFormik } from 'formik'
import { Models } from '@kittycad/lib'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'

type OutputFormat = Models['OutputFormat_type']
type OutputTypeKey = OutputFormat['type']
type ExtractStorageTypes<T> = T extends { storage: infer U } ? U : never
type StorageUnion = ExtractStorageTypes<OutputFormat>

interface ExportButtonProps extends React.PropsWithChildren {
  className?: {
    button?: string
    icon?: string
    bg?: string
  }
}

export const ExportButton = ({ children, className }: ExportButtonProps) => {
  const [modalIsOpen, setIsOpen] = React.useState(false)
  const {
    settings: {
      state: {
        context: { baseUnit },
      },
    },
  } = useSettingsAuthContext()

  const defaultType = 'gltf'
  const [type, setType] = React.useState<OutputTypeKey>(defaultType)
  const defaultStorage = 'embedded'
  const [storage, setStorage] = React.useState<StorageUnion>(defaultStorage)

  function openModal() {
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  // Default to gltf and embedded.
  const initialValues: OutputFormat = {
    type: defaultType,
    storage: defaultStorage,
    presentation: 'pretty',
  }
  const formik = useFormik({
    initialValues,
    onSubmit: (values: OutputFormat) => {
      // Set the default coords.
      if (
        values.type === 'obj' ||
        values.type === 'ply' ||
        values.type === 'step' ||
        values.type === 'stl'
      ) {
        // Set the default coords.
        // In the future we can make this configurable.
        // But for now, its probably best to keep it consistent with the
        // UI.
        values.coords = {
          forward: {
            axis: 'y',
            direction: 'negative',
          },
          up: {
            axis: 'z',
            direction: 'positive',
          },
        }
      }
      if (
        values.type === 'obj' ||
        values.type === 'stl' ||
        values.type === 'ply'
      ) {
        values.units = baseUnit
      }
      if (
        values.type === 'ply' ||
        values.type === 'stl' ||
        values.type === 'gltf'
      ) {
        // Set the storage type.
        values.storage = storage
      }
      if (values.type === 'ply' || values.type === 'stl') {
        values.selection = { type: 'default_scene' }
      }
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'export',
          // By default let's leave this blank to export the whole scene.
          // In the future we might want to let the user choose which entities
          // in the scene to export. In that case, you'd pass the IDs thru here.
          entity_ids: [],
          format: values,
          source_unit: baseUnit,
        },
        cmd_id: uuidv4(),
      })

      closeModal()
    },
  })

  return (
    <>
      <ActionButton
        onClick={openModal}
        Element="button"
        icon={{
          icon: faFileExport,
          className: 'p-1',
          size: 'sm',
          iconClassName: className?.icon,
          bgClassName: className?.bg,
        }}
        className={className?.button}
      >
        {children || 'Export'}
      </ActionButton>
      <Modal
        isOpen={modalIsOpen}
        onRequestClose={closeModal}
        contentLabel="Export"
        overlayClassName="z-40 fixed inset-0 grid place-items-center"
        className="rounded p-4 bg-chalkboard-10 dark:bg-chalkboard-100 border max-w-xl w-full"
      >
        <h1 className="text-2xl font-bold">Export your design</h1>
        <form onSubmit={formik.handleSubmit}>
          <div className="flex flex-wrap justify-between gap-8 items-center w-full my-8">
            <label htmlFor="type" className="flex-1">
              <p className="mb-2">Type</p>
              <select
                id="type"
                name="type"
                data-testid="export-type"
                onChange={(e) => {
                  setType(e.target.value as OutputTypeKey)
                  if (e.target.value === 'gltf') {
                    // Set default to embedded.
                    setStorage('embedded')
                  } else if (e.target.value === 'ply') {
                    // Set default to ascii.
                    setStorage('ascii')
                  } else if (e.target.value === 'stl') {
                    // Set default to ascii.
                    setStorage('ascii')
                  }
                  formik.handleChange(e)
                }}
                className="bg-chalkboard-20 dark:bg-chalkboard-90 w-full"
              >
                <option value="gltf">gltf</option>
                <option value="obj">obj</option>
                <option value="ply">ply</option>
                <option value="step">step</option>
                <option value="stl">stl</option>
              </select>
            </label>
            {(type === 'gltf' || type === 'ply' || type === 'stl') && (
              <label htmlFor="storage" className="flex-1">
                <p className="mb-2">Storage</p>
                <select
                  id="storage"
                  name="storage"
                  data-testid="export-storage"
                  onChange={(e) => {
                    setStorage(e.target.value as StorageUnion)
                    formik.handleChange(e)
                  }}
                  className="bg-chalkboard-20 dark:bg-chalkboard-90 w-full"
                >
                  {type === 'gltf' && (
                    <>
                      <option value="embedded">embedded</option>
                      <option value="binary">binary</option>
                      <option value="standard">standard</option>
                    </>
                  )}
                  {type === 'stl' && (
                    <>
                      <option value="ascii">ascii</option>
                      <option value="binary">binary</option>
                    </>
                  )}
                  {type === 'ply' && (
                    <>
                      <option value="ascii">ascii</option>
                      <option value="binary_little_endian">
                        binary_little_endian
                      </option>
                      <option value="binary_big_endian">
                        binary_big_endian
                      </option>
                    </>
                  )}
                </select>
              </label>
            )}
          </div>

          <div className="flex justify-between mt-6">
            <ActionButton
              Element="button"
              onClick={closeModal}
              icon={{
                icon: faXmark,
                className: 'p-1',
                bgClassName: 'bg-destroy-80',
                iconClassName:
                  'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
              }}
              className="hover:border-destroy-40"
            >
              Close
            </ActionButton>
            <ActionButton
              Element="button"
              type="submit"
              icon={{ icon: faFileExport, className: 'p-1' }}
            >
              Export
            </ActionButton>
          </div>
        </form>
      </Modal>
    </>
  )
}
