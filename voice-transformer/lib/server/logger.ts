// Only pass safe fields: timings, sizes, status codes, slugs. Never audio,
// headers or secrets.

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

function line(level: string, event: string, fields?: LogFields): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
}

export const consoleLogger: Logger = {
  info: (event, fields) => console.log(line("info", event, fields)),
  warn: (event, fields) => console.warn(line("warn", event, fields)),
  error: (event, fields) => console.error(line("error", event, fields)),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
