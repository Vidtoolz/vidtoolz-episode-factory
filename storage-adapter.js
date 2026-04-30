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

  function getBackupStatusKey() {
    return globalScope.EpisodeFactoryModel
      ? globalScope.EpisodeFactoryModel.BACKUP_STATUS_KEY
      : "vidtoolz-episode-factory-backup-status-v1";
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

  function loadBackupStatus(options = {}) {
    const storage = options.storage || globalScope.localStorage;
    const model = options.model || globalScope.EpisodeFactoryModel;
    if (!storage || !model) return { lastExportAt: "", lastImportAt: "" };
    try {
      const raw = storage.getItem(getBackupStatusKey());
      return model.normalizeBackupStatus(raw ? JSON.parse(raw) : {});
    } catch (error) {
      console.warn("Episode Factory could not load backup status.", error);
      return model.normalizeBackupStatus({});
    }
  }

  function saveBackupStatus(backupStatus, options = {}) {
    const storage = options.storage || globalScope.localStorage;
    const model = options.model || globalScope.EpisodeFactoryModel;
    if (!storage || !model) return false;
    storage.setItem(getBackupStatusKey(), JSON.stringify(model.normalizeBackupStatus(backupStatus)));
    return true;
  }

  function recordBackupTimestamp(type, timestamp = new Date().toISOString(), options = {}) {
    const current = loadBackupStatus(options);
    const next = {
      ...current,
      ...(type === "import" ? { lastImportAt: timestamp } : {}),
      ...(type === "export" ? { lastExportAt: timestamp } : {}),
    };
    return saveBackupStatus(next, options) ? next : current;
  }

  const api = {
    getStorageKey,
    loadState,
    saveState,
    getActiveSessionKey,
    loadActiveSession,
    saveActiveSession,
    getBackupStatusKey,
    loadBackupStatus,
    saveBackupStatus,
    recordBackupTimestamp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EpisodeFactoryStorage = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
