import { EventEmitter } from 'events';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

const MAX_BUFFER = 500;
let idCounter = 0;

const buffer: LogEntry[] = [];
export const logEvents = new EventEmitter();
logEvents.setMaxListeners(100);

function addEntry(level: LogEntry['level'], args: unknown[]) {
  const message = args
    .map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');

  const entry: LogEntry = {
    id: ++idCounter,
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  logEvents.emit('log', entry);
}

export function getLogBuffer(): LogEntry[] {
  return [...buffer];
}

const origLog   = console.log.bind(console);
const origWarn  = console.warn.bind(console);
const origError = console.error.bind(console);
const origInfo  = console.info.bind(console);
const origDebug = console.debug.bind(console);

export function initLogCapture() {
  console.log = (...args: unknown[]) => {
    origLog(...args);
    addEntry('info', args);
  };
  console.info = (...args: unknown[]) => {
    origInfo(...args);
    addEntry('info', args);
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    addEntry('warn', args);
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    addEntry('error', args);
  };
  console.debug = (...args: unknown[]) => {
    origDebug(...args);
    addEntry('debug', args);
  };
}
