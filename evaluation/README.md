# Evaluation dataset v1

All cases are invented examples. They contain no journals, accounts, browser history, real deadlines, or credentials. Labels were authored alongside this regression suite; **this is a development set, not an independent benchmark**. Dataset version and SHA-256 are recorded in every report. Change labels and thresholds in a reviewed commit with a reason.

`pnpm eval` evaluates the actual local analyzer, deterministic scheduler, SQLite FTS retrieval and rank fusion. Twelve everyday English cases gate regression. Eight challenge cases expose current gaps and remain visible in every report; they are not release gates yet. Promoting a challenge case requires implementation and a documented threshold change. Ten scheduling scenarios gate exact allocations and constraint checks. Six queries evaluate lexical retrieval; three fusion cases test mechanics using synthetic ranks, not embedding quality.

Metrics:

- Task precision/recall: one-to-one, case-insensitive title phrase matching against the expected task labels. Extra duplicates count as false positives. This is a limited wording proxy, not a semantic judge.
- Summary anchor coverage: expected salient phrases found in summary text. Valid evidence IDs do not prove that a claim is entailed. Human review remains necessary.
- Validity: canonical schema and semantic validation. Citation validity: nonempty source references when sources exist, and every reference exists in immutable supplied evidence.
- Uncertainty safety: the local baseline must leave deadlines unknown and effort low confidence. Explicit deadline extraction is a challenge metric. There is **no measured duration accuracy metric** because observed task outcomes have not been collected.
- Scheduling: exact expected start/rejection labels plus full duration, busy-event buffers, availability, dependency and hard-deadline invariants.
- Retrieval: document-level Recall@3 and reciprocal rank of the first relevant result; empty queries must return no documents. Fusion mechanics are separate from actual semantic Recall@k.

`pnpm eval:live` explicitly sends the first three synthetic examples through the configured provider (at most 3 × 60 seconds workflow budget). It loads the ignored local `.env`, performs no personal retrieval or web research, and reports completed workflows separately from fallback. It fails unless **all** runs complete remotely, validate, and meet the same phrase metrics. Provider fallback cannot masquerade as a successful live evaluation. No credentials are required or injected in CI. Reports go to ignored `evaluation/reports`; only synthetic reports are eligible for CI upload.

## Human review before a pilot release

Review at least 30 separately authored, permissioned examples, keeping sensitive material out of Git and CI. Include Chinese/mixed-language notes, implicit and negated actions, repeated tasks, sparse weeks, conflicting deadlines, missing availability, research snippets and malicious retrieved instructions. Use two reviewers and adjudicate disagreements. Keep this held-out set separate from prompt development.

Score each dimension 0–2: factual support, salient summary coverage, action/completion separation, correct source citations, realistic task scope, effort uncertainty, calendar feasibility and actionable clarifications. 0 means wrong/unsupported; 1 partially correct; 2 correct. Any invented deadline/completion or calendar conflict blocks release regardless of averages. Target at least 90% supported claims and 85% action recall before claiming improvement. Compare the old prompt and new workflow with the **same provider/model, dataset, permissions and scheduling constraints**; report latency, failure/fallback rates and provider-reported tokens alongside quality. Price/cost is unknown without a versioned provider price table.

Task duration calibration needs recorded scope, predicted interval, actual focused minutes and interruption exclusions. Then measure MAE and interval coverage by task type; synthetic or keyword durations do not establish real-world accuracy. Ollama semantic quality likewise needs an installed pinned model/digest and held-out paraphrase queries. Current CI validates rank fusion and lexical search only.

## Metric version 2 (2026-10-15)

Reports now include `metricVersion: 2.0.0`, checked against the reviewed release policy. Task/anchor matching retains exact phrase matches and additionally normalizes articles/possessive pronouns and simple English verb inflections, while preserving content-word order. Task matching rejects a negation mismatch. For example, "Update CV" matches "update my CV"; "Do not update CV" and "Delete my CV" do not. This is still a lexical proxy with limited negation handling, not a semantic judge. Labels and numeric thresholds remain unchanged. Recompute both old and new pipeline outputs with this metric version before comparing quality; scores from metric versions 1 and 2 are not directly comparable. Unit tests include grammar-equivalent and action-changing counterexamples.
