import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = { sessions: {} };

/**
 * Promise-based mutex keyed by string (e.g. remoteJid).
 */
class KeyedMutex {
  constructor() {
    /** @type {Map<string, Promise<void>>} */
    this._locks = new Map();
  }

  /**
   * @param {string} key
   * @returns {Promise<() => void>} release function
   */
  async acquire(key) {
    while (this._locks.has(key)) {
      await this._locks.get(key);
    }
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    this._locks.set(key, promise);
    return () => {
      this._locks.delete(key);
      release();
    };
  }
}

export class SessionStore {
  constructor(storePath, maxContextMessages) {
    this.storePath = storePath;
    this.maxContextMessages = maxContextMessages;
    /** @type {object|null} */
    this._cache = null;
    this._mutex = new KeyedMutex();
    this._flushTimer = null;
    this._dirty = false;
  }

  async ensureStoreFile() {
    const dir = path.dirname(this.storePath);
    await mkdir(dir, { recursive: true });
    try {
      await readFile(this.storePath, "utf8");
    } catch {
      await writeFile(this.storePath, JSON.stringify(EMPTY_STATE, null, 2), "utf8");
    }
  }

  async _loadCache() {
    if (this._cache) return this._cache;
    await this.ensureStoreFile();
    const raw = await readFile(this.storePath, "utf8");
    this._cache = JSON.parse(raw || JSON.stringify(EMPTY_STATE));
    return this._cache;
  }

  /** Schedule a debounced disk write (500 ms). */
  _scheduleSave() {
    this._dirty = true;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(async () => {
      this._flushTimer = null;
      await this._flushToDisk();
    }, 500);
  }

  async _flushToDisk() {
    if (this._dirty && this._cache) {
      await writeFile(this.storePath, JSON.stringify(this._cache, null, 2), "utf8");
      this._dirty = false;
    }
  }

  /** Force-write pending changes to disk immediately. */
  async flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    await this._flushToDisk();
  }

  trimSession(session) {
    return session.slice(-this.maxContextMessages);
  }

  async save(remoteJid, session) {
    const release = await this._mutex.acquire(remoteJid);
    try {
      const state = await this._loadCache();
      state.sessions[remoteJid] = this.trimSession(session);
      this._scheduleSave();
    } finally {
      release();
    }
  }

  async getSession(remoteJid) {
    const release = await this._mutex.acquire(remoteJid);
    try {
      const state = await this._loadCache();
      return [...(state.sessions[remoteJid] || [])];
    } finally {
      release();
    }
  }

  /**
   * Append multiple messages in a single atomic operation.
   * Replaces the old pattern of two separate appendMessage calls.
   */
  async appendMessages(remoteJid, messages) {
    const release = await this._mutex.acquire(remoteJid);
    try {
      const state = await this._loadCache();
      const session = state.sessions[remoteJid] || [];
      session.push(...messages);
      state.sessions[remoteJid] = this.trimSession(session);
      this._scheduleSave();
    } finally {
      release();
    }
  }

  async appendMessage(remoteJid, message) {
    return this.appendMessages(remoteJid, [message]);
  }

  /** Clear a session (for /reset command). */
  async clearSession(remoteJid) {
    const release = await this._mutex.acquire(remoteJid);
    try {
      const state = await this._loadCache();
      delete state.sessions[remoteJid];
      this._scheduleSave();
    } finally {
      release();
    }
  }
}
