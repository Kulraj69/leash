# Leash human demo runbook

Local demo only. The browser never connects a wallet or sends funds. Record and publish your own screen/video; this package does not supply a human-recorded demo or approved public words.

## Start

Node22 recommended. `npm ci`, copy `.env.example` to `.env.local`, leave all keys blank and `NEAR_LIVE=0`, then `npm run build && npm start`. Open localhost:3000. No provider credits or wallet needed. Do not paste secrets into messages.

## One clear demo, about 75 seconds

1. Show the synthetic-data badge. Policy Lab: compile Daily essentials. Point to 2NEAR/day,0.5/payment, human review above0.3.
2. Firewall: evaluate0.1NEAR to coffee.near. ALLOW and1.9remaining. Then0.4 asks a human; budget does not change.0.6 is blocked; no wallet action occurs.
3. Jailbreak: level9, load example, Send to agent. The deliberately weak method policy lets the harmful proposal through. Check Apply the policy fix, load example again, Send. The method restriction blocks it. Prior slip stays counted, honestly.
4. Explain the boundary: this UI is a simulator. Separately the NEAR vault WASM runs an actual local-chain transfer/approval/rollback harness. Show `npm run test:sandbox` output and distinguish local chain from public testnet/real funds.

## Repeatable browser test

After `npm run build`, install test-only browser dependency with `npm install --prefix tests-browser --no-save --package-lock=false playwright`. Run `tests-browser/node_modules/.bin/playwright install chromium ffmpeg` and `node tests-browser/local-production.mjs`. With system Chrome, set `CHROME_BIN` to its executable. Logs, screenshots and automated test video land in verification/. This is automated QA footage, not your required human recording. It performs local app actions only, provider variables are emptied, and external browser traffic is blocked. It starts/stops its own local server on3188.

## Remaining entry steps

Repository publication and exact source diff approval; your valid mainnet payout account; your human-recorded/published X demo link; complete final application and contact-consent review before sending. No final entry is made by these commands.
