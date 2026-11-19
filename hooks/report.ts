import type { EngineInterface as Engine } from 'claude-code'

import { addDays, datesBetween, dayStartMs, lastDates, localDate } from './dates'
import { type DateRange, HISTORY_DAYS } from './query'
import { type CwdTallies, type DayTallies, type SeenResults, type Tally, type TallyScope, ZERO, addTally, sumTallies, tallyTranscript } from './tally'
import { type TranscriptFile, listTranscripts, projectOf, projectsDir, readRange, streamLines } from './transcripts'

export type ProjectTally = Tally & { project: string }
export type DaySummary = Tally & { projects: ProjectTally[] }
export type DayEntry = { date: string; summary: DaySummary }
export type Report = { today: string; range: DateRange | null; focus: DaySummary; days: DayEntry[] }

type FileCursor = { offset: number; heredocs: Record<string, number> }
type StoredIndex = {
  files: Record<string, FileCursor>
  days: Record<string, Record<string, Tally>>
  seen: Record<string, string[]>
}

const OVERVIEW_DAYS = 7
const INDEX_KEY = 'index/v3'
const CHECKPOINT_MS = 3_000

let refreshing: Promise<DayTallies> | null = null

const emptyIndex = (): StoredIndex => ({ files: {}, days: {}, seen: {} })

const isUsableIndex = (index: StoredIndex | undefined, files: TranscriptFile[]): index is StoredIndex =>
  !!index?.files && files.every(file => (index.files[file.path]?.offset ?? 0) <= file.size)

const daysFrom = (stored: StoredIndex['days']): DayTallies =>
  new Map(Object.entries(stored).map(([date, byCwd]) => [date, new Map(Object.entries(byCwd))]))

const seenFrom = (stored: StoredIndex['seen']): SeenResults =>
  new Map(Object.entries(stored).flatMap(([date, keys]) => keys.map(key => [key, date] as const)))

const daysToStore = (days: DayTallies, oldest: string) =>
  Object.fromEntries([...days].filter(([date]) => date >= oldest).map(([date, byCwd]) => [date, Object.fromEntries(byCwd)]))

const seenToStore = (seen: SeenResults, oldest: string) => {
  const byDate: Record<string, string[]> = {}
  for (const [key, date] of seen) if (date >= oldest) (byDate[date] ??= []).push(key)
  return byDate
}

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

async function dropOtherKeys($: Engine) {
  for (const key of await $.store.keys()) if (key !== INDEX_KEY) await $.store.delete(key)
}

async function saveIndex($: Engine, files: Record<string, FileCursor>, scope: TallyScope, oldest: string) {
  const stored: StoredIndex = { files, days: daysToStore(scope.days, oldest), seen: seenToStore(scope.seen, oldest) }
  await $.store.set(INDEX_KEY, stored)
}

async function indexFile($: Engine, file: TranscriptFile, cursor: FileCursor, scope: TallyScope): Promise<FileCursor> {
  const heredocs = new Map(Object.entries(cursor.heredocs))
  const read = (start: number, end: number) => readRange($, file.path, start, end)
  const offset = await streamLines(read, file.size, cursor.offset, lines => tallyTranscript(lines, scope, heredocs)).catch(
    () => cursor.offset,
  )
  return { offset, heredocs: Object.fromEntries(heredocs) }
}

async function updateIndex($: Engine, today: string) {
  const oldest = addDays(today, 1 - HISTORY_DAYS)
  const files = await listTranscripts($, await projectsDir($), dayStartMs(oldest))
  const saved = (await $.store.get(INDEX_KEY)) as StoredIndex | undefined
  const index = isUsableIndex(saved, files) ? saved : emptyIndex()
  const scope = { wanted: new Set(datesBetween(oldest, today)), seen: seenFrom(index.seen), days: daysFrom(index.days) }
  const cursors = Object.fromEntries(files.flatMap(file => (index.files[file.path] ? [[file.path, index.files[file.path]!]] : [])))
  let savedAt = await $.clock.now()

  for (const file of files) {
    const cursor = cursors[file.path] ?? { offset: 0, heredocs: {} }
    if (cursor.offset === file.size) continue
    cursors[file.path] = await indexFile($, file, cursor, scope)
    if ((await $.clock.now()) - savedAt < CHECKPOINT_MS) continue
    await saveIndex($, cursors, scope, oldest)
    savedAt = await $.clock.now()
  }

  await saveIndex($, cursors, scope, oldest)
  await dropOtherKeys($)
  return scope.days
}

function refreshIndex($: Engine, today: string) {
  refreshing ??= updateIndex($, today).finally(() => {
    refreshing = null
  })
  return refreshing
}

export async function currentDate($: Engine) {
  return localDate(await $.clock.now())
}

export async function warmIndex($: Engine) {
  await refreshIndex($, await currentDate($))
}

export async function buildReport($: Engine, today: string, range: DateRange | null): Promise<Report> {
  const tallies = await refreshIndex($, today)
  const dates = range ? datesBetween(range.from, range.to) : lastDates(today, OVERVIEW_DAYS)
  const days: DayEntry[] = []
  for (const date of dates) days.push({ date, summary: await summarize($, tallies.get(date)) })
  const focus = range ? mergeProjects(days.map(day => day.summary)) : days[days.length - 1]!.summary
  return { today, range, focus, days }
}
