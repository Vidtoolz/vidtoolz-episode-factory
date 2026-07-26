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
  function filterIdeas(categories, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    (categories || []).forEach(function (category) {
      (category.ideas || []).forEach(function (idea) {
        var hay = (String(idea.title || '') + ' ' + String(idea.premise || '')).toLowerCase();
        if (hay.indexOf(q) !== -1) out.push({ idea: idea, category: category });
      });
    });
    return out;
  }

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
    summarizeJob: summarizeJob,
    makeConfirmController: makeConfirmController,
    makePromoteController: makePromoteController,
    makeRefreshAllPoller: makeRefreshAllPoller,
  };
});
