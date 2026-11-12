import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const L = createRequire(import.meta.url)('../src/lib.js');
const D = (s) => L.parseDayStr(s);
// local-time timestamp at noon of a given day
const at = (s, h = 12) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, h).getTime();
};
const task = (o) => ({ isDone: false, subTaskIds: [], projectId: 'P', parentId: null, created: 0, ...o });
const projects = [{ id: 'P', title: 'Proj', theme: { primary: '#123456' }, taskIds: ['b', 'a'], backlogTaskIds: [] }];

test('day helpers round-trip', () => {
  assert.equal(L.dayNumToStr(D('2026-11-12')), '2026-11-12');
  assert.equal(L.msToDayNum(at('2026-03-01'), 0), D('2026-03-01'));
  // with a 4h start-of-next-day offset, 02:00 counts for the previous day
  assert.equal(L.msToDayNum(at('2026-03-01', 2), 4 * 3600e3), D('2026-02-28'));
});

test('plan from dueDay/deadlineDay, actual from subtask doneOn, progress ratio', () => {
  const m = L.buildModel({
    todayStr: '2026-11-10',
    projects,
    tasks: [
      task({ id: 'a', title: 'A', dueDay: '2026-11-01', deadlineDay: '2026-11-30' }),
      task({ id: 'a1', parentId: 'a', isDone: true, doneOn: at('2026-11-03') }),
      task({ id: 'a2', parentId: 'a', isDone: true, doneOn: at('2026-11-07') }),
      task({ id: 'a3', parentId: 'a' }),
      task({ id: 'b', title: 'B' }),
    ],
  });
  const g = m.groups[0];
  assert.deepEqual(g.rows.map((r) => r.id), ['b', 'a'], 'project task order');
  const a = g.rows[1];
  assert.deepEqual([a.plan.start, a.plan.end], [D('2026-11-01'), D('2026-11-30')]);
  assert.deepEqual([a.actual.start, a.actual.end], [D('2026-11-03'), D('2026-11-07')]);
  assert.equal(a.done, 2);
  assert.equal(a.total, 3);
  assert.equal(a.status, 'onTrack');
  assert.equal(g.rows[0].plan, null);
  assert.equal(g.rows[0].actual, null);
  assert.equal(g.rows[0].status, 'none');
});

test('dueWithTime / deadlineWithTime take priority', () => {
  const m = L.buildModel({
    todayStr: '2026-11-10',
    projects,
    tasks: [task({ id: 'a', dueWithTime: at('2026-11-02', 9), dueDay: '2026-01-01', deadlineWithTime: at('2026-11-05', 18) })],
  });
  const r = m.groups[0].rows[0];
  assert.deepEqual([r.plan.start, r.plan.end], [D('2026-11-02'), D('2026-11-05')]);
});

test('overdue, finished late, behind', () => {
  const m = L.buildModel({
    todayStr: '2026-11-20',
    projects,
    tasks: [
      task({ id: 'a', dueDay: '2026-11-01', deadlineDay: '2026-11-15' }),
      task({ id: 'b', dueDay: '2026-11-01', deadlineDay: '2026-11-10', isDone: true, doneOn: at('2026-11-13') }),
      task({ id: 'c', dueDay: '2026-11-11', deadlineDay: '2026-11-30' }),
      ...Array.from({ length: 10 }, (_, i) => task({ id: 'c' + i, parentId: 'c' })),
    ],
  });
  const by = Object.fromEntries(m.groups[0].rows.map((r) => [r.id, r]));
  assert.equal(by.a.status, 'overdue');
  assert.equal(by.a.lateDays, 5);
  assert.equal(by.b.status, 'lateDone');
  assert.equal(by.b.lateDays, 3);
  assert.deepEqual([by.b.actual.start, by.b.actual.end], [D('2026-11-13'), D('2026-11-13')]);
  assert.equal(by.c.status, 'behind'); // 10/20 days elapsed, 0/10 done
  assert.equal(m.groups[0].lateCount, 2);
});

test('only one plan date, archived tasks merged, unknown project', () => {
  const m = L.buildModel({
    todayStr: '2026-11-10',
    projects,
    tasks: [task({ id: 'a', dueDay: '2026-11-12' }), task({ id: 'z', projectId: null })],
    archivedTasks: [
      task({ id: 'old', isDone: true, doneOn: at('2026-10-02'), subTaskIds: ['old1'] }),
      task({ id: 'old1', parentId: 'old', isDone: true, doneOn: at('2026-09-20') }),
      task({ id: 'a', title: 'stale archived copy' }),
    ],
  });
  const rows = m.groups[0].rows;
  const a = rows.find((r) => r.id === 'a');
  assert.equal(a.archived, false);
  assert.equal(a.plan.hasStart, true);
  assert.equal(a.plan.hasEnd, false);
  const old = rows.find((r) => r.id === 'old');
  assert.equal(old.archived, true);
  assert.deepEqual([old.actual.start, old.actual.end], [D('2026-09-20'), D('2026-10-02')]);
  assert.equal(m.groups[1].special, 'none');
  assert.ok(m.range.start <= D('2026-09-20') - 7);
  assert.ok(m.range.end >= D('2026-11-10') + 30);
});

test('plan rolls up from subtask due days when the parent has none', () => {
  const m = L.buildModel({
    todayStr: '2026-11-20',
    projects,
    tasks: [
      task({ id: 'a', subTaskIds: ['a3', 'a1', 'a2', 'a4'] }),
      task({ id: 'a1', parentId: 'a', dueDay: '2026-11-12', isDone: true, doneOn: at('2026-11-12') }),
      task({ id: 'a2', parentId: 'a', dueDay: '2026-11-15' }),
      task({ id: 'a3', parentId: 'a', dueDay: '2026-12-14' }),
      task({ id: 'a4', parentId: 'a', dueWithTime: at('2026-11-18', 9) }),
      // own dates win over subtask dates
      task({ id: 'b', dueDay: '2026-11-01', deadlineDay: '2026-12-31' }),
      task({ id: 'b1', parentId: 'b', dueDay: '2026-11-10' }),
    ],
  });
  const by = Object.fromEntries(m.groups[0].rows.map((r) => [r.id, r]));
  const a = by.a;
  assert.deepEqual([a.plan.start, a.plan.end], [D('2026-11-12'), D('2026-12-14')]);
  assert.equal(a.plan.startFromSubs, true);
  assert.equal(a.plan.endFromSubs, true);
  assert.deepEqual(a.subs.map((s) => s.id), ['a3', 'a1', 'a2', 'a4'], 'subtask order from subTaskIds');
  // a1, a2, a4 are due before 11-20; only a1 is done
  assert.equal(a.dueBefore, 3);
  assert.equal(a.behindBy, 2);
  assert.equal(a.overdueSubs, 2);
  assert.equal(a.status, 'behind');
  assert.equal(a.expected, 3 / 4);
  assert.deepEqual([by.b.plan.start, by.b.plan.end], [D('2026-11-01'), D('2026-12-31')]);
  assert.equal(by.b.plan.startFromSubs, false);
  // project summary spans the rolled-up plans
  assert.deepEqual([m.groups[0].plan.start, m.groups[0].plan.end], [D('2026-11-01'), D('2026-12-31')]);
});

test('on track when every subtask due before today is done; overdue past the rolled-up end', () => {
  const m = L.buildModel({
    todayStr: '2026-11-14',
    projects,
    tasks: [
      task({ id: 'a' }),
      task({ id: 'a1', parentId: 'a', dueDay: '2026-11-12', isDone: true, doneOn: at('2026-11-12') }),
      task({ id: 'a2', parentId: 'a', dueDay: '2026-11-14' }),
      task({ id: 'b' }),
      task({ id: 'b1', parentId: 'b', dueDay: '2026-11-10' }),
    ],
  });
  const by = Object.fromEntries(m.groups[0].rows.map((r) => [r.id, r]));
  assert.equal(by.a.status, 'onTrack');
  assert.equal(by.b.status, 'overdue');
  assert.equal(by.b.lateDays, 4);
});
