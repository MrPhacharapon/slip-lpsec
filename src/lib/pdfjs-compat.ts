/**
 * PDF.js 6 may use proposed Map upsert methods that are absent in older
 * Chromium/WebView engines. Install a small compatibility shim only before
 * loading the payroll PDF parser in the admin upload workflow.
 */
type MapWithUpsert = Map<unknown, unknown> & {
  getOrInsert?: (key: unknown, value: unknown) => unknown;
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
};

export function ensurePdfJsMapCompatibility(): void {
  const prototype = Map.prototype as MapWithUpsert;
  if (typeof prototype.getOrInsert !== "function") {
    Object.defineProperty(prototype, "getOrInsert", {
      configurable: true, writable: true,
      value: function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }
  if (typeof prototype.getOrInsertComputed !== "function") {
    Object.defineProperty(prototype, "getOrInsertComputed", {
      configurable: true, writable: true,
      value: function (
        this: Map<unknown, unknown>, key: unknown,
        callback: (key: unknown) => unknown
      ) {
        if (this.has(key)) return this.get(key);
        const value = callback(key);
        this.set(key, value);
        return value;
      },
    });
  }
}
