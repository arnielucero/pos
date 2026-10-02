export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY' | 'AUDIT';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warning(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Security-relevant events (failed logins, lockouts, tampering suspicion). */
  security(message: string, context?: LogContext): void;
  /** Business audit trail (also persisted via AuditLogRepository by use cases). */
  audit(message: string, context?: LogContext): void;
  child(scope: string): Logger;
}
