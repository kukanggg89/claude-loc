import { addDays, dayOfMonth, monthOf, weekdayOf } from './dates'

export type DateRange = { from: string; to: string }
export type Query = { kind: 'overview' } | { kind: 'range'; range: DateRange } | { kind: 'error'; message: string }

export const HISTORY_DAYS = 30

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const MIN_NAME_LENGTH = 3
const LOOKBACK_DAYS = 366

const FORMAT_ERROR = 'Couldn’t read that date. Try: yesterday, 18, nov 18, wed, 10-18, mon-fri'
const TOO_OLD_ERROR = `Only the last ${HISTORY_DAYS} days are available.`
const REVERSED_ERROR = 'That range ends before it starts.'

const nameIndex = (word: string, names: string[]) =>
  word.length >= MIN_NAME_LENGTH ? names.findIndex(name => name.startsWith(word)) : -1

const dayNumber = (word: string) => {
  const day = /^\d{1,2}$/.test(word) ? Number(word) : 0
  return day >= 1 && day <= 31 ? day : 0
}

const latestMatching = (latest: string, matches: (date: string) => boolean) => {
  for (let back = 0; back <= LOOKBACK_DAYS; back += 1) {
    const date = addDays(latest, -back)
    if (matches(date)) return date
  }
  return null
}

const resolveWord = (word: string, latest: string, today: string) => {
  if (word === 'today') return today
  if (word === 'yesterday') return addDays(today, -1)
  const weekday = nameIndex(word, WEEKDAY_NAMES)
  if (weekday >= 0) return latestMatching(latest, date => weekdayOf(date) === weekday)
  const day = dayNumber(word)
  return day ? latestMatching(latest, date => dayOfMonth(date) === day) : null
}

const resolveMonthDay = ([first = '', second = '']: string[], latest: string) => {
  const monthFirst = nameIndex(first, MONTH_NAMES)
  const month = monthFirst >= 0 ? monthFirst : nameIndex(second, MONTH_NAMES)
  const day = dayNumber(monthFirst >= 0 ? second : first)
  if (month < 0 || !day) return null
  return latestMatching(latest, date => monthOf(date) === month && dayOfMonth(date) === day)
}

const resolvePoint = (text: string, latest: string, today: string) => {
  const words = text.split(/\s+/)
  if (words.length === 1) return resolveWord(words[0]!, latest, today)
  return words.length === 2 ? resolveMonthDay(words, latest) : null
}

export const parseQuery = (args: string, today: string): Query => {
  const text = args.trim().toLowerCase()
  if (!text) return { kind: 'overview' }
  const ends = text.split(/\s*-\s*/)
  if (ends.length > 2 || ends.some(end => !end)) return { kind: 'error', message: FORMAT_ERROR }

  const to = resolvePoint(ends[ends.length - 1]!, today, today)
  const from = to && ends.length === 2 ? resolvePoint(ends[0]!, to, today) : to
  if (!from || !to) return { kind: 'error', message: FORMAT_ERROR }
  if (from > to) return { kind: 'error', message: REVERSED_ERROR }
  if (from < addDays(today, 1 - HISTORY_DAYS)) return { kind: 'error', message: TOO_OLD_ERROR }
  return { kind: 'range', range: { from, to } }
}
