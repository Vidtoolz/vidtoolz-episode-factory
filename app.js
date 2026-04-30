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
    gate: document.querySelector("#gateList"),
    gateSummary: document.querySelector("#gateSummary"),
    search: document.querySelector("#searchInput"),
    copyStatus: document.querySelector("#copyStatus"),
  };

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
    } else if (renderMode === "gate") {
      renderBoard();
      renderGate(state.episodes[index]);
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

  function renderBoard() {
    const visible = state.episodes.filter(matchesSearch);
    els.count.textContent = `${visible.length} shown / ${state.episodes.length} total`;
    els.board.innerHTML = "";

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
        const gate = model.getGateSummary(episode);
        const card = document.createElement("button");
        card.type = "button";
        card.className = episode.id === state.selectedId ? "episode-card selected" : "episode-card";
        card.dataset.id = episode.id;
        card.innerHTML = `
          <strong>${escapeHtml(episode.workingTitle || "Untitled episode")}</strong>
          <span>${escapeHtml(episode.topic || "No topic yet")}</span>
          <small>Gate ${gate.passed}/${gate.total}</small>
        `;
        list.append(card);
      });
      column.append(list);
      els.board.append(column);
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

    renderGate(episode);
  }

  function renderGate(episode) {
    const gate = model.getGateSummary(episode);
    els.gateSummary.textContent = gate.isComplete
      ? "Pass: packaging is ready to move forward."
      : `${gate.passed}/${gate.total} checks passed`;
    els.gate.innerHTML = "";
    gate.items.forEach((item) => {
      const id = `gate-${slugify(item.label)}`;
      const label = document.createElement("label");
      label.className = item.passed ? "gate-item passed" : "gate-item";
      label.innerHTML = `
        <input id="${id}" type="checkbox" data-gate="${escapeHtml(item.label)}" ${item.passed ? "checked" : ""} />
        <span>${escapeHtml(item.label)}</span>
      `;
      els.gate.append(label);
    });
  }

  function render() {
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
  els.form.addEventListener("submit", (event) => event.preventDefault());
  els.search.addEventListener("input", renderBoard);

  els.board.addEventListener("click", (event) => {
    const card = event.target.closest(".episode-card");
    if (!card) return;
    state.selectedId = card.dataset.id;
    persist();
    render();
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

  els.gate.addEventListener("change", (event) => {
    const episode = currentEpisode();
    if (!episode || !event.target.dataset.gate) return;
    const gate = model.normalizePackagingGate(episode.packagingGate);
    const nextGate = gate.map((item) =>
      item.label === event.target.dataset.gate ? { ...item, passed: event.target.checked } : item
    );
    updateEpisode(episode.id, { packagingGate: model.gateToObject(nextGate) }, "gate");
  });

  document.querySelector(".copy-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (button) copyOutput(button.dataset.copy);
  });

  render();
})();
