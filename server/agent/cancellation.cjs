const { WorkflowError } = require('./runtimeError.cjs');
async function cancellable(promise, signal, onAbort = () => {}) {
  if (!signal) return promise;
  let cancel;
  const stopped = new Promise((_, reject) => {
    cancel = () => { onAbort(); reject(new WorkflowError('cancelled')); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener('abort', cancel); }
}
module.exports = { cancellable };
