export function cronMatches(cron: string, date: Date, startAt?: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const start = startAt ? new Date(startAt) : undefined;
  const anchoredInterval = start && /^\*\/\d+$/.test(parts[1]);
  const hourMatches = anchoredInterval
    ? date.getMinutes() === Number(parts[0]) &&
      Math.floor((date.getTime() - start.getTime()) / 3600000) % Number(parts[1].slice(2)) === 0
    : matchesPart(parts[0], date.getMinutes(), 0, 59) && matchesPart(parts[1], date.getHours(), 0, 23);
  return hourMatches && matchesPart(parts[2], date.getDate(), 1, 31) && matchesPart(parts[3], date.getMonth() + 1, 1, 12) && matchesPart(parts[4], date.getDay(), 0, 6);
}

function matchesPart(expression: string, value: number, min: number, max: number) {
  return expression.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    const [startText, endText] = range === "*" ? [String(min), String(max)] : range.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && value >= start && value <= end && (value - start) % step === 0;
  });
}

export function nextCronRuns(cron: string, startAt: string, count = 2) {
  const runs: Date[] = [];
  const cursor = new Date(startAt);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60 && runs.length < count; i += 1) {
    if (cronMatches(cron, cursor, startAt)) runs.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return runs;
}
