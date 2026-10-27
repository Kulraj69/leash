"use client";
import type { CSSProperties } from "react";
import type { Evaluation } from "@/lib/firewall";
import { formatNear } from "@/lib/policy";
export type WireReceipt = Omit<Evaluation, "remainingBudget"> & {
  remainingBudget: string | null;
};
export function Receipt({
  result,
  sequence = 1,
}: {
  result: WireReceipt | null;
  sequence?: number;
}) {
  return (
    <section
      className={`receipt ${result ? result.verdict.toLowerCase() : ""}`}
      aria-label="Firewall receipt"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="receipt-top">
        <span>LEASH / DECISION RECEIPT</span>
        <span>№ {String(sequence).padStart(4, "0")}</span>
      </div>
      {result ? (
        <div key={sequence}>
          <div className="stamp">{result.verdict.replace("_", " ")}</div>
          <div className="receipt-lines">
            {result.receipt.map((line, i) => (
              <p key={`${i}-${line}`} style={{ "--line": i } as CSSProperties}>
                {line}
              </p>
            ))}
          </div>
          <div className="rule-tags">
            {result.firedRules.map((rule) => (
              <span key={rule}>{rule}</span>
            ))}
          </div>
          <div className="receipt-total">
            <span>BUDGET REMAINING</span>
            <strong>
              {result.remainingBudget === null
                ? "UNBOUNDED"
                : `${formatNear(BigInt(result.remainingBudget))} N`}
            </strong>
          </div>
        </div>
      ) : (
        <div className="receipt-empty">
          <span className="receipt-cursor">▍</span>
          <h3>Standing by.</h3>
          <p>
            Propose an action.
            <br />
            Every decision leaves a paper trail.
          </p>
          <div className="empty-verdicts">
            <span>ALLOW</span>
            <span>ASK</span>
            <span>BLOCK</span>
          </div>
        </div>
      )}
      <div className="receipt-bottom">SIMULATION ONLY · NO FUNDS MOVE</div>
    </section>
  );
}
