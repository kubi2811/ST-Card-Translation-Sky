/* ─── IndexedDB Helper with Debouncing & Connection Cache ─── */

let _db: IDBDatabase | null = null;
const _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const IDB = {
    dbName: 'st-translator-db',
    storeName: 'kv-store',

    /** Cached DB connection — avoids reopening on every call */
    init() {
        if (_db) return Promise.resolve(_db);
        return new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = (e: any) => {
                e.target.result.createObjectStore(this.storeName);
            };
            req.onsuccess = () => {
                _db = req.result;
                // Reset cache if DB is closed unexpectedly
                _db.onclose = () => { _db = null; };
                resolve(_db);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async get<T>(key: string, fallback: T): Promise<T> {
        try {
            const db = await this.init();
            return new Promise((resolve) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result !== undefined ? req.result : fallback);
                req.onerror = () => resolve(fallback);
            });
        } catch {
            return fallback;
        }
    },

    async set(key: string, value: any): Promise<void> {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const req = store.put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error('IDB Set Error', e);
        }
    },

    /**
     * Debounced write — coalesces rapid writes to the same key.
     * Only the last value within the delay window is actually written.
     * Ideal for translation loop where updateField() fires per-field.
     */
    setDebounced(key: string, value: any, delayMs = 3000): void {
        // Cancel any pending write for this key
        const existing = _debounceTimers.get(key);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            _debounceTimers.delete(key);
            this.set(key, value).catch(e => console.error('IDB debounced write error:', e));
        }, delayMs);

        _debounceTimers.set(key, timer);
    },

    /** Flush a specific debounced key immediately */
    async flushDebounced(key: string): Promise<void> {
        const timer = _debounceTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            _debounceTimers.delete(key);
        }
        // The actual value needs to be re-provided, so this just clears the timer.
        // For actual flush, call set() directly with the current value.
    },

    async remove(key: string): Promise<void> {
        try {
            // Also cancel any pending debounced write
            const timer = _debounceTimers.get(key);
            if (timer) {
                clearTimeout(timer);
                _debounceTimers.delete(key);
            }

            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error('IDB Remove Error', e);
        }
    },

    async clearPrefix(prefix: string): Promise<void> {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                
                // Clear any pending debounced writes for matching keys
                for (const key of _debounceTimers.keys()) {
                    if (key.startsWith(prefix)) {
                        const timer = _debounceTimers.get(key);
                        if (timer) clearTimeout(timer);
                        _debounceTimers.delete(key);
                    }
                }

                // Use key cursor to find and delete keys with prefix
                const req = store.openKeyCursor();
                req.onsuccess = (e: any) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const key = cursor.key;
                        if (typeof key === 'string' && key.startsWith(prefix)) {
                            store.delete(key);
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error('IDB Clear Prefix Error', e);
        }
    }
};
