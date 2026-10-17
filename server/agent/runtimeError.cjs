class WorkflowError extends Error {
  constructor(reason) { super('Agent workflow stopped'); this.reason = reason; }
}
module.exports = { WorkflowError };
