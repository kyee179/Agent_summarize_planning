# Chinese language handling

This pass supports Chinese and mixed-language journals while keeping the interface in English, as requested. In Journal → Customize analysis, **Analysis language** defaults to matching the journal. Choose 简体中文 or English to override generated explanations. Original task phrases, names, technical terms, evidence, JSON keys and enum values stay unchanged.

## 1. Preserve input before interpreting it

`src/features/JournalWorkspace.jsx` tracks composition events and disables Save/Prepare during IME composition. `src/lib/text.js` uses `Intl.Segmenter` for Chinese character/grapheme counts and English word counts. Journal-library lookup normalizes full-width forms for matching.

`server/language.cjs` uses NFKC only for recognition. Evidence and journal text retain original characters and UTF-16 offsets. Sentence boundaries include Chinese punctuation and semicolons; decimal points such as `１．５` stay inside their sentence. Long evidence and memory chunks avoid splitting surrogate pairs.

## 2. Separate actions from status and negation

The conservative local fallback separates clauses, recognizes explicit Chinese future/unfinished work, excludes clear negation/completion/speculation, and deduplicates repeated action mentions before its eight-task cap. For example:

| Source | Result |
| --- | --- |
| 我需要完成项目报告。 | One tentative task |
| 我不需要更新CV。 | No task |
| 我已经完成报告，但还需要准备答辩。 | Only 准备答辩 |
| 如果获得批准，就需要提交申请。 | Abstain in the local baseline |

Prompt policy **1.3.0** supplies an explicit output-language rule, examples and protocol boundaries. The workflow also rejects proposed tasks supported only by explicit Chinese negation/completion/conditional evidence. Mixed clauses containing an explicit future action remain eligible.

Live testing found that GLM's native argument generation can repeatedly fill an empty task array with placeholder objects. When all supplied journal evidence is explicitly non-actionable and no optional search is enabled, the compact tool schema therefore requests a summary-only proposal. The workflow creates the empty canonical task list. Elsewhere, proposals must still supply their task list, satisfy source-action checks, pass canonical validation and finish the latest preview. Budgets and human review are unchanged.

This is bounded language handling, not general semantic entailment. Complex implicit obligations and conditional clauses can be missed; the UI exposes fallback and evidence for review.

## 3. Suggest dates without inventing confirmed facts

`server/chineseDates.cjs` resolves 今天/明天/后天, N天后 and explicit 本/下/下下周 weekdays from **the source journal's date**, using the plan timezone. The scheduling target day is independent. It recognizes full-width digits, Chinese clock numbers, 半/一刻/三刻, explicit UTC/ISO offsets and bounded hour/minute durations.

For a journal dated 2030-01-07 in Asia/Shanghai:

| Source | Unconfirmed suggestion |
| --- | --- |
| 明天下午需要提交报告 | 2030-01-08, afternoon; exact hour unknown |
| 下周五下午三点半需要提交报告 | 2030-01-18 15:30 Asia/Shanghai |
| 周五需要提交报告 | Ask which week |
| 明天三点需要提交报告 | Ask AM/PM |
| 预计一个半小时完成 | 90 minutes, still unconfirmed |
| 30分钟后提交 | No effort estimate from that phrase |

Invalid/conflicting dates and skipped/repeated timezone clocks produce ambiguity, not an instant. Suggestions are refreshed when source context/timezone changes, without overwriting confirmed facts. Only source-matched text supplies suggestions; dates added by the model do not. **Use source date suggestion** fills the review input; **Confirm and save facts** remains necessary to establish a deadline. Existing calendar events keep their reviewed times.

Date parsing is intentionally bounded. Yearless dates, unspecified weeks, vague time periods and unusual wording require explicit review. Source timestamps are not substituted for the journal's entry date.

## 4. Retrieve and evaluate separately

Chinese lexical indexing/query segmentation from the release hardening pass remains the baseline, with new short-query, mixed API and full-width lookup fixtures. Original source excerpts remain citable. Reindexing now retains unchanged chunks and compatible embeddings. Bounded embedding jobs resume missing chunks across retries; changed text/model digests invalidate incompatible vectors. A synthetic 300-chunk test verifies 256 + 44 + 0 requests.

No embedding model was downloaded or changed. Actual installed-model Chinese semantic retrieval quality is unmeasured; hybrid Chinese searches disclose this limit. Lexical results and mocked vector mechanics do not establish multilingual semantic quality.

Dataset **1.2.0** adds 36 authored Chinese/mixed regressions to the previous 18 gates: 54 gates, eight diagnostic challenges, ten scheduler scenarios and eleven lexical queries. Metric **3.0.0** adds Chinese negation/completion mismatch checks and separate language gates, including summary anchors. Thresholds are unchanged. The quality policy pins dataset/prompt hashes and minimum Chinese coverage. These are synthetic development fixtures, not an independent holdout or an accuracy claim.

Run `pnpm release:check` and `pnpm smoke:desktop` for normal validation. `pnpm eval:chinese:live` explicitly sends three invented Chinese cases (action, negation, mixed completion/future) to the configured provider. It uses empty calendar context and no optional personal/web tools, records remote completion separately from fallback and requires Chinese output. Reports remain in ignored `evaluation/reports/live-chinese.json`.

## Verification limits

The final repository release check passed: 204 tests (42 frontend + 162 server), quality policy, lint, offline evaluation and production build. The real Electron smoke passed using a temporary synthetic database. A final three-case GLM diagnostic completed remotely and passed all configured metrics. Earlier runs exposed the empty-array failure fixed above; after that correction, all three completed remotely, but summary phrase coverage varied (2/3 in two runs, 3/3 in the diagnostic). This is evidence of working protocol boundaries, not a stable multilingual quality estimate; the strict live command can still fail on variable summary wording.

Automated composition events and a real hidden Electron Unicode save/read/analyze flow are covered. Native Microsoft Pinyin candidate selection has not been exercised manually. Installer upgrade, independent multilingual review and real semantic retrieval remain release work. No personal database was opened or migrated for this pass. App, contract and SQLite versions remain 0.3.0, 1 and 3; no new dependency is required.
