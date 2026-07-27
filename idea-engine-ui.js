/*
 * Idea Engine GUI logic — shared, Node-testable (UMD like super-focus-project-io.js).
 * Pure view helpers + small controllers with in-flight guards. The page
 * (idea-engine.html) owns DOM wiring; everything decision-shaped lives here so
 * the mini-DOM test harness can exercise it without a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IdeaEngineUI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Readable local timestamp (brief: no raw ISO in the normal UI).
  function formatTimestamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
    return d.toLocaleString(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  // One badge per idea: promotion state wins over review state.
  function promotionBadge(idea) {
    var promo = (idea && idea.promotion) || {};
    if (promo.state === 'promoted') return { label: 'Promoted', cls: 'badge-promoted' };
    if (promo.state === 'failed') return { label: 'Promotion failed', cls: 'badge-failed' };
    if (idea && idea.status === 'reviewed') return { label: 'Reviewed', cls: 'badge-reviewed' };
    return { label: 'New', cls: 'badge-new' };
  }

  // Case-insensitive title/premise search across every category (flat results).
  // Default scope: ACTIVE ideas. opts.includeRemoved extends it to removed
  // history (results carry from: 'active' | 'removed').
  function filterIdeas(categories, query, opts) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var includeRemoved = !!(opts && opts.includeRemoved);
    var out = [];
    function match(idea) {
      var hay = (String(idea.title || '') + ' ' + String(idea.premise || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    }
    (categories || []).forEach(function (category) {
      (category.ideas || []).forEach(function (idea) {
        if (match(idea)) out.push({ idea: idea, category: category, from: 'active' });
      });
      if (includeRemoved) {
        (category.removed || []).forEach(function (idea) {
          if (match(idea)) out.push({ idea: idea, category: category, from: 'removed' });
        });
      }
    });
    return out;
  }

  // Content-origin label for the detail panel.
  function originLabel(idea) {
    if (!idea) return '';
    if (idea.content_origin === 'manual') return 'Manually added';
    if (idea.content_origin === 'manually_edited') return 'Manually edited (revision ' + (idea.edit_revision || 0) + ')';
    if (idea.content_origin === 'replacement_generated') return 'Replacement-generated';
    return 'Model-generated';
  }

  // True when the Idea Engine wording has moved past what was transferred into
  // the Super Focus project at promotion time.
  function editedAfterPromotion(idea) {
    if (!idea || !idea.promotion || idea.promotion.state !== 'promoted') return false;
    if (typeof idea.promotion.promoted_revision !== 'number') return false;
    return (idea.edit_revision || 0) > idea.promotion.promoted_revision;
  }

  var REMOVAL_REASON_LABELS = {
    duplicate: 'Duplicate',
    too_broad: 'Too broad',
    too_narrow: 'Too narrow',
    weak_vidtoolz_fit: 'Weak VIDTOOLZ fit',
    poor_shorts_fit: 'Poor Shorts fit',
    already_covered: 'Already covered',
    too_tool_specific: 'Too tool-specific',
    weak_tension: 'Weak tension',
    not_visually_explainable: 'Not visually explainable',
    inaccurate: 'Inaccurate or misleading',
    superseded_by_refresh: 'Superseded by refresh',
    other: 'Other',
  };

  function summarizeJob(job) {
    if (!job) return 'No refresh has been run.';
    var total = (job.categories || []).length;
    var doneCount = (job.categories || []).filter(function (c) {
      return c.status === 'succeeded' || c.status === 'failed';
    }).length;
    if (!job.done) return 'Refreshing all categories: ' + doneCount + '/' + total + ' done (' + (job.failed || 0) + ' failed so far)…';
    if ((job.failed || 0) === 0) return 'Refresh complete: all ' + total + ' categories succeeded.';
    return 'Refresh finished: ' + (job.succeeded || 0) + ' succeeded, ' + job.failed + ' failed of ' + total + '. Failed categories keep their previous ideas.';
  }

  // Custom confirmation controller (no native confirm()). The page provides
  // elements: panel, message, confirmBtn, cancelBtn. ask() resolves true/false;
  // while a request runs the caller keeps the panel open via setBusy.
  function makeConfirmController(els) {
    var pending = null;
    function close(result) {
      if (els.panel && els.panel.classList) els.panel.classList.add('hidden');
      if (pending) { var r = pending; pending = null; r(result); }
    }
    if (els.confirmBtn) els.confirmBtn.addEventListener('click', function () { close(true); });
    if (els.cancelBtn) els.cancelBtn.addEventListener('click', function () { close(false); });
    var defaultConfirmLabel = els.confirmBtn ? els.confirmBtn.textContent : '';
    return {
      // opts.confirmLabel relabels the confirm button for this ask only (the
      // default "Replace ideas" is wrong for e.g. category removal).
      ask: function (message, opts) {
        if (pending) return Promise.resolve(false); // one confirmation at a time
        if (els.message) els.message.textContent = message;
        if (els.confirmBtn) els.confirmBtn.textContent = (opts && opts.confirmLabel) || defaultConfirmLabel;
        if (els.panel && els.panel.classList) els.panel.classList.remove('hidden');
        return new Promise(function (resolve) { pending = resolve; });
      },
      isOpen: function () { return pending !== null; },
    };
  }

  // Promotion controller: duplicate-safe on the client too — a second click on
  // the same idea while a promote request is in flight is refused locally
  // (the server holds the authoritative per-idea lock and idempotency).
  function makePromoteController(deps) {
    var pending = {};
    return {
      isPending: function (ideaId) { return pending[ideaId] === true; },
      promote: function (ideaId) {
        if (pending[ideaId]) return Promise.resolve({ ok: false, skipped: true, reason: 'already promoting' });
        pending[ideaId] = true;
        return deps.apiPost(deps.promoteApi, { idea_id: ideaId })
          .then(function (res) {
            var data = deps.unwrap(res.body);
            if (!res.ok) return { ok: false, status: res.status, error: (data && data.error) || 'Promotion failed.' };
            return { ok: true, data: data };
          })
          .catch(function (error) {
            return { ok: false, error: String((error && error.message) || 'Promotion failed.') };
          })
          .then(function (result) {
            delete pending[ideaId];
            return result;
          });
      },
    };
  }

  // Edit controller: per-idea in-flight guard; sends the loaded revision so a
  // stale tab gets a 409 conflict instead of clobbering newer content.
  function makeEditController(deps) {
    var pending = {};
    return {
      isPending: function (ideaId) { return pending[ideaId] === true; },
      save: function (ideaId, expectedRevision, fields) {
        if (pending[ideaId]) return Promise.resolve({ ok: false, skipped: true });
        pending[ideaId] = true;
        return deps.apiPost(deps.editApi, { idea_id: ideaId, expected_revision: expectedRevision, fields: fields })
          .then(function (res) {
            var data = deps.unwrap(res.body);
            if (!res.ok) return { ok: false, status: res.status, error: (data && data.error) || 'Edit failed.' };
            return { ok: true, idea: data.idea };
          })
          .catch(function (error) {
            return { ok: false, error: String((error && error.message) || 'Edit failed.') };
          })
          .then(function (result) { delete pending[ideaId]; return result; });
      },
    };
  }

  // Removal dialog controller (custom, no native confirm): shows the topic
  // title, structured reason select, optional note, and three explicit
  // actions. ask() resolves { action: 'cancel'|'remove'|'remove_replace',
  // reason, note }. One dialog at a time.
  function makeRemoveDialogController(els) {
    var pending = null;
    function close(action) {
      if (els.panel && els.panel.classList) els.panel.classList.add('hidden');
      if (pending) {
        var resolve = pending;
        pending = null;
        resolve({
          action: action,
          reason: els.reason ? String(els.reason.value || 'other') : 'other',
          note: els.note ? String(els.note.value || '') : '',
        });
      }
    }
    if (els.cancelBtn) els.cancelBtn.addEventListener('click', function () { close('cancel'); });
    if (els.removeBtn) els.removeBtn.addEventListener('click', function () { close('remove'); });
    if (els.removeReplaceBtn) els.removeReplaceBtn.addEventListener('click', function () { close('remove_replace'); });
    return {
      ask: function (title, options) {
        if (pending) return Promise.resolve({ action: 'cancel', reason: 'other', note: '' });
        if (els.title) els.title.textContent = title;
        if (els.reason) els.reason.value = 'other';
        if (els.note) els.note.value = '';
        // Promoted topics: replacement stays available, but the copy must say
        // the Super Focus project is untouched; caller controls visibility.
        if (els.removeReplaceBtn && els.removeReplaceBtn.classList) {
          els.removeReplaceBtn.classList.toggle('hidden', !!(options && options.hideReplace));
        }
        if (els.panel && els.panel.classList) els.panel.classList.remove('hidden');
        return new Promise(function (resolve) { pending = resolve; });
      },
      isOpen: function () { return pending !== null; },
    };
  }

  // Refresh-all poller: POST once, then poll refresh-status until job.done.
  // setTimeoutImpl is injectable for deterministic tests.
  function makeRefreshAllPoller(deps) {
    var timer = deps.setTimeoutImpl || function (fn, ms) { return setTimeout(fn, ms); };
    var interval = deps.intervalMs || 2500;
    var active = false;
    function poll() {
      deps.apiGet(deps.statusApi).then(function (res) {
        var data = deps.unwrap(res.body) || {};
        var job = data.job || null;
        if (deps.onUpdate) deps.onUpdate(job);
        if (job && !job.done && active) timer(poll, interval);
        else {
          active = false;
          if (deps.onDone) deps.onDone(job);
        }
      }).catch(function () {
        active = false;
        if (deps.onDone) deps.onDone(null);
      });
    }
    return {
      isActive: function () { return active; },
      start: function () {
        if (active) return Promise.resolve({ ok: false, skipped: true });
        active = true;
        return deps.apiPost(deps.refreshAllApi, { confirm: true }).then(function (res) {
          var data = deps.unwrap(res.body);
          if (!res.ok) {
            active = false;
            return { ok: false, status: res.status, error: (data && data.error) || 'Could not start the refresh.' };
          }
          timer(poll, interval);
          return { ok: true, job: data.job };
        }).catch(function (error) {
          active = false;
          return { ok: false, error: String((error && error.message) || 'Could not start the refresh.') };
        });
      },
      // Resume polling for a job that was already running when the page loaded.
      resume: function () {
        if (active) return;
        active = true;
        timer(poll, 0);
      },
    };
  }

  // ── Generation status (authoritative backend lifecycle) ───────────────────
  // Maps a /api/idea-engine/generation-status payload to a render model.
  // Pure and defensive: missing/odd fields never yield 'undefined' or
  // '[object Object]' in the GUI; unknown states render as idle-neutral.
  var GEN_STATE_META = {
    idle: { tone: 'idle', label: 'Idle' },
    starting: { tone: 'busy', label: 'Starting…' },
    running: { tone: 'busy', label: 'Generating' },
    completed: { tone: 'ok', label: '✓ Completed' },
    partial: { tone: 'warn', label: '⚠ Partially completed' },
    failed: { tone: 'err', label: '✕ Failed' },
    interrupted: { tone: 'warn', label: '⚠ Interrupted' },
  };
  var GEN_OPERATION_LABELS = {
    refresh_all: 'Refresh all categories',
    refresh_category: 'Refresh category',
    fill_vacancies: 'Fill vacancies',
    replace_one: 'Generate replacement',
  };
  function asText(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return String(value.message || value.code || '');
    return String(value);
  }
  function generationStatusView(status, nowMs) {
    var s = status && typeof status === 'object' ? status : {};
    var meta = GEN_STATE_META[s.state] || GEN_STATE_META.idle;
    var active = s.state === 'starting' || s.state === 'running';
    var parts = [];
    var op = GEN_OPERATION_LABELS[s.operation];
    if (op && s.state !== 'idle') parts.push(op);
    // Model identity, quiet but present ("with qwen3:30b"); legacy status
    // records without a model field simply omit it.
    if (typeof s.model === 'string' && s.model.trim() && s.state !== 'idle') parts.push('with ' + s.model.trim());
    if (active && isFinite(s.requested_categories) && s.requested_categories > 1) {
      var done = (Number(s.completed_categories) || 0) + (Number(s.failed_categories) || 0);
      parts.push('category ' + Math.min(done + 1, s.requested_categories) + ' of ' + s.requested_categories);
    }
    if (!active && isFinite(s.requested_categories) && s.requested_categories > 1) {
      parts.push((Number(s.completed_categories) || 0) + ' of ' + s.requested_categories + ' categories completed'
        + ((Number(s.failed_categories) || 0) > 0 ? ', ' + s.failed_categories + ' failed' : ''));
    }
    if (isFinite(s.requested_topics) && s.requested_topics > 0 && (active || (Number(s.created_topics) || 0) > 0)) {
      parts.push((Number(s.created_topics) || 0) + ' of ' + s.requested_topics + ' topics');
    }
    if (active && typeof s.started_at === 'string' && isFinite(nowMs)) {
      var mins = Math.max(0, Math.round((nowMs - Date.parse(s.started_at)) / 60000));
      if (isFinite(mins)) parts.push(mins === 0 ? 'just started' : 'started ' + mins + ' min ago');
    }
    var errText = s.state === 'failed' || s.state === 'partial' || s.state === 'interrupted' ? asText(s.last_error) : '';
    return {
      state: GEN_STATE_META[s.state] ? s.state : 'idle',
      tone: meta.tone,
      label: meta.label,
      message: asText(s.message),
      detail: parts.join(' · '),
      error: errText,
      active: active,
    };
  }

  // Polling controller for the status endpoint. The PAGE owns the timer; this
  // owns correctness: overlapping polls are skipped, stale responses cannot
  // overwrite newer ones, and a transient endpoint failure keeps the LAST
  // known status (never a false reset to idle) while counting errors so the
  // page can back off.
  function makeGenerationStatusPoller(deps) {
    var seq = 0;
    var inFlight = false;
    var errors = 0;
    var latest = null;
    function accept(status) {
      latest = status;
      deps.onUpdate(status);
    }
    return {
      latest: function () { return latest; },
      consecutiveErrors: function () { return errors; },
      seed: accept,
      poll: function () {
        if (inFlight) return Promise.resolve({ skipped: true });
        inFlight = true;
        var mySeq = ++seq;
        return deps.apiGet(deps.statusApi).then(function (res) {
          inFlight = false;
          if (mySeq !== seq) return { stale: true };
          if (!res.ok) { errors += 1; return { error: true, errors: errors }; }
          errors = 0;
          accept(deps.unwrap(res.body));
          return { status: latest };
        }).catch(function () {
          inFlight = false;
          errors += 1;
          return { error: true, errors: errors };
        });
      },
    };
  }

  // ── Category readiness (2026-07-27 contract) ─────────────────────────────
  // Renders BACKEND-derived readiness only — the browser never holds copies
  // of the 24/30 thresholds. Legacy payloads without readiness degrade to a
  // neutral, honest "unavailable" display.
  var READINESS_META = {
    full: { label: 'Complete', tone: 'ok' },
    usable_partial: { label: 'Usable partial', tone: 'warn' },
    incomplete: { label: 'Incomplete', tone: 'muted' },
    empty: { label: 'Empty', tone: 'muted' },
  };
  function categoryReadinessView(category) {
    var c = category && typeof category === 'object' ? category : {};
    var meta = READINESS_META[c.readiness];
    if (!meta || !isFinite(c.active_topic_count) || !isFinite(c.target_topics)) {
      return { known: false, state: null, tone: 'muted', label: 'Topic count unavailable', counts: '', detail: '', canFill: false, isFull: false };
    }
    var vacancies = isFinite(c.vacancies) ? c.vacancies : Math.max(0, c.target_topics - c.active_topic_count);
    var counts = c.active_topic_count + ' of ' + c.target_topics + ' validated topics';
    var detail = '';
    if (c.readiness === 'usable_partial' || c.readiness === 'incomplete') {
      detail = vacancies + ' vacanc' + (vacancies === 1 ? 'y' : 'ies') + ' remain';
    } else if (c.readiness === 'full' && isFinite(c.over_target_count) && c.over_target_count > 0) {
      detail = c.over_target_count + ' over target';
    }
    return {
      known: true,
      state: c.readiness,
      tone: meta.tone,
      label: meta.label,
      counts: counts,
      detail: detail,
      vacancies: vacancies,
      // Fill is the top-up action for anything below target; a full category
      // has nothing to fill (replacement refresh stays a separate action).
      canFill: vacancies > 0,
      isFull: c.readiness === 'full',
      isUsable: c.is_usable === true,
      // Accessible one-liner (never color-only).
      ariaText: meta.label + ': ' + counts + (detail ? ', ' + detail : ''),
    };
  }

  // Aggregate readiness line for refresh-all summaries (backend-provided).
  function readinessSummaryView(summary) {
    var s = summary && typeof summary === 'object' ? summary : null;
    if (!s || !isFinite(s.categories_total)) return '';
    return s.categories_full + ' full · ' + s.categories_usable_partial + ' usable partial · ' +
      s.categories_incomplete + ' incomplete · ' + s.categories_empty + ' empty';
  }

  return {
    categoryReadinessView: categoryReadinessView,
    readinessSummaryView: readinessSummaryView,
    generationStatusView: generationStatusView,
    makeGenerationStatusPoller: makeGenerationStatusPoller,
    formatTimestamp: formatTimestamp,
    promotionBadge: promotionBadge,
    filterIdeas: filterIdeas,
    originLabel: originLabel,
    editedAfterPromotion: editedAfterPromotion,
    REMOVAL_REASON_LABELS: REMOVAL_REASON_LABELS,
    summarizeJob: summarizeJob,
    makeConfirmController: makeConfirmController,
    makePromoteController: makePromoteController,
    makeEditController: makeEditController,
    makeRemoveDialogController: makeRemoveDialogController,
    makeRefreshAllPoller: makeRefreshAllPoller,
  };
});
