const { EventEmitter } = require('events');

const CLEANUP_MS = 5 * 60 * 1000; // keep finished jobs for 5 minutes
const jobs = new Map();

function createJob() {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const job = {
    id,
    emitter,
    createdAt: Date.now(),
    finishedAt: null,
    state: 'running', // 'running' | 'done' | 'error'
    buffer: [], // replay buffer for late subscribers
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
  // Replay everything that's already happened, then subscribe to new events.
  for (const evt of job.buffer) listener(evt);
  job.emitter.on('event', listener);
  return () => job.emitter.off('event', listener);
}

function finish(job, state) {
  job.state = state;
  job.finishedAt = Date.now();
  setTimeout(() => jobs.delete(job.id), CLEANUP_MS).unref?.();
}

function get(id) {
  return jobs.get(id) || null;
}

module.exports = { createJob, emit, subscribe, finish, get };