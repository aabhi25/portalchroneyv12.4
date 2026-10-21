/**
 * The day a visitor asked for in a booking message ("book for Saturday", "tomorrow", "24 Oct",
 * "on the 28th"), as YYYY-MM-DD in India time. The chat booking card opens on that day.
 * null when the message names no day. English only.
 */

const WEEKDAYS: Array<[number, RegExp]> = [
  [0, /\bsunday\b/],
  [1, /\b(monday|mon)\b/],
  [2, /\b(tuesday|tues|tue)\b/],
  [3, /\b(wednesday|weds|wed)\b/],
  [4, /\b(thursday|thurs|thu)\b/],
  [5, /\b(friday|fri)\b/],
  [6, /\bsaturday\b/],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** Today's date in India (the booking calendar's time zone) as a UTC-midnight Date. */
function todayInIndia(now: Date): Date {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now); // YYYY-MM-DD
  return new Date(`${iso}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** A calendar date this year, or next year when it has already passed. null for impossible dates. */
function upcomingDate(today: Date, month: number, day: number): Date | null {
  for (const year of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCMonth() !== month) return null; // e.g. 31 Feb
    if (d.getTime() >= today.getTime()) return d;
  }
  return null;
}

export function requestedBookingDay(message: string, now: Date = new Date()): string | null {
  const m = (message || '').toLowerCase();
  if (!m.trim()) return null;
  const today = todayInIndia(now);

  if (/\bday after tomorrow\b/.test(m)) return iso(addDays(today, 2));
  if (/\b(tomorrow|tmrw|tomorow|tommorow|tommorrow)\b/.test(m)) return iso(addDays(today, 1));
  if (/\b(today|tonight)\b/.test(m)) return iso(today);

  // "24 Oct", "24th of October"
  let match = m.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}\\b`));
  if (match) {
    const d = upcomingDate(today, MONTHS.indexOf(match[2].slice(0, 3)), Number(match[1]));
    if (d) return iso(d);
  }
  // "Oct 24", "October 24th"
  match = m.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (match) {
    const d = upcomingDate(today, MONTHS.indexOf(match[1].slice(0, 3)), Number(match[2]));
    if (d) return iso(d);
  }

  // "Saturday", "this Friday", "next Monday" (the coming one; "next" skips today)
  for (const [weekday, re] of WEEKDAYS) {
    const found = m.match(re);
    if (!found) continue;
    const isNext = new RegExp(`\\bnext\\s+${found[0]}\\b`).test(m);
    let ahead = (weekday - today.getUTCDay() + 7) % 7;
    if (ahead === 0 && isNext) ahead = 7;
    return iso(addDays(today, ahead));
  }

  // "on the 28th", "on 5th"
  match = m.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (match) {
    const day = Number(match[1]);
    for (let k = 0; k < 2; k++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k, day));
      if (d.getUTCDate() === day && d.getTime() >= today.getTime()) return iso(d);
    }
  }
  return null;
}
