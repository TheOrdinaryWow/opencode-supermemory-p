const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toValidDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAbsoluteDate(date: Date, now: Date): string {
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];

  if (date.getUTCFullYear() === now.getUTCFullYear()) {
    return `${day} ${month}`;
  }

  return `${day} ${month}, ${date.getUTCFullYear()}`;
}

export function formatRelativeTime(isoTimestamp: string | Date, now: Date = new Date()): string {
  const input = toValidDate(isoTimestamp);
  const current = toValidDate(now);

  if (!input || !current) return "";

  const diffMs = current.getTime() - input.getTime();

  if (diffMs < 0) {
    return formatAbsoluteDate(input, current);
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 30) {
    return "just now";
  }

  if (minutes < 60) {
    return minutes === 1 ? "1min ago" : `${minutes}mins ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return formatAbsoluteDate(input, current);
}
