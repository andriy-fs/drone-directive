export interface IStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  removeItems(keys: string[]): void;
}

/** Wraps the browser's localStorage; swallows failures (privacy mode, disabled/full storage). */
export class LocalStorage implements IStorage {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // best-effort — ignore write failures
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // best-effort — ignore failures
    }
  }

  removeItems(keys: string[]): void {
    for (const key of keys) this.removeItem(key);
  }
}

/** Shared instance — all app code should go through this rather than calling localStorage directly. */
export const storage: IStorage = new LocalStorage();
