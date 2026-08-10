---
title: Aurora 错误归一化与 fingerprint 分组算法第一增量
status: approved
implementation-status: not-started
approval-status: pending-g03-approval-package
owner: processing/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（@aurora/processing-store）的错误归一化与 fingerprint 纯函数、error_event_occurrences 增列 Migration、persistErrorEventOccurrence 指纹落库；apps/ingestion-worker 错误事件处理器指纹接线验证
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../protocol/error-event-contract.md
  - ./error-event-occurrence-processing-store.md
  - ./error-event-processor.md
  - ./formalization-readiness.md
supersedes: none
review-cycle: error-fingerprint-algorithm-or-compatibility-change
---

# Aurora 错误归一化与 fingerprint 分组算法第一增量

## 1. 定位、效力与当前状态

本文冻结 DAT-12（错误归一化、fingerprint 与分组版本）第一增量。该增量把已存在的、经 `@aurora/event-schema` 精确错误契约校验的错误事件正文，安全、稳定地规范化为带版本语义的 fingerprint/group key，并随错误 occurrence 一起持久化。

**批准状态**：本文是 G03 正式化扫掠产物，纳入 [G03 APPROVAL PACKAGE](../superpowers/g03-approval-package.md) 统一批准。批准后 `status: approved`、`approval-status: approved`；`implementation-status` 于计划执行后更新为 `implemented`。

**ADR 判断**：本增量**不创建新 ADR**。PRD §9.6 已固定聚合算法版本语义（问题记录算法版本；新事件用新算法；不自动重组历史数据），作为 approved 产品规则直接派生；fingerprint 是 `data` 层内部确定性纯函数与既有 `error_event_occurrences` 表的 additive 增列，不改变五系统边界、依赖方向、公开事件协议或长期兼容策略，属于“已批准架构内的普通功能实现”（`Aurora ADR 规范` §7.2）。

## 2. 元数据、Owner 和范围

- **Owner**：processing/backend
- **适用范围**：`@aurora/processing-store` 的错误归一化与 fingerprint 纯函数模块、`error_event_occurrences` 增列 Migration、`persistErrorEventOccurrence` 指纹落库、`@aurora/ingestion-worker` 错误事件处理器指纹接线验证、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-018 实施证据。
- **明确非职责**：
  - Issue 聚合数据模型、Issue 存储、代表样本（DAT-13，accepted ADR 另行）；
  - Issue 生命周期 Command 与活动/审计（DAT-14）；
  - Issue Query（DAT-15）；
  - 自定义 fingerprint 输入（v1 错误契约不含该字段，PRD §9.5 语义预留，需未来契约扩展）；
  - Source Map 与 Stack Frame 源码映射；
  - 请求/性能事件的归一化与分组；
  - 数据保留与清理、告警。

## 3. 模块选择依据与依赖方向

- `packages/processing-store` 已实施 `error_event_occurrences` 表 + `persistErrorEventOccurrence` Repository（accepted ADR-018 / implemented），其 `normalized_body` 是受协议约束的错误正文 jsonb；
- `@aurora/event-schema` 是错误类别/错误描述/资源错误正文的唯一来源（accepted ADR-005），`parseErrorEventEnvelope` 保证正文在进入处理器前已通过精确契约校验；
- 错误处理器核心能力（`createErrorEventProcessor`）已实施（approved 规格 [error-event-processor.md](./error-event-processor.md)），通过包根调用 `persistErrorEventOccurrence`；
- fingerprint 是错误处理域内的分组 key，被 DAT-13 的 Issue 聚合键使用。算法与持久化同置 `data` 层，避免 `data → service` 反向依赖；`@aurora/ingestion-worker`（service）可经 `@aurora/processing-store` 包根消费。
- 依赖方向：`error-fingerprint.ts` → `@aurora/event-schema` 包根常量/类型（`ErrorCategory`、`ErrorEventBody`、`ErrorDescriptor`、`ErrorResourceType`）。`persistErrorEventOccurrence` 内部计算并落库 fingerprint。

## 4. 输入与指纹组成（冻结）

### 4.1 输入

`computeErrorFingerprint` 的公开输入是**已验证的错误正文**（`ErrorEventBody`）与项目标识：

```ts
export interface ErrorFingerprintInput {
  readonly projectId: string;
  readonly body: ErrorEventBody; // 已经 parseErrorEventEnvelope 校验
}
```

输入来自 `error_event_occurrences.normalized_body`（或处理器持有的已验证错误正文）。指纹**不使用**：request/response body、Cookie、Authorization、Token、secret、完整 URL 查询、页面/接口上下文（v1 错误契约不含）、occurredAt、eventId、inboxId、协议版本。

**归一化标题输出（评审落实）**：`computeErrorFingerprint` 同时输出 `normalizedTitle`——取归一化后的 `normalizedMessage` 组件（或 `resource` 类别的归一化 URL path）的有界截断（建议 512 字符）作为安全投影标题，供 DAT-13 `issues.normalized_title` 与 DAT-15 C3 列表/详情展示；`normalizedTitle` 只含归一化占位符，**绝不等于**原始 `error.message`/`stack`（隐私负例断言）。

### 4.2 指纹组成

按 PRD §9.4.3 聚合优先级，指纹是稳定版本前缀 + 有序组件的拼接：

```text
v{version}|{type}|{keyLocation?}|{normalizedMessage}
```

| 组件 | 来源 | 规则 |
|---|---|---|
| `version` | 常量 `ERROR_FINGERPRINT_VERSION = 1` | 算法升级必须升版本，不得静默改变历史 Issue 身份（PRD §9.6） |
| `type` | 错误类型 | `javascript`/`unhandled_rejection` 类别优先取 `error.name`（如 `TypeError`）；缺失或 `string`/`non_standard` 拒绝原因时取稳定类别占位；`resource` 类别取 `resource.type`（`script`/`stylesheet`/`image`/`font`） |
| `keyLocation` | 有效堆栈的关键帧（见 §6） | 存在有效堆栈时必填；无有效堆栈时省略该组件（PRD §9.4.3） |
| `normalizedMessage` | 归一化后的错误信息（见 §5） | 始终存在；`javascript`/拒绝 `error` 原因取 `message`；拒绝 `string` 取 `value`；拒绝 `non_standard` 取有界规范投影；`resource` 取归一化 URL 的 path |

### 4.3 组件与分隔符

- 组件以 `|` 分隔；组件内的 `|`、`\n`、控制字符在投影时替换为安全转义序列，保证同输入必同输出、不同输入不因分隔歧义误合并；
- 指纹是长度有界的字符串（上限由计划冻结，建议 1024 字符），超长组件截断到有界长度并追加确定性后缀，避免无界增长。

## 5. 错误信息归一化（冻结）

按 PRD §9.4.1/9.4.2，**只替换高置信度动态值，保留高置信度稳定值**，并以关键调用栈为主要聚合依据。

### 5.1 替换规则（PRD §9.4.1）

输入消息中的以下高置信度动态值被替换为稳定占位符：

| 值 | 占位符 |
|---|---|
| UUID（标准 8-4-4-4-12 hex） | `:uuid` |
| 明显时间戳（ISO 8601、Unix 秒/毫秒串、常见时间格式） | `:timestamp` |
| 邮箱（ASCII 合法形态） | `:email` |
| 手机号/长数字串（≥8 位纯数字或带国家码形态） | `:phone` |
| 长随机字符串（≥16 位字母数字混合、无稳定子串） | `:random` |
| 常见哈希（≥16 位 hex） | `:hash` |
| 超长纯数字（≥8 位） | `:number` |
| 明显订单号/流水号（短前缀 + 高变化数字/字母段） | `:number` |

替换是**确定性**的：同一输入串总是得到同一归一化串；识别采用固定正则集合，不做机器学习或多层规则（PRD §9.4.6 第一版边界）。

### 5.2 保留规则（PRD §9.4.2）

默认保留：

- HTTP 状态码（`404`、`500` 等 3 位纯数字，不作为 `:number` 替换）；
- 版本号（`x.y.z` 形态）；
- 重试次数、行号；
- 短业务编号（短字母数字、无明显高变化特征）；
- 普通文本中的短数字（<8 位且无高变化上下文）。

### 5.3 敏感信息（PRD §9.4.4）

- 邮箱、手机号等明显个人信息在识别后被替换为占位符，**不作为原始值出现在指纹或问题标题**；
- 指纹只含归一化占位符，不保存原始 PII；
- 归一化**不能替代**完整隐私过滤：`normalized_body` 仍须遵守既有错误契约与隐私边界，`error_message`/`stack` 的原始值仍按事件保留策略处理。

### 5.4 长度与截断

归一化输入长度为 `1..2048`（契约 `maxErrorMessageLength`）；归一化输出与指纹 `normalizedMessage` 组件截断到有界长度（建议 512 字符），超长截断加确定性后缀。

## 6. 堆栈与关键帧投影（冻结）

### 6.1 堆栈解析

`error.stack`（`1..4096`，契约 `maxStackLength`）被**确定性**解析为帧序列：

- 按行拆分为帧；每帧提取 `function`（可为空/匿名）、`file`（URL 或文件路径）、`line`、`col`；
- 跳过无法解析的帧；不改变帧顺序。

### 6.2 关键帧选择

- 取第一帧为**非构造函数/非原生框架包装**帧：跳过 `Error`、`newError`、`construct`、内部 promise 包装等帧；
- 优先选择第一个含真实文件位置的帧（`file` 存在且非 `<anonymous>`/`native`）；
- 选中的帧作为 `keyLocation`：`file + line`（`col` 归一化后省略或保留由计划冻结，建议省略以吸收跨浏览器 col 差异）；
- **帧 `file` 的隐私投影（评审落实）**：帧 `file` 若是 URL，先以最先出现的 `?`/`#` 截断（移除全部查询参数与片段），再排除 scheme 与 authority（与 §7 资源 URL 同口径），只保留 path 与文件/行信息——低熵 secret 进入 `?session=`/`?t=` 查询时不得进入持久化指纹；随后对 path 应用与消息相同的动态值归一化（数字段、UUID、哈希段替换为占位符），避免打包哈希使同一错误拆成多问题；
- 无有效堆栈（无帧、全部 native/anonymous 或堆栈缺失）→ 省略 `keyLocation` 组件（PRD §9.4.3 “没有有效调用栈时”路径）。

### 6.3 Source Map 边界

v1 不解析 Stack Frame 的源码映射（`源码映射后的关键位置优先` 属 DAT-18 Source Map 模块），本增量只做原始堆栈的确定性投影。已有有效源码映射结果的帧位置不作为本增量输入。

## 7. 缺失行为（冻结）

| 情形 | 行为 |
|---|---|
| `message` 缺失 | 契约不允许（`1..2048` 必填）；若在投影中异常为空，使用稳定哨兵 `:empty_message` |
| `name` 缺失 | `type` 组件回退到类别占位（`javascript`→`js_error`、`unhandled_rejection`→`rejection_error`、`resource`→`resource_error`） |
| `stack` 缺失/无有效帧 | 省略 `keyLocation`，指纹退化为 `v1|{type}|{normalizedMessage}`（PRD §9.4.3 无栈路径） |
| 拒绝 `kind: 'string'` | `normalizedMessage` 来自归一化的 `value` |
| 拒绝 `kind: 'non_standard'` | `normalizedMessage` 来自 `value` 的**确定性有界规范投影**：按排序键遍历普通对象、按序遍历数组，仅取字符串叶值并应用消息归一化，非字符串叶贡献确定性类型标记；输出截断到有界长度。原始结构/非字符串值不进指纹 |
| `resource` 类别 | `type` 取 `resource.type`；`normalizedMessage` 取归一化 URL 的 path（`authority` 与 scheme 不进指纹；动态 path 段替换为占位符） |

## 8. fingerprint 版本与兼容策略（冻结）

- `ERROR_FINGERPRINT_VERSION = 1`；指纹字符串固定前缀 `v1|`；
- **算法升级规则**（PRD §9.6）：修改归一化正则、指纹组成、关键帧选择或占位符语义属于算法变化，必须升 `ERROR_FINGERPRINT_VERSION`；
- **兼容语义**：版本升级后**新事件使用新版本指纹**；**不自动重组全部历史数据**；历史 Issue 保持其创建时的指纹版本；需要历史重组时作为独立后台任务实施（不在本增量）；
- **稳定性承诺**：同一版本、同一输入 → 同一指纹（确定性纯函数，无随机、无时钟、无 I/O、无副作用）；“同样错误必须稳定分组，故意不同错误必须分离”为验收目标。

## 9. 自定义 fingerprint 边界（冻结）

PRD §9.5 允许 SDK 设置自定义 `fingerprint`。但 v1 错误事件契约（[error-event-contract.md](../protocol/error-event-contract.md) §4）**不含自定义 fingerprint 字段**，错误正文采用严格字段允许列表（未知字段拒绝）。因此：

- v1 指纹算法**不接受自定义 fingerprint 输入**；
- 自定义 fingerprint 语义（自定义值优先、不能含敏感原始值、不能绕过服务端校验、配置错误回退默认聚合、只影响未来事件）作为**未来契约扩展预留**；
- 若未来错误契约增加自定义 fingerprint 字段，须先完成协议兼容评估并可能新建 accepted ADR（`Aurora ADR 规范`），本增量不实现。

## 10. 隐私与脱敏边界（冻结）

- 指纹只含：版本、类别/错误类型、关键帧的归一化位置、归一化错误信息占位符；
- **禁止**参与指纹：request/response body、Cookie、Authorization、Token、secret、完整 URL query、页面/接口上下文、occurredAt、eventId、inboxId、内部 DB 标识、完整原始 PII；
- 归一化占位符不可逆（不携带被替换的原始值）；
- `error_message`/`stack` 原始值只存在于受协议约束的 `normalized_body`，按既有事件保留策略处理；指纹与日志诊断不得回显原始值。

## 11. 实现位置、公共出口与持久化

### 11.1 `@aurora/processing-store`

- 新建纯函数模块 `src/error-fingerprint.ts` + `src/error-fingerprint-types.ts`：
  - `ERROR_FINGERPRINT_VERSION`（常量 `1`）；
  - `computeErrorFingerprint(input: ErrorFingerprintInput): ErrorFingerprintResult`，结果含 `fingerprint`（稳定字符串）、`fingerprintVersion`（`1`）与 `normalizedTitle`（安全投影标题，§4.1 冻结）；
  - 纯函数：无随机、无时钟、无 I/O、无数据库、不写日志、不修改输入、输出冻结。
- 包根 `index.ts` 导出 `computeErrorFingerprint`、`ERROR_FINGERPRINT_VERSION`、`ErrorFingerprintInput`/`ErrorFingerprintResult`。
- 新增 additive Migration：`error_event_occurrences` 增加 `fingerprint varchar(1024) NOT NULL` 与 `fingerprint_version integer NOT NULL`（默认 `1`）。迁移只增列，不修改既有列/约束/索引；加 `fingerprint` 索引以支持 DAT-15 分组查询（索引名与计划冻结）。
- `persistErrorEventOccurrence` 输入扩展为接受 `fingerprint`/`fingerprintVersion`（由处理器计算传入；store 校验格式并落库，不重复计算）。

### 11.2 `@aurora/ingestion-worker`

- `createErrorEventProcessor` 经 `@aurora/processing-store` 包根调用 `computeErrorFingerprint` 计算 fingerprint，并随 occurrence 持久化调用传入 `persistErrorEventOccurrence`；
- 处理器接口与既有结果映射**不修改**；错误事件处理器接线验证任务确认经真实处理器持久化的 occurrence 带正确 `fingerprint`/`fingerprint_version`；
- DAT-13 处理器集成复用同一 `computeErrorFingerprint` 输出，保证 occurrence 与 Issue 聚合键一致（单一计算点）。

### 11.3 依赖边界

- `processing-store`（`data` 层）只新增对 `@aurora/event-schema` 包根的既有依赖；无新本地依赖、无循环依赖、无私有深导入；
- 不新增包；不修改 `event-schema`、`ingestion-inbox`、`ingestion-api`、OpenAPI、Platform Contract。

## 12. 单元测试

直接调用 `computeErrorFingerprint`，覆盖：

- **确定性**：同输入多次调用返回同一指纹；输入对象不被修改；
- **等价错误分组**：仅随机编号/时间戳/订单号/邮箱/手机号/哈希不同的同类错误 → 同一指纹；
- **故意不同错误分离**：错误类型不同、关键帧位置不同、稳定语义不同的消息 → 不同指纹；
- **无栈路径**：缺 stack → `v1|{type}|{normalizedMessage}`；有 stack → 含 `keyLocation`；
- **归一化边界**：HTTP 404/500、版本号、重试次数、行号、短业务编号保留；UUID/长随机串/长纯数字/订单号替换；
- **resource 类别**：`type` 取资源类型；URL path 归一化，authority/scheme/query 不进指纹；
- **拒绝原因**：`error`/`string`/`non_standard` 三类各自的指纹；`non_standard` 规范投影确定性；
- **隐私负例**：指纹/输出不含原始 email、手机号、UUID 值、token、secret、URL query；
- **版本兼容**：`ERROR_FINGERPRINT_VERSION` 固定为 `1`；算法变化升版本的语义被测试固定。

## 13. 真实 PostgreSQL 集成测试

- 新增 Migration 在真实 PostgreSQL 17.10 可回放/回滚；
- `persistErrorEventOccurrence` 持久化后 `error_event_occurrences.fingerprint`/`fingerprint_version` 与 `computeErrorFingerprint(normalized_body)` 一致；
- 经真实 `createErrorEventProcessor` 处理错误事件 → occurrence 行带正确指纹（错误事件处理器接线验证）；
- `(project_id, event_id)` 幂等保持：重复处理不产生重复 occurrence 行；
- Schema 与 Pool 完整清理。

## 14. 覆盖率与质量门禁

`packages/processing-store` 维持既有覆盖率阈值（lines/branches/functions/statements）。不得排除具有分支逻辑的新文件，不得降低门槛，不得删除或弱化失败测试。

实施必须新鲜运行：受影响 package `typecheck`、fingerprint 单元测试、targeted 真实 PG 集成测试、Lint、构建、包入口、Workspace 边界、`git diff --check`。本增量不运行 SDK/Console/浏览器/ingestion 全量矩阵。

## 15. 文档与 ADR 同步

- `packages/processing-store/README.md`：增加错误归一化与 fingerprint 能力、接口、版本语义与隐私边界；
- `docs/architecture/error-event-occurrence-processing-store.md`：追加 fingerprint 增列证据，保持 ADR-018 结论不变；
- `docs/architecture/formalization-readiness.md`、`docs/README.md`：把 Issue/fingerprint 状态更新为“fingerprint 算法 implemented、Issue 聚合数据模型 not-started（G03 后续叶子）”；
- ADR-018：只追加 fingerprint 增列与落库实施证据，保持 `accepted / implemented`；
- `AGENTS.md` 与 `AURORA_RULES.md`：全部门禁实际通过后才更新阶段快照；
- G03 计数：DAT-12 独立验收通过后 `completed 46→47 / remaining 32→31`。

## 16. 明确排除范围

- Issue 聚合与代表样本（DAT-13）；
- Issue 生命周期 Command/活动/审计（DAT-14）；
- Issue Query（DAT-15）；
- 自定义 fingerprint 输入（需契约扩展）；
- 页面/接口上下文进入指纹（v1 错误契约不含）；
- Source Map 与源码映射位置；
- 请求/性能事件归一化；
- 数据保留、清理、告警。

## 17. 规格自检

- 输入只来自已验证错误正文，隐私禁止字段全部排除；
- 归一化替换/保留规则逐条对应 PRD §9.4.1/9.4.2；指纹组成逐条对应 PRD §9.4.3；
- 缺失行为（无栈/无 name/空消息/non_standard）全部有确定语义；
- 版本与兼容语义逐条对应 PRD §9.6（新事件用新算法、不自动重组历史）；
- 自定义 fingerprint 边界诚实：v1 契约不含该字段，语义预留；
- 确定性纯函数、输出冻结、输入不变；
- 实现位置与依赖方向符合 `data` 层约束，无循环依赖；
- 测试覆盖确定性、分组、分离、隐私、版本兼容与真实 PG 落库；
- 不新增包、不修改公开事件协议、不修改 ADR 决策；
- 无占位/TBD，全部常量与类型签名冻结。

自动审批依据：本文语义全部由 approved PRD §9.1—9.6、approved 错误事件协议契约、approved 错误 occurrence 处理存储规格与 accepted ADR-005/006/018 无歧义派生；无新增产品/架构/安全/隐私决策（自定义 fingerprint 与页面上下文进入指纹属未来契约扩展，非本增量决策）；不创建新 ADR。纳入 G03 APPROVAL PACKAGE 统一批准。
