export class EvalContractFailure extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "EvalContractFailure";
    this.code = opts.code ?? "eval_contract_failure";
    this.path = opts.path ?? null;
    this.details = opts.details ?? null;
    if (opts.cause) {
      this.cause = opts.cause;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      details: this.details,
    };
  }
}

export function contractFailure(message, opts = {}) {
  return new EvalContractFailure(message, opts);
}
