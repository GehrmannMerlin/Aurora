---
title: Aurora 协议兼容边界（PRO-06 第一增量）
status: approved
owner: protocol
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/event-schema 的公共协议版本协商出口、兼容边界声明、SDK 版本保证与配套测试/文档
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/sdk-architecture.md
  - ../architecture/aurora-v1-remaining-module-batches.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - event-schema-foundation.md
  - event-envelope-v1.md
  - ../sdk/sdk-core-foundation.md
supersedes: none
review-cycle: protocol-or-public-api-change
---

# Aurora 协议兼容边界（PRO-06 第一增量）

## 1. 定位与批准来源

本文把 G05 叶子 PRO-06「协议兼容转换和版本协商」正式化为第一增量。该增量建立在 accepted [ADR-005](ADR-005-event-schema-source-of-truth.md) 与 approved [event-schema-foundation.md](event-schema-foundation.md) 既有的版本与兼容策略之上，只补足**公共版本协商出口**、**明确为空的转换边界**和 **SDK 不改变 wire contract 的保证**，不建立任何转换框架，不虚构历史版本转换器。

批准来源：G05_APPROVAL_PACKAGE 缺口 1，用户 2026-08-10 批准全部推荐方案。批准范围仅限 PRO-06 增量，不扩大协议范围。

## 2. 已有 approved 决策（本增量不再重复批准）

- 当前且唯一受支持协议版本是数字字面量 `1`（`CURRENT_PROTOCOL_VERSION`、`SUPPORTED_PROTOCOL_VERSIONS`）；
- 解析器只接受 `SUPPORTED_PROTOCOL_VERSIONS` 中的精确值，对未知版本不猜测、不降级（event-schema-foundation §7）；
- 同一版本内新增可选字段通常兼容；删除字段、改变含义/类型、可选改必填、改变枚举含义均不兼容；
- 不兼容变化必须创建新 ADR、迁移说明和旧版本处理方案，不得静默修改版本 `1`；
- 当前不存在历史协议版本，不得虚构 `v0` 转换器；
- `parseEventEnvelope` 已对未知/不支持版本返回稳定 `unsupported_protocol_version` issue。

## 3. 模块职责与非职责

### 3.1 职责（本增量）

- 在 `@aurora/event-schema` 根出口新增公共版本协商函数与稳定结果联合；
- 用公开契约和测试证明「未知/更新版本明确拒绝，绝不转换/猜测/降级」；
- 以可执行测试证明兼容转换能力当前**为空**（不存在任何转换器公共出口）；
- 记录 SDK 侧的协议版本保证：SDK 始终只产生 `CURRENT_PROTOCOL_VERSION` 事件，不得以 SDK 私有逻辑改变公共 wire contract；
- 同步协议文档、README、docs/README.md 和 ADR-005 实施证据（实施完成后追加）。

### 3.2 明确非职责

- 不创建版本转换框架、转换器注册表、Schema DSL 或降级通道；
- 不为不存在的历史版本虚构 `v0`/旧版解析器；
- 不实现 SDK 采集、采样、队列、传输、持久化；
- 不改变 `parseEventEnvelope`、`EventEnvelope` 或任何既有公共出口的签名与语义；
- 不生成 JSON Schema、OpenAPI 或文档站点；
- 不发布 npm 制品、不引入版本发布工具、CI 或基础设施。

## 4. 公共 TypeScript 契约（新增，纯增量）

```ts
export type ProtocolNegotiationCode = 'supported' | 'unsupported_version';

export interface ProtocolNegotiationSupported {
  readonly ok: true;
  readonly code: 'supported';
  readonly version: ProtocolVersion; // 固定为 1
}

export interface ProtocolNegotiationUnsupported {
  readonly ok: false;
  readonly code: 'unsupported_version';
  readonly requestedVersion: unknown; // 原始输入原样（有界，不复制到实例外）
}

export type ProtocolNegotiationResult =
  | ProtocolNegotiationSupported
  | ProtocolNegotiationUnsupported;

export function negotiateProtocolVersion(input: unknown): ProtocolNegotiationResult;
```

### 4.1 语义

- `negotiateProtocolVersion(input)` 是**版本协商**的公共入口：
  - 输入是数字且严格等于 `SUPPORTED_PROTOCOL_VERSIONS` 中某值 → `{ ok: true, code: 'supported', version }`；
  - 输入是数字但不在支持集合 → `{ ok: false, code: 'unsupported_version', requestedVersion: input }`；
  - 输入不是数字 → `{ ok: false, code: 'unsupported_version', requestedVersion: input }`；
- 结果全部为新对象，不修改输入，不记录到任何实例外状态；
- 函数不得抛出（普通非法输入一律以稳定结果返回）；
- 与 `parseEventEnvelope` 的关系：`negotiateProtocolVersion` 只协商版本号，`parseEventEnvelope` 继续负责完整信封校验；二者对未知版本结论一致（均拒绝）。

### 4.2 兼容转换边界声明

当前不存在可迁移的历史协议版本，因此本增量**不导出任何转换函数**。以下行为以测试明确固定：

- `@aurora/event-schema` 根出口不存在任何 `convert*`/`upgrade*`/`downgrade*` 公共函数；
- 任何「兼容转换」需求必须先经 ADR-005 门禁形成新 ADR + 迁移方案，再在本包中实施；
- SDK 侧遇到未知/更新版本输入时，只能返回稳定拒绝结果，不得降级、猜测或改写协议字段。

## 5. 测试与门禁

### 5.1 必测行为（`@aurora/event-schema`）

- `negotiateProtocolVersion(1)` → supported；
- `negotiateProtocolVersion(2)`、`negotiateProtocolVersion(0)`、`negotiateProtocolVersion('1')`、`negotiateProtocolVersion(null)`、`negotiateProtocolVersion(undefined)`、`negotiateProtocolVersion({})` → unsupported_version；
- 与 `parseEventEnvelope` 的版本结论一致性（版本 `2` 信封同时返回 `unsupported_protocol_version`）；
- 包入口负例：根出口不存在转换器函数（package-entry 测试）；
- 结果不可变性：返回对象冻结，输入不被修改；
- 既有事件契约全部既有测试保持通过（无回归）。

### 5.2 覆盖率

沿用包既有门槛（行 ≥85%、分支 ≥80%、函数 ≥85%、语句 ≥85%），由 `packages/event-schema/vitest.config.ts` 固定，不新增单独门槛，不排除文件。

## 6. 文档与 ADR 同步

实施完成后在同一变更中：

- `docs/protocol/event-envelope-v1.md`：在兼容规则中引用本协议兼容边界与 `negotiateProtocolVersion`；
- `packages/event-schema/README.md`：记录版本协商公共出口与空转换边界；
- `docs/README.md`：索引本规格；
- ADR-005：追加 PRO-06 第一增量实施证据，实施状态保持 `in-progress`（完整协议消费者、批次与历史版本兼容仍不存在）；
- `AGENTS.md`/`AURORA_RULES.md`：在 G05 状态与决策队列中同步 PRO-06 关闭后计数。

## 7. 与相邻模块边界

- SDK 控制面（`@aurora/sdk`）只消费本增量公共出口，不复制版本常量；
- 数据接入/处理层继续经 `parseEventEnvelope`/`parseIngestionBatchRequest` 拒绝不支持版本；
- 不提前实现 G06（队列/传输）与 G07（框架适配）。
