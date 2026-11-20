const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createQuotaStore } = require('../lib/quota');
const jobs = require('../lib/jobs');

function temporaryQuotaStore(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automailer-quota-'));
  const filePath = path.join(directory, 'sendlog.json');
  const store = createQuotaStore({ filePath, ...options });
  return {
    store,
    filePath,
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('quota reservations prevent concurrent jobs from oversubscribing the limit', () => {
  const fixture = temporaryQuotaStore({ limit: 50 });
  try {
    const first = fixture.store.reserve('job-a', 30);
    const second = fixture.store.reserve('job-b', 30);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(fixture.store.getUsage().reserved, 30);
    assert.equal(fixture.store.getUsage().remaining, 20);
  } finally {
    fixture.cleanup();
  }
});

test('successful sends convert reservations into rolling-window usage', () => {
  const fixture = temporaryQuotaStore({ limit: 5 });
  try {
    assert.equal(fixture.store.reserve('job-a', 3).ok, true);
    fixture.store.recordSuccess('job-a');

    assert.deepEqual(
      (({ used, reserved, remaining }) => ({ used, reserved, remaining }))(fixture.store.getUsage()),
      { used: 1, reserved: 2, remaining: 2 }
    );

    assert.equal(fixture.store.releaseReservations('job-a'), 2);
    assert.equal(fixture.store.getUsage().remaining, 4);
  } finally {
    fixture.cleanup();
  }
});

test('failed recipients release one reservation without consuming quota', () => {
  const fixture = temporaryQuotaStore({ limit: 3 });
  try {
    fixture.store.reserve('job-a', 2);
    assert.equal(fixture.store.releaseOne('job-a'), true);
    assert.equal(fixture.store.getUsage().used, 0);
    assert.equal(fixture.store.getUsage().reserved, 1);
    assert.equal(fixture.store.releaseReservations('job-a'), 1);
    assert.equal(fixture.store.getUsage().remaining, 3);
  } finally {
    fixture.cleanup();
  }
});

test('expired successful sends leave the rolling 24-hour window', () => {
  let clock = Date.UTC(2026, 0, 1);
  const fixture = temporaryQuotaStore({
    limit: 2,
    now: () => clock,
    windowMs: 1000,
  });
  try {
    fixture.store.reserve('job-a', 1);
    fixture.store.recordSuccess('job-a');
    assert.equal(fixture.store.getUsage().used, 1);

    clock += 1001;
    assert.equal(fixture.store.getUsage().used, 0);
    assert.equal(fixture.store.getUsage().remaining, 2);
  } finally {
    fixture.cleanup();
  }
});

test('startup recovery conservatively counts reservations from interrupted jobs', () => {
  const fixture = temporaryQuotaStore({ limit: 4 });
  try {
    fixture.store.reserve('interrupted-job', 3);
    const restarted = createQuotaStore({ filePath: fixture.filePath, limit: 4 });
    assert.equal(restarted.getUsage().reserved, 3);
    assert.equal(restarted.recoverReservations(), 3);

    assert.equal(restarted.getUsage().used, 3);
    assert.equal(restarted.getUsage().reserved, 0);
    assert.equal(restarted.getUsage().remaining, 1);
  } finally {
    fixture.cleanup();
  }
});

test('corrupt quota data fails closed instead of resetting the send allowance', () => {
  const fixture = temporaryQuotaStore();
  try {
    fs.writeFileSync(fixture.filePath, '{broken');
    assert.throws(() => fixture.store.getUsage(), /invalid JSON/);
  } finally {
    fixture.cleanup();
  }
});

test('job subscriptions replay buffered events and can unsubscribe cleanly', () => {
  const job = jobs.createJob();
  jobs.emit(job, 'start', { total: 1 });
  jobs.emit(job, 'done', { ok: true });

  const received = [];
  const unsubscribe = jobs.subscribe(job, (event) => received.push(event.type));

  assert.deepEqual(received, ['start', 'done']);
  assert.equal(job.emitter.listenerCount('event'), 1);

  unsubscribe();
  assert.equal(job.emitter.listenerCount('event'), 0);
});

test('job unsubscribe is idempotent', () => {
  const job = jobs.createJob();
  const unsubscribe = jobs.subscribe(job, () => {});
  unsubscribe();
  unsubscribe();
  assert.equal(job.emitter.listenerCount('event'), 0);
});
