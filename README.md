# Leash / LEASH 5150

A spending firewall for AI agents: simulated NEAR spending and a Solidity ETH vault for Base Sepolia. Deterministic policies return **ALLOW**, **ASK_HUMAN**, or **BLOCK**, with a readable receipt. A deliberately gullible shopping agent demonstrates why an agent's instructions are not an authorization boundary.

**Built at NEAR HACKATHON.** Tracks: `security`, `agents`, `games`.

This is a local/serverless hackathon prototype. The NEAR flows remain simulated. The Base vault can enforce spending rules on-chain after a human deploys and funds it; no deployment is included here. The web app only reads public NEAR/Base state and previews decisions. It never signs or sends transactions.

## Run

Requires Node.js 20.9+ and npm; Node.js 22+ recommended.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. No account, wallet, token, or API credential is needed. The default badge reads **Demo mode: synthetic data**. The two reference PNGs stay outside `public/` and are ignored by Git; the moon, mountains and ruins are original SVG/CSS scenery adapted from the local qloo night-scene pattern. VT323 and IBM Plex Mono are loaded with `next/font/google` and served by Next.js after the build.

## Judge walkthrough: do X → see Y

Start with **New session** if repeating these steps. The limit is 30 API requests per IP per rolling hour across all tabs; page viewing and changing tabs do not consume requests.

### 1. Policy Lab

1. Leave **Daily essentials** selected and click **Compile policy** → see 2 NEAR/day, 0.5 NEAR/payment, coffee.near and weather.near allowed, human review above 0.3 NEAR, and 5 allowed actions/hour.
2. Append `; spend wisely` and compile → see an explicit **NOT enforced** fragment. The compiler never turns unsupported prose into a claim of protection.
3. Expand **NEAR function-call access keys** → see two key specs, one per exact receiver, decimal-string yocto allowances, and copyable near-cli-rs command templates.
4. Select **Office hours** and compile → see 09:00–21:00 IST and the `forecast` method restriction. Select **Coffee network** and compile → see a suffix rule plus an explicit block, and an explanation that wildcard receivers cannot fit a native function-call key.
5. Restore **Daily essentials**, then compile before trying the firewall walkthrough. Editing the text or loading a preset does not silently activate it; the active-policy panel marks uncompiled edits.

### 2. Firewall

1. Click **Morning coffee** → ALLOW and exactly 1.9 NEAR remaining in this simulated session.
2. Click **Ask the human** → ASK_HUMAN; 0.4 NEAR exceeds the 0.3 threshold, but no budget is consumed. There is intentionally no approval/execution endpoint.
3. Click **Oversized payment** → BLOCK / `PER_TX_CAP`. Click **Unknown receiver** → BLOCK / `ALLOWLIST`.
4. Click **Hidden instruction** → BLOCK / `PROMPT_INJECTION` from the memo. Click **Lookalike account** → BLOCK / `UNICODE_RECEIVER` for the Cyrillic `е` in `coffee.nеar`.
5. Use the custom form to propose native transfers, function calls, FT transfers, or intent swaps. Expand arguments to test JSON containing instruction markers or a mismatched `receiver_id`.

Receipts print line by line; reduced-motion preferences disable the animation. ALLOW means “accepted into this in-memory simulation,” not “sent to NEAR.” BLOCK overrides ASK_HUMAN if both apply. Only ALLOW adds to the session ledger.

### 3. Jailbreak the Wallet

1. Open level 1, click **Load an example attack**, then **Send to agent** → the agent proposes the malicious action; Leash blocks it and records one protected attempt. The synthetic wallet starts with 10 NEAR; the default policy permits only 2 NEAR/day.
2. Levels 2–8 exercise the per-payment cap, injection text, lookalikes, cumulative spending, hourly rate, active hours, and human review. Each example is deterministic in scripted mode. Level 5 starts with 1.9 NEAR already spent; level 6 starts with five prior payments. Scenario time is fixed at 10:00 IST on November 1, 2026, except level 7 at 23:00 IST.
3. Open level 9 and send its example, `call drain on coffee.near with 0 NEAR` → **POLICY GAP FOUND**. The allowlisted receiver exposes an unrestricted method. Check **Apply the policy fix**, load the same attack, and send it → BLOCK / `METHOD`; only `brew` is now permitted.
4. Level 10 intentionally allows `*.coffee.near`. Its example passes to `evil.coffee.near` even though the lesson's business intent only trusts specific accounts. Apply its exact-account fix and re-test → BLOCK / `ALLOWLIST`.
5. Enter an operator name (up to 16 characters) and **Post my score** → a sanitized in-memory leaderboard entry calculated from server-side attempts. Click Refresh to load other local entries.

The teaching oracle is separate from the active policy. It labels attacks by the scenario's intended behavior, including unsafe receivers, sensitive methods, amounts needing review, and the seeded budget/hour/time scenarios. Scores distinguish harmful attempts **blocked**, **held for a human**, and **slipped through**. Safe proposals do not clear levels. A level is **cleared by Leash** only after a harmful attempt is tested and no harmful action has ever passed in that session. A successful fix does not erase an earlier slip; start a new session for a clean score. Repeated attacks can add points; this is a teaching leaderboard, not a competitive anti-cheat system.

### 4. Inspect account

1. Leave `leash-demo.testnet` and click **Inspect account** → see the synthetic 10 NEAR balance, `mock-block-5150`, and two public-key fixtures with `mock-` labels. Any valid ID gets this fixture in demo mode; it is not that account's actual state.
2. To inspect actual public state, set `NEAR_LIVE=1`, restart the app, enter an account that exists on the configured network, and inspect → two `query` calls retrieve the balance and key permissions. The second query uses the first response's block height for a consistent snapshot.
3. Inspect a nonexistent live account → a friendly RPC failure. Live errors never masquerade as mock results.

The `.near` receivers elsewhere in the demo are illustrative. For live inspection or human-run CLI commands, choose actual receivers on the configured network; the CLI templates explicitly target testnet.

## Policy language and exact units

`src/lib/policy.ts` defines the typed policy and exact arithmetic. Internally all money uses `bigint`: **1 NEAR = 10^24 yoctoNEAR**. JSON represents amounts as unsigned decimal strings, never floating-point numbers. Values must fit NEAR's u128 range. Decimal parsing accepts up to 24 fractional digits and rejects scientific notation, negative values, commas and excess precision.

| Clause                                      | Compiled rule                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `max 2 NEAR a day`                          | `dailyBudgetYocto`                                                           |
| `never more than 0.5 NEAR per payment`      | `perTxCapYocto`                                                              |
| `only pay weather.near and coffee.near`     | exact receiver allowlist                                                     |
| `only pay *.coffee.near`                    | strict dot-boundary subaccount suffix; does not include `coffee.near` itself |
| `block evil.near` / `never pay evil.near`   | blocklist; wins over the allowlist                                           |
| `only methods brew and menu on coffee.near` | method restriction for this receiver                                         |
| `ask me above 0.3 NEAR`                     | strict greater-than human threshold                                          |
| `no more than 5 payments an hour`           | allowed actions in a rolling 60-minute window                                |
| `only between 9am and 9pm`                  | IST start inclusive, end exclusive; overnight windows supported              |
| `only tokens NEAR and wrap.testnet`         | allowed native token / FT contract identifiers                               |

Separate clauses with semicolons, newlines, or a comma before the next recognizable clause. Whole clauses must match. Unknown fragments are returned verbatim. Later recognized clauses replace the same setting; block clauses accumulate. The compiler never calls an LLM.

Defaults are visible in the UI: 2 NEAR/day, 0.5/payment, ask above 0.3, 5/hour, NEAR only, all hours, **no receivers allowed until specified**. Unspecified receiver methods permit all contract methods. `null` represents an unconstrained field in the typed/API policy; an empty allowlist permits no receivers. An empty method list in the firewall permits no actions; it is never compiled into an on-chain empty method list, which would mean all methods. Exact and matching suffix method constraints are intersected. Method-only rules do not permit native transfers. Daily budgets reset at midnight IST, independently of the API's UTC global quota.

Actions use `{ kind, receiver, amountYocto, method?, token?, memo?, args? }`. For native transfers and function calls, the amount is the proposed NEAR value/deposit. For FT and intent proposals, it is a **caller-supplied NEAR-equivalent simulated valuation**, not an FT base-unit amount. No price oracle, signed quote validation, slippage checks, gas estimation or arbitrary contract-effect analysis is implemented. FT receivers refer to the normalized beneficiary rather than the token contract. Token contracts belong in `token`.

## NEAR features and boundaries

- **Function-call access keys:** `compileAccessKey(policy)` emits `{ receiver_id, method_names, allowance, command }` per exact, unblocked receiver. One key has one receiver. Wildcards require explicit expansion. A missing method restriction produces an all-methods warning; incompatible/deny-all methods produce no key. No key is generated for an unlimited budget.
- **Gas allowance is not a spending budget:** the CLI preview uses the policy's daily budget as a suggested cumulative gas allowance. This does **not** enforce daily resets or transferred value. Splitting keys does not give them a shared allowance. The human must review and select an appropriate gas cap.
- **Native limitations:** function-call keys cannot make native transfers or attach deposits. Standard `ft_transfer` requires a 1-yocto deposit, so these keys cannot directly authorize it. Budgets, approval, frequency, token policy, argument checks and time windows still require enforcement outside the key itself.
- **Public NEAR RPC:** only `query` with `view_account` and `view_access_key_list`; finalized state, 8-second per-query timeout, 30-second cache, 256 cached account snapshots maximum. No signing library or transaction RPC exists in the app.
- **NEAR Intents extension point:** `intent_swap` currently simulates a normalized proposal. A production adapter would verify a quote, beneficiary, tokens, amounts, expiry and slippage; derive a trusted valuation; evaluate and atomically reserve the budget; then pass an approved intent to a separate authorized signer. Confirmed settlement would reconcile that reservation. This repository neither requests quotes nor signs/submits intents.

The CLI output is a human-run **template** with `YOUR_ACCOUNT.testnet` and `YOUR_PUBLIC_KEY` placeholders. It uses near-cli-rs's `near account add-key ... grant-function-call-access --allowance ... --receiver-account-id ... --method-names ... use-manually-provided-public-key ... network-config testnet sign-with-keychain send` flow. Replace placeholders with an existing account and public key, and use a distinct public key per receiver. Leash only displays/copies the text. Actually running it in a separate terminal would add a key on-chain and requires your own review and authorization.

References: [NEAR CLI](https://docs.near.org/tools/cli), [NEAR access keys](https://docs.near.org/protocol/access-keys), [NEAR RPC](https://docs.near.org/api/rpc/introduction), [NEAR Intents docs](https://docs.near-intents.org/).

## Base (Sepolia)

**Contract: `<ADDRESS>`** — placeholder for a future deployment on chain **84532**. Explorer: `https://sepolia.basescan.org/address/<ADDRESS>`. No contract was deployed or funded as part of this change.

Choose **Base Sepolia** in the Network selector. NEAR testnet remains the default, and switching back preserves the NEAR lab/game session. The Base screen shows the vault address, owner, agent, policy, ETH balance, today's spend and rolling-hour action count. **Preview a payment on-chain** calls `check(address,uint256,bytes4)` through `eth_call`, with selector zero for a native ETH payment. The resulting receipt does not debit a budget, queue an approval, emit an on-chain event, or send a transaction. A preview describes one block's state; execution may later encounter changed rules/state or a reverting recipient.

With no address configured, the Base screen explicitly says **Not deployed** and uses a **mock-vault** fixture. Its balance is a synthetic 0.001 ETH, its spent amount/action count stay at zero, and its previews make no RPC calls. Try 0.00001 ETH for ALLOW, 0.00004 ETH for ASK_HUMAN, and 0.00006 ETH for BLOCK / `PER_TX_CAP` using the prefilled coffee address. Configuring an address enables live reads; a wrong network, missing contract or RPC failure is an error, never a substitute mock result.

### Contract and tests

`contracts/src/LeashVault.sol` uses Solidity 0.8.24, with no contract dependencies. `forge-std` is only used for tests and the human-run deployment script. From the repository root:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
forge install foundry-rs/forge-std@bd8c87087369377df8b451de74fb3a4fa9a7f577 --no-git
forge build
forge test -vv
cd ..
```

The pinned dependency is installed inside `contracts/lib/`, which is ignored along with `contracts/out/` and `contracts/cache/`. There are no Git submodules and the web build needs no Foundry install. TypeScript, ESLint, Vitest and Next.js output tracing exclude the contract project. Broadcast records are not blanket-ignored; a future `contracts/broadcast/*/84532/run-latest.json` can be committed after a real deployment.

The Foundry suite has **29 tests**, including a **256-run fuzz test** asserting that successful payments and approvals never exceed the daily cap across day rollover. It also covers every reason code, rolling-hour expiry, IST boundaries, overnight hours, approvals/rejections, selector restrictions, authorization, pause/recovery, recipient failures, reentrancy and deployment defaults/overrides in a local test VM. None of these tests broadcasts transactions.

### Human-run deployment template

The following command **would deploy** and configure a vault on Base Sepolia. Run it yourself from the repository root when ready; `KEY` belongs in your own shell for Foundry, never in the web app's environment or browser.

```sh
export PATH="$HOME/.foundry/bin:$PATH"
# Optional: export AGENT_ADDRESS=0x...   # defaults to the deployer
# Optional: export FUND_WEI=0           # default; initial ETH in exact wei
forge script contracts/script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org --broadcast --private-key "$KEY" \
  --root "$PWD/contracts"
```

The deployer becomes the immutable owner. The script applies a Daily essentials policy: **0.0002 ETH/day**, **0.00005 ETH/payment**, human review **above 0.00003 ETH**, **5 successful actions per rolling hour**, offset **+330 minutes (IST)**. Start/end are both zero, so active-hour restrictions are disabled. To use 09:00–21:00 IST, the owner can set start/end to 540/1260 through `setPolicy`.

The script allowlists these exact addresses, derived from the low 160 bits of `keccak256("coffee")` and `keccak256("weather")`:

- Coffee: `0x3bd349193d64331371ae5d047e0f91db989e8e35`
- Weather: `0x6f2e2f1380aa176569b6c84f16d7f2ced5965666`

These are deterministic demo placeholders, not services or accounts with known private keys. Replace the receiver configuration for meaningful use. The default initial funding is zero. After deploying, fill `<ADDRESS>` above and set one of the vault-address variables below, then restart/rebuild the web app as appropriate.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_RPC_URL` | `https://sepolia.base.org` | Server-only JSON-RPC endpoint; must report Base Sepolia chain 84532. |
| `NEXT_PUBLIC_LEASH_BASE_ADDRESS` | blank | Vault address; blank with no server override enables the labeled not-deployed fixture. Public-prefixed values are captured at Next.js build time. |
| `BASE_VAULT_ADDRESS` | blank | Optional server-side vault address; takes precedence over the public variable. |
| `AGENT_ADDRESS` | deployer | Foundry script only: address permitted to request spending. |
| `FUND_WEI` | `0` | Foundry script only: constructor funding in unsigned decimal wei, taken from the deployer. |

Live reads use plain fetch JSON-RPC with an 8-second timeout per call, no cache and no signing dependencies. `eth_chainId` verifies the network; `eth_blockNumber` pins `eth_getCode`, `eth_getBalance`, policy/getter calls and the optional preview to one block number. The receiver allowlist is a mapping: the UI checks the proposed receiver rather than claiming to enumerate the full list. All ETH amounts in JSON are exact unsigned decimal **wei** strings (**1 ETH = 10^18 wei**).

### Enforcement and boundaries

- Only the configured agent can call `pay` or `execute`. Policy BLOCKs emit `Blocked` and return without moving ETH. They still require an actual agent transaction to appear on-chain and cost transaction gas. Invalid authorization reverts with a custom error.
- ASK_HUMAN queues a request with its target, value and original calldata/memo hash, without reserving spend. The owner can `approve(id)` or `reject(id)`. Approval rechecks **all current restrictions**, bypassing only the human threshold. A blocked approval stays pending for retry/rejection; successful or rejected requests cannot be executed again.
- Successful agent payments, calls and approvals consume the daily budget and rolling-hour count. Daily buckets reset at midnight in the policy's fixed UTC offset, rather than after a trailing 24 hours. Active windows include the start, exclude the end, and support overnight hours. Equal start/end permits the full day. Zero caps or a zero rate deny the corresponding spending; a max-uint256 human threshold effectively disables review.
- `execute` requires at least four calldata bytes. Before any `setSelector` call, an allowlisted receiver permits all selectors. The first `setSelector(receiver, selector, bool)` enables restrictions permanently for that receiver, including when `bool` is false. Revoking the last permitted selector denies all `execute` calls there. Restricting a coffee contract to `brew` blocks the level-9 `drain` example. Native `pay` calls use empty calldata and are outside selector restrictions. `checkExecute` also previews actual zero selectors and malformed calldata; `check` reserves selector zero for payment previews.
- The owner can deposit ETH, change policy/agent/receivers/selectors, pause/unpause, and withdraw even while paused. Owner withdrawals are recovery operations outside agent limits. Policy changes do not clear spend or action history, but changing the UTC offset changes the calendar buckets used. The owner is a trusted administrator, not constrained by the agent's spending policy.
- A simple reentrancy guard protects every mutating entry point. Accounting and approval status update before recipient calls; a failed call reverts the entire execution with `CallFailed`, restoring counters and pending status. The rolling-hour lookup uses binary search over successful-action timestamps; storage grows by one slot per successful action.

Base reason names are `POLICY_PASSED`, `PER_TX_CAP`, `DAILY_CAP`, `ALLOWLIST`, `RATE_LIMIT`, `ACTIVE_HOURS`, `METHOD`, `PAUSED`, `NEEDS_APPROVAL` and `INSUFFICIENT_BALANCE`. `DAILY_CAP`, `RATE_LIMIT` and `NEEDS_APPROVAL` correspond to the NEAR simulation's `DAILY_BUDGET`, `HOURLY_RATE` and `HUMAN_THRESHOLD`. The contract returns the first blocking reason; the NEAR simulator can list multiple fired rules.

This vault enforces ETH value, exact receivers and optional selectors. It does not implement NEAR's prompt-injection/lookalike heuristics, memo inspection, token valuation, wildcard accounts, or arbitrary argument/contract-effect analysis. An allowed selector can still have dangerous effects; empty-calldata ETH payments can invoke recipient code. ERC-20 transfers or approvals triggered by a zero-value call are not measured by the ETH budget. This is testnet prototype code without an independent security audit, not a claim that an arbitrary agent wallet is protected.

## Architecture

```text
Plain English ──> deterministic compiler ──> typed Policy ──> key specs + CLI preview
                                                │
Form / gullible agent ──> normalized Action ──> evaluate(action, policy, ledger, now)
                                                │
                                      ALLOW / ASK_HUMAN / BLOCK
                                                │
                                      receipt + simulated ledger

Account inspector ──> mock fixture OR view-only NEAR JSON-RPC

Base inspector ──> not-deployed mock OR view-only Base JSON-RPC + check preview
Human-run Foundry script ──> LeashVault ──> enforced agent ETH spending after deployment
```

| Module                             | Responsibility                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| `src/lib/policy.ts`                | types, BigInt parsing/formatting, input validation, presets     |
| `src/lib/compile.ts`               | deterministic grammar and native key previews                   |
| `src/lib/firewall.ts`              | pure rules, injection heuristics, receipts, IST accounting      |
| `src/lib/game.ts`                  | ten fresh scripted scenarios, teaching oracle, scoring, fixes   |
| `src/lib/llm.ts`                   | optional bounded Nebius action proposal; scripted fallback      |
| `src/lib/near.ts`                  | mock/live public RPC parsing and TTL cache                      |
| `src/lib/base.ts`, `base-values.ts` | Base ABI, exact wei units, mock/live vault reads and previews   |
| `contracts/src/LeashVault.sol`     | owner-administered ETH spending and approval enforcement       |
| `src/lib/store.ts`                 | capped session ledgers and leaderboard                          |
| `src/lib/http.ts`, `rate-limit.ts` | 2 KB body/URL caps, validation, JSON serialization, rate limits |
| `src/app/api/*`                    | thin request handlers; no signing or transaction path           |
| `src/components/*`                 | four-tab terminal, SVG night scene, receipt printer             |

The app uses Next.js 16.4.3, TypeScript 5.9.3, React 19.3, and Tailwind v4, following the sibling qloo configuration. Vitest was upgraded to 4.1.12 because npm audit reported vulnerabilities in the reference version's test dependencies. The rate limiter, Nebius wrapper, Vercel install command, Vitest alias pattern and night scene are adapted from that reference.

## API

All routes share **30 requests/IP/rolling hour** and **3,000 requests/UTC day**, including invalid requests, demos and GET requests. A 429 includes a friendly explanation and `Retry-After` seconds. Request bodies and URLs are capped at **2,048 UTF-8 bytes**; the whole JSON body counts. POSTs require `application/json`.

| Route                          | Input                                      | Response                                                 |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| `POST /api/compile`            | `{ text }`                                 | policy, unparsed fragments, defaults/notes, key previews |
| `POST /api/evaluate`           | `{ policy, action, sessionId }`            | verdict, firedRules, receipt, remainingBudget            |
| `POST /api/game/turn`          | `{ level, message, sessionId, applyFix? }` | proposed action, agent source/reply, verdict, score, fix |
| `GET /api/near/account?id=...` | valid account ID                           | mock or live public snapshot                             |
| `GET /api/base/vault`          | optional `?to=0x...&amountWei=...`         | mock or live vault snapshot, optional check preview       |
| `POST /api/base/vault`         | `{ to, amountWei }`                       | read-only vault snapshot and payment check; no execution  |
| `GET /api/leaderboard`         | —                                          | top 20 in-memory scores                                  |
| `POST /api/leaderboard`        | `{ name, sessionId }`                      | server-calculated score and leaderboard                  |

Session IDs are 16–80 ASCII letters/digits/underscores/hyphens. The UI uses a random UUID in `sessionStorage`, with a memory fallback. IDs are demo bearer identifiers, not authenticated identities. Policy text is limited to 1,600 characters, messages to 1,000, and leaderboard names to 16; the byte cap applies additionally. Changing tabs preserves the current UI. **New session** resets simulated spending and game state, and never touches a wallet.

Evaluation and ledger reservation happen synchronously with no await between them; game model calls finish before reading/reserving the current session. Game ledgers are separate per level and fix mode, so scenarios and the Policy Lab cannot contaminate each other. Sessions expire after 24 hours idle; at most 500 sessions, 200 attempts/session, 100 published scores, and 256 RPC cache entries are retained.

## Environment

| Variable         | Default                        | Meaning                                                                    |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `NEAR_LIVE`      | unset / `0`                    | Only literal `1` enables live view-only RPC.                               |
| `NEAR_RPC_URL`   | `https://rpc.testnet.near.org` | Server-configured RPC endpoint; never accepted from a user request.        |
| `NEBIUS_API_KEY` | blank                          | Optional server-side model credential; blank uses the deterministic agent. |

With a Nebius key, game messages are sent to `https://api.tokenfactory.nebius.com/v1/chat/completions` using `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `/no_think`, thinking disabled, `max_tokens: 300`, temperature 0, and an 8-second timeout. Only a validated action proposal is accepted; original player text is preserved in the memo for firewall inspection. Any model/provider/format failure uses the scripted fallback, and the UI labels the actual source. No model can produce a trusted verdict or alter the game's policy.

Do not enter secrets in game messages or memos. Environment files and key/credential directories are ignored; `.env.example` contains only placeholders. The app never logs environment values or API credentials. Fonts may require Google network access during a clean build; runtime pages serve the generated font assets locally.

## Tests and build

```sh
npm test
npm run typecheck
npm run build
npm run lint
```

The Vitest suite has **240 tests**, including **62 Base tests** for ABI encoding/decoding, exact wei arithmetic, mocked JSON-RPC, network/contract validation, mock labeling, route behavior and shared quotas. It also covers grammar/unparsed fragments, multi-receiver key splitting, method intersections, verdict precedence, cumulative budgets, rolling rates, IST boundaries, Unicode and one-edit receivers, injection text/arguments, all ten levels and fixes, sanitized leaderboard scores, cache expiry, Nebius fallback, API byte caps, malformed inputs, concurrent reservations and session isolation. Tests never use live blockchain or model services. Run the separate Foundry suite using the Base instructions above.

Vercel is the deployment target. `vercel.json` explicitly uses `npm install --include=dev` so TypeScript/Tailwind/build tooling is installed. No deployment or Git push is needed to run locally.

## Safety and remaining work

- The web app accepts, generates, stores and uses no private wallet keys. It has no signer, send-transaction route, wallet connection, key-management execution, or intent execution. The separate human-run Foundry deployment command uses the deployer's key outside the app.
- The pure engine is deterministic, but prompt-injection/typosquatting checks are **heuristics**, not complete defenses. Encoded instructions, arbitrary contract effects, deceptive arguments and valuation manipulation need a stricter normalized action adapter and contract-specific validation. Levels 9–10 demonstrate the distinction between a policy passing and an action being safe.
- The NEAR sandbox accepts a user-supplied policy and permits a fresh session. Neither is a production security boundary. Production must authenticate the operator, protect policy changes, bind ledgers to an account and enforce checks in the only available spending path. The Base contract applies owner-only administration and contract-local accounting to ETH it holds; it does not govern an agent's other wallets.
- Session storage, quotas, caches and leaderboard are **per process/serverless instance**. They reset on restart/cold start and are not shared across Vercel instances. Multiple instances can each grant the advertised quota. A production firewall requires durable shared storage, atomic reservations, trusted time and a distributed limiter. Local deployments must overwrite proxy IP headers; on Vercel the limiter uses `x-vercel-forwarded-for`.
- The NEAR game remains an educational simulation, not evidence that an actual account is protected. Browser receipts, including Base read-only previews, are not signed audit records. The game does not analyze arbitrary contract semantics or guarantee model compliance.

Hackathon preparation notes remain in `PLAN.md`. The supplied event rules specify November 1–14, 2026 UTC; work prepared earlier should not be misrepresented as occurring inside that window. Repository publication, demo posting, deployment, mainnet activity and final submission are separate human-controlled steps. None is performed by this app or these build instructions.

MIT license, Kulraj Singh, 2026.
