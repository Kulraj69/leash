"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import type { BaseVaultView, PaymentPreview } from "@/lib/base";
import {
  BASE_REASON_TEXT,
  DEMO_RECEIVERS,
  formatEth,
  parseEth,
} from "@/lib/base-values";
import { Receipt, type WireReceipt } from "./receipt";

async function readVault(
  payment?: PaymentPreview,
  signal?: AbortSignal,
): Promise<BaseVaultView> {
  const response = await fetch("/api/base/vault", {
    signal,
    cache: "no-store",
    ...(payment
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payment),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Could not read the Base vault.");
  return data;
}

const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function BaseVault() {
  const [vault, setVault] = useState<BaseVaultView | null>(null);
  const [to, setTo] = useState<string>(DEMO_RECEIVERS[0]);
  const [amount, setAmount] = useState("0.00001");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [sequence, setSequence] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    readVault(undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setVault(value);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not read the Base vault.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function refresh(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    // Clear the previous snapshot/receipt so a failed read cannot look current.
    setVault(null);
    try {
      const payment = event
        ? { to, amountWei: parseEth(amount).toString() }
        : undefined;
      setVault(await readVault(payment));
      setSequence((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not read the Base vault.",
      );
    } finally {
      setBusy(false);
    }
  }

  const p = vault?.policy;
  const preview = vault?.preview;
  const remaining =
    p && vault
      ? BigInt(p.dailyCapWei) > BigInt(vault.spentTodayWei)
        ? BigInt(p.dailyCapWei) - BigInt(vault.spentTodayWei)
        : 0n
      : 0n;
  const receipt: WireReceipt | null =
    vault && preview
      ? {
          verdict: preview.verdict,
          firedRules: [preview.reason],
          remainingBudget: remaining.toString(),
          receipt: [
            vault.source === "live"
              ? `BASE SEPOLIA / block ${vault.blockNumber}`
              : "BASE SEPOLIA / MOCK FIXTURE / NOT DEPLOYED",
            `Payment → ${preview.to}`,
            `Value: ${formatEth(BigInt(preview.amountWei))} ETH`,
            BASE_REASON_TEXT[preview.reason],
            "Preview only. No ETH moved, approval request created, or on-chain event emitted.",
            ...(vault.source === "live"
              ? [
                  "State can change before execution. Recipient code can still revert.",
                ]
              : []),
          ],
        }
      : null;

  return (
    <section aria-labelledby="base-title" className="base-vault">
      <div className="section-heading">
        <div>
          <div className="eyebrow">BASE SEPOLIA / ETH VAULT</div>
          <h1 id="base-title">Spending rules on-chain.</h1>
          <p>
            The Solidity vault enforces agent payments when deployed. This
            screen reads public state and previews decisions; it never sends
            transactions.
          </p>
        </div>
      </div>
      <div className="base-toolbar">
        <p role="status">
          {busy ? "Reading vault…" : vault?.label || "Vault unavailable"}
        </p>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => refresh()}
        >
          <RefreshCw size={14} /> Refresh vault
        </button>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {vault && (
        <>
          {vault.address ? (
            <p className="base-address">
              Contract:{" "}
              <a
                href={`https://sepolia.basescan.org/address/${vault.address}`}
                target="_blank"
                rel="noreferrer"
              >
                {vault.address}{" "}
                <ExternalLink size={12} aria-label="View on Basescan" />
              </a>
              <span className="small">
                Snapshot at block {vault.blockNumber} ·{" "}
                {vault.paused ? "PAUSED" : "Agent spending enabled"}
              </span>
            </p>
          ) : (
            <div className="warning">
              <strong>Not deployed</strong>
              <p>
                No Base vault address is configured. Policy, balance and
                previews below are a mock demo fixture, with no blockchain
                calls.
              </p>
            </div>
          )}
          <div className="inspect-grid">
            <section className="account-results" aria-label="Base vault policy">
              <div className="panel-label">
                <span>
                  <ShieldCheck size={14} />{" "}
                  {vault.source === "live" ? "ON-CHAIN POLICY" : "MOCK POLICY"}
                </span>
              </div>
              <div className="account-stats">
                <div>
                  <span>VAULT BALANCE</span>
                  <strong>
                    {formatEth(BigInt(vault.balanceWei))} <small>ETH</small>
                  </strong>
                </div>
                <div>
                  <span>SPENT TODAY</span>
                  <strong>
                    {formatEth(BigInt(vault.spentTodayWei))} <small>ETH</small>
                  </strong>
                </div>
              </div>
              <dl className="policy-table">
                <div>
                  <dt>Daily cap</dt>
                  <dd>{formatEth(BigInt(vault.policy.dailyCapWei))} ETH</dd>
                </div>
                <div>
                  <dt>Per payment</dt>
                  <dd>{formatEth(BigInt(vault.policy.perTxCapWei))} ETH</dd>
                </div>
                <div>
                  <dt>Ask human above</dt>
                  <dd className="amber-text">
                    {formatEth(BigInt(vault.policy.askAboveWei))} ETH
                  </dd>
                </div>
                <div>
                  <dt>Rolling 60-minute actions</dt>
                  <dd>
                    {vault.actionsLastHour} / {vault.policy.maxActionsPerHour}
                  </dd>
                </div>
                <div>
                  <dt>Active hours</dt>
                  <dd>
                    {vault.policy.activeStartMinute ===
                    vault.policy.activeEndMinute
                      ? "All hours"
                      : `${time(vault.policy.activeStartMinute)}–${time(vault.policy.activeEndMinute)}`}
                  </dd>
                </div>
                <div>
                  <dt>Day boundary / time offset</dt>
                  <dd>
                    UTC{vault.policy.utcOffsetMinutes >= 0 ? "+" : "−"}
                    {time(Math.abs(vault.policy.utcOffsetMinutes))}
                    {vault.policy.utcOffsetMinutes === 330 ? " (IST)" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Receiver policy</dt>
                  <dd>Exact allowlist; checked on preview</dd>
                </div>
              </dl>
              {vault.owner && (
                <p className="small base-address">
                  Owner: {vault.owner}
                  <br />
                  Agent: {vault.agent}
                </p>
              )}
              <p className="small">
                The owner can restrict function selectors per receiver for
                contract calls. Payment previews below check a plain ETH
                payment.
              </p>
            </section>
            <div>
              <form className="inspect-form" onSubmit={refresh}>
                <h2>Preview a payment on-chain</h2>
                <p className="small">
                  {vault.source === "live"
                    ? "Calls the vault’s check function via eth_call. Gas-free, with no signature or submission."
                    : "Mock preview until a vault is deployed and configured."}
                </p>
                <label htmlFor="base-receiver">Receiver address</label>
                <input
                  id="base-receiver"
                  required
                  pattern="0x[0-9a-fA-F]{40}"
                  maxLength={42}
                  spellCheck={false}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <label htmlFor="base-amount">Amount · ETH</label>
                <input
                  id="base-amount"
                  required
                  inputMode="decimal"
                  maxLength={79}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <p className="small">
                  Prefilled with the deterministic coffee demo receiver.
                </p>
                <button className="primary-button" disabled={busy}>
                  {vault.source === "live"
                    ? "Preview via eth_call"
                    : "Preview mock payment"}
                  <ArrowRight size={15} />
                </button>
              </form>
            </div>
          </div>
          <Receipt
            result={receipt}
            sequence={sequence}
            currency="ETH"
            budgetLabel="BUDGET NOW · UNCHANGED"
            footer={
              vault.source === "live"
                ? "READ-ONLY ETH_CALL · NO TRANSACTION SENT"
                : "MOCK PREVIEW · NO ON-CHAIN CALL"
            }
          />
        </>
      )}
    </section>
  );
}
