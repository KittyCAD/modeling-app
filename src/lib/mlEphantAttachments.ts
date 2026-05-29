export const ZOODLE_ATTACHMENT_DISPLAY_NAME = 'zoodle'
export const ZOODLE_ATTACHMENT_FILE_NAME = `${ZOODLE_ATTACHMENT_DISPLAY_NAME}.png`

export const getAttachmentDisplayName = (fileName: string) =>
  fileName === ZOODLE_ATTACHMENT_FILE_NAME
    ? ZOODLE_ATTACHMENT_DISPLAY_NAME
    : fileName
