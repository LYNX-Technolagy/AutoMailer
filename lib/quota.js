const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const LIMIT = 50;

function createQuotaStore(options = {}) {
  const filePath = options.filePath || path.join(
    options.dataDir || process.env.AUTOMAILER_DATA_DIR || path.join(__dirname, '..', 'data'),
    'sendlog.json'
  );
  const windowMs = options.windowMs || WINDOW_MS;
  const limit = options.limit || LIMIT;
  const now = options.now || Date.now;

  function ensureDir() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readLog() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw new Error(`Unable to read quota log: ${err.message}`, { cause: err });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error('Quota log contains invalid JSON; refusing to reset the sending quota.', { cause: err });
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Quota log must contain a JSON array; refusing to reset the sending quota.');
    }

    for (const entry of parsed) {
      const validTimestamp = typeof entry === 'string' && !Number.isNaN(Date.parse(entry));
      const validReservation =
        entry &&
        typeof entry === 'object' &&
        entry.type === 'reservation' &&
        typeof entry.jobId === 'string' &&
        entry.jobId.length > 0 &&
        typeof entry.reservedAt === 'string' &&
        !Number.isNaN(Date.parse(entry.reservedAt));

      if (!validTimestamp && !validReservation) {
        throw new Error('Quota log contains an invalid entry; refusing to reset the sending quota.');
      }
    }

    return parsed;
  }

  function writeLog(entries) {
    ensureDir();
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw new Error(`Unable to persist quota log: ${err.message}`, { cause: err });
    }
  }

  function pruneOld(entries, timestamp = now()) {
    return entries.filter((entry) => {
      if (typeof entry === 'string') {
        return timestamp - Date.parse(entry) < windowMs;
      }
      // Reservations remain active until the job succeeds, fails, or is recovered at startup.
      return true;
    });
  }

  function usageFor(entries) {
    const used = entries.filter((entry) => typeof entry === 'string').length;
    const reserved = entries.length - used;
    return {
      used,
      reserved,
      limit,
      remaining: Math.max(0, limit - used - reserved),
      windowMs,
    };
  }

  function getUsage() {
    return usageFor(pruneOld(readLog()));
  }

  function reserve(jobId, count) {
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new TypeError('A job ID is required to reserve quota.');
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Reservation count must be a non-negative integer.');
    }

    const entries = pruneOld(readLog());
    const usage = usageFor(entries);
    if (count > usage.remaining) {
      return { ok: false, usage };
    }

    if (count > 0) {
      const reservedAt = new Date(now()).toISOString();
      for (let i = 0; i < count; i++) {
        entries.push({ type: 'reservation', jobId, reservedAt });
      }
      writeLog(entries);
    }

    return { ok: true, usage: usageFor(entries) };
  }

  function recordSuccess(jobId) {
    const entries = pruneOld(readLog());
    const index = entries.findIndex(
      (entry) => entry && entry.type === 'reservation' && entry.jobId === jobId
    );
    if (index === -1) {
      throw new Error(`No quota reservation remains for job ${jobId}.`);
    }

    entries[index] = new Date(now()).toISOString();
    writeLog(entries);
  }

  function releaseOne(jobId) {
    const entries = pruneOld(readLog());
    const index = entries.findIndex(
      (entry) => entry && entry.type === 'reservation' && entry.jobId === jobId
    );
    if (index === -1) return false;

    entries.splice(index, 1);
    writeLog(entries);
    return true;
  }

  function releaseReservations(jobId) {
    const entries = pruneOld(readLog());
    const remaining = entries.filter(
      (entry) => !(entry && entry.type === 'reservation' && entry.jobId === jobId)
    );
    const released = entries.length - remaining.length;
    if (released > 0) writeLog(remaining);
    return released;
  }

  function recoverReservations() {
    const entries = pruneOld(readLog());
    const recovered = entries.filter((entry) => entry && entry.type === 'reservation').length;
    if (recovered > 0) {
      writeLog(entries.filter((entry) => typeof entry === 'string'));
    }
    return recovered;
  }

  return {
    getUsage,
    reserve,
    recordSuccess,
    releaseOne,
    releaseReservations,
    recoverReservations,
    limit,
    windowMs,
  };
}

const defaultStore = createQuotaStore();

module.exports = {
  createQuotaStore,
  getUsage: defaultStore.getUsage,
  reserve: defaultStore.reserve,
  recordSuccess: defaultStore.recordSuccess,
  releaseOne: defaultStore.releaseOne,
  releaseReservations: defaultStore.releaseReservations,
  recoverReservations: defaultStore.recoverReservations,
  LIMIT,
  WINDOW_MS,
};
