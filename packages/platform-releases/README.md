# @aurora/platform-releases

Aurora 平台 Release 与 Source Map 数据层（DAT-18，PRD §8）。

私有 data 层包，只依赖 `pg`。职责：

- **Release 身份**：`releases` 表，按 `(project_id, version)` 唯一；v1 由获授权 Source Map 上传幂等创建（SDK 首现自动创建因事件无 release 字段 deferred）。
- **Source Map 元数据**：`source_map_files` 表，按严格键 `(release_id, normalized build_path)` 唯一；同摘要幂等返回，异摘要 `replace_conflict` 需显式替换（乐观版本）。
- **私有对象存储端口**：`SourceMapObjectStoragePort`（put/get/delete + 不可猜测对象键）；v1 提供 disposable `InMemorySourceMapObjectStorage`（测试/开发），真实 S3/MinIO 接线 deferred（accepted ADR-032 YAGNI）。
- **匹配与符号化**：`normalizeBuildPath`（PRD §8.3.3 有限规范化）、`parseSourceMapV3`/`resolveSourcePosition`（source-map v3 VLQ 确定性解析，无外部依赖）。
- **有界重解析任务**：`source_map_reparse_tasks`，每 (release, file) 至多一个活动任务；Worker 用 `claimPendingReparseTasks`（FOR UPDATE SKIP LOCKED）领取。

命令：`pnpm --filter @aurora/platform-releases test`（单元）、`typecheck`、`build`、`migrate`。
