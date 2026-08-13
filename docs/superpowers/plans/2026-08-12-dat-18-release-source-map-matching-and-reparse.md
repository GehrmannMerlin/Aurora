# DAT-18 Source Map Matching Processing and Reparse Implementation Plan

> **执行方式（用户指令 G04 FINAL CLOSE §11/§12）：** writing-plan 自检后由当前 Claude 直接实施。不派 Agent、不派 Reviewer、不调用其他 Superpowers skill。测试预算严格遵守 §14/§15/§16。

**Goal:** 实现 PRD §8 发布关联与 Source Map 后端链——Release identity → Source Map metadata/private storage port → error frame → match → symbolicate，以及"旧未解析错误 → 稍后上传 map → reparse → 解析源码位置"，并冻结 `@aurora/platform-contract` 契约、新增 `@aurora/platform-releases` 数据包、扩展 `@aurora/processing-store` 符号化存储、接线 `apps/platform-worker` 重解析轮询与 `apps/platform-api` 5 个 handler。

**Architecture:** Release 与 Source Map 元数据落在新平台数据包 `@aurora/platform-releases`（平台后端 §3 "发布元数据" = 平台 PostgreSQL）；Source Map 内容经 `SourceMapObjectStoragePort`（抽象，v1 用 disposable in-memory adapter，真实 S3/MinIO 因 ADR-032 YAGNI + 无凭证 deferred）；符号化结果落在 `@aurora/processing-store`（附加到错误 occurrence）；重解析编排在 `apps/platform-worker`（service 层可跨 data 包桥接）。匹配确定性（项目+发布+规范化构建路径），符号化纯函数（source-map v3 VLQ 解析），重解析幂等、有界、显式 release 归因（事件无 release 字段且本轮不修改 wire protocol，如实记录 v1 边界）。

**Tech Stack:** TypeScript、PostgreSQL 17 + `pg` + `node-pg-migrate`、`@aurora/platform-contract`（OpenAPI 注册表 + 漂移门禁）、`@aurora/processing-store`、Fastify 5、vitest。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | ------------------------------------------- |
| DAT-18 | BASE-PRD / BASE-ARCH / BASE-IMPL / PLAT-DOMAINS / PLAT-UX / PLAT-OAPI / OPS-DELIVERY / FORM（已回读） | PRD §8（8.1—8.3.11）、§9.3、§13（13.1—13.2）、§14（14.1）；UX/UI §7.23—7.24、§8.21—8.22、§10.15—10.16、§11.3；平台后端设计 §3/§7/§9.3/§12；平台前端架构 §4 | 严格匹配不跨版本猜测；路径有限规范化；上传/替换幂等与显式确认；Source Map 私有（客户端密钥禁读、默认仅项目管理员下载）；上传/替换入审计；项目删除一并清理；不修改 wire protocol；不产生第二套 Release 模型 | 无新增 required ADR（ADR-032 已 accepted 冻结对象存储方向；PRD §8 唯一确定 Release 必要字段，属 implementation-detail）；真实云对象凭证缺失 → `PRODUCTION_OBJECT_STORAGE_EVIDENCE_PENDING` 不阻塞业务关闭 |

## Global Constraints

- 不公开 Source Map：私有存储、不可猜测对象键、无永久 URL、客户端上报密钥禁读；原文件下载（短期签名 URL）不在本叶（对象存储供应商集成 deferred）。
- 不修改 wire protocol：事件正文不含 release（协议缺口），reparse 采用**显式 release 归因**（操作者对该发布声明重解析范围），绝不自动跨版本猜测；SDK 首现自动创建发布因协议缺口 deferred（v1 边界）。
- 严格匹配：`项目 + 发布版本 + 规范化构建路径` 完全一致才匹配；不尝试相邻版本、不做模糊文件名匹配（PRD §8.3.2/§8.3.11）。
- 路径规范化只允许：移除协议/域名、保留路径+文件名+哈希、不模糊匹配（PRD §8.3.3）。
- 上传/替换：同严格键同摘要 → 幂等返回已有；同键不同摘要 → `replace_conflict`，须显式确认替换、并发版本、审计；替换后自动创建有界重解析（PRD §8.3.7/§8.3.8）。
- 上传至少提交：项目、发布版本、构建文件路径、对应 map、可选构建标识（PRD §8.3.1）。
- 重解析状态：等待/处理中/已完成/处理失败；不建设独立任务中心；范围有界（每轮上限）。
- 权限（PRD §8.3.10 + §13.1）：项目管理员 + 获准开发成员上传（org manager / `project_admin` / `developer`）；默认仅项目管理员下载（下载 deferred）；上传/替换入审计；客户端密钥禁读。
- 错误经 RFC 9457 + 稳定错误码；不泄露对象键、完整摘要、堆栈、SQL 或账号存在性。
- 时间 UTC 存储；无真实云凭证 → 使用正式 storage 抽象 + disposable in-memory adapter，不访问生产 bucket；记录 `PRODUCTION_OBJECT_STORAGE_EVIDENCE_PENDING`。

## File Structure

**packages/platform-contract**
- `src/releases/releases.ts`（新增）— Release/Source Map 契约：5 个操作 Schema + 稳定枚举。
- `src/registry/operations.ts`（修改）— 注册 5 个稳定操作；从 `BLOCKED_OPERATIONS` 移除 `releasesListReleases`/`sourceMapsListFiles`。
- `src/index.ts`（修改）— `export * from './releases/releases.js';`

**packages/platform-releases（新私有 data 包，`aurora.layer: data`，dep `pg`）**
- `package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`、`migrations/1787000000000_releases-and-source-maps.ts`、`src/run-migrations.ts`、`src/errors.ts`、`src/repositories/transaction.ts`、`src/releases-repository.ts`、`src/source-map-repository.ts`、`src/source-map-object-storage.ts`、`src/build-path.ts`、`src/source-map-parser.ts`、`src/index.ts`

**packages/processing-store**
- `migrations/1722500000011_error-occurrence-symbolizations.ts`（新增）
- `src/symbolization-types.ts`、`src/symbolization-repository.ts`（新增）
- `src/index.ts`（修改）— 导出。

**apps/platform-worker**
- `src/source-maps/reparse-round.ts`（新增）— `runSourceMapReparseRound`。
- `src/worker.ts`、`src/config.ts`、`src/index.ts`、`src/start.ts`（修改）— 重解析轮询接线 + 对象存储 port 注入。

**apps/platform-api**
- `src/routes/source-maps.ts`（新增）— 5 个 handler。
- `src/route-deps.ts`、`src/app.ts`（修改）— `sourceMapObjectStorage` port 注入。
- `test/integration/source-maps-flow.test.ts`（新增）。

**docs**
- `docs/architecture/release-source-map-matching-and-reparse.md`（新增，approved+implemented 正式规格）。

---

## Task 1: Release / Source Map / storage contract（platform-contract + OpenAPI 再生）

**Files:**
- Create: `packages/platform-contract/src/releases/releases.ts`
- Modify: `packages/platform-contract/src/index.ts`、`src/registry/operations.ts`
- Test: `docs/api/platform-openapi-v1.yaml` 再生 + 漂移门禁

**Interfaces:**
- Consumes: `common/schema.ts`（`obj`/`str`/`num`/`optional`/`enum_`/`arr`）、`common/query.ts` `queryResponse`、`common/identifiers.ts`（`ProjectId`/`ReleaseId`/`SourceMapFileId`）、`common/time.ts` `utcTimestamp`、`common/section.ts` `sectionResult`。
- Produces: `OPERATION_ID_RELEASES_LIST`/`OPERATION_ID_SOURCE_MAPS_LIST`/`OPERATION_ID_SOURCE_MAPS_UPLOAD`/`OPERATION_ID_SOURCE_MAPS_REPLACE`/`OPERATION_ID_SOURCE_MAPS_REPARSE`；Schema `releasesListReleasesPathParams`/`releasesListReleasesResponse`/`sourceMapsListFilesPathParams`/`sourceMapsListFilesResponse`/`sourceMapsUploadPathParams`/`sourceMapsUploadBody`/`sourceMapsUploadResponse`/`sourceMapsReplacePathParams`/`sourceMapsReplaceBody`/`sourceMapsReplaceResponse`/`sourceMapsReparsePathParams`/`sourceMapsReparseBody`/`sourceMapsReparseResponse`；常量 `SOURCE_MAP_STATUS`（active/replaced）/`SOURCE_MAP_REPARSE_STATE`（queued/processing/completed/failed）/`RELEASE_SOURCE`（source_map_upload）。

**Operations（5 个稳定操作）：**

| operationId | method | path | page | 说明 |
|---|---|---|---|---|
| `releasesListReleases` | GET | `/api/platform/v1/organizations/:organizationId/projects/:projectId/releases` | `project.releases` | C8 发布列表 |
| `sourceMapsListFiles` | GET | `/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps` | `project.source-maps` | C9 文件列表 |
| `sourceMapsUpload` | POST | `/api/platform/v1/organizations/:organizationId/projects/:projectId/source-maps` | `project.source-maps` | 上传（幂等 upsert release + map + 自动重解析任务） |
| `sourceMapsReplace` | POST | `/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps/:sourceMapFileId/replace` | `project.source-maps` | 显式替换（versioned + 审计 + 自动重解析任务） |
| `sourceMapsReparse` | POST | `/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/reparse` | `project.source-maps` | 显式触发有界重解析 |

**Schema 要点：**
- `releasesListReleasesResponse = queryResponse(sectionResult(obj({ items: arr(releaseSummary, 0, 200) })))`；`releaseSummary = obj({ releaseId: ReleaseId, version: str(1, 256), source: enum_(['source_map_upload']), firstSeenAt: utcTimestamp, sourceMapFileCount: num(0) })`。
- `sourceMapsListFilesResponse = queryResponse(sectionResult(obj({ items: arr(sourceMapFileSummary, 0, 200) })))`；`sourceMapFileSummary = obj({ sourceMapFileId: SourceMapFileId, buildPath: str(1, 2048), digestPrefix: str(8, 16), status: enum_(['active','replaced']), reparse: obj({ state: enum_(['queued','processing','completed','failed']), processedCount: optional(num(0)), totalCount: optional(num(0)), updatedAt: optional(utcTimestamp) }), uploadedAt: utcTimestamp, replacedAt: optional(utcTimestamp), version: num(1) })`。
- `sourceMapsUploadBody = obj({ releaseVersion: str(1, 256), buildPath: str(1, 2048), content: str(1, 240000), digest: str(64, 64), buildId: optional(str(1, 128)), idempotencyKey: str(8, 128) })`。
- `sourceMapsUploadResponse = obj({ data: obj({ status: enum_(['uploaded','duplicate','replace_conflict']), releaseId: ReleaseId, sourceMapFileId: optional(SourceMapFileId), currentDigest: optional(str(64, 64)), version: optional(num(1)) }) })`。
- `sourceMapsReplaceBody = obj({ content: str(1, 240000), digest: str(64, 64), version: num(1), idempotencyKey: str(8, 128) })`；`sourceMapsReplaceResponse = obj({ data: obj({ status: enum_(['replaced']), sourceMapFileId: SourceMapFileId, version: num(1) }) })`。
- `sourceMapsReparseBody = obj({ idempotencyKey: str(8, 128) })`；`sourceMapsReparseResponse = obj({ data: obj({ status: enum_(['queued']), releaseId: ReleaseId, taskCount: num(1) }) })`。

- [ ] **Step 1** — 新建 `packages/platform-contract/src/releases/releases.ts`（上述 Schema + 常量）。
- [ ] **Step 2** — `registry/operations.ts` 注册 5 个稳定操作；从 `BLOCKED_OPERATIONS` 移除 `releasesListReleases`/`sourceMapsListFiles`。
- [ ] **Step 3** — `src/index.ts` 追加 `export * from './releases/releases.js';`。
- [ ] **Step 4** — `pnpm platform-contract:generate && pnpm platform-contract:drift`；更新 `test/registry/manifest.test.ts` 的稳定操作列表与 `project.releases`/`project.release-detail`/`project.source-maps` 覆盖为 `stable`。
- [ ] **Step 5** — `pnpm --filter @aurora/platform-contract test`（Expected: PASS）。

## Task 2: Source Map metadata + private storage（`@aurora/platform-releases`）

**Files:**（新建包全部文件 + 单元测试）
- `packages/platform-releases/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`
- `packages/platform-releases/migrations/1787000000000_releases-and-source-maps.ts`
- `packages/platform-releases/src/errors.ts`、`src/repositories/transaction.ts`、`src/run-migrations.ts`
- `packages/platform-releases/src/build-path.ts`
- `packages/platform-releases/src/source-map-object-storage.ts`
- `packages/platform-releases/src/source-map-parser.ts`
- `packages/platform-releases/src/releases-repository.ts`
- `packages/platform-releases/src/source-map-repository.ts`
- `packages/platform-releases/src/index.ts`
- `packages/platform-releases/test/build-path.test.ts`、`test/source-map-parser.test.ts`、`test/source-map-repository.unit.test.ts`

**Interfaces:**
- Consumes: `pg`。Produces（Task 3/4 复用）：
  - `normalizeBuildPath(path: string): string` — PRD §8.3.3 有限规范化。
  - `parseSourceMapV3(json: string): SourceMapV3 | { error: 'invalid_json' | 'unsupported_version' | 'missing_mappings' }`；`SourceMapV3 = { version: 3; sources: string[]; names: string[]; mappings: string }`。
  - `resolveSourcePosition(map: SourceMapV3, line: number, column: number): { source: string; line: number; column: number; name?: string } | null` — 1-indexed line，找 genCol ≤ column 的最后一个 segment。
  - `SourceMapObjectStoragePort = { putObject(input: { key: string; content: string }): Promise<void>; getObject(key: string): Promise<string | null>; deleteObject(key: string): Promise<void> }`；`InMemorySourceMapObjectStorage`（disposable，Map<string,string>）。
  - `upsertRelease(pool, { projectId, version })` → `{ status: 'inserted'|'existing', releaseId }`；`listReleases(pool, { projectId })` → ReleaseRow[]（含 sourceMapFileCount）。
  - `createSourceMapFile(pool, { projectId, releaseId, buildPath, objectKey, digest, buildId })` → `{ status: 'created'|'duplicate'|'replace_conflict', sourceMapFileId?, currentDigest?, version? }`；`replaceSourceMapFile(pool, { projectId, sourceMapFileId, objectKey, digest, version })` → `{ status: 'replaced'|'not_found'|'version_conflict', version }`；`listSourceMapFiles(pool, { projectId, releaseId })` → SourceMapFileRow[]；`getSourceMapFileById(pool, { projectId, sourceMapFileId })`。
  - `createReparseTask(pool, { projectId, releaseId, sourceMapFileId })` → `{ status: 'queued'|'already_pending' }`；`claimPendingReparseTasks(pool, { limit })` → TaskRow[]；`updateReparseTaskProgress`/`completeReparseTask`/`failReparseTask`。

**Migration（本任务冻结）：**
- `releases`：`id` bigserial PK、`project_id` uuid NOT NULL、`version` varchar(256) NOT NULL、`source` varchar(32) NOT NULL DEFAULT 'source_map_upload'、`created_at` timestamptz NOT NULL DEFAULT now()。唯一 `(project_id, version)`；`source` CHECK（source_map_upload）。索引 `(project_id, created_at DESC)`。
- `source_map_files`：`id` bigserial PK、`project_id` uuid NOT NULL、`release_id` bigint NOT NULL REFERENCES releases、`build_path` varchar(2048) NOT NULL、`object_key` varchar(512) NOT NULL、`digest` varchar(64) NOT NULL、`build_id` varchar(128)、`status` varchar(16) NOT NULL DEFAULT 'active'、`version` int NOT NULL DEFAULT 1、`created_at`、`updated_at`、`replaced_at` timestamptz。唯一 `(release_id, build_path)`（严格键）；`status` CHECK（active/replaced）；索引 `(project_id, release_id)`。
- `source_map_reparse_tasks`：`id` bigserial PK、`project_id` uuid NOT NULL、`release_id` bigint NOT NULL REFERENCES releases、`source_map_file_id` bigint NOT NULL REFERENCES source_map_files、`status` varchar(16) NOT NULL DEFAULT 'queued'、`target_count` int、`processed_count` int NOT NULL DEFAULT 0、`created_at`、`updated_at`、`completed_at` timestamptz。`status` CHECK（queued/processing/completed/failed）；部分唯一 `(release_id, source_map_file_id) WHERE status IN ('queued','processing')`。

**对象键规则**：不可猜测内部标识，不拼接原始上传路径（平台后端 §9.3）：`aurora-sourcemaps/{projectId}/{sourceMapFileId}.map`（sourceMapFileId 在 INSERT 后由 `source_map_files.id` 决定 → 先 INSERT 占位键、后更新键，或用 `gen_random_uuid()` 作为 key 前缀）。采用：`objectKey = aurora-sourcemaps/{projectId}/{uuid}.map`（uuid 由 `crypto.randomUUID()` 生成），INSERT 后无需回写。

- [ ] **Step 1** — 写失败单元测试：`build-path.test.ts`（协议/域名剥离、查询去除、保留哈希、不加模糊匹配）、`source-map-parser.test.ts`（最小 v3 map 的 VLQ 解码与 `resolveSourcePosition` 命中/越界/无效 JSON/版本≠3/缺 mappings）。
- [ ] **Step 2** — 实现 `build-path.ts`、`source-map-parser.ts`（含 VLQ 解码：`'A'..'Z','a'..'z','0'..'9','+','/'`，连续位在最高位，负号在最低位；`mappings` 按 `;` 分行、`,` 分 segment；字段相对增量，genCol 逐行从 0 累计）、`source-map-object-storage.ts`。
- [ ] **Step 3** — 实现 `errors.ts`/`transaction.ts`/Migration/`releases-repository.ts`/`source-map-repository.ts`（含摘要幂等与 replace_conflict、versioned replace、reparse task 生命周期）/`index.ts` 导出。
- [ ] **Step 4** — 跑测试：`pnpm --filter @aurora/platform-releases test`（Expected: PASS）；`pnpm --filter @aurora/platform-releases typecheck`。
- [ ] **Step 5** — `pnpm --filter @aurora/platform-releases build`（PASS）；Migration 的真实 PostgreSQL 验证由 Task 4 的 platform-worker 集成测试承载（`runAllMigrations` + `checkOrder:false` 已覆盖全部 data 包）。

## Task 3: matching / symbolication / reparse（processing-store 符号化 + worker 重解析）

**Files:**
- Create: `packages/processing-store/migrations/1722500000011_error-occurrence-symbolizations.ts`
- Create: `packages/processing-store/src/symbolization-types.ts`、`src/symbolization-repository.ts`
- Modify: `packages/processing-store/src/index.ts`
- Create: `apps/platform-worker/src/source-maps/reparse-round.ts`
- Modify: `apps/platform-worker/src/config.ts`、`src/worker.ts`、`src/index.ts`、`src/start.ts`

**Interfaces:**
- Consumes: Task 2 的 `parseSourceMapV3`/`resolveSourcePosition`/`normalizeBuildPath`/`SourceMapObjectStoragePort`/`claimPendingReparseTasks`/`getSourceMapFileById`/reparse task 更新；processing-store `error_event_occurrences`。
- Produces:
  - processing-store：`persistSymbolization(pool, { occurrenceId, projectId, releaseId, sourceMapFileId, originalPath, resolvedFile?, resolvedLine?, resolvedColumn?, functionName?, status })`（`(occurrence_id)` 唯一 upsert）；`queryReparseCandidates(pool, { projectId, limit })` → `{ id, normalizedBody }[]`（无符号化行的 occurrence）。
  - platform-worker：`runSourceMapReparseRound({ pool, objectStorage, maxOccurrences?, maxTasks? })` → `{ processedTasks, symbolizedOccurrences, failedTasks }`。

**Migration（processing-store）** `1722500000011_error-occurrence-symbolizations.ts`：
- `error_occurrence_symbolizations`：`id` bigserial PK、`occurrence_id` bigint NOT NULL UNIQUE REFERENCES error_event_occurrences、`project_id` uuid NOT NULL、`release_id` bigint NOT NULL（无跨包 FK）、`source_map_file_id` bigint NOT NULL、`original_path` varchar(2048) NOT NULL、`resolved_file` varchar(1024)、`resolved_line` int、`resolved_column` int、`function_name` varchar(256)、`status` varchar(16) NOT NULL CHECK（symbolized/not_found/parse_failed）、`created_at`、`updated_at`。索引 `(project_id, status)`。

**重解析编排（`runSourceMapReparseRound`，worker，有界）**：
1. `claimPendingReparseTasks({ limit: maxTasks })`；
2. 每任务：标记 `processing` → `getSourceMapFileById` + `objectStorage.getObject(objectKey)` → `parseSourceMapV3`；解析失败 → `failReparseTask`；
3. `queryReparseCandidates({ projectId, limit: maxOccurrences })`；对每个 occurrence：从 `normalizedBody.error.stack` 提取栈帧（`extractStackFrames`：按行解析 `at fn (file:line:col)` 与 `at file:line:col`），逐帧 `normalizeBuildPath` 与文件 `build_path` 严格匹配，命中 → `resolveSourcePosition(map, line, column)` → `persistSymbolization`（status symbolized；越界/无命中 → not_found）；`parse_failed` 仅在 map 解析失败时用于任务；
4. 更新 `processed_count`；完成后 `completeReparseTask`；单任务失败 → `failReparseTask`，不阻断其余任务。
- `extractStackFrames(stack)` 作为 processing-store 导出纯函数（`src/stack-frames.ts`，含正则 `/\bat\s+(?:([^ (]+)\s+\()?([^ (]+):(\d+):(\d+)\)?\s*$/` 与 `/\bat\s+([^ (]+):(\d+):(\d+)\s*$/`），单元测试。

**Worker 接线：** `BuildPlatformWorkerInput` 增可选 `sourceMaps?: { objectStorage: SourceMapObjectStoragePort; maxOccurrences: number; maxTasks: number }`；`pollOnce` 调用 `runSourceMapReparseRound`；config 增 `SOURCE_MAPS_REPARSE_ENABLED`（默认 true）、`SOURCE_MAPS_REPARSE_MAX_OCCURRENCES`（默认 500）、`SOURCE_MAPS_REPARSE_MAX_TASKS`（默认 10）；`start.ts`/`index.ts` composition 注入 `InMemorySourceMapObjectStorage`。

- [ ] **Step 1** — 写失败单测 `packages/processing-store/test/stack-frames.test.ts`（三类帧格式解析 + 无匹配）。
- [ ] **Step 2** — 实现 Migration + `symbolization-types.ts`/`symbolization-repository.ts`/`stack-frames.ts` + 导出；`pnpm --filter @aurora/processing-store typecheck` + 单测。
- [ ] **Step 3** — 实现 `apps/platform-worker/src/source-maps/reparse-round.ts` + worker/config/index/start 接线。
- [ ] **Step 4** — `pnpm --filter @aurora/platform-worker typecheck`。

## Task 4: API/Command/Query integration + focused verification

**Files:**
- Create: `apps/platform-api/src/routes/source-maps.ts`
- Modify: `apps/platform-api/src/route-deps.ts`、`src/app.ts`
- Create: `apps/platform-api/test/integration/source-maps-flow.test.ts`
- Create: `docs/architecture/release-source-map-matching-and-reparse.md`

**Interfaces:**
- Consumes: Task 1 契约 Schema/操作 ID；Task 2/3 包导出；`SourceMapObjectStoragePort`。
- Produces: 5 handler；route-deps `sourceMapObjectStorage`。

**Handler 要点（`routes/source-maps.ts`）：**
- 复用 `authorizeAlertView` 同构的 `authorizeSourceMapView`（session + org + project view）；上传/替换/重解析直接复用 DAT-14 既有 `requireProjectHandleAccess` + `requireProjectHandleAccessOnTransaction`（org manager / `project_admin` / `developer`，PRD §8.3.10 上传权限）。
- `releasesListReleases`/`sourceMapsListFiles`：读取，诚实 `empty`/`available`。
- `sourceMapsUpload`：body（releaseVersion/buildPath/content/digest/buildId/idempotencyKey）→ 事务内 `upsertRelease`（按版本）→ 计算 objectKey（`aurora-sourcemaps/{projectId}/{uuid}.map`）→ `objectStorage.putObject` → `createSourceMapFile`（摘要幂等/替换冲突）→ 成功则 `createReparseTask` → 审计（action `source_map.uploaded`）→ 响应。冲突（`replace_conflict`）返回 `currentDigest`/`version`，不覆盖、不建任务。
- `sourceMapsReplace`：`version` 并发 → `objectStorage.putObject`（新 key）→ `replaceSourceMapFile`（旧对象由 `deleteObject` 清理）→ `createReparseTask` → 审计（action `source_map.replaced`）。
- `sourceMapsReparse`：校验 release 存在 → `createReparseTask`（对每个 active map 文件）。
- 错误映射：`PlatformReleasesError`/`ProcessingStoreError`→400/503（复用 `sendMappedError`，需在 `service-error.ts` 注册 `PlatformReleasesError`）。

**route-deps 注入：** `PlatformApiRouteDependencies` 增 `readonly sourceMapObjectStorage: SourceMapObjectStoragePort`；`buildPlatformApi` input 同名；`app.ts` 的 `routeContext` 透传；测试 `buildApp` 注入 `InMemorySourceMapObjectStorage`。

**正式规格** `docs/architecture/release-source-map-matching-and-reparse.md`：approved+implemented；记录 v1 边界（SDK 事件无 release → 显式归因重解析、256KB 上传上限（平台-api bodyLimit）、下载/签名 URL deferred、真实云对象凭证 `PRODUCTION_OBJECT_STORAGE_EVIDENCE_PENDING`、不修改 fingerprint/wire protocol）。

**验证（测试预算 §14）：**
- [ ] **Step 1** — A（unit）：`pnpm --filter @aurora/platform-releases test`（path 规范化 + 解析器/符号化 + 无效/缺失 map）。
- [ ] **Step 2** — B（唯一 integration）：`pnpm --filter @aurora/platform-worker test:integration -- source-maps-reparse`（真实 PG：API/仓库创建 release + 上传 map（共享 in-memory adapter）→ list → `runSourceMapReparseRound` → `queryReparseCandidates` 中 occurrence 的符号化位置断言）。
- [ ] **Step 3** — C：`pnpm --filter @aurora/platform-releases typecheck && pnpm --filter @aurora/processing-store typecheck && pnpm --filter @aurora/platform-contract typecheck && pnpm --filter @aurora/platform-api typecheck && pnpm --filter @aurora/platform-worker typecheck`。
- [ ] **Step 4** — D：`pnpm platform-contract:generate && pnpm platform-contract:drift`（契约已变）。
- [ ] **Step 5** — E：`git diff --check`。
- [ ] **Step 6** — Commit `feat(source-maps): DAT-18 release/source-map matching, symbolication and reparse`。

## 明确的 deferred / out-of-scope

- 真实 S3/MinIO 对象存储接线（ADR-032 YAGNI + 无凭证 → `PRODUCTION_OBJECT_STORAGE_EVIDENCE_PENDING`）；原文件下载/短期签名 URL。
- SDK 事件上报 release / 事件侧 release 自动归因（wire protocol 不变；reparse 显式归因）。
- 部署记录与"成功部署参与再次出现判断"（C4/G03 依赖，PRD §8.2；本叶只建立 Release 与 Source Map）。
- 跨版本尝试、模糊文件名匹配、代码仓库扫描、完整文件版本历史、独立任务中心、网页规则编辑（PRD §8.3.11）。
- Console 页面（G12 C8/C9）、完整下载权限矩阵。
- 修改 Error fingerprint 语义、Source Map 源码内容预览。
