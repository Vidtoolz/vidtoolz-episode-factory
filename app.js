(function episodeFactoryApp() {
  "use strict";

  const model = window.EpisodeFactoryModel;
  const storage = window.EpisodeFactoryStorage;
  const state = storage.loadState();

  const els = {
    board: document.querySelector("#board"),
    count: document.querySelector("#episodeCount"),
    form: document.querySelector("#episodeForm"),
    empty: document.querySelector("#emptyState"),
    fields: document.querySelector("#fieldGrid"),
    status: document.querySelector("#statusSelect"),
    boardFilters: document.querySelector("#boardFilters"),
    queue: document.querySelector("#executionQueue"),
    taskCopyStatus: document.querySelector("#taskCopyStatus"),
    sessions: document.querySelector("#workSessions"),
    checklists: document.querySelector("#checklistGroups"),
    readinessGrid: document.querySelector("#readinessGrid"),
    readinessSummary: document.querySelector("#readinessSummary"),
    search: document.querySelector("#searchInput"),
    copyStatus: document.querySelector("#copyStatus"),
    importExportStatus: document.querySelector("#importExportStatus"),
    importInput: document.querySelector("#importJsonInput"),
  };

  const boardFilters = [
    { key: "all", label: "All" },
    { key: "packagingBlocked", label: "Packaging blocked" },
    { key: "readyToShoot", label: "Ready to shoot" },
    { key: "readyToPublish", label: "Ready to publish" },
    { key: "published", label: "Published" },
  ];
  let activeFilter = "all";

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
    if (renderMode === "board") {
      renderBoard();
      renderQueue();
    } else if (renderMode === "checklists") {
      renderBoard();
      renderQueue();
      renderReadiness(state.episodes[index]);
      renderChecklists(state.episodes[index]);
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
          <button type="button" data-task-complete="${escapeHtml(task.id)}">Complete</button>
        </div>
      `;
      els.queue.append(item);
    });
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
        </div>
      `;
      els.sessions.append(item);
    });
  }

  function render() {
    renderQueue();
    renderBoard();
    renderForm();
  }

  function createEpisode() {
    const episode = model.createEpisode();
    state.episodes.unshift(episode);
    state.selectedId = episode.id;
    persist();
    render();
  }

  function duplicateCurrent() {
    const episode = currentEpisode();
    if (!episode) return;
    const copy = model.duplicateEpisode(episode);
    state.episodes.unshift(copy);
    state.selectedId = copy.id;
    persist();
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
    render();
  }

  function showImportExportStatus(message, type = "") {
    els.importExportStatus.textContent = message;
    els.importExportStatus.className = `global-status ${type}`.trim();
  }

  function exportJson() {
    const payload = model.buildExportPayload(state);
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
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
    showImportExportStatus(`Exported ${payload.counts.episodes} episodes.`, "success");
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

  function replaceState(nextState) {
    state.version = nextState.version;
    state.selectedId = nextState.selectedId;
    state.episodes = nextState.episodes;
    persist();
    render();
  }

  function importJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = model.parseImportJson(String(reader.result || ""));
      if (!result.ok) {
        showImportExportStatus(result.error, "error");
        return;
      }

      replaceState(result.state);
      showImportExportStatus(`Imported ${result.summary.episodes} episodes. Existing local data was replaced.`, "success");
    });
    reader.addEventListener("error", () => {
      showImportExportStatus("Import failed: the selected file could not be read.", "error");
    });
    reader.readAsText(file);
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

  function completeTask(taskId) {
    const task = model.buildExecutionQueue(state.episodes).find((item) => item.id === taskId);
    if (!task) return;
    const episodeIndex = state.episodes.findIndex((episode) => episode.id === task.episodeId);
    if (episodeIndex < 0) return;

    const actualMinutes = window.prompt("Actual minutes spent:", String(task.estimatedMinutes));
    if (actualMinutes === null) return;
    const result = window.prompt("What was completed?", "");
    if (result === null) return;
    const blocked = window.prompt("What is still blocked?", "");
    if (blocked === null) return;
    const notes = window.prompt("Notes:", "");
    if (notes === null) return;
    const nextAction = window.prompt("Next action after this session:", "");
    if (nextAction === null) return;

    let completedChecklistItems = [];
    if (task.relevantChecklistItems.length) {
      const options = task.relevantChecklistItems
        .map((item, index) => `${index + 1}. ${item.groupLabel}: ${item.item}`)
        .join("\n");
      const selection = window.prompt(`Mark completed checklist items by number, comma-separated:\n${options}`, "");
      if (selection === null) return;
      completedChecklistItems = parseSelectedChecklistItems(task, selection);
    }

    state.episodes[episodeIndex] = model.addWorkSession(state.episodes[episodeIndex], {
      taskTitle: task.taskTitle,
      taskType: task.type,
      estimatedMinutes: task.estimatedMinutes,
      actualMinutes,
      result,
      completedChecklistItems,
      notes: [`Still blocked: ${blocked || "None recorded."}`, notes].filter(Boolean).join("\n"),
      nextActionAfterSession: nextAction,
    });
    state.selectedId = state.episodes[episodeIndex].id;
    persist();
    render();
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
  document.querySelector("#duplicateBtn").addEventListener("click", duplicateCurrent);
  document.querySelector("#deleteBtn").addEventListener("click", deleteCurrent);
  document.querySelector("#exportJsonBtn").addEventListener("click", exportJson);
  document.querySelector("#importJsonBtn").addEventListener("click", () => els.importInput.click());
  document.querySelector("#downloadMarkdownBtn").addEventListener("click", downloadMarkdownPackage);
  els.importInput.addEventListener("change", (event) => {
    importJsonFile(event.target.files[0]);
    event.target.value = "";
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

    const completeButton = event.target.closest("[data-task-complete]");
    if (completeButton) completeTask(completeButton.dataset.taskComplete);
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

  els.sessions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-copy]");
    if (!button) return;
    copySessionOutput(button.dataset.sessionCopy, button.dataset.sessionId);
  });

  document.querySelector(".copy-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (button) copyOutput(button.dataset.copy);
  });

  render();
})();
