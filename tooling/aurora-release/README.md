# @aurora/aurora-release

Aurora OPS-05 部署流水线工具链（private `tooling` 层包）。

不可变制品身份、前向兼容 Migration、部署/回滚计划编排——**纯函数 + dry-run CLI，不执行任何 AWS 调用、不创建真实资源**。真实 provisioning（`cdk deploy`、ECS update、ECR push）需要 AWS 凭据与用户提供域名，当前状态记录为 **`PROVISIONING_EVIDENCE_PENDING`**。

## 模块

| 文件                | 职责                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/manifest.ts`   | `ReleaseManifest`（提交 SHA + 各服务镜像 digest / SPA 内容哈希）、`buildReleaseManifest`、`assertImmutableArtifact`                  |
| `src/migrations.ts` | Migration 集发现（按版本前缀排序）、前向兼容校验（禁止破坏性 up / 乱序 / 重复）、前向迁移命令渲染（`node-pg-migrate up`，无 `down`） |
| `src/deploy.ts`     | `planDeployment`（migrate → API → Worker → SPA 入口切换，跳过未变化 digest）、`assertSafeDeployment`                                 |
| `src/rollback.ts`   | `planRollback`（按服务回滚到上一 digest、SPA 入口回退、Worker drain 语义）、`assertNoDestructiveMigrationRollback`                   |
| `src/entry.ts`      | CLI：`plan` / `validate-migrations` / `plan-rollback`，默认 `--dry-run`                                                              |

## 使用（dry-run）

```bash
pnpm --filter @aurora/aurora-release build
node tooling/aurora-release/dist/entry.js plan \
  --manifest <release-manifest.json> \
  --previous <previous-manifest.json> \
  --targets services=ingestion-api,ingestion-worker,spa,migrate
```

输出部署/回滚计划文本，退出码 0=通过、1=校验失败。全部操作只打印计划，不连接 AWS。

## 权威依据

- [deployment](../docs/architecture/deployment.md) §5—6
- [release-migration-and-rollback](../docs/releases/release-migration-and-rollback.md) §1—4、§6
- [测试/部署/发布设计](../docs/superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) §5、§7、§10、§14
- [OPS-05 正式规格](../docs/architecture/immutable-artifact-deployment-pipeline.md)
