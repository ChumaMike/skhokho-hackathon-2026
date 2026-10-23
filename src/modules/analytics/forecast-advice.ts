/**
 * What the Business Buddy says about a forecast — pure, so the Forecast page
 * and the buddy's rules-based answer say exactly the same thing about the same
 * numbers rather than drifting apart in two places.
 *
 * This is the rules-first path: no model is involved, the sentences are built
 * from the business's own figures, and nothing here claims more than the
 * arithmetic in `forecast.ts` supports. Tone is the dashboard's: plain, warm,
 * no jargon, and honest when the history is too short to lean on.
 */

import { SLOW_DAY_SHARE, type SalesForecast } from './forecast'

/** Day and month the way the rest of the dashboard writes a date: `19 Nov`. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * The forecast in a few sentences. One line per idea, so the page can show
 * them as separate points and the buddy can join them into an answer.
 */
export function explainForecast(forecast: SalesForecast): string[] {
  if (forecast.confidence === 'none') {
    return [
      'There are no paid orders yet, so there is nothing to forecast. Take a few orders and this page starts filling itself in.',
    ]
  }

  const lines: string[] = []
  const firstWeek = forecast.weeks[0]
  const lastWeek = forecast.weeks[forecast.weeks.length - 1]
  if (firstWeek && lastWeek) {
    lines.push(
      `Next week looks like about ${firstWeek.display}, and the four weeks to ${shortDate(lastWeek.weekEnd)} come to about ${forecast.totalDisplay}.`,
    )
  }

  if (forecast.trend.direction === 'up') {
    lines.push(`Your takings have been climbing by about ${forecast.trend.perWeekDisplay} a week, so the forecast climbs with them.`)
  } else if (forecast.trend.direction === 'down') {
    lines.push(`Your takings have been slipping by about ${forecast.trend.perWeekDisplay} a week, so the forecast comes down week by week.`)
  } else if (forecast.history.completeWeeks >= 2) {
    lines.push('Your takings have been steady, so the forecast holds level.')
  }

  if (forecast.trend.capped) {
    lines.push('The change was steep enough that we held the forecast to 50% up or down — four weeks is too far to carry a short run of weeks any further.')
  }

  const trading = forecast.weekdayAverages.filter((day) => day.daysCounted > 0 && day.averageCents > 0)
  const busiest = trading.reduce<(typeof trading)[number] | null>((best, day) => (!best || day.averageCents > best.averageCents ? day : best), null)
  if (busiest) {
    lines.push(`${busiest.name} is your big day, averaging ${busiest.averageDisplay} — worth having enough stock and hands for it.`)
  }

  if (forecast.slowWeekdays.length > 0) {
    const names = forecast.slowWeekdays.length === 1
      ? forecast.slowWeekdays[0]!
      : `${forecast.slowWeekdays.slice(0, -1).join(', ')} and ${forecast.slowWeekdays[forecast.slowWeekdays.length - 1]}`
    const verb = forecast.slowWeekdays.length === 1 ? 'is' : 'are'
    lines.push(
      `${names} ${verb} quiet — under ${Math.round(SLOW_DAY_SHARE * 100)}% of your average day. A special, or fewer hours, is where the easy win usually sits.`,
    )
  }

  if (forecast.confidence === 'thin') {
    lines.push(
      `This is built on ${forecast.history.daysCovered} ${forecast.history.daysCovered === 1 ? 'day' : 'days'} of trading, so treat it as a first sketch. It gets steadier every week you keep taking orders here.`,
    )
  } else if (forecast.confidence === 'fair') {
    lines.push(`This is built on ${forecast.history.completeWeeks} full weeks of trading — enough to show a pattern, not enough to bank on yet.`)
  }

  return lines
}

/** The same explanation as one paragraph, for the buddy's chat answer. */
export function explainForecastAsAnswer(forecast: SalesForecast): string {
  return explainForecast(forecast).join(' ')
}
