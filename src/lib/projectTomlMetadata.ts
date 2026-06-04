type SectionRange = {
  headerIndex: number
  startIndex: number
  endIndex: number
}

function getTomlString(value: string) {
  return JSON.stringify(value)
}

function parseTomlString(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return undefined
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return undefined
}

function parseSectionHeader(line: string) {
  return line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)?.[1]?.trim()
}

function getSectionRange(
  lines: string[],
  matchesSection: (sectionName: string) => boolean
): SectionRange | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const sectionName = parseSectionHeader(lines[index])
    if (!sectionName || !matchesSection(sectionName)) {
      continue
    }

    let endIndex = lines.length
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      if (parseSectionHeader(lines[nextIndex])) {
        endIndex = nextIndex
        break
      }
    }

    return {
      headerIndex: index,
      startIndex: index + 1,
      endIndex,
    }
  }

  return undefined
}

function getKeyValueFromSection(
  lines: string[],
  section: SectionRange,
  key: string
) {
  const keyPattern = new RegExp(
    `^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.+?)\\s*(?:#.*)?$`
  )
  for (let index = section.startIndex; index < section.endIndex; index += 1) {
    const value = keyPattern.exec(lines[index])?.[1]
    if (value) {
      return parseTomlString(value)
    }
  }

  return undefined
}

function getTopLevelKeyValue(lines: string[], key: string) {
  const topLevelSection = {
    headerIndex: -1,
    startIndex: 0,
    endIndex: lines.findIndex((line) => Boolean(parseSectionHeader(line))),
  }
  if (topLevelSection.endIndex === -1) {
    topLevelSection.endIndex = lines.length
  }

  return getKeyValueFromSection(lines, topLevelSection, key)
}

function projectTitleSectionMatches(sectionName: string) {
  return sectionName === 'settings.meta'
}

export function getProjectTitleFromProjectTomlContents(contents: string) {
  const lines = contents.replaceAll('\r\n', '\n').split('\n')
  const section = getSectionRange(lines, projectTitleSectionMatches)
  if (!section) {
    const topLevelTitle = getTopLevelKeyValue(lines, 'title')
    return typeof topLevelTitle === 'string' && topLevelTitle.trim()
      ? topLevelTitle
      : undefined
  }

  const title =
    getKeyValueFromSection(lines, section, 'title') ??
    getTopLevelKeyValue(lines, 'title')
  return typeof title === 'string' && title.trim() ? title : undefined
}

export function setProjectTitleInProjectTomlContents(
  contents: string,
  title: string
) {
  const lines = contents.replaceAll('\r\n', '\n').split('\n')
  const nextTitleLine = `title = ${getTomlString(title)}`
  const section = getSectionRange(lines, projectTitleSectionMatches)
  if (!section) {
    const nextContents = contents.trimEnd()
    return `${nextContents ? `${nextContents}\n\n` : ''}[settings.meta]\n${nextTitleLine}\n`
  }

  for (let index = section.startIndex; index < section.endIndex; index += 1) {
    if (/^\s*title\s*=/.test(lines[index])) {
      lines[index] = nextTitleLine
      return lines.join('\n')
    }
  }

  lines.splice(section.startIndex, 0, nextTitleLine)
  return lines.join('\n')
}
