# Contributing

Use Node.js 20 or newer. Keep evaluator changes pure and deterministic: no clock,
randomness, network, or filesystem access in `src/evaluator.ts`.

Run `npm test` and `npm run typecheck` before opening a change. Add a focused test
for every observable behavior change, including validation failures where relevant.
Keep dependencies to a minimum; platform APIs are preferred when they meet the need.
