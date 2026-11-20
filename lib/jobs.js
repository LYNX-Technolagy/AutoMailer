const { EventEmitter } = require('events');
const crypto = require('crypto');

const CLEANUP_MS = 5 * 60 * 1000; // keep finished jobs for 5 minutes
const jobs = new Map();

function createJob() {
  const id = crypto.randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const job = {
    id,
    emitter,
    createdAt: Date.now(),
    finishedAt: null,
    state: 'running',
    buffer: [],
    resultCount: 0,
  };

  jobs.set(id, job);
  return job;
}

// Push an event to all listeners AND record it for replay.
function emit(job, type, data) {
  const evt = { type, data, at: Date.now() };
  job.buffer.push(evt);
  job.emitter.emit('event', evt);
}

function subscribe(job, listener) {
  let active = true;
  const unsubscribe = () => {
    if (!active) return;
    active = false;
    job.emitter.off('event', listener);
  };

  // Attach before replay so events emitted during replay cannot be missed.
  job.emitter.on('event', listener);
  const replay = job.buffer.slice();
  for (const evt of replay) {
    if (!active) break;
    listener(evt);
  }

  return unsubscribe;
}

function finish(job, state) {
  if (job.finishedAt) return;
  job.state = state;
  job.finishedAt = Date.now();
  setTimeout(() => jobs.delete(job.id), CLEANUP_MS).unref?.();
}

function get(id) {
  return jobs.get(id) || null;
}

module.exports = { createJob, emit, subscribe, finish, get };
