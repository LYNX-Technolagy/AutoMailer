const fs = require('fs');
const path = require('path');

const SENDLOG_PATH = path.join(__dirname, '..', 'data', 'sendlog.json');
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const LIMIT = 50;

function ensureDir() {
  fs.mkdirSync(path.dirname(SENDLOG_PATH), { recursive: true });
}

function readLog() {
  try {
    const raw = fs.readFileSync(SENDLOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((ts) => typeof ts === 'string' && !Number.isNaN(Date.parse(ts)));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.warn('[quota] sendlog unreadable, treating as empty:', err.message);
    return [];
  }
}

function pruneOld(entries, now = Date.now()) {
  return entries.filter((ts) => now - Date.parse(ts) < WINDOW_MS);
}

function writeLog(entries) {
  ensureDir();
  fs.writeFileSync(SENDLOG_PATH, JSON.stringify(entries, null, 2));
}

function getUsage(now = Date.now()) {
  const entries = pruneOld(readLog(), now);
  return {
    used: entries.length,
    limit: LIMIT,
    remaining: Math.max(0, LIMIT - entries.length),
    windowMs: WINDOW_MS,
  };
}

function recordSuccess() {
  const now = Date.now();
  const entries = pruneOld(readLog(), now);
  entries.push(new Date(now).toISOString());
  writeLog(entries);
}

module.exports = { getUsage, recordSuccess, LIMIT, WINDOW_MS };