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
    return {
      ask: function (message) {
        if (pending) return Promise.resolve(false); // one confirmation at a time
        if (els.message) els.message.textContent = message;
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

  return {
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
