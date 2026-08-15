---
title: Aurora GitHub 主分支与项目主页更新设计
status: approved
owner: documentation/release
last-reviewed: 2026-08-15
applies-to: Aurora GitHub main 分支、根 README、版本增量记录与 GitHub About 元数据
related:
  - ../../../README.md
  - ../../../CHANGELOG.md
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../operations/preview-continuous-delivery.md
  - ../../releases/release-migration-and-rollback.md
supersedes: none
review-cycle: repository-homepage-or-release-change
---

# Aurora GitHub 主分支与项目主页更新设计

## 1. 目标

把当前服务器 `47.238.145.24` 上 `https://aurora.ah.cn/` 所运行源码对应的开发分支收口到 GitHub `main`，同时把根 `README.md` 从内部实施台账改为面向用户和贡献者的项目主页。

结果必须满足：

- GitHub `main` 包含线上运行代码及该分支后续仅文档收口提交；
- README 首屏能快速解释 Aurora 的价值、能力和使用入口；
- 内部门禁、逐项实施状态和长篇包清单不再占据项目主页；
- 后续功能增量和 Bug 修复通过稳定结构持续更新，无需重写整篇 README；
- GitHub About 描述、网站和 Topics 与 README 定位一致；
- 更新使用普通 fast-forward，不强推、不改写历史。

## 2. 已确认基线

### 2.1 线上来源

服务器 `current` 在核对时指向：

```text
/opt/aurora-preview/releases/20260815-132409
```

线上以下关键文件的 SHA-256 与本地 `codex/email-verification-aliyun-implementation` 工作树一致：

- `apps/console/src/main.ts`；
- `apps/platform-api/src/start.ts`；
- `deploy/preview/compose.yaml`；
- `README.md`。

该 release 的创建时间紧随 `d6700af`（`fix(deploy): restore onboarding and resend quota state`）。当前分支头 `0d13778` 只在其后增加实施收口文档，不改变线上运行代码，因此 GitHub 收口以该分支当前头及本设计后续提交为来源。

### 2.2 Git 历史关系

核对时远端 `main` 为 `76b55ea`，并且它是 `codex/email-verification-aliyun-implementation` 的祖先。因此目标更新是 fast-forward：

```text
origin/main (旧)
  └─ 已实现的新分支提交
      └─ README / CHANGELOG / 设计与实施记录
          └─ origin/main (新)
```

不使用 `--force` 或 `--force-with-lease`。旧 `main` 提交继续保留在新历史中，可直接追溯和回退，不额外创建备份分支。

## 3. README 信息架构

README 采用“中文主文 + 英文一句话定位”，参考成熟开源项目常见的产品型结构，但只描述 Aurora 已真实存在的能力。

顺序固定为：

1. **Hero**：项目名、英文 tagline、中文一句话定位、在线体验与文档入口；
2. **为什么使用 Aurora**：用简短段落解释从浏览器事实到可行动证据的价值；
3. **核心能力**：错误追踪、请求监控、Web 性能、Issue/Source Map/告警、组织与项目管理；
4. **快速开始**：提供仓库当前可验证的源码安装与本地命令，不提供尚未真实发布的 npm 安装命令；
5. **工作原理**：使用一张小型 Mermaid 流程图表达 SDK → ingestion API → Worker/存储 → platform API → Console；
6. **最近更新**：最多三至五条用户可感知变化，并链接 `CHANGELOG.md`；
7. **隐私与部署**：说明默认敏感数据边界和 provider-neutral 单主机自托管定位；
8. **项目文档**：链接 SDK、API、架构、部署、ADR 和贡献者入口；
9. **开发命令**：仅保留最常用命令和 `pnpm check` 汇总入口，不在主页逐项解释质量门禁。

README 不包含：

- ADR 逐项状态表；
- “completed/remaining” 叶子计数；
- 内部 Agent 恢复流程；
- 全量真实包枚举；
- 大段未实现能力清单；
- 质量门禁的逐项实现历史；
- 未发布 npm 包的安装承诺；
- 不存在的 License、Release 或社区渠道。

## 4. 版本与 Bug 更新模型

新增根 `CHANGELOG.md`，作为用户可感知变化的单一滚动入口。结构为：

```markdown
# Changelog

## [Unreleased]

### Added

### Changed

### Fixed

### Security
```

规则：

- 开发中的新能力写入 `Added`；
- 行为调整写入 `Changed`；
- Bug 修复写入 `Fixed`；
- 安全修复写入 `Security`，但不得披露利用细节或秘密；
- 正式创建版本标签时，把本期条目移动到 `## [x.y.z] - YYYY-MM-DD`；
- 当前尚无可验证正式版本标签，因此本次不虚构 `v1.0.0`；
- README 的“最近更新”只保留摘要，完整条目始终链接 CHANGELOG。

## 5. GitHub About 元数据

GitHub 仓库 About 更新为：

- **Description**：`面向前端应用的开源可观测平台：错误、请求与性能监控，配套 TypeScript SDK 与自托管控制台。`
- **Website**：`https://aurora.ah.cn/`
- **Topics**：`observability`、`monitoring`、`error-tracking`、`performance-monitoring`、`typescript`、`javascript`、`vue`、`react`、`self-hosted`、`web-vitals`。

元数据通过已认证的 GitHub CLI 或 GitHub API 更新。若当前凭据无管理权限，代码与 README 推送不回滚；必须准确报告元数据这一单独阻塞，不把未更新描述为成功。

## 6. 更新流程

1. 在 `codex/email-verification-aliyun-implementation` 工作树修改 README 并新增 CHANGELOG；
2. 检查 Markdown 格式、内部链接、无虚构能力、无敏感信息；
3. 运行 `pnpm format:check` 和与仓库风险相称的完整 `pnpm check`；
4. 获取最新 `origin/main`，再次证明其仍是目标提交祖先；
5. 将目标提交普通推送到 `origin/main`；
6. 更新 GitHub About 元数据；
7. 监控 main CI 与自动部署到终态；
8. 核验远端 `main` SHA、GitHub README/About、服务器 `current`、公网 HTTPS 页面和关键健康响应。

## 7. 失败与并发处理

- 本地工作树出现与本任务无关的新增修改时停止，不覆盖、不清理；
- `origin/main` 在执行期间出现非祖先提交时停止，不做强推；
- 本地质量门禁失败时修复本任务引入的问题；既有失败必须保留完整证据并区分来源；
- GitHub CI 失败时不宣称完成，定位并处理本次变更造成的失败；
- 自动部署失败时保留服务器上一成功 release，不执行破坏性数据库回滚；
- 不修改服务器秘密、数据库内容或无关 Lumina 服务；
- 不用页面可访问替代 SHA、CI 和部署证据。

## 8. 验收标准

- `origin/main` 与本次最终目标提交一致；
- 更新是 fast-forward，旧 `main` 可从提交历史直接访问；
- README 首屏不再展示内部实施台账或门禁；
- README 所有能力、命令和链接均与仓库真实状态一致；
- `CHANGELOG.md` 存在并可直接承载 Added/Changed/Fixed/Security；
- GitHub About 的描述、网站和 Topics 已更新，或被准确记录为权限阻塞；
- main CI 达到成功终态；
- 自动部署达到成功终态，服务器 `current` 对应新 main release；
- `https://aurora.ah.cn/` HTTPS 可访问，关键 API 健康语义不回退；
- 最终 `git status` 无本任务未提交修改，无秘密或无关文件进入提交。
