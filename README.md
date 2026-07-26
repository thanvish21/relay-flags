# Relay Flags

Relay Flags is a deterministic feature-flag evaluator for backend services. It keeps decision logic in-process and explicit so services can make fast, inspectable flag decisions without a network dependency during request handling.

It supports typed boolean and string-variant flags, ordered rules, reusable segments, percentage rollouts, deterministic subject bucketing, defaults, structured reasons, and append-only audit records.

```mermaid
flowchart LR
  Client[Service / CLI] --> HTTP[HTTP adapter]
  HTTP --> Eval[Pure evaluator]
  CLI --> Eval
  Config[Flag configuration] --> Eval
  Eval --> Result[Value + reason]
  HTTP --> Audit[Audit sink]
  Audit --> Memory[Memory adapter]
  Audit --> JSONL[JSONL file adapter]
```

## Quick Start

Requires Node.js 20 or later.

```sh
npm install
npm run build
npm start
```

The server starts on port `3000`, reads `examples/flags.json`, and appends evaluation records to `audit.jsonl`. Set `PORT`, `FLAG_CONFIG`, or `AUDIT_LOG` to change these.

Evaluate a fixture directly:

```sh
npm run cli -- examples/flags.json examples/subject.json search-algorithm
```

## HTTP API

`GET /health`

```json
{"status":"ok"}
```

`POST /v1/evaluate`

```sh
curl -X POST http://localhost:3000/v1/evaluate \
  -H 'content-type: application/json' \
  -d '{"flagKey":"new-checkout","subject":{"key":"user-123","attributes":{"plan":"pro"}}}'
```

Example response:

```json
{"flagKey":"new-checkout","value":true,"reason":{"kind":"ROLLOUT","bucket":17}}
```

`POST /v1/evaluate/batch` accepts an `evaluations` array containing the same objects accepted by the single endpoint:

```json
{"evaluations":[{"flagKey":"new-checkout","subject":{"key":"user-1"}}]}
```

Invalid JSON, invalid request bodies, and unknown flags return a JSON `400` response with an `error` and `message`. Invalid flag configuration prevents the server from starting. Unknown routes return 404.

## Evaluation Model

Evaluation is pure: `evaluateFlag(config, flagKey, subject)` neither reads nor writes anything. For a flag, Relay Flags evaluates rules in listed order and returns the first match. A rule can contain AND-ed attribute clauses or refer to a reusable segment. When no rule matches, a rollout hashes `flagKey:salt:subjectKey` with SHA-256 and maps the first 32 bits into one of 100 buckets. Weighted variations consume contiguous bucket ranges. If no rollout is configured, the typed flag default is returned.

The hash makes assignments stable for a fixed key and salt, while changing either intentionally reshuffles the population. A 100-bucket model makes configuration simple and explainable, at the cost of percentage precision below one percent. Configuration is validated before each evaluation for defensive clarity; a long-lived, high-throughput embedding can validate once and retain its immutable configuration instead.

Audit output is deliberately outside the evaluator. The HTTP adapter emits a timestamped event after a successful result through an `AuditSink`; `JsonlFileAuditSink` serializes one append-only JSON object per line. File audit writing is appropriate for local use, not a replacement for durable, centralized production event delivery.

## Determinism, And How It Is Proven

"Deterministic" is the central claim, so it is tested rather than asserted. The
suite verifies that:

- the same `(flagKey, salt, subjectKey)` always lands in the same bucket, across
  repeated calls and across separate processes;
- bucket occupancy over a large synthetic population converges on the configured
  weights, so a 30% rollout actually reaches ~30% of subjects;
- changing the salt, or the flag key, reshuffles assignments independently —
  one flag's rollout tells you nothing about another's.

That last property is what makes staged rollouts safe: a subject unlucky in one
flag is not systematically unlucky in every flag.

## Benchmarks

Measured with `npm run bench` (median of 7 runs, Node v24.18.0, linux x64,
11th Gen Intel Core i3-1115G4 @ 3.00GHz). Numbers are from a real run on modest
hardware — reproduce them yourself rather than trusting the table.

| configuration        | `evaluateFlag` /s | compiled /s | speedup |
| -------------------- | ----------------: | ----------: | ------: |
| 1 flag × 1 rule      |           206,611 |     179,509 |    0.9× |
| 10 flags × 3 rules   |            82,268 |     198,571 |    2.4× |
| 100 flags × 5 rules  |            13,896 |     184,518 |   13.3× |
| 500 flags × 10 rules |             2,338 |     153,326 |   65.6× |

The shape matters more than the absolute figures. `evaluateFlag` revalidates the
whole configuration on every call, so its throughput decays as configurations
grow. Compiling once holds throughput roughly flat — about 5–6 µs per
evaluation regardless of size — which is why a long-lived service should
`compileConfig` at startup and keep the immutable result.

Where the time goes, at 100 flags × 5 rules:

| operation                       |     ops/s | latency |
| ------------------------------- | --------: | ------: |
| first rule matches, no hash     | 5,653,736 |  177 ns |
| no rule matches, rollout hash   |   228,440 | 4378 ns |
| `bucketFor` alone (SHA-256)     |   240,852 | 4152 ns |
| `compileConfig` (once per load) |    19,991 | 50 µs   |

A matched rule is ~25× cheaper than a rollout, because the rollout pays for
SHA-256. Determinism is bought with hashing; this is the price.

## Configuration

See [examples/flags.json](examples/flags.json). Subjects have a required string `key` and optional primitive-valued `attributes`. Clauses use `equals` or `in`; both compare strictly. A boolean flag can only have boolean rule and rollout values, and a string flag can only have string values. Rollout weights must be positive integers totaling 100.

## Development

```sh
npm test          # builds then runs Node's native test runner (93 tests)
npm run bench     # evaluation throughput benchmark
npm run typecheck # TypeScript strict-mode check
npm run build     # compile to dist/
```

Build and run the container locally:

```sh
docker build -t relay-flags .
docker run -p 3000:3000 relay-flags
```

## Project Structure

```text
src/evaluator.ts  Pure validation, matching, rollout, and evaluation
src/http.ts       Native Node HTTP adapter and input validation
src/audit.ts      AuditSink seam plus memory and JSONL adapters
src/cli.ts        Configuration/subject fixture command
src/server.ts     Local server entry point
test/             Native Node test runner suite
examples/         Runnable flag and subject fixtures
```

## Intentionally Out Of Scope

This repository intentionally does not include a configuration control plane, flag authoring UI, remote configuration fetch, authentication/authorization, tenant isolation, SDKs for other languages, streaming updates, cryptographic signing, metrics export, distributed audit delivery, or persistence beyond the local JSONL adapter.

## Future Improvements

- Precompile validated configurations for high-throughput embeddings.
- Add richer clause operators and explicit rule-level rollouts.
- Add request IDs and asynchronous, durable audit adapters.
- Add OpenAPI documentation and authenticated multi-tenant endpoints.
