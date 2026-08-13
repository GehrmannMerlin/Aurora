---
title: ING-12 Production Admission Rate Limit Size and Privacy Policy Adapter Plan
status: approved
owner: ingestion/security
created: 2026-08-13
last-reviewed: 2026-08-13
applies-to: G08 ING-12——把 ING-13 批准参数落地为 ingestion-api 生产准入 adapter（限流/大小/降级/隐私），不改公共事件协议
related:
  - ../../adr/ADR-036-provider-neutral-single-host-deployment.md
  - ../../architecture/ingestion-http-service.md
  - ../../protocol/ingestion-batch-and-receipt-contract.md
  - ../../testing/evidence/2026-08-13-ing-13-target-postgresql-baseline.md
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
supersedes: none
---

# ING-12 Production Admission Rate Limit Size and Privacy Policy Adapter Plan

## 固定回读与权威边界

| 项 | 内容 |
|---|---|
| 不得改变 | 公共事件协议、credential verification、Origin/CORS、SDK-15/16、ingestion-api 既有 200/400/401/403/413/415/429/500/503 语义、Retry-After 契约 |
| 参数来源 | ING-13 `APPROVED_INGESTION_PARAMETERS`（`maxEventsPerBatch=50`、`approvedSustainableEventsPerSecond=400`、`approvedMaxHttpConcurrency=8`） |
| 不新增采集 | 不采集 request body、credentials、cookie、authorization、未批准 query values、完整 DOM/text |

## Task 1：ING-13 参数映射到 typed production policy

新增 `IngestionAdmissionPolicyConfig` typed 模型（`maxEventsPerSecond`、`retryAfterMs`），数值全部来自 ING-13 证据，提供 `DEFAULT_INGESTION_ADMISSION_POLICY`（不可变冻结快照），非法配置抛稳定错误；不出现无来源 magic number。

## Task 2：ingestion admission adapter 实施

实现 `createIngestionAdmissionPolicy(config)`：确定性内存 token-bucket 限流（按事件数消耗 token），`check` 返回 `allow` 或 `temporarilyRejected{retryAfterMs}`（429），保留既有 `allowAllIngestionAdmissionPolicy` 供测试/显式配置。扩展 `CheckIngestionAdmissionInput` 传入事件数（body 已由 Fastify 解析，防御性计数）。

## Task 3：rate-limit / size / privacy / degradation 行为

把 `createIngestionAdmissionPolicy` 接入生产 composition root（`start.ts`）：超事件速率 → 429 + Retry-After；body 超限 → 既有 Fastify 413；隐私违规 → 既有 event-schema 400；Inbox/PG 不可用 → 既有 503。不改 credential/origin 校验顺序与语义。

## Task 4：targeted verification + G08 close

targeted tests（合法 PASS / 超 size 拒绝 / 超 rate 429 / overload 退避 / privacy 拒绝 / credential-origin 不回归）+ 一条真实 smoke（正常 credential → POST → accepted → Inbox → processed；超准入 → 正式 rejection）；同步 remaining-module-batches 与 AGENTS/AURORA_RULES，G08 close。

## 自检（§19 十二项）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 每个数值阈值可追溯到 ING-13 | PASS（config 来自 APPROVED_INGESTION_PARAMETERS） |
| 2 | 不出现拍脑袋 magic number | PASS |
| 3 | 不修改公共事件协议 | PASS |
| 4 | 不削弱 credential verification | PASS |
| 5 | 不削弱 Origin/CORS | PASS |
| 6 | 不采集 body | PASS（只防御性计数，不读正文） |
| 7 | 不记录 secret | PASS |
| 8 | 不允许未经批准 query data | PASS |
| 9 | 拒绝行为沿用 OpenAPI/ING-HTTP 正式语义 | PASS（429/413/400/503 不变） |
| 10 | retry/backpressure 不与 SDK 行为冲突 | PASS |
| 11 | 不重做 SDK-15/16 | PASS |
| 12 | 不重做 ingestion-api | PASS（只接准入 adapter） |

## 最小验证预算

一组 targeted tests（admission adapter 单测 + 必要时真实 PostgreSQL 集成）+ 一条真实 smoke + `git diff --check` + affected typecheck。禁止 root check/test/coverage、整套 ingestion-api、Browser matrix、Console E2E、SDK tests、其他组测试。
