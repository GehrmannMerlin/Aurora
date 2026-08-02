# Ingestion OpenAPI Contract (数据接入 OpenAPI 机器契约第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依据 approved 规格 `docs/api/ingestion-openapi.md` 与 accepted ADR-009，创建数据接入公开 HTTP 传输的机器契约第一增量：`docs/api/ingestion.openapi.yaml`（OpenAPI 3.1.0，`POST /v1/batches` + 完整 components + security scheme + 状态码映射）、人类说明文件同步、OpenAPI 解析/lint 门禁（redocly）、以及与 `@aurora/event-schema` 的自动漂移测试（枚举/required/限制/样本/retryable/retryAfterMs）。本计划只实施 OpenAPI 机器契约与漂移门禁；**不**创建 Fastify 路由、接入服务、Inbox 数据模型、Migration、密钥数据库/生成/轮换、CORS 中间件、SDK transport、Worker。

**Architecture:** OpenAPI 是 `@aurora/event-schema` 批次/接收结果协议的 HTTP 传输投影。机器文件 `docs/api/ingestion.openapi.yaml` 只定义传输层：`components.schemas`（`IngestionBatchRequest`、`EventEnvelope`、`EventType`、`IngestionRequestReceipt`、`IngestionEventReceipt`、`IngestionReceiptState`、`IngestionErrorCode`、`ErrorResponse`）、security scheme `ClientIngestionKey`、`POST /v1/batches` operation、全部响应状态码。漂移门禁放独立 tooling 包 `tooling/ingestion-openapi-contract`：从 `@aurora/event-schema` 公共根与 `contract-testkit` 消费常量、枚举、类型与样本，用 `yaml` 解析 OpenAPI 文件，断言枚举/required/限制/样本与 event-schema 一致，并驱动 `redocly` 做结构验证。事件正文字段（`body`）保持 `unknown`/`additionalProperties: true`，不复制错误/请求/性能正文 Schema。

**Tech Stack:** OpenAPI 3.1.0、`@redocly/cli` 2.43.1（根 devDependency，`redocly lint` 验证 3.1、解析 `$ref`、运行 lint）、`yaml` 2.9.0（根 devDependency，漂移测试解析）、TypeScript 6.0.3、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、pnpm 11.17.0、Node.js ≥24.18.0（当前 v24.18.0）。

**Plan status:** ready-for-implementation（自动审批通过后执行；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只新增 `docs/api/ingestion.openapi.yaml`、`docs/api/ingestion-openapi.md`（规格已建）、`.redocly.yaml`、`tooling/ingestion-openapi-contract/`（新私有 tooling 包）、根 `package.json`/`pnpm-lock.yaml`（已含 redocly+yaml devDeps）与相关索引文档。不修改 `packages/event-schema` 源码或公共 API。
- OpenAPI 是传输投影：所有 body/receipt/状态/错误码/限制唯一来源是 `@aurora/event-schema`；不定义第二套状态/错误码/限制。
- "已可靠接收"（`accepted`）严格对应 ADR-008 的 `event_inbox` 事务提交成功；OpenAPI 层不实现 Inbox 写入、数据库、Migration、采样、限流、队列、Worker。
- 端点 `POST /v1/batches`；不设置 `servers`（主机由部署配置）；请求/响应 `application/json`；不承诺压缩。
- security scheme `ClientIngestionKey` = `apiKey`（`in: header`，Header `X-Aurora-Client-Key`，值视为 opaque string）；Header `X-Aurora-Environment`（必填 string）。禁止 Query/URL/Cookie/正文传凭证。
- HTTP 状态映射固定：200（含部分成功/全拒/duplicate/部分临时失败）、400、401、403、413、415、429、503、500；`Retry-After` 仅 retryable 且整数秒；`X-Aurora-Request-Id` 响应 Header（opaque string）。
- Origin/CORS 语义由 ADR-009 冻结，OpenAPI 中不声明为 JSON Schema 字段；CORS 中间件不属于本模块。
- 请求字节上限不冻结：OpenAPI 记录可能返回 413，但不声明精确大小；`maxEventsPerBatch = 50` 是唯一机器限制。
- `@redocly/cli` 与 `yaml` 只作为根 devDependency，不进入生产运行时；不同时引入多套 OpenAPI 工具。
- 漂移测试只从 `@aurora/event-schema` 根与 `contract-testkit` 导入；不导入私有路径（`src/`、`internal/`）。
- 合法样本必须通过 event-schema 解析器与 OpenAPI Schema；非法样本不能因 OpenAPI 过宽被接受；边界样本两契约一致；示例不包含真实客户端密钥；Query 无凭证。
- 新 tooling 包 `tooling/ingestion-openapi-contract`：`aurora.layer: tooling`、私有、零运行时依赖、devDeps 为 `@aurora/event-schema`（workspace）、`yaml`、`vitest`、`@types/node`、`typescript`。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`。生产源码（如果产生）不使用 `console`、DOM、Node 运行时（除测试）。
- 不创建 `utils`/`helpers`/`common`/`misc`。
- 不修改 ADR 决策结论。ADR-009 保持 `accepted / not-started`（本轮实施完成后可在追加记录中更新为 `in-progress`，因公开机器契约已实现，但凭证、服务和 CORS 未实现）；ADR-008 保持 `accepted / not-started`；ADR-005 保持 `accepted / in-progress`（追加 OpenAPI 映射单一来源证据）；ADR-004 保持原状态。
- 不创建第二份 ingestion OpenAPI YAML/JSON。

---

## 文件树

```text
docs/
├── api/
│   ├── ingestion.openapi.yaml          # Create：OpenAPI 3.1.0 机器契约（唯一机器文件）
│   └── ingestion-openapi.md            # Exists：正式规格（本计划依赖，已 approved）
├── adr/ADR-009-*.md                    # Modify（Task 9）：追加 OpenAPI 实施证据，更新实施状态 in-progress
├── adr/README.md                       # Modify（Task 9）：ADR-009 行实施状态
├── README.md                           # Modify（Task 9）：docs 索引
├── architecture/formalization-readiness.md  # Modify（Task 9）：数据接入 OpenAPI 状态
└── superpowers/plans/2026-08-01-ingestion-openapi-contract.md  # This plan
.redocly.yaml                           # Create（Task 1）：redocly lint 配置
package.json                            # Modify（Task 1/2）：已含 redocly+yaml devDeps；新增 openapi:lint 与 openapi:check 脚本
pnpm-lock.yaml                          # Modify（Task 1）：工具链 lock 更新（已发生）
tooling/ingestion-openapi-contract/
├── package.json                        # Create：tooling 包清单
├── tsconfig.json                       # Create
├── tsconfig.build.json                 # Create
├── vitest.config.ts                    # Create
├── README.md                           # Create：模块定位/职责/命令
├── src/
│   ├── index.ts                        # Create：公开入口（export 解析 helper）
│   ├── load-openapi.ts                 # Create：读取+解析 ingestion.openapi.yaml → typed structure
│   ├── schema-map.ts                   # Create：OpenAPI Schema 名称 → 断言 helper（枚举/required/限制/retryable/retryAfterMs）
│   └── drift-errors.ts                 # Create：漂移失败错误类型与格式化
└── test/
    ├── drift-enums.test.ts             # Create：状态/错误码枚举漂移
    ├── drift-required-limits.test.ts   # Create：required/数组/字符串限制漂移
    ├── drift-samples.test.ts           # Create：合法/非法/边界样本漂移
    ├── drift-retry.test.ts             # Create：retryable/retryAfterMs 语义漂移
    ├── drift-security.test.ts          # Create：Query 无凭证、示例无真实密钥、错误不泄露
    ├── drift-structure.test.ts         # Create：operationId 唯一、$ref 完整、schema 名称稳定
    ├── load-openapi.test.ts            # Create：loader 单元测试
    └── documentation-contract.test.ts  # Create：README/规格示例与 YAML 一致
```

每个文件单一职责；`src/` 只放漂移断言 helper，不创建 Fastify/数据库/CORS/凭证实现。

---

## Consumes / Produces 总览

- **Consumes**：`docs/api/ingestion-openapi.md`（approved 规格）、`@aurora/event-schema` 根（`BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`、`CURRENT_PROTOCOL_VERSION`、`EVENT_SCHEMA_LIMITS`、`EventType`、`IngestionBatchRequest`/`IngestionRequestReceipt`/`IngestionEventReceipt` 类型）、`@aurora/event-schema/contract-testkit`（`valid/invalid/boundaryIngestionBatchRequestSamples`、`valid/invalid/boundaryIngestionRequestReceiptSamples`、信封/事件样本）、ADR-009 最终决定、PRD 相关章节。
- **Produces**：`docs/api/ingestion.openapi.yaml`、`.redocly.yaml`、`tooling/ingestion-openapi-contract/`（源码+测试+README）、根脚本 `openapi:lint`/`openapi:check`、漂移门禁、ADR-005/008/009 实施证据、更新后的索引与剩余模块统计。

---

## Task 1: OpenAPI 工具链与 redocly 配置

**目标：** 固定 OpenAPI 工具链（`@redocly/cli` 2.43.1 + `yaml` 2.9.0，根 devDependencies，已验证安装成功），创建 `.redocly.yaml`，建立 `redocly lint` 命令与 `openapi:check` 根脚本。工具链只做 OpenAPI 结构验证（3.1 解析、`$ref` 完整、operationId 唯一、lint 规则），不做 event-schema 语义验证（语义由 Task 3—7 漂移测试负责）。

- Consumes: 根 `package.json`（已含 `@redocly/cli` 2.43.1、`yaml` 2.9.0 devDeps）、`pnpm-lock.yaml`（已更新）。
- Produces: `.redocly.yaml`、根 `scripts.openapi:lint`、`scripts.openapi:check`。

- [ ] **Step 1: 失败测试（命令存在性 + redocly 配置解析）**
  - 先运行 `npx redocly lint docs/api/ingestion.openapi.yaml`，预期失败（文件尚不存在，redocly 报"Please provide a valid path"或类似错误，exit 非 0）。记录实际输出与退出码。
  - 若 `.redocly.yaml` 不存在，`redocly` 使用内置默认（recommended）规则；验证默认规则含 `info-license-strict`、`operation-4xx-response`、`security-defined` 等会误伤内部契约的规则（可先对最小临时 3.1 文件运行确认，见背景验证）。

- [ ] **Step 2: 最小实现 `.redocly.yaml`**
  - 创建 `.redocly.yaml`，内容：
    ```yaml
    extends:
      - recommended
    rules:
      info-license: off
      info-license-strict: off
      info-description: off
      security-defined: off
      no-unused-components: off
      no-ambiguous-paths: off
      operation-4xx-response: off
      operation-2xx-response: off
      operation-parameters: off
      operation-description: off
      tag-description: off
      tags-alphabetical: off
      spec: error
    ```
  - 说明：`recommended` 之外的 strict 规则（license/security-defined/operation-4xx 等）不适用内部传输契约；保留 `spec: error`（结构合法）、`$ref` 解析、operationId 唯一性等核心校验为默认开启。若后续发现个别规则误报，可在本计划 Task 8 回归时按证据微调，但不得关闭 `spec`。

- [ ] **Step 3: 最小实现根脚本**
  - 修改根 `package.json` scripts，新增：
    ```json
    "openapi:lint": "redocly lint docs/api/ingestion.openapi.yaml",
    "openapi:check": "pnpm openapi:lint && pnpm --filter @aurora/ingestion-openapi-contract test"
    ```
  - 并在 `check` 脚本开头（`format:check` 之后）加入 `&& pnpm openapi:check`，使 `check:ci` 覆盖 OpenAPI 门禁。
  - 同步更新 `pnpm-lock.yaml`（若脚本变化不触发，仅 package.json 变化；工具链 lock 已在环境核验中更新）。

- [ ] **Step 4: 确认通过**
  - `pnpm openapi:lint` 在 `docs/api/ingestion.openapi.yaml` 尚未创建时应失败（红色）——此步骤确认命令接线正确。
  - 新建一个最小临时 3.1 文件在 `docs/api/` 测试接线后删除（或用 Task 2 产物验证），确认 `redocly lint` 解析配置、无配置错误。

- [ ] **Step 5: 相关回归**
  - `node -e "const p=require('./package.json'); if(!p.scripts['openapi:check']) process.exit(1)"` 确认脚本存在。
  - `npx prettier --check .redocly.yaml` 确认格式（若 prettier 支持 yaml；否则 `git diff --check` 兜底）。
  - 确认 `pnpm check:ci` 的 `check` 链已含 `openapi:check`（读 package.json 断言）。

- [ ] **Step 6: 建议提交边界**
  - `.redocly.yaml`、根 `package.json`（scripts）、`pnpm-lock.yaml`。

---

## Task 2: OpenAPI 机器文件壳、元数据、路径与 operation

**目标：** 创建 `docs/api/ingestion.openapi.yaml` 完整骨架：`openapi: 3.1.0`、info、不设置 `servers`、`security` 引用 `ClientIngestionKey`、`paths./v1/batches.post`（operationId `ingestionSubmitBatch`）、security scheme `ClientIngestionKey`（apiKey/header/X-Aurora-Client-Key）、Header 参数 `X-Aurora-Environment`、`Content-Type`、以及全部响应状态码的骨架（200/400/401/403/413/415/429/500/503 + 400/401/403/413/415/429/500/503 引用 `ErrorResponse`）。Schema `$ref` 指向 `components.schemas`（Task 3—5 填充），先建立稳定引用骨架。

- Consumes: `docs/api/ingestion-openapi.md` §5、§6、§13、§22；ADR-009 §4.1/4.2/4.6/4.9。
- Produces: `docs/api/ingestion.openapi.yaml`（骨架，Schema `$ref` 占位但引用名称已稳定）。

- [ ] **Step 1: 失败测试（redocly lint 在真实路径上对不完整文件失败）**
  - 先创建最小 `docs/api/ingestion.openapi.yaml`（只有 `openapi: 3.1.0` + `info`），运行 `pnpm openapi:lint`，确认 redocly 报错（缺 `paths`/`info` 字段/`security` 等），exit 非 0。记录错误清单。

- [ ] **Step 2: 最小实现 YAML 骨架**
  - 写入完整骨架（Schema 定义在 Task 3—5 补齐，`$ref` 引用已稳定）：
    ```yaml
    openapi: 3.1.0
    info:
      title: Aurora Data Ingestion API
      version: 1.0.0
      description: >
        HTTP transport projection of the Aurora data ingestion batch and
        receipt contract. The machine-semantic source of truth is the
        @aurora/event-schema package; this document is the HTTP projection.
    security:
      - ClientIngestionKey: []
    paths:
      /v1/batches:
        post:
          operationId: ingestionSubmitBatch
          summary: Submit an event batch for reliable ingestion
          security:
            - ClientIngestionKey: []
          parameters:
            - name: X-Aurora-Environment
              in: header
              required: true
              description: Stable environment identifier from the project environment catalog.
              schema:
                type: string
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/IngestionBatchRequest'
                examples:
                  validBatch:
                    $ref: '#/components/examples/ValidBatchRequest'
          responses:
            '200':
              description: >
                Request-level receipt. HTTP 200 means JSON parseable, batch
                structure parseable, request-level auth/origin/environment
                passed, and a definitive receipt formed for every event. It
                does NOT mean every event succeeded; use perEventResults.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  description: Server-generated opaque request identifier.
                  schema:
                    type: string
                Retry-After:
                  required: false
                  description: Present only on retryable request-level responses (429/503).
                  schema:
                    type: integer
                    minimum: 1
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/IngestionRequestReceipt'
                  examples:
                    partialSuccess:
                      $ref: '#/components/examples/PartialSuccessReceipt'
            '400':
              description: Malformed JSON or unparseable batch structure.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/ErrorResponse'
            '401':
              description: Missing, invalid, disabled, revoked, expired, or rotated client key.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/ErrorResponse'
            '403':
              description: Origin not allowed, non-browser disallowed, environment not allowed, or policy-permanent rejection.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/ErrorResponse'
            '413':
              description: Request body exceeds server protection threshold. Exact byte limit is requires-benchmark; not declared here.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/ErrorResponse'
            '415':
              description: Content-Type is not application/json.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/ErrorResponse'
            '429':
              description: Request-level rate limiting or capacity protection. retryable; Retry-After may be provided.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
                Retry-After:
                  required: false
                  schema: { type: integer, minimum: 1 }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/IngestionRequestReceipt'
            '500':
              description: Unclassified internal error. No internal service/SQL/constraint/stack leakage.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/ErrorResponse'
            '503':
              description: PostgreSQL/Inbox temporarily unavailable, capacity protection, or reliable-durability boundary not satisfiable. Never mapped to accepted.
              headers:
                X-Aurora-Request-Id:
                  required: true
                  schema: { type: string }
                Retry-After:
                  required: false
                  schema: { type: integer, minimum: 1 }
              content:
                application/json:
                  schema:
                    $ref: '#/components/schemas/IngestionRequestReceipt'
    components:
      securitySchemes:
        ClientIngestionKey:
          type: apiKey
          in: header
          name: X-Aurora-Client-Key
          description: >
            Client ingestion key (aurora_ingest_<keyId>_<secret>) treated as an
            opaque string. Grants ingestion only; never read/query/manage/
            Source Map/platform access.
      schemas:
        # Task 3-5 fill these; names are stable.
        IngestionBatchRequest:
          type: object
        EventEnvelope:
          type: object
        EventType:
          type: string
        IngestionRequestReceipt:
          type: object
        IngestionEventReceipt:
          type: object
        IngestionReceiptState:
          type: string
        IngestionErrorCode:
          type: string
        ErrorResponse:
          type: object
      examples:
        # Task 3-6 fill examples.
    ```
  - `servers` 不设置（主机由部署配置，ADR-009 §4.1）。

- [ ] **Step 3: 确认通过**
  - `pnpm openapi:lint` 通过（exit 0）：结构合法、`$ref` 指向已声明组件、operationId 唯一。此时 `schemas` 尚为空 object，redocly 不报未定义字段（Schema 内容 Task 3—5 填充）。
  - 若 redocly 对空 object schema 报 `spec` 错误，则在本步将各 schema 补最小合法定义（`type: object` + `additionalProperties: true`），满足 `spec: error`。

- [ ] **Step 4: 相关回归**
  - `npx prettier --check docs/api/ingestion.openapi.yaml`（确认格式；若 prettier 报 yaml 格式问题则 `--write` 后复检）。
  - `git diff --check`。

- [ ] **Step 5: 建议提交边界**
  - `docs/api/ingestion.openapi.yaml`（骨架）。

---

## Task 3: security scheme、Header、CORS 说明与批次请求 Schema

**目标：** 完成 `components.securitySchemes.ClientIngestionKey`（Task 2 已建）、Header 参数语义（`X-Aurora-Environment`、`X-Aurora-Client-Key`、`Content-Type`），并在 `components.schemas` 完整定义 `IngestionBatchRequest`、`EventEnvelope`、`EventType`，属性名与 event-schema 完全一致、限制引用机器常量。

- Consumes: `docs/api/ingestion-openapi.md` §6、§7、§10；`@aurora/event-schema` 根（`CURRENT_PROTOCOL_VERSION`、`EVENT_SCHEMA_LIMITS`、`BATCH_EVENT_LIMITS`、`EventType`、`IngestionBatchRequest` 类型）；`packages/event-schema/src/event-envelope.ts`（字段与限制）。
- Produces: `docs/api/ingestion.openapi.yaml` `components.schemas.IngestionBatchRequest/EventEnvelope/EventType` 完整定义；`components.securitySchemes`/Header 说明完成。

- [ ] **Step 1: 失败测试（schema 内容漂移测试先行）**
  - 在 `tooling/ingestion-openapi-contract/test/drift-required-limits.test.ts` 写第一个失败断言：解析 `docs/api/ingestion.openapi.yaml`，读取 `IngestionBatchRequest` schema，断言 `required` 包含 `protocolVersion`、`events`；`events.maxItems === 50`；`protocolVersion` 为 `const: 1`。当前 YAML 中 schema 为空 object → 断言失败（红色）。此步同时验证 loader 接线。

- [ ] **Step 2: 最小实现 YAML Schema**
  - 在 `docs/api/ingestion.openapi.yaml` 中补全：
    ```yaml
    IngestionBatchRequest:
      type: object
      required: [protocolVersion, events]
      additionalProperties: false
      properties:
        protocolVersion:
          const: 1
          description: Must equal CURRENT_PROTOCOL_VERSION (1).
        events:
          type: array
          minItems: 1
          maxItems: 50
          items:
            $ref: '#/components/schemas/EventEnvelope'
        receivedAt:
          type: integer
          format: int64
          minimum: 1
          description: Optional positive safe integer Unix epoch milliseconds.
    EventEnvelope:
      type: object
      required: [protocolVersion, eventId, eventType, occurredAt, body]
      additionalProperties: false
      properties:
        protocolVersion:
          const: 1
        eventId:
          type: string
          minLength: 1
          maxLength: 128
        eventType:
          $ref: '#/components/schemas/EventType'
        occurredAt:
          type: integer
          format: int64
          minimum: 1
        body:
          type: object
          additionalProperties: true
          description: Event-type-specific body; semantic schema lives in @aurora/event-schema.
    EventType:
      type: string
      enum: [error, request, performance]
      description: Must match EventType values from @aurora/event-schema.
    ```
  - 限制注释标明来源：`50` = `BATCH_EVENT_LIMITS.maxEventsPerBatch`；`128` = `EVENT_SCHEMA_LIMITS.maxEventIdLength`；`const: 1` = `CURRENT_PROTOCOL_VERSION`。`additionalProperties: false` 对应 event-schema 精确字段允许列表；`body.additionalProperties: true` 对应 `EventEnvelope.body: unknown`。

- [ ] **Step 3: 确认通过**
  - `pnpm openapi:lint` exit 0。
  - 漂移测试 `drift-required-limits.test.ts` 对应断言通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-openapi-contract test`（该包 test 命令在 Task 1/漂移测试建好后可运行；本步至少跑 `drift-required-limits`）。
  - 确认 `event-schema` 公共 API 未被修改：`git diff --stat packages/event-schema/` 无新增。

- [ ] **Step 5: 建议提交边界**
  - `docs/api/ingestion.openapi.yaml`（schemas 部分）。

---

## Task 4: request receipt 与 per-event receipt Schema 映射

**目标：** 在 `components.schemas` 完整定义 `IngestionRequestReceipt`、`IngestionEventReceipt`、`IngestionReceiptState`、`IngestionErrorCode`、`ErrorResponse`，属性名/枚举/限制与 event-schema 完全一致。

- Consumes: `docs/api/ingestion-openapi.md` §11、§12、§14；`@aurora/event-schema` 根（`IngestionReceiptState`、`IngestionErrorCode`、`BATCH_EVENT_LIMITS`、`IngestionRequestReceipt`/`IngestionEventReceipt` 类型）。
- Produces: 上述五个 `components.schemas` 完整定义。

- [ ] **Step 1: 失败测试（枚举与 required 漂移先行）**
  - 在 `drift-enums.test.ts` 写断言：OpenAPI `IngestionReceiptState.enum` 与 `Object.values(IngestionReceiptState)` 完全一致（集合相等）；`IngestionErrorCode.enum` 与 `Object.values(IngestionErrorCode)` 完全一致。当前 YAML 中这两个 schema 为空 object → 失败（红色）。
  - 在 `drift-required-limits.test.ts` 写断言：`IngestionRequestReceipt.required` 含 `batchState`、`retryable`、`perEventResults`；`IngestionEventReceipt.required` 含 `eventId`、`state`、`retryable`；`retryAfterMs.maximum === 86400000`。

- [ ] **Step 2: 最小实现 YAML Schema**
  - 补全：
    ```yaml
    IngestionReceiptState:
      type: string
      enum: [accepted, duplicate_accepted, permanently_rejected, temporarily_failed]
    IngestionErrorCode:
      type: string
      enum:
        - batch_accepted
        - event_accepted
        - duplicate_accepted
        - unsupported_protocol_version
        - invalid_schema
        - field_exceeds_limit
        - forbidden_field
        - invalid_event_type
        - project_permanently_not_allowed
        - source_permanently_not_allowed
        - service_temporarily_unavailable
        - rate_limited
        - capacity_protected
    IngestionEventReceipt:
      type: object
      required: [eventId, state, retryable]
      additionalProperties: false
      properties:
        eventId:
          type: string
          minLength: 1
          maxLength: 128
        state:
          $ref: '#/components/schemas/IngestionReceiptState'
        errorCode:
          $ref: '#/components/schemas/IngestionErrorCode'
        retryable:
          type: boolean
        retryAfterMs:
          type: integer
          format: int64
          minimum: 0
          maximum: 86400000
    IngestionRequestReceipt:
      type: object
      required: [batchState, retryable, perEventResults]
      additionalProperties: false
      properties:
        batchState:
          $ref: '#/components/schemas/IngestionReceiptState'
        errorCode:
          $ref: '#/components/schemas/IngestionErrorCode'
        retryable:
          type: boolean
        retryAfterMs:
          type: integer
          format: int64
          minimum: 0
          maximum: 86400000
        perEventResults:
          type: array
          items:
            $ref: '#/components/schemas/IngestionEventReceipt'
          description: Length must match request events one-to-one (parser context check).
    ErrorResponse:
      type: object
      required: [requestId, message]
      additionalProperties: false
      properties:
        requestId:
          type: string
          description: Matches the X-Aurora-Request-Id response header.
        message:
          type: string
        errorCode:
          $ref: '#/components/schemas/IngestionErrorCode'
          description: Optional; uses existing IngestionErrorCode, never a second business code set.
    ```
  - `retryAfterMs.maximum` 注释 `86400000` = `BATCH_EVENT_LIMITS.maxRetryAfterMs`。

- [ ] **Step 3: 确认通过**
  - `pnpm openapi:lint` exit 0；`drift-enums.test.ts`、`drift-required-limits.test.ts` 对应断言通过。

- [ ] **Step 4: 相关回归**
  - 全量 `pnpm --filter @aurora/ingestion-openapi-contract test`。
  - 确认 `event-schema` 未改。

- [ ] **Step 5: 建议提交边界**
  - `docs/api/ingestion.openapi.yaml`（receipt schemas）。

---

## Task 5: HTTP 状态、Retry-After、request ID 与响应映射自检

**目标：** 验证 OpenAPI 响应定义与 ADR-009 状态映射一致：200/400/401/403/413/415/429/500/503 全部出现且语义正确；429/503 带 `Retry-After`；全部带 `X-Aurora-Request-Id`；`ErrorResponse` 用于请求前错误；`IngestionRequestReceipt` 用于 200/429/503。补充 `components.examples` 中 `ValidBatchRequest`、`PartialSuccessReceipt` 等示例（不含真实凭证）。

- Consumes: `docs/api/ingestion-openapi.md` §13、§15、§16、§17—20；ADR-009 §4.6/4.7/4.8；`@aurora/event-schema/contract-testkit` 样本（合法批次、部分成功 receipt）。
- Produces: 响应定义校验断言 + `components.examples` 完成。

- [ ] **Step 1: 失败测试（结构断言先行）**
  - 在 `drift-structure.test.ts` 写断言：`POST /v1/batches` 的 `responses` 必须包含 `200`、`400`、`401`、`403`、`413`、`415`、`429`、`500`、`503` 全部九种状态码；`429`/`503` 响应含 `Retry-After` header；所有响应含 `X-Aurora-Request-Id` header；`operationId` 全局唯一。当前 YAML 已满足大部分（Task 2），但断言驱动确认。

- [ ] **Step 2: 最小实现 examples**
  - 在 `components.examples` 补全（示例值必须能被 event-schema 公共解析器接受，且不含真实密钥）：
    ```yaml
    ValidBatchRequest:
      summary: Minimal valid batch with one event
      value:
        protocolVersion: 1
        events:
          - protocolVersion: 1
            eventId: evt-doc-example-001
            eventType: error
            occurredAt: 1800000005100
            body: {}
    PartialSuccessReceipt:
      summary: Request-level receipt with one accepted and one temporarily failed event
      value:
        batchState: accepted
        errorCode: event_accepted
        retryable: false
        perEventResults:
          - eventId: evt-doc-example-001
            state: accepted
            retryable: false
          - eventId: evt-doc-example-002
            state: temporarily_failed
            errorCode: rate_limited
            retryable: true
            retryAfterMs: 5000
    ```
  - 同时按需补 `DuplicateAcceptedReceipt`、`PermanentRejectionReceipt`、`TemporarilyFailedReceipt` 示例（各映射 `perEventResults[].state` 合法值），确保 `IngestionReceiptState` 四值在示例中均有表达。

- [ ] **Step 3: 确认通过**
  - `pnpm openapi:lint` exit 0。
  - `drift-structure.test.ts` 全部断言通过。
  - `drift-samples.test.ts`（Task 6 补充）验证示例能被 event-schema 解析器接受。

- [ ] **Step 4: 相关回归**
  - 全量 tooling 包测试；`git diff --check`。

- [ ] **Step 5: 建议提交边界**
  - `docs/api/ingestion.openapi.yaml`（examples、响应自检）。

---

## Task 6: event-schema 合法/非法/边界样本漂移测试

**目标：** 在 tooling 包实现样本漂移：合法批次/请求级/逐事件样本必须通过对应 OpenAPI Schema（用 `yaml` 解析 OpenAPI 后用 JSON Schema 校验，或断言样本符合 OpenAPI 定义的字段/枚举/限制）；非法样本不能因 OpenAPI 过宽被接受；边界样本两契约一致。同时验证文档示例可被 event-schema 公共解析器接受。

- Consumes: `@aurora/event-schema/contract-testkit`（`valid/invalid/boundaryIngestionBatchRequestSamples`、`valid/invalid/boundaryIngestionRequestReceiptSamples`、信封/事件样本）、`@aurora/event-schema` 根（解析器 `parseIngestionBatchRequest`、`parseIngestionRequestReceipt`、`parseIngestionEventReceipt`）、`yaml`、`docs/api/ingestion-openapi.md` 示例。
- Produces: `drift-samples.test.ts`（合法/非法/边界 + 文档示例）、`drift-retry.test.ts`（retryable/retryAfterMs 语义）。

- [ ] **Step 1: 失败测试**
  - 在 `drift-samples.test.ts` 写断言：
    - 对每个 `validIngestionBatchRequestSamples`，其 `expected` 对象必须满足 OpenAPI `IngestionBatchRequest` 的字段/required/enum/限制（通过 JSON Schema 校验或等价结构断言）；
    - 对每个 `validIngestionRequestReceiptSamples`，其 `expected` 满足 OpenAPI `IngestionRequestReceipt`；
    - 对每个 `invalidIngestionBatchRequestSamples`/`invalidIngestionRequestReceiptSamples`，断言"合法子集"被 event-schema 拒绝（即 OpenAPI 不能把这些非法输入放宽为合法——用 event-schema 解析器证实 `success: false`）；
    - 对每个 `boundaryIngestionBatchRequestSamples`/`boundaryIngestionRequestReceiptSamples`，断言 `isValid` 与 OpenAPI Schema 校验结果一致（`isValid: true` → 通过，`isValid: false` → 不通过）。
  - 先在 Tooling 包写 `schema-map.ts` 的 JSON Schema 构造（把 OpenAPI Schema 转成可执行校验或直接断言结构），保证断言真实失败（当前 OpenAPI 定义为空/不完整时）。

- [ ] **Step 2: 最小实现 schema-map + 断言**
  - `src/schema-map.ts`：提供 `expectSchemaMatchesContract(schema, expected)` 断言 helper：校验 `required` 子集、`enum` 集合相等、`minItems/maxItems/minLength/maxLength/minimum/maximum` 数值、`const`、布尔类型。不引入 JSON Schema 校验库（避免第二套依赖）；用结构断言覆盖 event-schema 可表达的限制。
  - `drift-retry.test.ts`：断言 `IngestionEventReceipt.retryable` 与 `retryAfterMs` 在 OpenAPI 中为 boolean / integer(0..86400000)；断言 `permanently_rejected` 状态与 `retryable: false` 的协议语义在 OpenAPI 类型表达上一致（OpenAPI 不强制 retryable 与 state 的跨字段关系——那是协议运行时约束，由 event-schema 解析器保证；测试明确注释这一边界）。
  - `drift-samples.test.ts` 用 `schema-map` 断言全部样本。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-openapi-contract test` 全绿。
  - `pnpm openapi:lint` exit 0。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/event-schema test`（确认 event-schema 未受影响，其样本/解析器原样通过）。
  - `git diff --check`。

- [ ] **Step 5: 建议提交边界**
  - `tooling/ingestion-openapi-contract/src/schema-map.ts`、`test/drift-samples.test.ts`、`test/drift-retry.test.ts`。

---

## Task 7: 非法、边界、安全与敏感信息测试

**目标：** 强化漂移门禁的安全/隐私维度：Query 无凭证、示例无真实客户端密钥、错误响应不泄露内部信息、CORS 不启用 Cookie credential、Origin 缺失语义一致、environment 不授予权限、request ID 无可推断信息。同时在 OpenAPI 文件中加入安全自检注释（不声明为 Schema 字段）。

- Consumes: `docs/api/ingestion-openapi.md` §24；ADR-009 §4.4/4.5/4.8；OpenAPI 文件。
- Produces: `drift-security.test.ts`、`drift-structure.test.ts` 扩展（CORS/Origin 说明存在性）。

- [ ] **Step 1: 失败测试**
  - 在 `drift-security.test.ts` 写断言：
    - OpenAPI 全文不包含 `?clientKey=`、不把 `X-Aurora-Client-Key` 放在 `in: query` 参数或 requestBody schema 属性中；
    - `components.examples` 的值不包含 `aurora_ingest_` 前缀真实值（检查无匹配真实密钥模式的可疑明文；允许占位如 `"aurora_ingest_<keyId>_<secret>"` 说明字符串）；
    - 错误响应 schema（`ErrorResponse`）不引用数据库/SQL/约束/内部服务字段；
    - security scheme `ClientIngestionKey` 为 `apiKey`/`in: header`/`name: X-Aurora-Client-Key`；
    - `components` 不声明任何 `Origin`/`allowNonBrowser`/`environment` 为 JSON Schema 属性（它们由服务端上下文评估，不在 body）。
  - 当前 YAML 若不满足则断言失败（红色）。

- [ ] **Step 2: 最小实现（OpenAPI 补充说明 + 断言收口）**
  - 在 OpenAPI `info.description` 或 `components.securitySchemes.ClientIngestionKey.description` 中明确：CORS 只允许 allowlist 精确 Origin、禁止 `*`、不返回 `Access-Control-Allow-Credentials: true`、暴露 `X-Aurora-Request-Id`/`Retry-After`；Origin 缺失默认拒绝（`allowNonBrowser` 语义由服务端策略评估，不进入 body）；environment 不授予权限。
  - 完成 `drift-security.test.ts` 断言；必要时在 `schema-map.ts` 加辅助。

- [ ] **Step 3: 确认通过**
  - 漂移安全测试全绿；`pnpm openapi:lint` exit 0。

- [ ] **Step 4: 相关回归**
  - 全量 tooling 包测试；`git diff --check`。

- [ ] **Step 5: 建议提交边界**
  - `tooling/ingestion-openapi-contract/test/drift-security.test.ts`、OpenAPI 说明注释。

---

## Task 8: README、索引、正式规格与 ADR 证据

**目标：** 创建 `tooling/ingestion-openapi-contract/README.md`；更新 `docs/README.md`、`docs/adr/README.md`、`docs/architecture/formalization-readiness.md`、根 `README.md` 的索引；在 ADR-005/008/009 追加实施证据；ADR-009 实施状态更新为 `in-progress`（公开机器契约已实现，凭证/服务/CORS 未实现）。

- Consumes: `docs/api/ingestion-openapi.md`、OpenAPI 文件、漂移测试产物、ADR-005/008/009。
- Produces: 上述文档更新与 ADR 追加记录。

- [ ] **Step 1: 失败测试（文档契约断言先行）**
  - 在 `tooling/ingestion-openapi-contract/test/documentation-contract.test.ts` 写断言：
    - `docs/api/ingestion-openapi.md` 存在且包含 §1 定位、§5 端点、§6 security scheme、§13 状态码、§22 OpenAPI 3.1；
    - `docs/api/ingestion.openapi.yaml` 的 `info.title` 与规格一致；`openapi: 3.1.0`；
    - tooling 包 README 存在且包含 `## 模块定位`、`## 职责`、`## 非职责`、`## 命令`。
  - 当前 README 未建 → 失败（红色）。

- [ ] **Step 2: 最小实现文档与索引**
  - 创建 `tooling/ingestion-openapi-contract/README.md`（定位：数据接入 OpenAPI 与 event-schema 漂移门禁；职责：枚举/required/限制/样本/retryable 漂移断言 + 结构校验；非职责：不实现接入服务/数据库/CORS/凭证；命令：`pnpm --filter @aurora/ingestion-openapi-contract test`）。
  - 更新 `docs/README.md`：`docs/api/ingestion-openapi.*` 行从"本轮实施"改为"implemented"（或对应新状态），加入工具链与漂移门禁描述。
  - 更新 `docs/adr/README.md`：ADR-009 实施状态更新为 `in-progress`，附一行说明（公开机器契约已实现，凭证/服务/CORS 未实现）。
  - 更新 `docs/architecture/formalization-readiness.md`：机器契约清单数据接入 OpenAPI 行状态从"本轮实施"改为"implemented（机器文件 + 漂移门禁）；接入服务与 Inbox 仍 absent"；剩余模块统计同步。
  - 更新根 `README.md`（若提及 OpenAPI 状态）。

- [ ] **Step 3: 确认通过**
  - `documentation-contract.test.ts` 全绿；`pnpm openapi:check` 全绿。

- [ ] **Step 4: 相关回归**
  - `pnpm format:check`（新文档纳入格式检查范围；若 prettier 覆盖新增路径则需把新文件加入 `format:check` 列表或确认其默认通过）。
  - `git diff --check`。

- [ ] **Step 5: 建议提交边界**
  - 全部索引文档、tooling README。

---

## Task 9: 根级完整质量门禁与收尾

**目标：** 运行完整验证矩阵，确认 `check:ci` 覆盖 OpenAPI 门禁；核对 `git diff --check`；核对 ADR 状态；生成完成报告要点。不修改 ADR 决策结论。

- Consumes: 全部 Task 1—8 产物。
- Produces: 验证结果与完成报告输入。

- [ ] **Step 1: 新鲜运行完整矩阵**
  - `pnpm install --frozen-lockfile`（确认锁文件一致）
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `pnpm check:boundaries`
  - `pnpm build`
  - `pnpm check:ci`（含新增 `openapi:check`）
  - `git diff --check`
  - 逐个记录 exit code；任何非 0 都不得声称通过。

- [ ] **Step 2: OpenAPI 专项验证**
  - `pnpm openapi:lint`（redocly 3.1 解析、`$ref` 完整、operationId 唯一）；
  - `pnpm --filter @aurora/ingestion-openapi-contract test`（枚举/required/限制/样本/retryable/retryAfterMs/安全漂移全绿）；
  - 敏感信息扫描：`grep -riE "aurora_ingest_[a-z0-9]{8,}|clientKey=|client_key=" docs/api/ tooling/ingestion-openapi-contract/` 无真实密钥命中；
  - Query 凭证禁止：确认 OpenAPI 无 `in: query` 的 `X-Aurora-Client-Key`。

- [ ] **Step 3: ADR 与文档契约**
  - 确认 ADR-009 `accepted / in-progress`（决策未改，实施状态已更新）；
  - 确认 ADR-005 `accepted / in-progress`、ADR-008 `accepted / not-started`、ADR-004 原状态不变；
  - 确认没有第二份 ingestion OpenAPI 文件（`find docs -name "ingestion.openapi*.yaml"` 唯一）。

- [ ] **Step 4: 相关回归**
  - 全仓测试一次通过；`git status --short` 核对无越界文件。

- [ ] **Step 5: 建议提交边界**
  - 全部本轮产物（OpenAPI、漂移工具包、索引、根脚本）。不执行 `git add`/`commit`/`push`。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：完成的 Task；创建和修改的文件；OpenAPI 公开契约（路径 `/v1/batches`、方法 POST、API 版本 3.1.0、operationId `ingestionSubmitBatch`）；security scheme（`ClientIngestionKey` apiKey/header/`X-Aurora-Client-Key`）；Header（`X-Aurora-Environment`、`X-Aurora-Request-Id`、`Retry-After`）；Origin/environment/CORS 语义；HTTP 状态映射与 Retry-After/request ID；event-schema 漂移测试（枚举/required/限制/样本/retryable/retryAfterMs/安全）；全部质量命令与退出码；与计划的偏差；ADR 状态（ADR-009 更新为 in-progress，ADR-005 追加证据 in-progress，ADR-008 保持 not-started，ADR-004 不变）；Git 状态；更新后的剩余模块统计；建议提交边界；并明确说明未实施 Fastify 路由、Inbox、数据库、Migration、凭证服务或 Worker，未规划或实施下一模块，未提交或推送。
