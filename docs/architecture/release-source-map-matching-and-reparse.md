---
title: DAT-18 发布关联、Source Map 匹配、符号化与重解析
status: approved
owner: platform/releases
last-reviewed: 2026-08-12
applies-to: PRD §8 发布版本与源码映射后端链——Release identity → Source Map metadata/private storage → error frame → match → symbolicate → reparse
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../prd/platform-product-domains.md
  - ../architecture/platform-backend.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/plans/2026-08-12-dat-18-release-source-map-matching-and-reparse.md
  - ../adr/ADR-032-platform-outbox-tasks-cache-objects.md
supersedes: none
review-cycle: product-or-api-change
---

# DAT-18 发布关联、Source Map 匹配、符号化与重解析

## 1. 目标与边界

实现 PRD §8 发布关联与 Source Map 后端链：Release 身份、Source Map 元数据、私有对象存储端口、确定性匹配、source-map v3 符号化与有界重解析，并通过 `@aurora/platform-contract` 冻结机器契约、经 `apps/platform-api` 公开、由 `apps/platform-worker` 轮询执行重解析。

本规格明确不实现：

- 公开 Source Map、原文件下载/短期签名 URL（对象存储供应商集成 deferred）；
- SDK 事件上报 release / 事件侧 release 自动归因（wire protocol 本轮不变；重解析采用显式 release 归因）；
- 部署记录与"成功部署参与再次出现判断"（C4/G03 依赖，PRD §8.2）；
- 跨版本尝试、模糊文件名匹配、代码仓库扫描、完整文件版本历史、独立任务中心、网页规则编辑（PRD §8.3.11）；
- Console 页面（G12 C8/C9）、修改 Error fingerprint 语义、源码内容预览。

## 2. 权威来源

- 发布/匹配/符号化/重解析语义：PRD §8.1—8.3.11、§9.3、§13（权限）、§14（隐私）；
- 页面口径：UX/UI §7.23—7.24、§8.21—8.22、§10.15—10.16；
- 对象存储语义：平台后端 §9.3（私有桶、不可猜测键、服务端摘要验证、激活后才可用）+ accepted ADR-032；
- 数据所有权：平台后端 §3（发布元数据 = 平台 PostgreSQL；符号化结果附加到处理存储的 error occurrence）。

## 3. 数据模型

**`@aurora/platform-releases`（新平台 data 包）** Migration `1787000000000_releases-and-source-maps.ts`：

| 表 | 职责 |
|---|---|
| `releases` | 发布身份，`(project_id, version)` 唯一；v1 由获授权 Source Map 上传幂等创建（`source` 恒 `source_map_upload`） |
| `source_map_files` | 严格键 `(release_id, normalized build_path)` 唯一；元数据（object_key/digest/build_id/version/replaced_at）；同摘要幂等、异摘要 `replace_conflict` 需显式替换 |
| `source_map_reparse_tasks` | 有界重解析任务，每 `(release_id, source_map_file_id)` 至多一个活动任务（部分唯一索引）；queued/processing/completed/failed |

**`@aurora/processing-store`** Migration `1722500000011_error-occurrence-symbolizations.ts`：

- `error_occurrence_symbolizations`：`(occurrence_id)` 唯一当前符号化；含 `map_version`（替换触发重解析可重处理旧版本符号化）、`resolved_file/line/column/function_name`、`status`（symbolized/not_found/parse_failed）。

## 4. 私有对象存储端口

`SourceMapObjectStoragePort`（put/get/delete）+ 不可猜测对象键 `aurora-sourcemaps/{projectId}/{uuid}.map`（不拼接原始上传路径）。v1 提供 disposable `InMemorySourceMapObjectStorage`（测试/开发单进程）；真实 S3/MinIO 接线 deferred（accepted ADR-032 YAGNI + 无凭证）→ 记录 **`PRODUCTION_OBJECT_STORAGE_EVIDENCE_PENDING`**，不阻塞业务实现关闭。客户端上报密钥禁读；无永久 URL。

## 5. 匹配与符号化（纯函数）

- `normalizeBuildPath`（PRD §8.3.3）：只移除协议/域名、查询/片段、补前导 `/`；保留路径+文件名+哈希；无模糊匹配。
- `parseSourceMapV3`/`resolveSourcePosition`：source-map v3 VLQ 确定性解码（无外部依赖）；1-indexed 行、找 genCol ≤ column 的最后一个 segment；越界/畸形 → null（PRD §8.3.5 "解析位置不存在"，绝不猜测）。
- 严格匹配键：`项目 + 发布版本 + 规范化构建路径` 完全一致（PRD §8.3.2）。

## 6. 上传 / 替换 / 重解析

- **上传**（项目管理员/获准开发成员，CSRF + 幂等 + 审计 `source_map.uploaded`）：upsert release → 存内容到对象存储 → 建 map 元数据（同摘要 `duplicate` 幂等；异摘要 `replace_conflict` 返回 currentDigest/version，不覆盖）→ 自动建重解析任务（PRD §8.3.8）。
- **替换**（显式确认 + 乐观 version + 审计 `source_map.replaced`）：新内容新键 → 更新元数据（version+1）→ 清理旧对象 → 自动建重解析任务。
- **重解析**：`runSourceMapReparseRound`（worker 轮询，`FOR UPDATE SKIP LOCKED` 领取）：读 map → 解析 → 对项目内有界未符号化/旧版本符号化 occurrence 提取栈帧 → 严格匹配构建路径 → 符号化 → upsert `error_occurrence_symbolizations`（幂等）。单任务失败不阻断其余。
- 显式 `sourceMapsReparse` 命令用于失败重试/刷新（为每个活动 map 文件建任务）。

## 7. 公开契约（5 个稳定操作）

| operationId | 说明 |
|---|---|
| `releasesListReleases` | C8 发布列表（source、firstSeenAt、sourceMapFileCount） |
| `sourceMapsListFiles` | C9 当前有效文件列表（含重解析状态投影） |
| `sourceMapsUpload` | 上传（releaseVersion/buildPath/content/digest/buildId） |
| `sourceMapsReplace` | 显式替换（versioned） |
| `sourceMapsReparse` | 显式有界重解析触发 |

## 8. 实施边界与记录

- v1 上传体上限 240KB（platform-api 全局 bodyLimit 256KB），大 map 传输/分块 deferred。
- `lcp_ratio` 等无关：本叶只做 Source Map；性能/请求指标不受影响。
- 重解析候选为项目级（事件无 release，无法按 release 过滤），显式 release 归因 + `map_version` 追踪；该语义如实记录，避免自动跨版本猜测。
- 不修改 wire protocol、不修改 Error fingerprint、不产生第二套 Release 模型（本模型即 PRD §8 唯一正式模型）。
- 错误经 RFC 9457 + 稳定错误码；不泄露对象键、完整摘要、堆栈或账号存在性。
