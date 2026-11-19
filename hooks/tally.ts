import { localDate } from './dates'

export type Tally = { added: number; removed: number }
export type CwdTallies = Map<string, Tally>
export type DayTallies = Map<string, CwdTallies>
export type Heredocs = Map<string, number>
export type SeenResults = Map<string, string>
export type TallyScope = { wanted: Set<string>; seen: SeenResults; days: DayTallies }

type FileEditResult = { type?: unknown; content?: unknown; structuredPatch?: unknown; memdirStamped?: unknown }
type Block = { type?: string; id?: string; name?: string; input?: { command?: unknown }; tool_use_id?: string; is_error?: boolean }
type Entry = { type?: string; timestamp?: string; cwd?: string; message?: { content?: unknown }; toolUseResult?: unknown }

const HEREDOC_TO_FILE = /\bcat\s+>>?\s*\S+\s*<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g
const SEEN_KEY_LENGTH = 12

export const ZERO: Tally = { added: 0, removed: 0 }

export const addTally = (a: Tally, b: Tally): Tally => ({ added: a.added + b.added, removed: a.removed + b.removed })

export const sumTallies = (tallies: Iterable<Tally>) => [...tallies].reduce(addTally, ZERO)

export const countLines = (text: string) => {
  if (!text) return 0
  const lines = text.split('\n')
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

export const heredocLines = (command: string) => {
  let total = 0
  for (const match of command.matchAll(HEREDOC_TO_FILE)) total += countLines(match[2] ?? '')
  return total
}

export const seenKey = (toolUseId: string) => toolUseId.slice(-SEEN_KEY_LENGTH)

const patchTally = (hunks: { lines?: unknown }[]) => {
  const tally = { added: 0, removed: 0 }
  for (const hunk of hunks) {
    for (const line of Array.isArray(hunk.lines) ? hunk.lines : []) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) tally.added += 1
      else if (line.startsWith('-')) tally.removed += 1
    }
  }
  return tally
}

export const fileEditTally = (result: FileEditResult): Tally | null => {
  if (result.memdirStamped) return null
  if (Array.isArray(result.structuredPatch) && result.structuredPatch.length) return patchTally(result.structuredPatch)
  if (result.type === 'create' && typeof result.content === 'string') return { added: countLines(result.content), removed: 0 }
  return null
}

const blocksOf = (entry: Entry): Block[] => (Array.isArray(entry.message?.content) ? (entry.message.content as Block[]) : [])

const mayHoldHeredoc = (line: string) => line.includes('"tool_use"') && line.includes('<<')

const mayHoldCountedResult = (line: string, heredocs: Heredocs) =>
  line.includes('"tool_result"') && (line.includes('"structuredPatch"') || heredocs.size > 0)

const parseEntry = (line: string, heredocs: Heredocs): Entry | null => {
  if (!mayHoldHeredoc(line) && !mayHoldCountedResult(line, heredocs)) return null
  try {
    return JSON.parse(line) as Entry
  } catch {
    return null
  }
}

const rememberHeredocs = (entry: Entry, heredocs: Heredocs) => {
  for (const block of blocksOf(entry)) {
    if (block.type !== 'tool_use' || block.name !== 'Bash' || !block.id) continue
    const lines = typeof block.input?.command === 'string' ? heredocLines(block.input.command) : 0
    if (lines) heredocs.set(block.id, lines)
  }
}

const resultTally = (id: string, entry: Entry, heredocs: Heredocs) => {
  const heredoc = heredocs.get(id)
  if (heredoc !== undefined) return { added: heredoc, removed: 0 }
  const result = entry.toolUseResult
  return result && typeof result === 'object' ? fileEditTally(result as FileEditResult) : null
}

const addTo = (days: DayTallies, date: string, cwd: string, tally: Tally) => {
  if (!tally.added && !tally.removed) return
  const byCwd = days.get(date) ?? new Map<string, Tally>()
  byCwd.set(cwd, addTally(byCwd.get(cwd) ?? ZERO, tally))
  days.set(date, byCwd)
}

const countResults = (entry: Entry, scope: TallyScope, heredocs: Heredocs) => {
  if (!entry.timestamp) return
  const date = localDate(Date.parse(entry.timestamp))
  for (const block of blocksOf(entry)) {
    const id = block.tool_use_id
    if (block.type !== 'tool_result' || !id) continue
    const key = seenKey(id)
    const tally = block.is_error || scope.seen.has(key) ? null : resultTally(id, entry, heredocs)
    heredocs.delete(id)
    if (!tally || !scope.wanted.has(date)) continue
    scope.seen.set(key, date)
    addTo(scope.days, date, entry.cwd ?? '', tally)
  }
}

export const tallyTranscript = (text: string, scope: TallyScope, heredocs: Heredocs = new Map()) => {
  for (const line of text.split('\n')) {
    const entry = parseEntry(line, heredocs)
    if (entry?.type === 'assistant') rememberHeredocs(entry, heredocs)
    else if (entry?.type === 'user') countResults(entry, scope, heredocs)
  }
}
