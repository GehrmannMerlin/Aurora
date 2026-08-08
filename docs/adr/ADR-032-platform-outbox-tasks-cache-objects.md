---
title: ADR-032：管理平台 Outbox、任务、缓存与对象存储基础设施
status: accepted
decision-status: accepted
implementation-status: not-started
approval-status: approved
owner: backend/operations
date: 2026-08-08
last-reviewed: 2026-08-09
applies-to: 管理平台 platform-api/platform-worker 的异步边界——事务性 Outbox、后台任务/队列、缓存、对象存储（Source Map、导出等）；不改变已 accepted 的 ingestion 域基础设施决策
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../architecture/formalization-readiness.md
  - ./ADR-029-platform-database-access-and-migration.md
  - ./ADR-031-platform-email-delivery.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
superseded-by: none
---

# ADR-032：管理平台 Outbox、任务、缓存与对象存储基础设施

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-review
- 日期：2026-08-08
- Owner：backend/operations
- 适用范围：管理平台 `platform-api`/`platform-worker` 的异步边界——事务性 Outbox、后台任务/队列、缓存、对象存储（Source Map、导出等）；不改变已 accepted 的 ingestion 域基础设施决策
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)（§17.3 永久删除清理、§5.4 私密令牌）
- 关联技术方案：[管理平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved，BACKEND-002=B）
- 关联 ADR：[ADR-029](../../docs/adr/ADR-029-platform-database-access-and-migration.md)（proposed）、[ADR-031](../../docs/adr/ADR-031-platform-email-delivery.md)（proposed，Outbox 记录邮件）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：无
- 被替代 ADR：无

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：formalization-readiness §7 候选队列第 6 项"平台 Outbox、任务、缓存与对象"；平台后端设计 BACKEND-002=B"PostgreSQL Outbox＋Redis/BullMQ＋私有 S3 兼容对象存储、第一版无独立搜索"；G10 SEC-01 需要异步删除交接、PLT-03 需要 Outbox 记录邮件发送。**在用户批准（accepted）前，不得创建 Outbox 表、BullMQ 队列、Redis 缓存基础设施、S3 对象存储或进入 `writing-plans`。**

## 背景

G10 叶子需要异步边界：PLT-03 邮箱验证/重置/邀请的发送请求需要事务性 Outbox 权威记录（ADR-031）；SEC-01 账号注销的在线清理交接（A5-009，7 天在线清理）需要后台任务机制；B6 私密令牌与 B8 回收站需要状态清理任务；未来 Source Map 上传需要对象存储。当前没有任何 accepted ADR 冻结这些物理技术。平台后端设计 BACKEND-002=B 已批准方向（Outbox＋BullMQ＋S3），但未升格为 accepted ADR。

## 决策驱动因素

- **可靠性与一致性**：Outbox 保证业务事务与副作用（邮件/任务）不丢失；
- **与 approved 设计一致**：BACKEND-002=B 已批准 PostgreSQL Outbox＋Redis/BullMQ＋S3；
- **职责边界**：管理平台域与 ingestion 域基础设施独立，不共享队列（避免跨域耦合）；
- **安全与隐私**：对象存储私有、Source Map 访问受限、删除传播可审计；
- **运维复杂度**：Redis 已由 ADR-030 引入（Session）；BullMQ 复用 Redis 实例需隔离命名空间。

## 候选方案

### 方案 A：PostgreSQL 事务性 Outbox + Redis/BullMQ + 私有 S3 兼容对象存储（推荐）

**行为**：业务事务内写 Outbox 记录（幂等键、聚合、payload）；Worker 轮询 Outbox 发布到 BullMQ 队列；BullMQ 队列处理任务（邮件发送、删除交接、Source Map 处理）；Redis 复用（Session 命名空间隔离）；私有 S3 兼容对象存储承载 Source Map/导出，URL 短期签名。

**优点**：与 BACKEND-002=B 一致；Outbox 保证事务与副作用一致；BullMQ 提供租约/重试/死信；S3 私有签名 URL 满足 Source Map 安全边界；Redis 实例复用。

**缺点**：两套异步机制（Outbox→BullMQ）需要接线与运维；Redis 成为 Session+队列共享依赖；S3 增加对象生命周期管理。

**选择结论**：推荐。

### 方案 B：Outbox + SQS（不采用）

**行为**：Outbox 记录 + AWS SQS 队列。

**优点**：托管队列免运维。

**缺点**：SQS 与公有云绑定（与阿里云 Preview 单主机不一致）；事务性 Outbox 仍需 Worker 发布；本地/Preview 无 SQS 等价物，测试困难；与 BACKEND-002=B 冲突。

**选择结论**：不采用。

### 方案 C：仅 Outbox 无独立队列（不采用）

**行为**：只使用 Outbox，Worker 直接消费记录，无 BullMQ。

**优点**：组件最少。

**缺点**：缺少租约/重试/死信/优先级等队列能力；与 BACKEND-002=B（Redis/BullMQ）冲突；高负载任务管理脆弱。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Outbox+BullMQ+S3 | B：Outbox+SQS | C：仅 Outbox |
|---|---|---|---|
| 与 BACKEND-002=B 一致 | 是 | 否 | 否 |
| 本地/Preview 可测 | 是（Redis 本地） | 难 | 是 |
| 队列能力（重试/死信） | 完整 | 完整 | 弱 |
| 对象存储安全 | 私有签名 URL | 同 A | 无 |

## 最终决策（proposed）

**方案 A：PostgreSQL 事务性 Outbox + Redis/BullMQ + 私有 S3 兼容对象存储。**

### 决定细节（proposed）

1. **事务性 Outbox**：业务事务内写 Outbox（幂等键、聚合类型、payload、状态）；Worker 轮询发布；Outbox 表为平台域独立表（不混入 ingestion）；
2. **队列**：BullMQ 队列，Redis 命名空间与 Session 隔离；任务含邮件发送、删除交接、Source Map 处理、回收站清理；租约/重试/死信语义与 ingestion Worker 模式一致但不共享队列；A5 删除交接任务继承账号注销安全规格 §8 不变量（可重启/幂等、跨系统确认后才呈现 deleted、7 天期限、停滞告警→Runbook）；
3. **缓存**：Redis 复用（Session + BullMQ 命名空间隔离）；不引入独立缓存服务；同一 Redis 实例上 ADR-030 的 `noeviction` Session 命名空间与 BullMQ 队列共享容量，实例规格/淘汰边界由部署与运维规格承载并在 G10 实施计划中显式命名，避免实现期冲突；
4. **对象存储**：私有 S3 兼容对象存储（本地/Preview 可用 MinIO 或等价）；Source Map/导出 URL 短期签名、访问受限；删除传播可审计；当前 Public Preview 单主机（`public-preview-single-host-deployment.md`）无 Redis/对象存储且不创建付费云资源，本 ADR 实施需在单主机上本地提供 Redis/MinIO，并核对内存/磁盘预算；
5. **无独立搜索**：第一版不引入 OpenSearch/全文搜索（accepted 设计）。

## 结果与影响

### 正面影响

- 解除 SEC-01 删除交接与 PLT-03 邮件 Outbox 的异步阻塞；
- 与 BACKEND-002=B 一致；
- Outbox+BullMQ 保证可靠异步；S3 签名 URL 安全。

### 负面影响与代价

- 两套异步机制接线复杂度；
- Redis 共享依赖；
- S3 生命周期管理。

### 未解决问题

- 具体对象存储服务（阿里云 OSS / MinIO 本地）与账号（用户授权）；
- 具体 Outbox 表结构/Worker 轮询参数（叶子规格冻结）。

## 实施约束

- 不把 Outbox payload 里的验证码/重置 token/私密令牌写入日志；
- 管理平台域与 ingestion 域不共享队列；
- 对象存储私有、URL 短期签名、删除传播可审计；
- S3/OSS 账号与 secret 不进 Git/日志。

## 迁移方案

- 首次引入 Outbox 表 + BullMQ 队列 + S3 适配器；后续替换供应商通过适配器。

## 回滚方案

- 队列/对象适配器可替换；Outbox 记录保留可审计；禁用任务处理可回退到重试到期失败。

## 验证方式

- Outbox 集成测试（真实 PostgreSQL，断言事务/幂等/状态）；
- BullMQ 队列集成测试（真实 Redis，断言租约/重试/死信）；
- S3 适配器集成测试（本地 MinIO 或等价）；
- 全仓质量门禁。

## 重新评估条件

- 容量/成本证据显示 BullMQ 或 S3 不适合；
- 出现云原生托管队列/对象硬性要求；
- 独立搜索需求触发（候选项 #10）。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-review`；
- 由 G10 PLT-03（Outbox 邮件）与 SEC-01（删除交接）实施门禁创建；
- 依据 formalization-readiness §7 候选 6、BACKEND-002=B；
- 未调用 writing-plans、未创建 Outbox/BullMQ/S3 实现、未进入实施；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（backend/ops + architecture subagents，记录用，不代替正式批准）

> 评审意见用于改进决策材料，不改变 ADR 状态；正式接受必须由用户完成。

- **后端/运维评审**：`ACCEPT`（无 blocking）。已按非阻断观察修订：N1 候选集与 formalization §7 项 6 对齐说明；N2 Preview 单主机无 Redis/对象存储且不创建付费云资源，决定细节 4 已补充需在单主机本地提供 Redis/MinIO 并核对内存/磁盘预算；N3 Redis 隔离（独立凭据/容量/淘汰/监控）与 ADR-030 noeviction 命名空间共享容量冲突由决定细节 3 显式命名给部署与运维规格；N4 A5 删除交接不变量（可重启/幂等/跨系统确认/7 天期限/停滞告警）由决定细节 2 交叉引用账号注销安全规格 §8。
- **架构交叉评审**：`ACCEPT`（无 blocking）。与 BACKEND-002=B 逐条一致（同事务 Outbox、relay、BullMQ、PostgreSQL 权威、私有 S3 短期签名 URL、无独立搜索）；正确限定为通用异步基础设施，不越界 SEC-02 跨存储物理删除/备份淘汰。

### 2026-08-09：用户正式批准（accepted，附 YAGNI 实施约束）

- 用户已于 2026-08-09 对本 ADR 作出明确正式批准，批准范围（逐条）：
  1. 管理平台 Outbox、任务、缓存与对象存储的长期架构（PostgreSQL 事务性 Outbox + Redis/BullMQ + 私有 S3 兼容对象存储）与职责边界；
  2. 无独立搜索（第一版）；
  3. 平台域与 ingestion 域不共享队列，保持清晰系统边界；
  4. A5 删除交接任务继承账号注销安全规格 §8 不变量（决定细节 2）；
  5. Preview 单主机本地 Redis/MinIO 资源预算（决定细节 4）。
- **YAGNI 实施约束（用户附加，与本 ADR 同等效力）**："ADR accepted 不等于当前 G10 必须立即 provision 所有 Redis/cache/object storage/background infrastructure"。只有满足以下全部条件才允许实际创建：① 当前 approved PLT-03/PLT-04/SEC-01 规格确实需要；② 当前实现存在真实 consumer；③ ADR 明确要求该资源。禁止因为 ADR 定义了未来基础设施边界就提前创建没有 consumer 的付费资源。
- 批准仅适用于本 ADR 已记录并经过评审修订的决策范围；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留（"创建（proposed）"与"独立评审"各节均未删除或覆盖）；
- 实施状态保持 `not-started`，直到对应代码实施真正开始；本 ADR 不得在此时标记为 implemented 或 in-progress。
