import type { ApprovalDecision, ApprovalRequest } from "../../shared/types";

interface PendingRequest {
  req: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
}

/**
 * Pairs `request()` (called from the agent loop) with `decide()` (called by
 * the webview when the user clicks Approve/Reject).
 *
 * The agent loop awaits the returned promise; if the gate is destroyed
 * (e.g. task cancelled) all pending requests are rejected.
 */
export class ApprovalGate {
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(req: ApprovalRequest) => void>();

  onRequest(fn: (req: ApprovalRequest) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  request(req: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(req.id, { req, resolve });
      for (const fn of this.listeners) fn(req);
    });
  }

  decide(decision: ApprovalDecision): boolean {
    const p = this.pending.get(decision.id);
    if (!p) return false;
    this.pending.delete(decision.id);
    p.resolve(decision);
    return true;
  }

  cancelAll(reason = "cancelled"): void {
    for (const [, p] of this.pending) {
      p.resolve({ id: p.req.id, approved: false, rememberSession: false });
    }
    this.pending.clear();
    void reason;
  }

  isPending(id: string): boolean {
    return this.pending.has(id);
  }
}
