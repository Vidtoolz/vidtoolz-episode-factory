(function storageAdapter(globalScope) {
  "use strict";

  function getStorageKey() {
    return globalScope.EpisodeFactoryModel
      ? globalScope.EpisodeFactoryModel.STORAGE_KEY
      : "vidtoolz-episode-factory-v1";
  }

  function loadState(options = {}) {
    const storage = options.storage || globalScope.localStorage;
    const model = options.model || globalScope.EpisodeFactoryModel;
    if (!storage || !model) return { version: 1, selectedId: "", episodes: [] };

    try {
      const raw = storage.getItem(getStorageKey());
      if (!raw) return model.normalizeState({ episodes: [] });
      return model.normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("Episode Factory could not load local state.", error);
      return model.normalizeState({ episodes: [] });
    }
  }

  function saveState(state, options = {}) {
    const storage = options.storage || globalScope.localStorage;
    if (!storage) return false;
    storage.setItem(getStorageKey(), JSON.stringify(state));
    return true;
  }

  const api = { getStorageKey, loadState, saveState };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EpisodeFactoryStorage = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
