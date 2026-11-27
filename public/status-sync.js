'use strict';

(function (root) {
  function createStatusSync() {
    const inFlight = new Set();
    return {
      pending(id) {
        return inFlight.has(String(id));
      },
      async run(id, handlers) {
        const key = String(id);
        if (inFlight.has(key)) return { skipped: true };
        inFlight.add(key);
        handlers.optimistic();
        try {
          const result = await handlers.request();
          await handlers.commit(result);
          return { ok: true, result };
        } catch (error) {
          handlers.rollback(error);
          return { ok: false, error };
        } finally {
          inFlight.delete(key);
        }
      },
    };
  }

  const api = { createStatusSync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorkspaceStatusSync = api;
})(typeof window !== 'undefined' ? window : null);
