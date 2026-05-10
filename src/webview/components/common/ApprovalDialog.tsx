import { AnimatePresence, motion } from "framer-motion";
import { useAppStore } from "../../stores/appStore";

export function ApprovalDialog() {
  const req = useAppStore((s) => s.state.pendingApproval);
  const send = useAppStore((s) => s.send);
  const decide = (approved: boolean, rememberSession = false) =>
    req && send({ type: "approval/decide", decision: { id: req.id, approved, rememberSession } });
  return (
    <AnimatePresence>
      {req && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="nx-card w-[460px] max-w-full p-5 shadow-2xl"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="nx-tag" data-risk={req.riskLevel}>
                risk: {req.riskLevel}
              </span>
              <h2 className="text-base font-semibold">Approval requested</h2>
            </div>
            <p className="text-sm text-nexus-muted mb-2">
              The agent wants to call{" "}
              <span className="font-mono text-nexus-text">{req.toolName}</span>.
            </p>
            {req.command && (
              <pre className="text-[12px] bg-nexus-surface-2 border border-nexus-border rounded-lg p-2 overflow-x-auto">
                {req.command}
              </pre>
            )}
            <pre className="text-[12px] bg-nexus-surface-2 border border-nexus-border rounded-lg p-2 mt-2 overflow-x-auto whitespace-pre-wrap max-h-48">
              {req.argsPreview}
            </pre>
            {req.affectedFiles && req.affectedFiles.length > 0 && (
              <div className="mt-3 text-xs text-nexus-muted">
                <div className="font-medium text-nexus-text mb-1">Affected files</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {req.affectedFiles.map((f) => (
                    <li key={f} className="font-mono">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {req.rationale && <p className="text-xs text-nexus-muted mt-3">{req.rationale}</p>}
            <div className="mt-4 flex gap-2 justify-end flex-wrap">
              <button className="nx-btn nx-btn-soft" onClick={() => decide(false)}>
                Reject
              </button>
              <button className="nx-btn nx-btn-soft" onClick={() => decide(true, true)}>
                Approve & remember
              </button>
              <button className="nx-btn nx-btn-primary" onClick={() => decide(true)}>
                Approve once
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
