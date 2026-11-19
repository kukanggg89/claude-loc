import type { EngineInterface as Engine } from 'claude-code'

import { addDays, datesBetween, dayStartMs, lastDates, localDate } from './dates'
import { type DateRange, HISTORY_DAYS } from './query'
import { type CwdTallies, type DayTallies, type Tally, type TallyScope, ZERO, addTally, sumTallies, tallyTranscript } from './tally'
import { type TranscriptFile, completeLines, listTranscripts, projectOf, projectsDir, readRange, readTail } from './transcripts'

export type ProjectTally = Tally & { project: string }
export type DaySummary = Tally & { projects: ProjectTally[] }
export type DayEntry = { date: string; summary: DaySummary }
export type Report = { today: string; range: DateRange | null; focus: DaySummary; days: DayEntry[] }

type FileCursor = { offset: number; heredocs: Record<string, number> }
type TodayScan = { date: string; files: Record<string, FileCursor>; seen: string[]; byCwd: Record<string, Tally> }

const OVERVIEW_DAYS = 7
const DAY_PREFIX = 'day/v2/'
const TODAY_SCAN_KEY = 'scan/v2/today'

const dayKey = (date: string) => `${DAY_PREFIX}${date}`

const emptyScan = (date: string): TodayScan => ({ date, files: {}, seen: [], byCwd: {} })

const isUsableScan = (scan: TodayScan | undefined, date: string, files: TranscriptFile[]): scan is TodayScan =>
  !!scan && scan.date === date && files.every(file => (scan.files[file.path]?.offset ?? 0) <= file.size)

const byAddedDesc = (a: ProjectTally, b: ProjectTally) => b.added - a.added

const addToProject = (byProject: Map<string, Tally>, project: string, tally: Tally) =>
  byProject.set(project, addTally(byProject.get(project) ?? ZERO, tally))

const toSummary = (byProject: Map<string, Tally>): DaySummary => {
  const projects = [...byProject].map(([project, t]) => ({ project, ...t })).sort(byAddedDesc)
  return { ...sumTallies(projects), projects }
}

const mergeProjects = (summaries: DaySummary[]) => {
  const byProject = new Map<string, Tally>()
  for (const { project, ...tally } of summaries.flatMap(summary => summary.projects)) addToProject(byProject, project, tally)
  return toSummary(byProject)
}

async function summarize($: Engine, byCwd: CwdTallies | undefined) {
  const byProject = new Map<string, Tally>()
  for (const [cwd, tally] of byCwd ?? []) addToProject(byProject, await projectOf($, cwd), tally)
  return toSummary(byProject)
}

async function readCachedDays($: Engine, dates: string[]) {
  const cached = new Map<string, DaySummary>()
  for (const date of dates) {
    const summary = (await $.store.get(dayKey(date))) as DaySummary | undefined
    if (summary && Array.isArray(summary.projects)) cached.set(date, summary)
  }
  return cached
}

async function dropStaleKeys($: Engine, today: string) {
  const oldest = addDays(today, 1 - HISTORY_DAYS)
  for (const key of await $.store.keys()) {
    const isKeptDay = key.startsWith(DAY_PREFIX) && key.slice(DAY_PREFIX.length) >= oldest
    if (!isKeptDay && key !== TODAY_SCAN_KEY) await $.store.delete(key)
  }
}

async function scanPastDays($: Engine, dates: string[]) {
  const summaries = await readCachedDays($, dates)
  const missing = dates.filter(date => !summaries.has(date))
  if (!missing.length) return summaries

  const sinceMs = dayStartMs(missing[0]!)
  const scope: TallyScope = { wanted: new Set(missing), seen: new Set(), days: new Map() }
  for (const file of await listTranscripts($, await projectsDir($), sinceMs)) {
    const text = await readTail($, file, sinceMs).catch(() => '')
    tallyTranscript(completeLines(text).lines, scope)
  }
  for (const date of missing) {
    const summary = await summarize($, scope.days.get(date))
    summaries.set(date, summary)
    await $.store.set(dayKey(date), summary)
  }
  return summaries
}

async function readNewText($: Engine, file: TranscriptFile, cursor: FileCursor | undefined, sinceMs: number) {
  return cursor ? readRange($, file.path, cursor.offset, file.size) : readTail($, file, sinceMs)
}

async function scanToday($: Engine, today: string) {
  const sinceMs = dayStartMs(today)
  const files = await listTranscripts($, await projectsDir($), sinceMs)
  const saved = (await $.store.get(TODAY_SCAN_KEY)) as TodayScan | undefined
  const scan = isUsableScan(saved, today, files) ? saved : emptyScan(today)
  const days: DayTallies = new Map([[today, new Map(Object.entries(scan.byCwd))]])
  const scope: TallyScope = { wanted: new Set([today]), seen: new Set(scan.seen), days }
  const cursors: Record<string, FileCursor> = {}

  for (const file of files) {
    const cursor = scan.files[file.path]
    if (cursor?.offset === file.size) {
      cursors[file.path] = cursor
      continue
    }
    try {
      const { lines, pendingBytes } = completeLines(await readNewText($, file, cursor, sinceMs))
      const heredocs = new Map(Object.entries(cursor?.heredocs ?? {}))
      tallyTranscript(lines, scope, heredocs)
      cursors[file.path] = { offset: file.size - pendingBytes, heredocs: Object.fromEntries(heredocs) }
    } catch {
      if (cursor) cursors[file.path] = cursor
    }
  }

  const byCwd = scope.days.get(today) ?? new Map<string, Tally>()
  await $.store.set(TODAY_SCAN_KEY, { date: today, files: cursors, seen: [...scope.seen], byCwd: Object.fromEntries(byCwd) })
  return summarize($, byCwd)
}

async function summariesFor($: Engine, dates: string[], today: string) {
  const summaries = await scanPastDays($, dates.filter(date => date !== today))
  if (dates.includes(today)) summaries.set(today, await scanToday($, today))
  return dates.map(date => ({ date, summary: summaries.get(date)! }))
}

async function currentDate($: Engine) {
  return localDate(await $.clock.now())
}

export async function cachePastDays($: Engine) {
  const today = await currentDate($)
  await scanPastDays($, lastDates(addDays(today, -1), OVERVIEW_DAYS - 1))
  await dropStaleKeys($, today)
}

export async function buildReport($: Engine, range: DateRange | null): Promise<Report> {
  const today = await currentDate($)
  const days = await summariesFor($, range ? datesBetween(range.from, range.to) : lastDates(today, OVERVIEW_DAYS), today)
  await dropStaleKeys($, today)
  const focus = range ? mergeProjects(days.map(day => day.summary)) : days[days.length - 1]!.summary
  return { today, range, focus, days }
}
