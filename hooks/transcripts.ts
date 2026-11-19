import type { EngineInterface as Engine } from 'claude-code'

import { firstTimestampMs } from './tally'

export type TranscriptFile = { path: string; size: number }

const TAIL_CHUNK = 1024 * 1024
const MAX_READ = 4 * 1024 * 1024
const NO_FOLDER = '(no folder)'
const SKIPPED_DIRS = new Set(['tool-results'])

const projectByCwd = new Map<string, string>()

const pathParts = (path: string) => path.split(/[\\/]+/).filter(Boolean)
const baseName = (path: string) => pathParts(path).pop() ?? path
const parentOf = (path: string) => path.replace(/[\\/]+[^\\/]+[\\/]*$/, '')

export const utf8Length = (text: string) => {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

export const completeLines = (text: string) => {
  const cut = text.lastIndexOf('\n') + 1
  return { lines: text.slice(0, cut), pendingBytes: utf8Length(text.slice(cut)) }
}

export async function projectsDir($: Engine) {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir) return `${configDir}/projects`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~'
  return `${home}/.claude/projects`
}

export async function listTranscripts($: Engine, dir: string, sinceMs: number): Promise<TranscriptFile[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const found: TranscriptFile[] = []
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir' && !SKIPPED_DIRS.has(entry.name)) found.push(...(await listTranscripts($, path, sinceMs)))
    else if (entry.kind === 'file' && entry.name.endsWith('.jsonl') && entry.mtimeMs >= sinceMs) {
      found.push({ path, size: entry.size })
    }
  }
  return found
}

export async function readRange($: Engine, path: string, start: number, end: number) {
  let text = ''
  for (let offset = start; offset < end; offset += MAX_READ) {
    text += (await $.fs.read(path, { offset, length: Math.min(MAX_READ, end - offset) })) as string
  }
  return text
}

export async function readTail($: Engine, file: TranscriptFile, sinceMs: number) {
  const chunks: string[] = []
  let end = file.size
  while (end > 0) {
    const start = Math.max(0, end - TAIL_CHUNK)
    const chunk = await readRange($, file.path, start, end)
    chunks.unshift(chunk)
    end = start
    if (firstTimestampMs(chunk) < sinceMs) break
  }
  const text = chunks.join('')
  return end > 0 ? text.slice(text.indexOf('\n') + 1) : text
}

async function findGitRoot($: Engine, cwd: string) {
  for (let dir = cwd; pathParts(dir).length > 1; dir = parentOf(dir)) {
    if (await $.fs.exists(`${dir}/.git`).catch(() => false)) return dir
  }
  return null
}

export async function projectOf($: Engine, cwd: string) {
  if (!cwd || /[\\/]scratch-workspaces[\\/]/i.test(cwd)) return NO_FOLDER
  const known = projectByCwd.get(cwd)
  if (known) return known
  const project = baseName((await findGitRoot($, cwd)) ?? cwd)
  projectByCwd.set(cwd, project)
  return project
}
