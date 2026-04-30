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

  function getActiveSessionKey() {
    return globalScope.EpisodeFactoryModel
      ? globalScope.EpisodeFactoryModel.ACTIVE_SESSION_KEY
      : "vidtoolz-episode-factory-active-session-v1";
  }

  function loadActiveSession(options = {}) {
    const storage = options.storage || globalScope.localStorage;
    const model = options.model || globalScope.EpisodeFactoryModel;
    if (!storage || !model) return null;
    try {
      const raw = storage.getItem(getActiveSessionKey());
      return raw ? model.normalizeActiveSession(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn("Episode Factory could not load active session.", error);
      return null;
    }
  }

  function saveActiveSession(activeSession, options = {}) {
    const storage = options.storage || globalScope.localStorage;
    if (!storage) return false;
    if (!activeSession) {
      storage.removeItem(getActiveSessionKey());
      return true;
    }
    storage.setItem(getActiveSessionKey(), JSON.stringify(activeSession));
    return true;
  }

  const api = {
    getStorageKey,
    loadState,
    saveState,
    getActiveSessionKey,
    loadActiveSession,
    saveActiveSession,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EpisodeFactoryStorage = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
