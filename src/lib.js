// Gantt: pure data model. No DOM, no PluginAPI: index.html renders the result
// and test/lib.test.mjs checks it under node.
//
// Days are represented as integer "day numbers" (days since 1970-01-01 in the
// calendar, independent of time zone), so ranges and widths are plain ints.
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var BEHIND_MARGIN = 0.15; // progress this far below the time-elapsed share counts as behind

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 'YYYY-MM-DD' -> day number, or null. */
  function parseDayStr(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }

  /**
   * Timestamp (ms) -> day number of the local calendar day it falls on, shifted
   * by the app's start-of-next-day offset (a check at 01:00 with a 2h offset
   * counts for the previous day, like the app does).
   */
  function msToDayNum(ms, dayOffsetMs) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    var d = new Date(ms - (dayOffsetMs || 0));
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }

  function dayNumToStr(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Day number -> { y, m (1-12), d, dow (0=Sun) }. */
  function dayNumParts(n) {
    var d = new Date(n * DAY_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
  }

  function partsToDayNum(y, m, d) {
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  /** Planned start: dueWithTime wins over dueDay, as in the app. */
  function planStartOf(t, off) {
    if (t.dueWithTime) return msToDayNum(t.dueWithTime, 0);
    return parseDayStr(t.dueDay);
  }

  function planEndOf(t, off) {
    if (t.deadlineWithTime) return msToDayNum(t.deadlineWithTime, 0);
    return parseDayStr(t.deadlineDay);
  }

  function doneDayOf(t, off) {
    if (!t.isDone || !t.doneOn) return null;
    return msToDayNum(t.doneOn, off);
  }

  /**
   * Build the chart model.
   * @param {object} input
   *   tasks, archivedTasks: Task[] from PluginAPI
   *   projects: Project[] from PluginAPI.getAllProjects()
   *   todayStr: 'YYYY-MM-DD' (getDayContext().todayStr, or local today)
   *   dayOffsetMs: startOfNextDayDiffMs (0 if unknown)
   * @returns {{ today, groups: Group[], range: {start,end} }}
   */
  function buildModel(input) {
    var off = input.dayOffsetMs || 0;
    var today = parseDayStr(input.todayStr);
    if (today == null) today = msToDayNum(Date.now(), off);

    // Active tasks win over archived copies of the same id.
    var byId = {};
    (input.archivedTasks || []).forEach(function (t) {
      if (t && t.id) byId[t.id] = { t: t, archived: true };
    });
    (input.tasks || []).forEach(function (t) {
      if (t && t.id) byId[t.id] = { t: t, archived: false };
    });

    var childrenOf = {};
    var parents = [];
    Object.keys(byId).forEach(function (id) {
      var e = byId[id];
      if (e.t.parentId) {
        (childrenOf[e.t.parentId] = childrenOf[e.t.parentId] || []).push(e.t);
      } else {
        parents.push(e);
      }
    });

    var rowsByProject = {};
    parents.forEach(function (e) {
      var row = buildRow(e.t, e.archived, childrenOf[e.t.id] || [], today, off);
      var pid = e.t.projectId || '';
      (rowsByProject[pid] = rowsByProject[pid] || []).push(row);
    });

    var groups = [];
    var seen = {};
    (input.projects || []).forEach(function (p) {
      seen[p.id] = true;
      var rows = rowsByProject[p.id] || [];
      if (p.isArchived && !rows.length) return;
      groups.push(buildGroup(p.id, p.title, null, (p.theme && p.theme.primary) || null, !!p.isArchived, rows, orderOf(p)));
    });
    Object.keys(rowsByProject).forEach(function (pid) {
      if (seen[pid]) return;
      // Tasks without a project, or whose project is gone. The view names these.
      groups.push(buildGroup(pid || '__none__', '', pid ? 'unknown' : 'none', null, false, rowsByProject[pid], {}));
    });

    return { today: today, groups: groups, range: rangeOf(groups, today) };
  }

  function orderOf(p) {
    var o = {};
    var i = 0;
    (p.taskIds || []).concat(p.backlogTaskIds || []).forEach(function (id) {
      if (!(id in o)) o[id] = i++;
    });
    return o;
  }

  function buildRow(t, archived, subs, today, off) {
    subs = sortSubs(subs, t.subTaskIds);
    var subRows = subs.map(function (s) {
      return {
        id: s.id,
        title: s.title || '',
        isDone: !!s.isDone,
        plan: planStartOf(s, off),
        doneDay: doneDayOf(s, off),
      };
    });
    var subPlanDays = [];
    subRows.forEach(function (s) {
      if (s.plan != null) subPlanDays.push(s.plan);
    });

    // The parent's own dates win; missing ends roll up from the subtasks' planned
    // days (done ones included, so the span does not shrink as work gets done).
    var ownStart = planStartOf(t, off);
    var ownEnd = planEndOf(t, off);
    var subMin = subPlanDays.length ? Math.min.apply(null, subPlanDays) : null;
    var subMax = subPlanDays.length ? Math.max.apply(null, subPlanDays) : null;
    var ps = ownStart != null ? ownStart : subMin;
    var pe = ownEnd != null ? ownEnd : subMax;
    var plan = null;
    if (ps != null || pe != null) {
      var a = ps != null ? ps : pe;
      var b = pe != null ? pe : ps;
      plan = {
        start: Math.min(a, b),
        end: Math.max(a, b),
        hasStart: ps != null,
        hasEnd: pe != null,
        startFromSubs: ownStart == null && ps != null,
        endFromSubs: ownEnd == null && pe != null,
        reversed: ps != null && pe != null && ps > pe,
      };
    }

    var doneDays = [];
    var doneCount = 0;
    subRows.forEach(function (s) {
      if (s.isDone) doneCount++;
      if (s.doneDay != null) doneDays.push(s.doneDay);
    });
    var ownDone = doneDayOf(t, off);
    if (ownDone != null) doneDays.push(ownDone);

    var actual = null;
    if (doneDays.length) {
      actual = {
        start: Math.min.apply(null, doneDays),
        end: Math.max.apply(null, doneDays),
        days: uniq(doneDays),
      };
    }

    var total = subs.length;
    var done = doneCount;
    if (!total) {
      total = 1;
      done = t.isDone ? 1 : 0;
    }
    // A parent checked done counts as fully done even if subtasks were left open.
    var isComplete = !!t.isDone || (subs.length > 0 && doneCount === subs.length);
    var ratio = isComplete ? 1 : done / total;

    // Subtasks planned before today should be done by now.
    var dueBefore = 0;
    var overdueSubs = 0;
    subRows.forEach(function (s) {
      if (s.plan != null && s.plan < today) {
        dueBefore++;
        if (!s.isDone) overdueSubs++;
      }
    });

    var finishDay = isComplete ? (actual ? actual.end : null) : null;
    var status = 'none';
    var lateDays = 0;
    var expected = null;
    var behindBy = 0;
    if (plan && plan.hasEnd) {
      if (isComplete) {
        if (finishDay != null && finishDay > plan.end) {
          status = 'lateDone';
          lateDays = finishDay - plan.end;
        } else {
          status = 'done';
        }
      } else if (today > plan.end) {
        status = 'overdue';
        lateDays = today - plan.end;
      } else if (subPlanDays.length) {
        // Schedule from the subtasks' own days: compare done vs. due so far.
        expected = dueBefore / subs.length;
        behindBy = Math.max(0, dueBefore - doneCount);
        status = behindBy > 0 ? 'behind' : 'onTrack';
      } else if (plan.hasStart && today >= plan.start) {
        expected = (today - plan.start + 1) / (plan.end - plan.start + 1);
        status = ratio + BEHIND_MARGIN < expected ? 'behind' : 'onTrack';
      } else {
        status = 'onTrack';
      }
    } else if (isComplete) {
      status = 'done';
    }

    return {
      id: t.id,
      title: t.title || '',
      projectId: t.projectId || null,
      archived: archived,
      isDone: isComplete,
      plan: plan,
      actual: actual,
      done: subs.length ? doneCount : done,
      total: total,
      hasSubTasks: subs.length > 0,
      subs: subRows,
      dueBefore: dueBefore,
      overdueSubs: overdueSubs,
      behindBy: behindBy,
      ratio: ratio,
      expected: expected,
      status: status,
      lateDays: lateDays,
      isLate: status === 'overdue' || status === 'lateDone',
      created: t.created || 0,
    };
  }

  /** Subtasks in the parent's order (subTaskIds), unknown ones after, by creation. */
  function sortSubs(subs, order) {
    var pos = {};
    (order || []).forEach(function (id, i) {
      pos[id] = i;
    });
    return subs.slice().sort(function (a, b) {
      var pa = a.id in pos ? pos[a.id] : Infinity;
      var pb = b.id in pos ? pos[b.id] : Infinity;
      if (pa !== pb) return pa - pb;
      return (a.created || 0) - (b.created || 0);
    });
  }

  function uniq(arr) {
    var o = {};
    arr.forEach(function (x) {
      o[x] = true;
    });
    return Object.keys(o)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
  }

  function buildGroup(id, title, special, color, archived, rows, order) {
    rows.sort(function (a, b) {
      var oa = a.id in order ? order[a.id] : Infinity;
      var ob = b.id in order ? order[b.id] : Infinity;
      if (oa !== ob) return oa - ob;
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return a.created - b.created;
    });
    var plan = spanOf(rows, 'plan');
    var actual = spanOf(rows, 'actual');
    var done = 0;
    var total = 0;
    var late = 0;
    rows.forEach(function (r) {
      done += r.isDone && r.hasSubTasks ? r.total : r.done;
      total += r.total;
      if (r.isLate) late++;
    });
    return {
      id: id,
      title: title || '',
      special: special,
      color: color,
      archived: archived,
      rows: rows,
      plan: plan,
      actual: actual,
      done: done,
      total: total,
      ratio: total ? done / total : 0,
      lateCount: late,
    };
  }

  function spanOf(rows, key) {
    var s = Infinity;
    var e = -Infinity;
    rows.forEach(function (r) {
      if (!r[key]) return;
      s = Math.min(s, r[key].start);
      e = Math.max(e, r[key].end);
    });
    return s === Infinity ? null : { start: s, end: e };
  }

  /** Overall date range shown: every bar plus today, with some air. */
  function rangeOf(groups, today) {
    var s = today;
    var e = today;
    groups.forEach(function (g) {
      [g.plan, g.actual].forEach(function (sp) {
        if (!sp) return;
        s = Math.min(s, sp.start);
        e = Math.max(e, sp.end);
      });
    });
    return { start: s - 7, end: Math.max(e, today + 30) + 7 };
  }

  var api = {
    DAY_MS: DAY_MS,
    parseDayStr: parseDayStr,
    msToDayNum: msToDayNum,
    dayNumToStr: dayNumToStr,
    dayNumParts: dayNumParts,
    partsToDayNum: partsToDayNum,
    buildModel: buildModel,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GanttLib = api;
})(this);
