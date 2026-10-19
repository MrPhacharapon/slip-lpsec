// Compatibility shim for the isolated PDF.js worker in older browsers.
if (typeof Map.prototype.getOrInsert !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsert", {
    configurable: true, writable: true,
    value: function (key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    },
  });
}
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    configurable: true, writable: true,
    value: function (key, callback) {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
  });
}
await import("./pdf.worker.min.mjs");
