import { fmt, site } from '../data/site';

export type HoursOverride = { date: string; open: string; close: string; closed: boolean };
export type VisitSettings = { notice: string; overrides: HoursOverride[] };
export const VISIT_DRAFT_KEY = 'hb-visit-v1';

export function parseVisit(raw?: string | null): VisitSettings {
  const empty: VisitSettings = { notice: '', overrides: [] };
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw) as Partial<VisitSettings>;
    const overrides = Array.isArray(value?.overrides) ? value.overrides.filter(validOverride) : [];
    return { notice: typeof value?.notice === 'string' ? value.notice.slice(0, 280) : '', overrides };
  } catch {
    return empty;
  }
}

export function validOverride(value: HoursOverride): boolean {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || typeof value.closed !== 'boolean') return false;
  const date = new Date(`${value.date}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date
    && (value.closed || (time.test(value.open) && time.test(value.close) && value.open < value.close));
}

const shopClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function renderVisit(settings: VisitSettings, instant = new Date()) {
  const parts = Object.fromEntries(shopClock.formatToParts(instant).map(({ type, value }) => [type, value]));
  const now = `${parts.hour}:${parts.minute}`;
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  const todayKey = date.toISOString().slice(0, 10);
  const todayDay = date.getUTCDay();
  const schedule = (day: Date) => settings.overrides.find((item) => item.date === day.toISOString().slice(0, 10))
    ?? { ...site.hours.find((item) => item.day === day.getUTCDay())!, closed: false };
  const today = schedule(date);
  const open = !today.closed && now >= today.open && now < today.close;
  let text = open ? `Open now, until ${fmt(today.close)}` : 'Closed now';
  if (!open) {
    for (let offset = 0; offset <= settings.overrides.length + 7; offset++) {
      const hours = schedule(date);
      if (!hours.closed && (offset > 0 || now < hours.open)) {
        const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : new Intl.DateTimeFormat('en-GB', {
          timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
        }).format(date);
        text = `Closed, opens ${fmt(hours.open)} ${when}`;
        break;
      }
      date.setUTCDate(date.getUTCDate() + 1);
    }
  }

  document.querySelectorAll<HTMLElement>('[data-hours]').forEach((pill) => {
    pill.dataset.open = String(open);
    pill.querySelector('span')!.textContent = text;
  });
  document.querySelectorAll<HTMLElement>('[data-day]').forEach((row) => {
    row.toggleAttribute('data-today', Number(row.dataset.day) === todayDay);
  });
  document.querySelectorAll<HTMLElement>('[data-shop-notice]').forEach((notice) => {
    notice.textContent = settings.notice;
    notice.hidden = !settings.notice;
  });
  const list = document.querySelector<HTMLElement>('[data-special-hours]');
  if (!list) return;
  const dates = settings.overrides.filter((item) => item.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date));
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const rows = dates.map((item) => {
    const li = document.createElement('li');
    li.textContent = `${label.format(new Date(item.date))} · ${item.closed ? 'Closed' : `${fmt(item.open)} to ${fmt(item.close)}`}`;
    return li;
  });
  list.querySelector('ul')!.replaceChildren(...rows);
  list.hidden = !rows.length;
}
