import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from './ActionButton'
import Modal from 'react-modal'
import React from 'react'
import { useFormik } from 'formik'
import { Models } from '@kittycad/lib'

type OutputFormat = Models['OutputFormat_type']

export const ExportButton = () => {
  const { engineCommandManager } = useStore((s) => ({
    engineCommandManager: s.engineCommandManager,
  }))

  const [modalIsOpen, setIsOpen] = React.useState(false)

  const defaultType = 'gltf'
  const [type, setType] = React.useState(defaultType)

  const customModalStyles = {
    content: {
      top: '50%',
      left: '50%',
      right: 'auto',
      bottom: 'auto',
      marginRight: '-50%',
      transform: 'translate(-50%, -50%)',
    },
  }

  function openModal() {
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  // Default to gltf and embedded.
  const initialValues: OutputFormat = {
    type: defaultType,
    storage: 'embedded',
  }
  const formik = useFormik({
    initialValues,
    onSubmit: (values: OutputFormat) => {
      engineCommandManager?.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'export',
          // By default let's leave this blank to export the whole scene.
          // In the future we might want to let the user choose which entities
          // in the scene to export. In that case, you'd pass the IDs thru here.
          entity_ids: [],
          format: values,
        },
        cmd_id: uuidv4(),
        file_id: uuidv4(),
      })

      closeModal()
    },
  })

  return (
    <>
      <button onClick={openModal}>Export</button>
      <Modal
        isOpen={modalIsOpen}
        onRequestClose={closeModal}
        contentLabel="Export"
        style={customModalStyles}
      >
        <div className="text-black">
          <h1 className="text-2xl font-bold">Export your design</h1>
          <form onSubmit={formik.handleSubmit}>
            <p>
              <label htmlFor="type">Type</label>
            </p>
            <p>
              <select
                id="type"
                name="type"
                onChange={(e) => {
                  setType(e.target.value)
                  formik.handleChange(e)
                }}
              >
                <option value="gltf">gltf</option>
                <option value="obj">obj</option>
                <option value="ply">ply</option>
                <option value="step">step</option>
                <option value="stl">stl</option>
              </select>
            </p>

            {(type === 'gltf' || type === 'ply' || type === 'stl') && (
              <>
                <p>
                  {' '}
                  <label htmlFor="storage">Storage</label>
                </p>
                <p>
                  <select
                    id="storage"
                    name="storage"
                    onChange={formik.handleChange}
                    value={formik.values.storage}
                  >
                    {type === 'gltf' && (
                      <>
                        <option value="embedded">embedded</option>
                        <option value="binary">binary</option>
                        <option value="standard">standard</option>
                      </>
                    )}
                    {type === 'ply' && (
                      <>
                        <option value="ascii">ascii</option>
                        <option value="binary">binary</option>
                      </>
                    )}
                    {type === 'stl' && (
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
                </p>
              </>
            )}

            <div className="flex justify-between mt-6">
              <button type="submit">Submit</button>
            </div>
          </form>
          <div className="flex justify-between mt-6">
            <ActionButton
              onClick={closeModal}
              icon={{
                icon: faXmark,
                bgClassName: 'bg-destroy-80',
                iconClassName:
                  'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
              }}
              className="hover:border-destroy-40"
            >
              Close
            </ActionButton>
          </div>
        </div>
      </Modal>
    </>
  )
}
