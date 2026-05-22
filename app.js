(function episodeFactoryApp() {
  "use strict";

  const model = window.EpisodeFactoryModel;
  const storage = window.EpisodeFactoryStorage;
  const state = storage.loadState();
  const EPISODE_FACTORY_VIEW_MODE_KEY = "vidtoolz-episode-factory-view-mode-v1";
  let activeSession = storage.loadActiveSession();
  let backupStatus = storage.loadBackupStatus();
  let pendingImport = null;
  let viewMode = "focused";

  const els = {
    workspace: document.querySelector(".workspace"),
    episodeFocusPanel: document.querySelector("#episodeFocusPanel"),
    board: document.querySelector("#board"),
    count: document.querySelector("#episodeCount"),
    form: document.querySelector("#episodeForm"),
    empty: document.querySelector("#emptyState"),
    fields: document.querySelector("#fieldGrid"),
    status: document.querySelector("#statusSelect"),
    boardFilters: document.querySelector("#boardFilters"),
    weeklyDashboard: document.querySelector("#weeklyDashboard"),
    weeklyCopyStatus: document.querySelector("#weeklyCopyStatus"),
    queue: document.querySelector("#executionQueue"),
    nextWorkBlock: document.querySelector("#nextWorkBlock"),
    activeSessionPanel: document.querySelector("#activeSessionPanel"),
    completionDrawer: document.querySelector("#completionDrawer"),
    taskCopyStatus: document.querySelector("#taskCopyStatus"),
    sessions: document.querySelector("#workSessions"),
    workBlocks: document.querySelector("#workBlocks"),
    workBlockForm: document.querySelector("#workBlockForm"),
    planWorkBlocksBtn: document.querySelector("#planWorkBlocksBtn"),
    checklists: document.querySelector("#checklistGroups"),
    readinessGrid: document.querySelector("#readinessGrid"),
    readinessSummary: document.querySelector("#readinessSummary"),
    search: document.querySelector("#searchInput"),
    copyStatus: document.querySelector("#copyStatus"),
    importExportStatus: document.querySelector("#importExportStatus"),
    importPreviewPanel: document.querySelector("#importPreviewPanel"),
    importInput: document.querySelector("#importJsonInput"),
    appStatus: document.querySelector("#appStatus"),
    appVersion: document.querySelector("#appVersion"),
  };

  const boardFilters = [
    { key: "all", label: "All" },
    { key: "packagingBlocked", label: "Packaging blocked" },
    { key: "readyToShoot", label: "Ready to shoot" },
    { key: "readyToPublish", label: "Ready to publish" },
    { key: "published", label: "Published" },
  ];
  let activeFilter = "all";
  let activeCompletionTaskId = "";
  let completionTaskOverride = null;
  let editingSessionId = "";

  els.appVersion.textContent = `v${model.APP_VERSION}`;

  function normalizeViewMode(mode) {
    return mode === "full" ? "full" : "focused";
  }

  function readViewMode() {
    try {
      return normalizeViewMode(window.localStorage && window.localStorage.getItem(EPISODE_FACTORY_VIEW_MODE_KEY));
    } catch (_error) {
      return "focused";
    }
  }

  function saveViewMode(mode) {
    const normalized = normalizeViewMode(mode);
    try {
      if (window.localStorage) window.localStorage.setItem(EPISODE_FACTORY_VIEW_MODE_KEY, normalized);
    } catch (_error) {
      return normalized;
    }
    return normalized;
  }

  function setViewMode(mode, options = {}) {
    viewMode = normalizeViewMode(mode);
    if (options.persist !== false) saveViewMode(viewMode);
    if (els.workspace) els.workspace.dataset.viewMode = viewMode;
    document.body.dataset.episodeViewMode = viewMode;
    document.querySelectorAll("[data-view-mode-button]").forEach((button) => {
      const active = button.dataset.viewModeButton === viewMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  if (!state.episodes.length) {
    const starter = model.createEpisode({
      topic: "A practical VIDTOOLZ workflow idea",
      workingTitle: "How to turn a rough idea into a shoot-ready YouTube episode",
      targetViewer: "Solo YouTube creator",
      viewerProblem: "They have ideas but lose momentum before packaging, scripting, and publishing.",
      corePromise: "A compact workflow for turning one idea into a complete production package.",
      titleOptions: "- Stop Losing Video Ideas Before You Shoot\n- My Solo Creator Episode Factory\n- Turn Any Idea Into a Publish-Ready Video",
      thumbnailConcept: "Split screen: messy idea notes on the left, clean episode package on the right.",
      hook: "Your idea is not the bottleneck. The missing production package is.",
      notes: "Starter episode. Edit or duplicate it.",
    });
    state.episodes.push(starter);
    state.selectedId = starter.id;
    persist();
  }

  function persist() {
    storage.saveState(state);
  }

  function persistActiveSession() {
    storage.saveActiveSession(activeSession);
  }

  function currentEpisode() {
    return state.episodes.find((episode) => episode.id === state.selectedId) || null;
  }

  function updateEpisode(id, patch, renderMode = "all") {
    const index = state.episodes.findIndex((episode) => episode.id === id);
    if (index < 0) return;
    state.episodes[index] = model.normalizeEpisode({
      ...state.episodes[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    persist();
    showBackupRecommendation();
    if (renderMode === "board") {
      renderBoard();
      renderQueue();
      renderWeeklyDashboard();
      renderEpisodeFocusPanel();
    } else if (renderMode === "checklists") {
      renderBoard();
      renderQueue();
      renderWeeklyDashboard();
      renderReadiness(state.episodes[index]);
      renderChecklists(state.episodes[index]);
      renderEpisodeFocusPanel();
    } else if (renderMode === "workBlocks") {
      renderBoard();
      renderQueue();
      renderWeeklyDashboard();
      renderWorkBlocks(state.episodes[index]);
      renderEpisodeFocusPanel();
    } else {
      render();
    }
  }

  function matchesSearch(episode) {
    const query = els.search.value.trim().toLowerCase();
    if (!query) return true;
    return model.FIELD_DEFINITIONS.some((field) =>
      String(episode[field.key] || "").toLowerCase().includes(query)
    );
  }

  function matchesFilter(episode) {
    const scores = model.getReadinessScores(episode);
    if (activeFilter === "packagingBlocked") return scores.packaging < 100;
    if (activeFilter === "readyToShoot") return scores.packaging === 100 && scores.script === 100;
    if (activeFilter === "readyToPublish") return episode.status === "Ready to Publish" || scores.publish === 100;
    if (activeFilter === "published") return episode.status === "Published";
    return true;
  }

  function visibleEpisodes() {
    return state.episodes.filter((episode) => matchesSearch(episode) && matchesFilter(episode));
  }

  function renderBoard() {
    const visible = visibleEpisodes();
    els.count.textContent = `${visible.length} shown / ${state.episodes.length} total`;
    els.board.innerHTML = "";
    renderFilters();

    model.STATUSES.forEach((status) => {
      const column = document.createElement("article");
      column.className = "status-column";
      const episodes = visible.filter((episode) => episode.status === status);
      column.innerHTML = `
        <div class="column-heading">
          <h3>${status}</h3>
          <span>${episodes.length}</span>
        </div>
      `;

      const list = document.createElement("div");
      list.className = "episode-list";
      episodes.forEach((episode) => {
        const scores = model.getReadinessScores(episode);
        const card = document.createElement("button");
        card.type = "button";
        card.className = episode.id === state.selectedId ? "episode-card selected" : "episode-card";
        card.dataset.id = episode.id;
        card.innerHTML = `
          <strong>${escapeHtml(episode.workingTitle || "Untitled episode")}</strong>
          <span>${escapeHtml(episode.topic || "No topic yet")}</span>
          <small>Overall ${scores.overall}%</small>
          <div class="mini-readiness" aria-label="Readiness summary">
            <span>P ${scores.packaging}%</span>
            <span>S ${scores.script}%</span>
            <span>Prod ${scores.production}%</span>
            <span>Pub ${scores.publish}%</span>
          </div>
        `;
        list.append(card);
      });
      column.append(list);
      els.board.append(column);
    });
  }

  function renderQueue() {
    const tasks = model.buildExecutionQueue(state.episodes);
    els.queue.innerHTML = "";
    if (!tasks.length) {
      els.queue.innerHTML = `<p class="muted">No active blocker tasks. Pick an episode or create the next idea.</p>`;
      renderNextWorkBlock();
      renderActiveSessionPanel();
      renderCompletionDrawer();
      return;
    }

    tasks.slice(0, 8).forEach((task) => {
      const item = document.createElement("article");
      item.className = "queue-item";
      item.innerHTML = `
        <div class="queue-main">
          <button class="queue-title" type="button" data-select-episode="${escapeHtml(task.episodeId)}">${escapeHtml(task.taskTitle)}</button>
          <span>${escapeHtml(task.episodeTitle)} · ${task.estimatedMinutes} min</span>
          <small>${escapeHtml(task.reason)}</small>
          <small>Blocker: ${escapeHtml(task.sourceBlocker)}</small>
        </div>
        <div class="queue-actions">
          <button type="button" data-task-copy="human" data-task-id="${escapeHtml(task.id)}">Human</button>
          <button type="button" data-task-copy="hermes" data-task-id="${escapeHtml(task.id)}">Hermes</button>
          <button type="button" data-task-copy="linear" data-task-id="${escapeHtml(task.id)}">Linear</button>
          <button type="button" data-task-copy="codex" data-task-id="${escapeHtml(task.id)}">Codex</button>
          <button type="button" data-task-start="${escapeHtml(task.id)}">Start Session</button>
          <button type="button" data-task-complete="${escapeHtml(task.id)}">Complete</button>
        </div>
      `;
      els.queue.append(item);
    });
    renderNextWorkBlock();
    renderActiveSessionPanel();
    renderCompletionDrawer();
  }

  function listMarkup(items) {
    return items && items.length
      ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : "<li>None recorded.</li>";
  }

  function compactList(items, emptyText = "None reported.") {
    const normalized = (items || []).filter(Boolean).slice(0, 4);
    return normalized.length
      ? normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : `<li>${escapeHtml(emptyText)}</li>`;
  }

  function buildEpisodeFocusModel() {
    const episode = currentEpisode();
    const selectedTask = episode ? model.generateNextActionTask(episode) : null;
    const queueTask = model.buildExecutionQueue(state.episodes)[0] || null;
    const nextTask = selectedTask || queueTask;
    const nextBlock = model.buildWorkBlockQueue(state.episodes)[0] || null;
    const session = model.normalizeActiveSession(activeSession);
    const backupHealth = model.getBackupHealth(backupStatus);
    const scores = episode ? model.getReadinessScores(episode) : null;
    const checklistSummaries = episode ? model.getChecklistSummaries(episode) : [];
    const weakChecklist = checklistSummaries
      .filter((summary) => summary.passed < summary.total)
      .slice(0, 3)
      .map((summary) => `${summary.label}: ${summary.passed}/${summary.total}`);
    const blockers = [];
    if (nextTask && nextTask.sourceBlocker) blockers.push(nextTask.sourceBlocker);
    if (nextBlock && nextBlock.status !== "done") blockers.push(`Work block: ${nextBlock.objective}`);
    if (backupHealth.needsExport) blockers.push(`Backup: ${backupHealth.recommendation || backupHealth.label}`);
    const whatNow = session
      ? `${session.isRunning ? "Continue" : "Resume"} the active focus session: ${session.task.taskTitle}.`
      : nextBlock
        ? `Work the next 30-minute block: ${nextBlock.objective}.`
        : nextTask
          ? nextTask.taskTitle
          : "Pick one episode and define the next practical action.";
    return {
      episode,
      nextTask,
      nextBlock,
      session,
      backupHealth,
      scores,
      weakChecklist,
      blockers,
      whatNow,
    };
  }

  function renderEpisodeFocusPanel() {
    if (!els.episodeFocusPanel) return;
    const focus = buildEpisodeFocusModel();
    const episodeTitle = focus.episode ? focus.episode.workingTitle || "Untitled episode" : "No episode selected";
    const episodeStatus = focus.episode ? focus.episode.status || "No status" : "Select or create an episode";
    const nextAction = focus.nextTask
      ? `${focus.nextTask.taskTitle} (${focus.nextTask.estimatedMinutes} min)`
      : "No generated next action available.";
    const activeText = focus.session
      ? `${focus.session.isRunning ? "Running" : "Paused"}: ${focus.session.task.taskTitle}`
      : "No active focus session.";
    const blockText = focus.nextBlock
      ? `${focus.nextBlock.objective} (${focus.nextBlock.estimatedMinutes} min)`
      : "No open work block.";
    const readinessText = focus.scores
      ? `Overall ${focus.scores.overall}% · packaging ${focus.scores.packaging}% · script ${focus.scores.script}% · production ${focus.scores.production}% · publish ${focus.scores.publish}%`
      : "No readiness summary until an episode is selected.";

    els.episodeFocusPanel.innerHTML = `
      <div class="episode-focus-header">
        <div>
          <p class="eyebrow">Creator Work Focus</p>
          <h2>${escapeHtml(episodeTitle)}</h2>
          <p class="muted">${escapeHtml(episodeStatus)}</p>
        </div>
        <span class="lifecycle-badge">Read-only summary</span>
      </div>
      <div class="episode-focus-grid">
        <section class="episode-focus-card episode-focus-now" aria-label="What to do now">
          <span>What to do now</span>
          <strong>${escapeHtml(focus.whatNow)}</strong>
          <p>${escapeHtml(nextAction)}</p>
        </section>
        <section class="episode-focus-card" aria-label="Active session">
          <span>Active session</span>
          <strong>${escapeHtml(activeText)}</strong>
        </section>
        <section class="episode-focus-card" aria-label="Next work block">
          <span>Next work block</span>
          <strong>${escapeHtml(blockText)}</strong>
        </section>
        <section class="episode-focus-card" aria-label="Readiness summary">
          <span>Readiness summary</span>
          <strong>${escapeHtml(readinessText)}</strong>
          <ul>${compactList(focus.weakChecklist, "Checklist summary is clear for the selected episode.")}</ul>
        </section>
        <section class="episode-focus-card episode-focus-blockers" aria-label="Blockers and warnings">
          <span>Blockers / warnings</span>
          <ul>${compactList(focus.blockers, "No current blocker reported by the focused summary.")}</ul>
        </section>
      </div>
    `;
  }

  function renderNextWorkBlock() {
    const block = model.buildWorkBlockQueue(state.episodes)[0];
    els.nextWorkBlock.innerHTML = "";
    if (!block) {
      els.nextWorkBlock.innerHTML = `<p class="muted">No open work blocks. Plan starter blocks on an episode or add one in the detail view.</p>`;
      return;
    }
    els.nextWorkBlock.innerHTML = `
      <article class="work-block-card next-block-card">
        <div class="section-heading">
          <div>
            <h2>Next 30-Minute Work Block</h2>
            <p class="muted">${escapeHtml(block.episodeTitle)} · ${escapeHtml(block.category)} · ${block.estimatedMinutes} min</p>
          </div>
          <span class="status-pill">${escapeHtml(block.status)}</span>
        </div>
        <h3>${escapeHtml(block.objective || "Untitled work block")}</h3>
        <div class="work-block-grid">
          <div>
            <h4>Inputs</h4>
            <ul>${listMarkup(block.inputsNeeded)}</ul>
          </div>
          <div>
            <h4>Steps</h4>
            <ul>${listMarkup(block.steps)}</ul>
          </div>
        </div>
        <p><strong>Done:</strong> ${escapeHtml(block.doneCondition || "No done condition recorded.")}</p>
        <div class="queue-actions">
          <button type="button" data-block-open="${escapeHtml(block.episodeId)}">Open Episode</button>
          <button type="button" data-block-start="${escapeHtml(block.id)}">Start</button>
          <button class="primary-btn" type="button" data-block-done="${escapeHtml(block.id)}">Done</button>
          <button type="button" data-block-skip="${escapeHtml(block.id)}">Skip</button>
        </div>
      </article>
    `;
  }

  function formatSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderActiveSessionPanel() {
    const session = model.normalizeActiveSession(activeSession);
    els.activeSessionPanel.innerHTML = "";
    if (!session) {
      els.activeSessionPanel.innerHTML = `<p class="muted">No active focus session.</p>`;
      return;
    }

    const elapsed = model.getActiveSessionElapsedSeconds(session);
    const progress = model.getActiveSessionProgressPercent(session);
    const checklistMarkup = session.task.relevantChecklistItems.length
      ? session.task.relevantChecklistItems
          .map((item) => `<li>${escapeHtml(item.groupLabel)}: ${escapeHtml(item.item)}</li>`)
          .join("")
      : "<li>No task-specific checklist items.</li>";
    const controls = session.isRunning
      ? `
          <button type="button" data-active-control="pause">Pause</button>
          <button type="button" data-active-control="reset">Reset</button>
          <button class="primary-btn" type="button" data-active-control="complete">Complete Session</button>
          <button type="button" data-active-control="abandon">Abandon Session</button>
        `
      : `
          <button type="button" data-active-control="resume">Resume</button>
          <button type="button" data-active-control="reset">Reset</button>
          <button class="primary-btn" type="button" data-active-control="complete">Complete Session</button>
          <button type="button" data-active-control="abandon">Abandon Session</button>
        `;
    els.activeSessionPanel.innerHTML = `
      <article class="active-session-card">
        <div class="section-heading">
          <div>
            <h2>Active Session</h2>
            <p class="muted">${escapeHtml(session.task.episodeTitle)} · ${escapeHtml(session.task.type)}</p>
          </div>
          <strong class="timer-readout">${formatSeconds(elapsed)}</strong>
        </div>
        <h3>${escapeHtml(session.task.taskTitle)}</h3>
        <p>${escapeHtml(session.task.reason)}</p>
        <p class="muted">Estimate: ${session.task.estimatedMinutes} min · Source: ${escapeHtml(session.task.sourceBlocker)}</p>
        <div class="active-progress" aria-label="Active session progress">
          <div class="active-progress-meta">
            <span>${progress}% of estimate</span>
            <span>${formatSeconds(elapsed)} / ${session.task.estimatedMinutes} min</span>
          </div>
          <div class="active-progress-bar"><span style="width: ${progress}%"></span></div>
        </div>
        <div class="active-session-grid">
          <div>
            <h3>Steps</h3>
            <ul>${session.task.concreteSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
          </div>
          <div>
            <h3>Success Criteria</h3>
            <ul>${session.task.successCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </div>
          <div>
            <h3>Relevant Checklist Items</h3>
            <ul>${checklistMarkup}</ul>
          </div>
        </div>
        <div class="queue-actions">
          ${controls}
        </div>
      </article>
    `;
  }

  function renderCompletionDrawer() {
    const task =
      completionTaskOverride ||
      model.buildExecutionQueue(state.episodes).find((item) => item.id === activeCompletionTaskId);
    els.completionDrawer.classList.toggle("hidden", !task);
    els.completionDrawer.innerHTML = "";
    if (!task) return;

    const checklistMarkup = task.relevantChecklistItems.length
      ? task.relevantChecklistItems
          .map(
            (item, index) => `
              <label class="completion-check">
                <input type="checkbox" name="completedChecklistItems" value="${index}" />
                <span>${escapeHtml(item.groupLabel)}: ${escapeHtml(item.item)}</span>
              </label>
            `
          )
          .join("")
      : `<p class="muted">No checklist items are tied to this task.</p>`;

    const actualMinutes = completionTaskOverride
      ? Math.ceil(model.getActiveSessionElapsedSeconds(activeSession) / 60)
      : task.estimatedMinutes;
    els.completionDrawer.innerHTML = `
      <form id="completionForm" class="completion-form">
        <div class="section-heading">
          <div>
            <h2>Complete Task</h2>
            <p class="muted">${escapeHtml(task.taskTitle)} · ${escapeHtml(task.episodeTitle)}</p>
          </div>
        </div>
        <div class="completion-grid">
          <label class="field">
            <span>Actual minutes</span>
            <input name="actualMinutes" type="number" min="0" value="${actualMinutes}" required />
          </label>
          <label class="field span-2">
            <span>What was completed</span>
            <textarea name="result" rows="3" required></textarea>
          </label>
          <label class="field span-2">
            <span>What is still blocked</span>
            <textarea name="blocked" rows="3"></textarea>
          </label>
          <label class="field span-2">
            <span>Notes</span>
            <textarea name="notes" rows="3"></textarea>
          </label>
          <label class="field span-2">
            <span>Next action</span>
            <textarea name="nextActionAfterSession" rows="3"></textarea>
          </label>
        </div>
        <div class="completion-checks">
          <h3>Mark completed checklist items</h3>
          ${checklistMarkup}
        </div>
        <p id="completionError" class="form-error"></p>
        <div class="detail-actions">
          <button type="submit" class="primary-btn">Save session</button>
          <button type="button" data-completion-cancel>Cancel</button>
        </div>
      </form>
    `;
  }

  function renderFilters() {
    els.boardFilters.innerHTML = "";
    boardFilters.forEach((filter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = filter.key === activeFilter ? "filter-chip active" : "filter-chip";
      button.dataset.filter = filter.key;
      button.textContent = filter.label;
      els.boardFilters.append(button);
    });
  }

  function renderForm() {
    const episode = currentEpisode();
    els.form.classList.toggle("hidden", !episode);
    els.empty.classList.toggle("hidden", Boolean(episode));
    if (!episode) return;

    els.status.innerHTML = model.STATUSES.map(
      (status) => `<option value="${status}" ${episode.status === status ? "selected" : ""}>${status}</option>`
    ).join("");

    els.fields.innerHTML = "";
    model.FIELD_DEFINITIONS.forEach((field) => {
      const wrapper = document.createElement("label");
      wrapper.className = field.type === "textarea" ? "field span-2" : "field";
      const value = episode[field.key] || "";
      wrapper.innerHTML =
        field.type === "textarea"
          ? `<span>${field.label}</span><textarea name="${field.key}" rows="5">${escapeHtml(value)}</textarea>`
          : `<span>${field.label}</span><input name="${field.key}" value="${escapeHtml(value)}" />`;
      els.fields.append(wrapper);
    });

    renderReadiness(episode);
    renderSessions(episode);
    renderWorkBlocks(episode);
    renderChecklists(episode);
  }

  function renderReadiness(episode) {
    const scores = model.getReadinessScores(episode);
    els.readinessSummary.textContent = `Overall readiness ${scores.overall}%`;
    els.readinessGrid.innerHTML = "";
    [
      ["Packaging", scores.packaging],
      ["Script", scores.script],
      ["Production", scores.production],
      ["Publish", scores.publish],
      ["Overall", scores.overall],
    ].forEach(([label, score]) => {
      const item = document.createElement("div");
      item.className = "readiness-item";
      item.innerHTML = `
        <span>${label}</span>
        <strong>${score}%</strong>
        <div class="readiness-bar"><span style="width: ${score}%"></span></div>
      `;
      els.readinessGrid.append(item);
    });
  }

  function renderChecklists(episode) {
    const summaries = model.getChecklistSummaries(episode);
    els.checklists.innerHTML = "";
    summaries.forEach((summary) => {
      const group = document.createElement("section");
      group.className = "checklist-group";
      group.innerHTML = `
        <div class="checklist-heading">
          <h3>${escapeHtml(summary.label)}</h3>
          <span>${summary.passed}/${summary.total}</span>
        </div>
      `;

      const list = document.createElement("div");
      list.className = "gate-list";
      summary.items.forEach((item) => {
        const id = `checklist-${summary.key}-${slugify(item.label)}`;
        const label = document.createElement("label");
        label.className = item.passed ? "gate-item passed" : "gate-item";
        label.innerHTML = `
          <input id="${id}" type="checkbox" data-checklist="${escapeHtml(summary.key)}" data-item="${escapeHtml(item.label)}" ${item.passed ? "checked" : ""} />
          <span>${escapeHtml(item.label)}</span>
        `;
        list.append(label);
      });
      group.append(list);
      els.checklists.append(group);
    });
  }

  function renderSessions(episode) {
    const sessions = (episode.workSessions || []).slice(0, 5);
    els.sessions.innerHTML = "";
    if (!sessions.length) {
      els.sessions.innerHTML = `<p class="muted">No completed work sessions yet.</p>`;
      return;
    }

    sessions.forEach((session) => {
      if (session.id === editingSessionId) {
        const editItem = document.createElement("article");
        editItem.className = "session-item";
        editItem.innerHTML = `
          <form class="session-edit-form" data-session-edit-form="${escapeHtml(session.id)}">
            <div class="completion-grid">
              <label class="field">
                <span>Actual minutes</span>
                <input name="actualMinutes" type="number" min="0" value="${session.actualMinutes}" required />
              </label>
              <label class="field span-2">
                <span>What was completed</span>
                <textarea name="result" rows="3" required>${escapeHtml(session.result)}</textarea>
              </label>
              <label class="field span-2">
                <span>Notes / blockers</span>
                <textarea name="notes" rows="3">${escapeHtml(session.notes)}</textarea>
              </label>
              <label class="field span-2">
                <span>Next action</span>
                <textarea name="nextActionAfterSession" rows="3">${escapeHtml(session.nextActionAfterSession)}</textarea>
              </label>
            </div>
            <div class="detail-actions">
              <button class="primary-btn" type="submit">Save edits</button>
              <button type="button" data-session-edit-cancel>Cancel</button>
            </div>
          </form>
        `;
        els.sessions.append(editItem);
        return;
      }
      const item = document.createElement("article");
      item.className = "session-item";
      item.innerHTML = `
        <div class="session-main">
          <h3>${escapeHtml(session.taskTitle)}</h3>
          <span>${escapeHtml(session.createdAt)} · ${session.actualMinutes}/${session.estimatedMinutes} min</span>
          <p>${escapeHtml(session.result || "No result recorded.")}</p>
          <small>Next: ${escapeHtml(session.nextActionAfterSession || "None recorded.")}</small>
        </div>
        <div class="queue-actions">
          <button type="button" data-session-copy="hermes" data-session-id="${escapeHtml(session.id)}">Hermes</button>
          <button type="button" data-session-copy="linear" data-session-id="${escapeHtml(session.id)}">Linear</button>
          <button type="button" data-session-copy="codex" data-session-id="${escapeHtml(session.id)}">Codex</button>
          <button type="button" data-session-copy="history" data-session-id="${escapeHtml(session.id)}">History</button>
          <button type="button" data-session-resume="${escapeHtml(session.id)}">Resume blocker</button>
          <button type="button" data-session-repeat="${escapeHtml(session.id)}">Repeat task</button>
          <button type="button" data-session-edit="${escapeHtml(session.id)}">Edit</button>
          <button type="button" data-session-delete="${escapeHtml(session.id)}">Delete</button>
        </div>
      `;
      els.sessions.append(item);
    });
  }

  function renderWorkBlocks(episode) {
    const blocks = model.normalizeWorkBlocks(episode.workBlocks, episode.id);
    els.workBlocks.innerHTML = "";
    if (!blocks.length) {
      els.workBlocks.innerHTML = `<p class="muted">No work blocks yet. Plan starter blocks or add one custom block.</p>`;
      return;
    }

    blocks.forEach((block) => {
      const item = document.createElement("article");
      item.className = `work-block-card ${block.status}`;
      item.innerHTML = `
        <div class="work-block-heading">
          <div>
            <h3>${escapeHtml(block.objective || "Untitled work block")}</h3>
            <span>${escapeHtml(block.category)} · ${escapeHtml(block.status)} · ${block.estimatedMinutes} min</span>
          </div>
          <span class="status-pill">${escapeHtml(block.status)}</span>
        </div>
        <div class="work-block-grid">
          <div>
            <h4>Inputs</h4>
            <ul>${listMarkup(block.inputsNeeded)}</ul>
          </div>
          <div>
            <h4>Steps</h4>
            <ul>${listMarkup(block.steps)}</ul>
          </div>
        </div>
        <p><strong>Done:</strong> ${escapeHtml(block.doneCondition || "No done condition recorded.")}</p>
        <p class="muted">Created: ${escapeHtml(formatOptionalTimestamp(block.createdAt))}${block.completedAt ? ` · Completed: ${escapeHtml(formatOptionalTimestamp(block.completedAt))}` : ""}</p>
        <label class="field">
          <span>Notes</span>
          <textarea data-block-notes="${escapeHtml(block.id)}" rows="2">${escapeHtml(block.notes)}</textarea>
        </label>
        <div class="queue-actions">
          <button type="button" data-block-start="${escapeHtml(block.id)}">Start</button>
          <button class="primary-btn" type="button" data-block-done="${escapeHtml(block.id)}">Done</button>
          <button type="button" data-block-skip="${escapeHtml(block.id)}">Skip</button>
        </div>
      `;
      els.workBlocks.append(item);
    });
  }

  function parseLines(value) {
    return String(value || "")
      .split("\n")
      .map((line) => line.replace(/^[-*0-9.\s]+/, "").trim())
      .filter(Boolean);
  }

  function replaceEpisodeInState(episode) {
    const index = state.episodes.findIndex((item) => item.id === episode.id);
    if (index < 0) return;
    state.episodes[index] = model.normalizeEpisode(episode);
    persist();
    showBackupRecommendation();
    render();
  }

  function findBlockContext(blockId) {
    return model.findWorkBlock(state.episodes, blockId);
  }

  function updateBlockStatus(blockId, action) {
    const context = findBlockContext(blockId);
    if (!context) return;
    const block = context.block;
    let updated;
    if (action === "start") {
      updated = model.startWorkBlock(context.episode, blockId);
    } else if (action === "done") {
      updated = model.completeWorkBlock(context.episode, blockId, block.notes);
    } else if (action === "skip") {
      updated = model.skipWorkBlock(context.episode, blockId, block.notes);
    }
    if (updated) replaceEpisodeInState(updated);
  }

  function updateBlockNotes(blockId, notes) {
    const context = findBlockContext(blockId);
    if (!context) return;
    replaceEpisodeInState(model.updateWorkBlock(context.episode, blockId, { notes }));
  }

  function formControlValue(container, name) {
    const control = container.querySelector(`[name="${name}"]`);
    return control ? control.value : "";
  }

  function addCustomWorkBlock(container) {
    const episode = currentEpisode();
    if (!episode) return;
    const objective = formControlValue(container, "objective").trim();
    if (!objective) return;
    const updated = model.addWorkBlock(episode, {
      category: formControlValue(container, "category") || "close-loop",
      objective,
      inputsNeeded: parseLines(formControlValue(container, "inputsNeeded")),
      steps: parseLines(formControlValue(container, "steps")),
      doneCondition: formControlValue(container, "doneCondition").trim(),
    });
    container.querySelectorAll("input, textarea").forEach((control) => {
      control.value = "";
    });
    const category = container.querySelector('[name="category"]');
    if (category) category.value = "publish";
    replaceEpisodeInState(updated);
  }

  function planStarterBlocksForCurrentEpisode() {
    const episode = currentEpisode();
    if (!episode) return;
    replaceEpisodeInState(model.addStarterWorkBlocks(episode));
  }

  function render() {
    renderAppStatus();
    renderWeeklyDashboard();
    renderQueue();
    renderBoard();
    renderForm();
    renderEpisodeFocusPanel();
    setViewMode(viewMode, { persist: false });
  }

  function renderWeeklyDashboard() {
    const review = model.buildWeeklyReview(state);
    const counts = model.STATUSES.map(
      (status) => `
        <div class="pipeline-count">
          <span>${escapeHtml(status)}</span>
          <strong>${review.pipelineCounts[status] || 0}</strong>
        </div>
      `
    ).join("");
    const blockers = review.blockedEpisodes.slice(0, 4).map(
      (episode) => `
        <li>
          <button class="inline-link" type="button" data-weekly-select="${escapeHtml(episode.id)}">${escapeHtml(episode.title)}</button>
          <span>${episode.blockers.map((blocker) => `${blocker.type} ${blocker.score}%`).join(", ")}</span>
        </li>
      `
    ).join("");
    const publish = review.closestToPublish.slice(0, 4).map(
      (episode) => `
        <li>
          <button class="inline-link" type="button" data-weekly-select="${escapeHtml(episode.id)}">${escapeHtml(episode.title)}</button>
          <span>${escapeHtml(episode.status)} · publish ${episode.scores.publish}% · overall ${episode.scores.overall}%</span>
        </li>
      `
    ).join("");
    const task = review.recommendedNextFocusSession;
    els.weeklyDashboard.innerHTML = `
      <div class="weekly-metrics">
        <div><span>Sessions</span><strong>${review.weeklySummary.completedSessions}</strong></div>
        <div><span>Focused minutes</span><strong>${review.weeklySummary.totalFocusedMinutes}</strong></div>
        <div><span>Episodes touched</span><strong>${review.weeklySummary.episodesTouched}</strong></div>
        <div><span>Most recent</span><strong>${escapeHtml(review.weeklySummary.mostRecentSession ? review.weeklySummary.mostRecentSession.taskTitle : "None")}</strong></div>
      </div>
      <div class="pipeline-grid">${counts}</div>
      <div class="weekly-lists">
        <div>
          <h3>Blocked Episodes</h3>
          <ul>${blockers || "<li><span>No active blockers.</span></li>"}</ul>
        </div>
        <div>
          <h3>Closest To Publish</h3>
          <ul>${publish || "<li><span>No active episodes.</span></li>"}</ul>
        </div>
      </div>
      <article class="weekly-next">
        <h3>Recommended Next Focus Session</h3>
        ${
          task
            ? `
              <p><strong>${escapeHtml(task.taskTitle)}</strong></p>
              <p class="muted">${escapeHtml(task.episodeTitle)} · ${escapeHtml(task.reason)}</p>
              <div class="queue-actions">
                <button type="button" data-weekly-select="${escapeHtml(task.episodeId)}">Open Episode</button>
                <button class="primary-btn" type="button" data-weekly-start="${escapeHtml(task.id)}">Start Session</button>
              </div>
            `
            : `<p class="muted">No active blocker task available.</p>`
        }
      </article>
    `;
  }

  function formatOptionalTimestamp(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function renderAppStatus() {
    const status = model.getAppStatus(state, activeSession, backupStatus);
    const activeText = status.activeSession.isActive
      ? `${status.activeSession.isRunning ? "Running" : "Paused"}: ${status.activeSession.taskTitle}`
      : "None";
    const backupNote = status.backupHealth.recommendation
      ? `<small>${escapeHtml(status.backupHealth.recommendation)}</small>`
      : "";
    els.appStatus.innerHTML = `
      <div><span>Total episodes</span><strong>${status.totalEpisodes}</strong></div>
      <div><span>Total work sessions</span><strong>${status.totalWorkSessions}</strong></div>
      <div><span>Backup health</span><strong>${escapeHtml(status.backupHealth.label)}</strong>${backupNote}</div>
      <div><span>Last JSON export</span><strong>${escapeHtml(formatOptionalTimestamp(status.lastExportAt))}</strong></div>
      <div><span>Last JSON import</span><strong>${escapeHtml(formatOptionalTimestamp(status.lastImportAt))}</strong></div>
      <div><span>Active session</span><strong>${escapeHtml(activeText)}</strong></div>
    `;
    els.appStatus.dataset.viewWarning = status.backupHealth.needsExport ? "true" : "false";
  }

  function showBackupRecommendation() {
    const health = model.getBackupHealth(backupStatus);
    if (!health.needsExport) return;
    showImportExportStatus("Backup recommended: export JSON after local changes.", "");
  }

  function createEpisode() {
    const episode = model.createEpisode();
    state.episodes.unshift(episode);
    state.selectedId = episode.id;
    persist();
    showBackupRecommendation();
    render();
  }

  function createDemoEpisode() {
    const episode = model.createDemoEpisode(state.episodes);
    state.episodes.unshift(episode);
    state.selectedId = episode.id;
    persist();
    showImportExportStatus(
      model.getBackupHealth(backupStatus).needsExport
        ? "Demo episode created. Backup recommended: export JSON after local changes."
        : "Demo episode created without replacing existing episodes.",
      "success"
    );
    render();
  }

  function duplicateCurrent() {
    const episode = currentEpisode();
    if (!episode) return;
    const copy = model.duplicateEpisode(episode);
    state.episodes.unshift(copy);
    state.selectedId = copy.id;
    persist();
    showBackupRecommendation();
    render();
  }

  function deleteCurrent() {
    const episode = currentEpisode();
    if (!episode) return;
    const confirmed = window.confirm(`Delete "${episode.workingTitle || "Untitled episode"}"?`);
    if (!confirmed) return;
    state.episodes = state.episodes.filter((item) => item.id !== episode.id);
    state.selectedId = state.episodes[0] ? state.episodes[0].id : "";
    persist();
    showBackupRecommendation();
    render();
  }

  function showImportExportStatus(message, type = "") {
    els.importExportStatus.textContent = message;
    els.importExportStatus.className = `global-status ${type}`.trim();
  }

  function exportJson() {
    const payload = model.buildExportPayload(state);
    const blob = new Blob([model.exportEpisodeCollectionJson(state)], {
      type: "application/json",
    });
    const date = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `vidtoolz-episode-factory-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    backupStatus = storage.recordBackupTimestamp("export");
    showImportExportStatus(
      activeSession
        ? `Exported ${payload.counts.episodes} episodes. Active session draft is not included in JSON export. Complete or abandon it before relying on this backup as the full work record.`
        : `Exported ${payload.counts.episodes} episodes.`,
      "success"
    );
    renderAppStatus();
  }

  function downloadTextFile(filename, text, mimeType = "text/plain") {
    const blob = new Blob([`${text}\n`], { type: mimeType });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadMarkdownPackage() {
    const episode = currentEpisode();
    if (!episode) return;
    const filename = `${slugify(episode.workingTitle || "episode-package") || "episode-package"}.md`;
    const markdown = model.buildFullEpisodeMarkdownPackage(episode);
    downloadTextFile(filename, markdown, "text/markdown");
    els.copyStatus.textContent = "Markdown package downloaded.";
  }

  function downloadCreatorQaJson() {
    const episode = currentEpisode();
    if (!episode) return;
    const filename = `${slugify(episode.workingTitle || "creator-qa-package") || "creator-qa-package"}-creator-qa.json`;
    downloadTextFile(filename, model.buildCreatorQaJsonExport(episode), "application/json");
    els.copyStatus.textContent = "Creator QA JSON downloaded.";
  }

  function downloadCreatorQaMarkdown() {
    const episode = currentEpisode();
    if (!episode) return;
    const filename = `${slugify(episode.workingTitle || "creator-qa-package") || "creator-qa-package"}-creator-qa.md`;
    downloadTextFile(filename, model.buildCreatorQaMarkdownPackage(episode), "text/markdown");
    els.copyStatus.textContent = "Creator QA Markdown downloaded.";
  }

  function replaceState(nextState) {
    state.schemaVersion = nextState.schemaVersion;
    state.version = nextState.version;
    state.selectedId = nextState.selectedId;
    state.episodes = nextState.episodes;
    persist();
    render();
  }

  function clearImportPreview() {
    pendingImport = null;
    els.importPreviewPanel.classList.add("hidden");
    els.importPreviewPanel.innerHTML = "";
  }

  function importItemLabel(item) {
    if (item.type === "conflict") {
      return `${item.title || "Untitled"} conflicts with current title "${item.currentTitle || "Untitled"}"`;
    }
    if (item.type === "possible-duplicate") {
      return `${item.title || "Untitled"} may duplicate an existing episode title`;
    }
    if (item.type === "changed-match") return `${item.title || "Untitled"} will update a matching episode`;
    if (item.type === "match") return `${item.title || "Untitled"} already matches`;
    return `${item.title || "Untitled"} is new`;
  }

  function renderImportPreview(result) {
    const preview = model.buildImportPreview(state, result.state);
    pendingImport = {
      state: result.state,
      preview,
    };
    const counts = preview.counts;
    const flaggedItems = preview.items.filter((item) => item.type === "conflict" || item.type === "possible-duplicate");
    const changedItems = preview.items.filter((item) => item.type === "changed-match").slice(0, 5);
    const flaggedMarkup = flaggedItems.length
      ? flaggedItems
          .slice(0, 6)
          .map((item) => `<li>${escapeHtml(importItemLabel(item))}</li>`)
          .join("")
      : "<li>No conflicts or possible duplicates found.</li>";
    const changedMarkup = changedItems.length
      ? changedItems.map((item) => `<li>${escapeHtml(importItemLabel(item))}</li>`).join("")
      : "<li>No changed matching episodes found.</li>";

    els.importPreviewPanel.innerHTML = `
      <div class="section-heading">
        <div>
          <h2>Import Preview</h2>
          <p class="muted">Review the JSON file before changing local episode data.</p>
        </div>
      </div>
      <div class="import-preview-grid">
        <div><span>Current episodes</span><strong>${counts.currentEpisodes}</strong></div>
        <div><span>Imported episodes</span><strong>${counts.importedEpisodes}</strong></div>
        <div><span>New episodes</span><strong>${counts.newEpisodes}</strong></div>
        <div><span>Matching episodes</span><strong>${counts.matchingEpisodes}</strong></div>
        <div><span>Changed matches</span><strong>${counts.changedMatchingEpisodes}</strong></div>
        <div><span>Duplicates/conflicts</span><strong>${counts.possibleDuplicateEpisodes + counts.conflictingEpisodes}</strong></div>
        <div><span>Skipped in merge</span><strong>${counts.skippedEpisodes}</strong></div>
        <div><span>Imported work sessions</span><strong>${counts.importedWorkSessions}</strong></div>
      </div>
      <div class="import-preview-details">
        <div>
          <h3>Conflicts and possible duplicates</h3>
          <ul>${flaggedMarkup}</ul>
        </div>
        <div>
          <h3>Changed matching episodes</h3>
          <ul>${changedMarkup}</ul>
        </div>
      </div>
      <fieldset class="import-mode-group">
        <legend>Import mode</legend>
        <label><input type="radio" name="importMode" value="merge-new" checked /> Merge new episodes only</label>
        <label><input type="radio" name="importMode" value="merge-update" /> Merge and update matching episodes</label>
        <label><input type="radio" name="importMode" value="replace" /> Replace library</label>
      </fieldset>
      <div class="import-preview-actions">
        <button id="confirmImportBtn" class="primary-btn" type="button">Confirm import</button>
        <button id="cancelImportBtn" type="button">Cancel</button>
      </div>
    `;
    els.importPreviewPanel.classList.remove("hidden");
    showImportExportStatus("Import preview ready. Choose a mode and confirm to change local data.", "");
  }

  function importJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = model.importEpisodeCollectionJson(String(reader.result || ""));
      if (!result.ok) {
        showImportExportStatus(result.error, "error");
        return;
      }

      renderImportPreview(result);
    });
    reader.addEventListener("error", () => {
      showImportExportStatus("Import failed: the selected file could not be read.", "error");
    });
    reader.readAsText(file);
  }

  function confirmPendingImport() {
    if (!pendingImport) return;
    const selectedMode = els.importPreviewPanel.querySelector("input[name='importMode']:checked");
    const mode = selectedMode ? selectedMode.value : "merge-new";
    const counts = pendingImport.preview.counts;
    const isRiskyMode = mode === "replace" || mode === "merge-update";
    if (isRiskyMode && !model.getBackupHealth(backupStatus).hasRecentExport) {
      const confirmed = window.confirm(
        "Export recommended before this import mode. Replace library and merge-and-update can overwrite local episode data. Continue without a recent JSON export?"
      );
      if (!confirmed) {
        showImportExportStatus("Import paused. Export JSON before using this import mode.", "");
        return;
      }
    }
    let nextState;
    let message;

    if (mode === "replace") {
      nextState = model.applyReplaceImport(state, pendingImport.state);
      message = `Import complete: replaced local library with ${nextState.episodes.length} episodes.`;
    } else if (mode === "merge-update") {
      nextState = model.applyMergeAndUpdateImport(state, pendingImport.state);
      message = `Import complete: added ${counts.newEpisodes} new episodes and updated ${counts.changedMatchingEpisodes} matching episodes. Skipped ${counts.skippedEpisodes} conflicts or possible duplicates.`;
    } else {
      nextState = model.applyMergeNewOnlyImport(state, pendingImport.state);
      message = `Import complete: added ${counts.newEpisodes} new episodes. Skipped ${counts.matchingEpisodes + counts.skippedEpisodes} matching, conflicting, or possible duplicate episodes.`;
    }

    replaceState(nextState);
    backupStatus = storage.recordBackupTimestamp("import");
    clearImportPreview();
    showImportExportStatus(message, "success");
    renderAppStatus();
  }

  async function copyOutput(type) {
    const episode = currentEpisode();
    if (!episode) return;
    const payload = model.buildCopyPayload(type, episode);
    try {
      await navigator.clipboard.writeText(payload);
      els.copyStatus.textContent = "Copied.";
    } catch (error) {
      window.prompt("Copy this text:", payload);
      els.copyStatus.textContent = "Clipboard blocked. Text opened for manual copy.";
    }
  }

  async function copyTaskOutput(type, taskId) {
    const task = model.buildExecutionQueue(state.episodes).find((item) => item.id === taskId);
    if (!task) return;
    const payload = model.buildTaskPackagePayload(type, task);
    try {
      await navigator.clipboard.writeText(payload);
      els.taskCopyStatus.textContent = "Task package copied.";
    } catch (error) {
      window.prompt("Copy this task package:", payload);
      els.taskCopyStatus.textContent = "Clipboard blocked. Task package opened for manual copy.";
    }
  }

  function showTaskStatus(message) {
    els.taskCopyStatus.textContent = message;
  }

  async function copySessionOutput(type, sessionId) {
    const episode = currentEpisode();
    if (!episode) return;
    const session = (episode.workSessions || []).find((item) => item.id === sessionId) || episode.workSessions[0];
    if (!session) return;
    const payload = model.buildSessionExportPayload(type, episode, session);
    try {
      await navigator.clipboard.writeText(payload);
      els.copyStatus.textContent = "Session output copied.";
    } catch (error) {
      window.prompt("Copy this session output:", payload);
      els.copyStatus.textContent = "Clipboard blocked. Session output opened for manual copy.";
    }
  }

  async function copyWeeklyOutput(type) {
    const payload = model.buildWeeklyExportPayload(type, state);
    try {
      await navigator.clipboard.writeText(payload);
      els.weeklyCopyStatus.textContent = "Weekly review copied.";
    } catch (error) {
      window.prompt("Copy this weekly review:", payload);
      els.weeklyCopyStatus.textContent = "Clipboard blocked. Weekly review opened for manual copy.";
    }
  }

  function parseSelectedChecklistItems(task, rawSelection) {
    const choices = String(rawSelection || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
    return choices
      .map((number) => task.relevantChecklistItems[number - 1])
      .filter(Boolean)
      .map((item) => ({ groupKey: item.groupKey, item: item.item }));
  }

  function selectedChecklistItemsFromForm(task, form) {
    return Array.from(form.querySelectorAll('[name="completedChecklistItems"]:checked'))
      .map((input) => task.relevantChecklistItems[Number(input.value)])
      .filter(Boolean)
      .map((item) => ({ groupKey: item.groupKey, item: item.item }));
  }

  function saveCompletedTask(taskId, form) {
    const task =
      completionTaskOverride ||
      model.buildExecutionQueue(state.episodes).find((item) => item.id === taskId);
    if (!task) return false;
    const episodeIndex = state.episodes.findIndex((episode) => episode.id === task.episodeId);
    if (episodeIndex < 0) return false;

    const data = Object.fromEntries(new FormData(form).entries());
    const error = form.querySelector("#completionError");
    if (!String(data.result || "").trim()) {
      error.textContent = "What was completed is required.";
      return false;
    }

    const completionInput = {
      ...data,
      completedChecklistItems: selectedChecklistItemsFromForm(task, form),
    };
    const sessionData =
      activeSession && activeSession.task && activeSession.task.id === task.id
        ? model.buildCompletionDataFromActiveSession(activeSession, completionInput)
        : model.normalizeCompletionFormData(completionInput, task);
    state.episodes[episodeIndex] = model.addWorkSession(state.episodes[episodeIndex], sessionData);
    state.selectedId = state.episodes[episodeIndex].id;
    activeCompletionTaskId = "";
    completionTaskOverride = null;
    if (activeSession && activeSession.task && activeSession.task.id === task.id) {
      activeSession = null;
      persistActiveSession();
    }
    persist();
    showBackupRecommendation();
    render();
    return true;
  }

  function editSession(sessionId, form) {
    const episode = currentEpisode();
    if (!episode) return;
    const index = state.episodes.findIndex((item) => item.id === episode.id);
    const data = Object.fromEntries(new FormData(form).entries());
    if (!String(data.result || "").trim()) return;
    state.episodes[index] = model.editWorkSession(episode, sessionId, data);
    editingSessionId = "";
    persist();
    showBackupRecommendation();
    render();
  }

  function startFocusSession(taskId) {
    const task = model.buildExecutionQueue(state.episodes).find((item) => item.id === taskId);
    if (!task) return;
    if (activeSession && !window.confirm("A focus session is already active. Abandon it and start this one?")) {
      return;
    }
    activeSession = model.startActiveSession(task);
    activeCompletionTaskId = "";
    completionTaskOverride = null;
    state.selectedId = task.episodeId;
    persistActiveSession();
    persist();
    render();
    showTaskStatus("Focus session started.");
  }

  function activeSessionControl(action) {
    if (!activeSession) return;
    let message = "";
    if (action === "resume") {
      activeSession = model.resumeActiveSession(activeSession);
      message = "Focus session resumed.";
    }
    if (action === "pause") {
      activeSession = model.pauseActiveSession(activeSession);
      message = "Focus session paused.";
    }
    if (action === "reset") {
      activeSession = model.resetActiveSession(activeSession);
      message = "Focus session timer reset.";
    }
    if (action === "complete") {
      activeSession = model.pauseActiveSession(activeSession);
      completionTaskOverride = activeSession.task;
      activeCompletionTaskId = activeSession.task.id;
      persistActiveSession();
      renderActiveSessionPanel();
      renderCompletionDrawer();
      renderAppStatus();
      renderEpisodeFocusPanel();
      showTaskStatus("Complete the session details to save it.");
      return;
    }
    if (action === "abandon") {
      if (!window.confirm("Abandon the active focus session?")) return;
      activeSession = model.abandonActiveSession();
      activeCompletionTaskId = "";
      completionTaskOverride = null;
      message = "Focus session abandoned.";
    }
    persistActiveSession();
    renderActiveSessionPanel();
    renderAppStatus();
    renderEpisodeFocusPanel();
    showTaskStatus(message);
  }

  async function copyGeneratedTask(task) {
    if (!task) {
      els.copyStatus.textContent = "No blocker task available for that session.";
      return;
    }
    const payload = model.buildTaskPackagePayload("human", task);
    try {
      await navigator.clipboard.writeText(payload);
      els.copyStatus.textContent = "Generated task package copied.";
    } catch (error) {
      window.prompt("Copy this generated task:", payload);
      els.copyStatus.textContent = "Clipboard blocked. Generated task opened for manual copy.";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  document.querySelector("#newEpisodeBtn").addEventListener("click", createEpisode);
  document.querySelector("#demoEpisodeBtn").addEventListener("click", createDemoEpisode);
  document.querySelector("#duplicateBtn").addEventListener("click", duplicateCurrent);
  document.querySelector("#deleteBtn").addEventListener("click", deleteCurrent);
  document.querySelector("#exportJsonBtn").addEventListener("click", exportJson);
  document.querySelector("#importJsonBtn").addEventListener("click", () => els.importInput.click());
  document.querySelector("#downloadMarkdownBtn").addEventListener("click", downloadMarkdownPackage);
  document.querySelector("#downloadCreatorQaJsonBtn").addEventListener("click", downloadCreatorQaJson);
  document.querySelector("#downloadCreatorQaMarkdownBtn").addEventListener("click", downloadCreatorQaMarkdown);
  els.importInput.addEventListener("change", (event) => {
    importJsonFile(event.target.files[0]);
    event.target.value = "";
  });
  els.importPreviewPanel.addEventListener("click", (event) => {
    if (event.target.closest("#confirmImportBtn")) confirmPendingImport();
    if (event.target.closest("#cancelImportBtn")) {
      clearImportPreview();
      showImportExportStatus("Import canceled. Local data was not changed.", "");
    }
  });
  els.form.addEventListener("submit", (event) => event.preventDefault());
  els.search.addEventListener("input", renderBoard);

  els.board.addEventListener("click", (event) => {
    const card = event.target.closest(".episode-card");
    if (!card) return;
    state.selectedId = card.dataset.id;
    persist();
    render();
  });

  els.queue.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-select-episode]");
    if (selectButton) {
      state.selectedId = selectButton.dataset.selectEpisode;
      persist();
      render();
      return;
    }

    const copyButton = event.target.closest("[data-task-copy]");
    if (copyButton) {
      copyTaskOutput(copyButton.dataset.taskCopy, copyButton.dataset.taskId);
      return;
    }

    const startButton = event.target.closest("[data-task-start]");
    if (startButton) {
      startFocusSession(startButton.dataset.taskStart);
      return;
    }

    const completeButton = event.target.closest("[data-task-complete]");
    if (completeButton) {
      activeCompletionTaskId = completeButton.dataset.taskComplete;
      renderCompletionDrawer();
    }
  });

  els.weeklyDashboard.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-weekly-select]");
    if (selectButton) {
      state.selectedId = selectButton.dataset.weeklySelect;
      persist();
      render();
      return;
    }

    const startButton = event.target.closest("[data-weekly-start]");
    if (startButton) {
      startFocusSession(startButton.dataset.weeklyStart);
    }
  });

  document.querySelector(".weekly-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-weekly-copy]");
    if (button) copyWeeklyOutput(button.dataset.weeklyCopy);
  });

  els.completionDrawer.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCompletedTask(activeCompletionTaskId, event.target);
  });

  els.completionDrawer.addEventListener("click", (event) => {
    if (!event.target.closest("[data-completion-cancel]")) return;
    activeCompletionTaskId = "";
    completionTaskOverride = null;
    renderCompletionDrawer();
  });

  els.activeSessionPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-active-control]");
    if (!button) return;
    activeSessionControl(button.dataset.activeControl);
  });

  els.nextWorkBlock.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-block-open]");
    if (openButton) {
      state.selectedId = openButton.dataset.blockOpen;
      persist();
      render();
      return;
    }
    const startButton = event.target.closest("[data-block-start]");
    if (startButton) {
      updateBlockStatus(startButton.dataset.blockStart, "start");
      return;
    }
    const doneButton = event.target.closest("[data-block-done]");
    if (doneButton) {
      updateBlockStatus(doneButton.dataset.blockDone, "done");
      return;
    }
    const skipButton = event.target.closest("[data-block-skip]");
    if (skipButton) {
      updateBlockStatus(skipButton.dataset.blockSkip, "skip");
    }
  });

  els.boardFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    renderBoard();
  });

  els.status.addEventListener("change", () => {
    const episode = currentEpisode();
    if (!episode) return;
    updateEpisode(episode.id, { status: els.status.value });
  });

  els.fields.addEventListener("input", (event) => {
    const field = event.target.name;
    const episode = currentEpisode();
    if (!field || !episode) return;
    updateEpisode(episode.id, { [field]: event.target.value }, "board");
  });

  els.checklists.addEventListener("change", (event) => {
    const episode = currentEpisode();
    const groupKey = event.target.dataset.checklist;
    const itemLabel = event.target.dataset.item;
    if (!episode || !groupKey || !itemLabel) return;
    const group = model.normalizeChecklistGroup(groupKey, episode.checklists[groupKey]);
    const nextGroup = group.map((item) =>
      item.label === itemLabel ? { ...item, passed: event.target.checked } : item
    );
    const nextChecklists = {
      ...episode.checklists,
      [groupKey]: model.checklistToObject(nextGroup),
    };
    updateEpisode(episode.id, { checklists: nextChecklists }, "checklists");
  });

  els.planWorkBlocksBtn.addEventListener("click", planStarterBlocksForCurrentEpisode);

  els.workBlockForm.addEventListener("click", (event) => {
    if (!event.target.closest("[data-block-add]")) return;
    addCustomWorkBlock(els.workBlockForm);
  });

  els.workBlocks.addEventListener("click", (event) => {
    const startButton = event.target.closest("[data-block-start]");
    if (startButton) {
      updateBlockStatus(startButton.dataset.blockStart, "start");
      return;
    }
    const doneButton = event.target.closest("[data-block-done]");
    if (doneButton) {
      updateBlockStatus(doneButton.dataset.blockDone, "done");
      return;
    }
    const skipButton = event.target.closest("[data-block-skip]");
    if (skipButton) {
      updateBlockStatus(skipButton.dataset.blockSkip, "skip");
    }
  });

  els.workBlocks.addEventListener("change", (event) => {
    const blockId = event.target.dataset.blockNotes;
    if (!blockId) return;
    updateBlockNotes(blockId, event.target.value);
  });

  els.sessions.addEventListener("click", (event) => {
    const episode = currentEpisode();
    if (!episode) return;
    const copyButton = event.target.closest("[data-session-copy]");
    if (copyButton) {
      copySessionOutput(copyButton.dataset.sessionCopy, copyButton.dataset.sessionId);
      return;
    }
    const editButton = event.target.closest("[data-session-edit]");
    if (editButton) {
      editingSessionId = editButton.dataset.sessionEdit;
      renderSessions(episode);
      return;
    }
    if (event.target.closest("[data-session-edit-cancel]")) {
      editingSessionId = "";
      renderSessions(episode);
      return;
    }
    const deleteButton = event.target.closest("[data-session-delete]");
    if (deleteButton) {
      if (!window.confirm("Delete this work session?")) return;
      const index = state.episodes.findIndex((item) => item.id === episode.id);
      state.episodes[index] = model.deleteWorkSession(episode, deleteButton.dataset.sessionDelete);
      persist();
      showBackupRecommendation();
      render();
      return;
    }
    const resumeButton = event.target.closest("[data-session-resume]");
    if (resumeButton) {
      const session = episode.workSessions.find((item) => item.id === resumeButton.dataset.sessionResume);
      copyGeneratedTask(model.buildResumeBlockerTask(episode, session));
      return;
    }
    const repeatButton = event.target.closest("[data-session-repeat]");
    if (repeatButton) {
      const session = episode.workSessions.find((item) => item.id === repeatButton.dataset.sessionRepeat);
      copyGeneratedTask(model.buildRepeatTaskFromSession(episode, session));
    }
  });

  els.sessions.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-session-edit-form]");
    if (!form) return;
    event.preventDefault();
    editSession(form.dataset.sessionEditForm, form);
  });

  document.querySelector(".copy-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (button) copyOutput(button.dataset.copy);
  });

  document.querySelectorAll("[data-view-mode-button]").forEach((button) => {
    button.addEventListener("click", () => setViewMode(button.dataset.viewModeButton));
  });

  window.EpisodeFactoryViewMode = {
    key: EPISODE_FACTORY_VIEW_MODE_KEY,
    normalizeViewMode,
    readViewMode,
    saveViewMode,
    setViewMode,
    buildEpisodeFocusModel,
  };

  viewMode = readViewMode();
  render();

  window.setInterval(() => {
    if (!activeSession || !activeSession.isRunning) return;
    renderActiveSessionPanel();
    renderEpisodeFocusPanel();
  }, 1000);
})();
