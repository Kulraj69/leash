# LeashVault for NEAR (DRAFT - local only)

near-sdk-js port of `contracts/src/LeashVault.sol` semantics: one human owner
administers spending rules for one agent account. The contract holds NEAR and
returns ALLOW / ASK_HUMAN / BLOCK for each proposed native transfer.

- `propose` (agent only): ALLOW transfers immediately; ASK_HUMAN stores a
  pending request for owner `approve`/`reject`; BLOCK changes nothing.
- Caps in yoctoNEAR decimal strings: per-transaction, daily (day boundary by
  the owner-set UTC offset, IST = 330), rolling one-hour action limit,
  active-hours window, exact-account receiver allowlist, pause switch.
- `approve` re-evaluates the request against the current policy and balance
  before paying; a policy change between propose and approve can still stop it.
- `check` is a read-only dry run of the same evaluation.

Status: draft. Typechecks against near-sdk-js (`tsc --strict`) and compiles to
wasm via the near-sdk-js builder (`build/contract.wasm`). Not audited, not
deployed, and no testnet write has been made.

Known boundary, same as the Solidity version: the contract enforces amounts,
receivers, rate and hours; it does not inspect memos or validate downstream
contract effects. The web engine's prompt-injection and SOCIAL_PRESSURE checks
are off-chain heuristics and stay off-chain; on-chain enforcement would need
argument validation per method, which this draft intentionally does not claim.
