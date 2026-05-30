export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

const DOM_FULL_LEN = 31;
const DOW_FULL_LEN = 7;

function expandField(spec: string, min: number, max: number): number[] {
  if (spec.includes(",")) {
    const result = new Set<number>();
    for (const part of spec.split(",")) {
      for (const v of expandField(part, min, max)) result.add(v);
    }
    return Array.from(result).sort((a, b) => a - b);
  }

  let step = 1;
  let body = spec;
  if (spec.includes("/")) {
    const parts = spec.split("/");
    if (parts.length !== 2) throw new Error(`Invalid step expression: ${spec}`);
    body = parts[0];
    const stepNum = Number(parts[1]);
    if (!Number.isInteger(stepNum) || stepNum <= 0) {
      throw new Error(`Invalid step: ${spec}`);
    }
    step = stepNum;
  }

  let from: number;
  let to: number;
  if (body === "*") {
    from = min;
    to = max;
  } else if (body.includes("-")) {
    const parts = body.split("-");
    if (parts.length !== 2) throw new Error(`Invalid range: ${spec}`);
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`Invalid range: ${spec}`);
    }
    from = a;
    to = b;
  } else {
    const v = Number(body);
    if (!Number.isInteger(v)) throw new Error(`Invalid value: ${spec}`);
    if (step !== 1) throw new Error(`Step requires range or *: ${spec}`);
    if (v < min || v > max) {
      throw new Error(`Value ${v} out of range [${min},${max}]`);
    }
    return [v];
  }

  if (from < min || to > max || from > to) {
    throw new Error(`Range ${from}-${to} out of bounds [${min},${max}]`);
  }

  const result: number[] = [];
  for (let i = from; i <= to; i += step) result.push(i);
  return result;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expression must have 5 fields");
  }
  return {
    minute: expandField(parts[0], 0, 59),
    hour: expandField(parts[1], 0, 23),
    dayOfMonth: expandField(parts[2], 1, 31),
    month: expandField(parts[3], 1, 12),
    dayOfWeek: expandField(parts[4], 0, 6),
  };
}

export function matchesCron(fields: CronFields, date: Date): boolean {
  const m = date.getMinutes();
  const h = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1;
  const dow = date.getDay();

  if (!fields.minute.includes(m)) return false;
  if (!fields.hour.includes(h)) return false;
  if (!fields.month.includes(mon)) return false;

  const domRestricted = fields.dayOfMonth.length !== DOM_FULL_LEN;
  const dowRestricted = fields.dayOfWeek.length !== DOW_FULL_LEN;
  const domMatch = fields.dayOfMonth.includes(dom);
  const dowMatch = fields.dayOfWeek.includes(dow);

  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  if (domRestricted) return domMatch;
  if (dowRestricted) return dowMatch;
  return true;
}

export function nextFireTime(fields: CronFields, from: Date): Date {
  const cur = new Date(from.getTime());
  cur.setSeconds(0, 0);
  cur.setMinutes(cur.getMinutes() + 1);

  const cap = 527040;
  for (let i = 0; i < cap; i++) {
    if (matchesCron(fields, cur)) return new Date(cur.getTime());
    cur.setMinutes(cur.getMinutes() + 1);
  }
  throw new Error("No fire time within horizon");
}
