// Local-sandbox end-to-end harness for the Leash NEAR vault contract.
// Runs the built WASM (contracts-near/build/contract.wasm) inside a local
// near-workspaces sandbox - no testnet keys, no real funds.
// Pinned to near-workspaces@3.5.0 (the 5.x API is incompatible with this harness).
// Run: npm ci && npm run test:sandbox
import { Worker, NEAR } from 'near-workspaces';

const N = (n) => NEAR.parse(`${n} N`).toString();
const GAS = '250000000000000';
const WASM = new URL('../contracts-near/build/contract.wasm', import.meta.url).pathname;
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

const POLICY = {
  dailyCap: N(2), perTxCap: N(0.5), askAbove: N(0.3),
  maxActionsPerHour: 10, activeStartMinute: 0, activeEndMinute: 0, utcOffsetMinutes: 330,
};

const worker = await Worker.init();
try {
  const root = worker.rootAccount;
  const owner = await root.createSubAccount('owner', { initialBalance: N(50) });
  const agent = await root.createSubAccount('agent', { initialBalance: N(5) });
  const receiver = await root.createSubAccount('coffee', { initialBalance: N(1) });

  // Vault A: core decision flow (ALLOW / BLOCK / ASK_HUMAN / view).
  const vault = await root.devDeploy(WASM, { initialBalance: N(10) });
  await owner.call(vault, 'init', { owner: owner.accountId, agent: agent.accountId });
  await owner.call(vault, 'set_policy', { agent: agent.accountId, policy: POLICY });
  await owner.call(vault, 'set_receiver', { receiver: receiver.accountId, allowed: true });
  await owner.call(vault, 'deposit', {}, { attachedDeposit: N(5) });

  // 1. ALLOW: small allowlisted transfer executes
  const before = (await receiver.balance()).total;
  const v1 = await agent.call(vault, 'propose', { receiver: receiver.accountId, amount: N(0.1), memo: 'coffee' }, { gas: GAS });
  ok('ALLOW executes transfer', v1.decision === 'ALLOW', JSON.stringify(v1));
  const after = (await receiver.balance()).total;
  ok('receiver balance +0.1 NEAR', before.add(NEAR.parse('0.1 N')).toString().slice(0, 20) === after.toString().slice(0, 20), `before=${before} after=${after}`);

  // 2. BLOCK: over per-tx cap
  const v2 = await agent.call(vault, 'propose', { receiver: receiver.accountId, amount: N(0.6), memo: 'too big' }, { gas: GAS });
  ok('BLOCK over per-tx cap', v2.decision === 'BLOCK', JSON.stringify(v2));

  // 3. ASK_HUMAN -> approve re-evaluates and pays
  const v3 = await agent.call(vault, 'propose', { receiver: receiver.accountId, amount: N(0.4), memo: 'needs ok' }, { gas: GAS });
  ok('ASK_HUMAN queued', v3.decision === 'ASK_HUMAN' && typeof v3.requestId === 'number', JSON.stringify(v3));
  const b2 = (await receiver.balance()).total;
  const v4 = await owner.call(vault, 'approve', { id: v3.requestId }, { gas: GAS });
  const a2 = (await receiver.balance()).total;
  ok('approve pays out', v4.decision === 'ALLOW' && b2.add(NEAR.parse('0.4 N')).toString().slice(0, 20) === a2.toString().slice(0, 20), JSON.stringify(v4));

  // 4. view check agrees
  const v5 = await vault.view('check', { receiver: receiver.accountId, amount: N(0.6) });
  ok('view check BLOCK consistent', v5.decision === 'BLOCK', JSON.stringify(v5));

  // Vault B (fresh): rate-limit family on a clean hourly-slot ledger, so the
  // vault-A actions above cannot pollute the slot counts.
  const vaultB = await root.devDeploy(WASM, { initialBalance: N(10) });
  await owner.call(vaultB, 'init', { owner: owner.accountId, agent: agent.accountId });
  await owner.call(vaultB, 'set_receiver', { receiver: receiver.accountId, allowed: true });
  await owner.call(vaultB, 'deposit', {}, { attachedDeposit: N(5) });

  // 5. Rate limit engages after maxActionsPerHour successful actions
  await owner.call(vaultB, 'set_policy', { agent: agent.accountId, policy: { ...POLICY, maxActionsPerHour: 1 } });
  const v6 = await agent.call(vaultB, 'propose', { receiver: receiver.accountId, amount: N(0.1), memo: 'uses slot' }, { gas: GAS });
  const v7 = await agent.call(vaultB, 'propose', { receiver: receiver.accountId, amount: N(0.1), memo: 'over limit' }, { gas: GAS });
  ok('hourly rate limit blocks 2nd action', v6.decision === 'ALLOW' && v7.decision === 'BLOCK', `${v6.decision}/${v7.decision}`);

  // 6. THE FIXED BUG: failed transfer must not consume the hourly slot
  await owner.call(vaultB, 'set_receiver', { receiver: 'ghost.test.near', allowed: true });
  await owner.call(vaultB, 'set_policy', { agent: agent.accountId, policy: { ...POLICY, maxActionsPerHour: 2 } });
  const v8 = await agent.call(vaultB, 'propose', { receiver: 'ghost.test.near', amount: N(0.1), memo: 'will fail on chain' }, { gas: GAS });
  ok('ghost propose returns ALLOW (transfer later fails)', v8.decision === 'ALLOW', JSON.stringify(v8));
  const v9 = await agent.call(vaultB, 'propose', { receiver: receiver.accountId, amount: N(0.1), memo: 'should still fit' }, { gas: GAS });
  ok('failed transfer did not consume slot (FIX)', v9.decision === 'ALLOW', `after ghost: ${v9.decision} ${v9.reason || ''}`);

  // 7. pause blocks everything
  await owner.call(vault, 'set_paused', { paused: true });
  const v10 = await agent.call(vault, 'propose', { receiver: receiver.accountId, amount: N(0.1), memo: 'paused' }, { gas: GAS });
  ok('paused blocks', v10.decision === 'BLOCK' && v10.reason === 'PAUSED', JSON.stringify(v10));

  // 8. non-agent cannot propose
  let denied = false;
  try { await owner.call(vault, 'propose', { receiver: receiver.accountId, amount: N(0.1), memo: 'x' }, { gas: GAS }); }
  catch (e) { denied = /agent only/i.test(String(e)); }
  ok('non-agent propose rejected', denied);
} finally {
  await worker.tearDown();
}
let fails = 0;
for (const [s, name, extra] of results) { if (s === 'FAIL') fails++; console.log(`${s}  ${name}${extra ? '  | ' + extra : ''}`); }
console.log(`\n${results.length - fails}/${results.length} sandbox assertions passed`);
process.exit(fails ? 1 : 0);
