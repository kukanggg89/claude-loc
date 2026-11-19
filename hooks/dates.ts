const pad = (n: number) => String(n).padStart(2, '0')

const toDateString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const toLocalDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day)
}

export const localDate = (ms: number) => toDateString(new Date(ms))

export const dayStartMs = (date: string) => toLocalDate(date).getTime()

export const addDays = (date: string, days: number) => {
  const local = toLocalDate(date)
  local.setDate(local.getDate() + days)
  return toDateString(local)
}

export const datesBetween = (from: string, to: string) => {
  const dates: string[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date)
  return dates
}

export const lastDates = (today: string, count: number) => datesBetween(addDays(today, 1 - count), today)

export const weekdayOf = (date: string) => toLocalDate(date).getDay()

export const monthOf = (date: string) => toLocalDate(date).getMonth()

export const dayOfMonth = (date: string) => toLocalDate(date).getDate()
