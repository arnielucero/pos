import type { LogContext, Logger, LogLevel } from '../../application/ports/Logger';
import { redact } from './Redactor';

export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly context: unknown;
}

export interface LogSink {
  write(record: LogRecord): void;
}

const ORDER: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, SECURITY: 50, AUDIT: 50 };

/** The ONLY place in the app that talks to the console. */
export class ConsoleSink implements LogSink {
  write(r: LogRecord): void {
    const line = JSON.stringify(r);
    if (r.level === 'ERROR' || r.level === 'SECURITY') console.error(line);
    else if (r.level === 'WARNING') console.warn(line);
    else if (r.level === 'DEBUG') console.debug(line);
    else console.info(line);
  }
}

/** In-memory ring buffer exposed in Sync diagnostics. */
export class MemorySink implements LogSink {
  private readonly buffer: LogRecord[] = [];
  constructor(private readonly capacity = 300) {}

  write(r: LogRecord): void {
    this.buffer.push(r);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  records(): readonly LogRecord[] {
    return [...this.buffer];
  }
}

export class StructuredLogger implements Logger {
  constructor(
    private readonly sinks: readonly LogSink[],
    private readonly minLevel: LogLevel = 'INFO',
    private readonly scope = 'app',
    private readonly now: () => Date = () => new Date(),
  ) {}

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const record: LogRecord = {
      ts: this.now().toISOString(),
      level,
      scope: this.scope,
      message: String(redact(message)),
      context: context ? redact(context) : undefined,
    };
    for (const s of this.sinks) {
      try {
        s.write(record);
      } catch {
        // a broken sink must never break the app
      }
    }
  }

  debug(m: string, c?: LogContext): void {
    this.log('DEBUG', m, c);
  }
  info(m: string, c?: LogContext): void {
    this.log('INFO', m, c);
  }
  warning(m: string, c?: LogContext): void {
    this.log('WARNING', m, c);
  }
  error(m: string, c?: LogContext): void {
    this.log('ERROR', m, c);
  }
  security(m: string, c?: LogContext): void {
    this.log('SECURITY', m, c);
  }
  audit(m: string, c?: LogContext): void {
    this.log('AUDIT', m, c);
  }
  child(scope: string): Logger {
    return new StructuredLogger(this.sinks, this.minLevel, `${this.scope}.${scope}`, this.now);
  }
}
