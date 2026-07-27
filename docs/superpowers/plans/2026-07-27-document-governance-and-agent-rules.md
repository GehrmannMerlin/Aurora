# Aurora 文档治理与 Agent 规则实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 保留并长期维护六份原始规范文档，统一 Aurora 产品名称，建立追加式规则体系、AURORA_RULES.md、AGENTS.md 和六份待评审 ADR，并将结果安全发布到空的 GitHub 仓库 GehrmannMerlin/Aurora。

**Architecture:** 六份根目录规范继续作为产品、架构、代码、测试、文档和 ADR 领域的权威来源；AURORA_RULES.md 提供自包含的项目上下文和规则总入口；AGENTS.md 把关键流程转化为项目级强制约束。重大架构选择以 proposed ADR 补充评审材料，不取代架构规范。

**Tech Stack:** Markdown、PowerShell、Git、GitHub CLI。

## Global Constraints

- 六份原始规范文件不得删除、移动、重命名或复制成替代版本。
- 产品正文名称统一为 Aurora；PRD 历史文件名中的 Auroa 保留并解释兼容原因。
- 本次只允许非语义校正和用户明确批准的规则追加。
- 后续规则变化只能追加，历史原则不得删除、覆盖或静默改写。
- 六份初始 ADR 的决策状态必须为 proposed，实施状态必须为 not-started。
- 不实施业务代码，不选择尚未批准的框架、数据库、队列或部署平台。
- GitHub 远端当前没有引用；禁止 force push，禁止覆盖远端历史。

---

### Task 1: 建立可追溯的 Git 基线

**Files:**
- Track: 六份根目录规范文档
- Track: docs/superpowers/specs/2026-07-27-document-governance-and-agent-workflow-design.md
- Track: docs/superpowers/plans/2026-07-27-document-governance-and-agent-rules.md

**Interfaces:**
- Consumes: 当前文件系统中的六份原始规范和已批准设计规格。
- Produces: 保存原始内容的 Git 初始提交、main 分支和 GitHub 远端配置。

- [ ] **Step 1: 重新确认远端为空且认证有效**

```powershell
git ls-remote https://github.com/GehrmannMerlin/Aurora.git
gh auth status
```

Expected: git ls-remote 无引用输出且退出码为 0；GitHub CLI 显示账号 GehrmannMerlin 已登录。

- [ ] **Step 2: 初始化仓库和远端**

```powershell
git init -b main
git remote add origin https://github.com/GehrmannMerlin/Aurora.git
git remote -v
```

Expected: 当前目录成为 main 分支仓库，origin 的 fetch/push 地址均指向目标仓库。

- [ ] **Step 3: 提交整理前的权威基线**

```powershell
git add -- 'Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md' 'Aurora 架构规范.md' 'Aurora 代码规范.md' 'Aurora 测试规范.md' 'Aurora 文档规范.md' 'Aurora ADR 规范.md' docs/superpowers
git diff --cached --name-status
git commit -m "chore: establish Aurora documentation baseline"
```

Expected: 初始提交包含六份原始规范、设计规格和实施计划，后续校正均可通过 Git 历史追溯。

---

### Task 2: 校正并建立 PRD 的追加式基线

**Files:**
- Modify: Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md

**Interfaces:**
- Consumes: 已批准产品名、现有 PRD 业务规则和异步架构原则。
- Produces: 正文产品名为 Aurora、状态一致、编号正确、异步语义明确且可追加维护的 PRD。

- [ ] **Step 1:** 添加稳定元数据和历史文件名说明。状态设为 approved；动态复查信息以后使用追加记录。
- [ ] **Step 2:** 将正文产品名称 Auroa 改为 Aurora，但不改文件名；统一建议稿、定稿和冻结状态表述。
- [ ] **Step 3:** 将第二组 5.1.4—5.1.11 顺延为 5.1.9—5.1.16，将 9.4 下的 9.3.1—9.3.6 改为 9.4.1—9.4.6，将第二个一级章节 24 改为 25。
- [ ] **Step 4:** 将 7.1 拆成同步接入与异步处理阶段，明确上报成功只代表进入可靠缓冲；接入成功仍等待测试问题异步生成。
- [ ] **Step 5:** 添加到 AURORA_RULES、五份工程规范的相对链接，在末尾追加 RULE-BASELINE-20260727。
- [ ] **Step 6:** 验证名称、编号、异步语义和基线。

```powershell
$p='Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md'
Select-String -LiteralPath $p -Pattern 'Auroa' -Encoding UTF8
Select-String -LiteralPath $p -Pattern '^(# 24\.|# 25\.|### 5\.1\.|### 9\.4\.)' -Encoding UTF8
Select-String -LiteralPath $p -Pattern '可靠缓冲|异步处理|RULE-BASELINE-20260727' -Encoding UTF8
```

Expected: Auroa 只出现在历史文件名说明；编号无已知重复；异步语义和维护基线存在。

---

### Task 3: 校正五份工程规范并建立追加式维护

**Files:**
- Modify: Aurora 架构规范.md
- Modify: Aurora 代码规范.md
- Modify: Aurora 测试规范.md
- Modify: Aurora 文档规范.md
- Modify: Aurora ADR 规范.md

**Interfaces:**
- Consumes: 六份规范保护原则、追加式维护协议和当前批准状态。
- Produces: 具有稳定元数据、相对链接、维护基线且 Markdown 可正确解析的五份工程规范。

- [ ] **Step 1:** 添加稳定元数据和可点击关联文档。
- [ ] **Step 2:** 修复文档规范 5.6 示例、5.7—5.10 标题缩进和两个不完整代码围栏。
- [ ] **Step 3:** 在文档规范末尾追加已批准规则，明确六份规范固定路径、禁止替代副本、后续规则只追加、复查记录追加保存及非语义校正边界。
- [ ] **Step 4:** 在五份工程规范末尾分别追加 RULE-BASELINE-20260727；架构规范关联六份 proposed ADR，ADR 规范重申 proposed 不约束实现。
- [ ] **Step 5:** 验证结构。

```powershell
$files='Aurora 架构规范.md','Aurora 代码规范.md','Aurora 测试规范.md','Aurora 文档规范.md','Aurora ADR 规范.md'
foreach($f in $files){$c=Get-Content -LiteralPath $f -Encoding UTF8; "$f|baseline=$([bool]($c -match 'RULE-BASELINE-20260727'))|fences=$(@($c|Where-Object{$_ -match '^\s*'+[char]96+[char]96+[char]96}).Count)"}
Select-String -LiteralPath 'Aurora 文档规范.md' -Pattern '^## 5\.(7|8|9|10)' -Encoding UTF8
```

Expected: 五份文件均有基线，围栏数量为偶数，5.7—5.10 均为正式标题。

---

### Task 4: 创建自包含的 AURORA_RULES.md

**Files:**
- Create: AURORA_RULES.md

**Interfaces:**
- Consumes: 六份长期规范和已批准设计规格。
- Produces: 单独阅读即可恢复开发上下文的最高级规则入口。

- [ ] **Step 1:** 写入正式产品名、当前项目阶段、核心链路、第一版范围和非目标。
- [ ] **Step 2:** 写入五大系统、SDK 分层、事件异步处理、协议来源、问题聚合、Source Map、权限、隐私、采样、额度和保留摘要。
- [ ] **Step 3:** 写入 Agent 从恢复上下文、范围判断、ADR 判断、设计、测试、实现、验证、文档同步到交付的完整流程及停止条件。
- [ ] **Step 4:** 写入六份规范、设计规格、实施计划和六份 proposed ADR 的当前索引。
- [ ] **Step 5:** 写入历史保护、规则状态、追加模板、冲突处理和初始基线，明确不取代六份规范。
- [ ] **Step 6:** 验证单文件覆盖。

```powershell
$p='AURORA_RULES.md'
$terms='产品定位','当前项目阶段','五大系统','SDK 分层','异步处理','TypeScript','测试','ADR','Agent 开发流程','当前必读文档','追加式维护'
foreach($t in $terms){"$t=$([bool](Select-String -LiteralPath $p -SimpleMatch $t -Quiet -Encoding UTF8))"}
```

Expected: 每个主题均输出 True。

---

### Task 5: 创建项目级 AGENTS.md

**Files:**
- Create: AGENTS.md

**Interfaces:**
- Consumes: AURORA_RULES.md 和六份长期规范。
- Produces: 对整个仓库及所有子目录生效的 Agent 强制执行规则。

- [ ] **Step 1:** 规定新对话先读 AURORA_RULES.md，首次修改前完整阅读六份规范，并读取任务相关的 accepted ADR、README、API 和协议文档。
- [ ] **Step 2:** 规定范围判断、ADR 门禁、测试优先、边界保持、实现、验证、文档影响和交付流程。
- [ ] **Step 3:** 禁止扩大第一版范围、未批准实施重大决策、破坏 SDK 宿主、绕过 Schema/隐私/事件管道、反向依赖、跳过验证以及删除或覆盖历史规则。
- [ ] **Step 4:** 规定冲突时停止受影响实现并报告；完成声明必须附带新鲜验证证据；规则变化必须追加到领域规范。
- [ ] **Step 5:** 验证关键约束。

```powershell
$p='AGENTS.md'
$terms='AURORA_RULES.md','完整阅读','六份','proposed','accepted','不得实施','运行时校验','宿主页面','回归测试','验证','只能追加'
foreach($t in $terms){"$t=$([bool](Select-String -LiteralPath $p -SimpleMatch $t -Quiet -Encoding UTF8))"}
```

Expected: 每项约束均输出 True。

---

### Task 6: 创建六份待评审 ADR

**Files:**
- Create: docs/adr/README.md
- Create: docs/adr/ADR-001-use-monorepo.md
- Create: docs/adr/ADR-002-five-system-boundaries.md
- Create: docs/adr/ADR-003-sdk-plugin-architecture.md
- Create: docs/adr/ADR-004-asynchronous-event-processing.md
- Create: docs/adr/ADR-005-event-schema-source-of-truth.md
- Create: docs/adr/ADR-006-one-way-dependencies.md

**Interfaces:**
- Consumes: 架构规范 ARCH-001—ARCH-006 初始决策。
- Produces: 可独立评审、但尚未批准实施的重大决策提案。

- [ ] **Step 1:** 创建 ADR 索引，列出编号、标题、决策状态、实施状态和关联规则。
- [ ] **Step 2:** ADR-001 比较统一 Monorepo 与多仓库；ADR-002 比较五大系统边界与按应用或部署单元划分。
- [ ] **Step 3:** ADR-003 比较 SDK 分层插件架构与单体 SDK；ADR-004 比较同步复杂处理与可靠接收后异步处理。
- [ ] **Step 4:** ADR-005 比较公共 Schema 单一来源与多端独立定义；ADR-006 比较自动约束的单向依赖与仅靠评审约束。
- [ ] **Step 5:** 每份 ADR 完整记录背景、驱动因素、候选方案、影响、实施约束、迁移、回滚、验证和重新评估条件。
- [ ] **Step 6:** 验证状态和模板。

```powershell
$files=Get-ChildItem -LiteralPath 'docs/adr' -File -Filter 'ADR-*.md'
"ADR_COUNT=$($files.Count)"
foreach($f in $files){$c=Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8; "$($f.Name)|proposed=$($c -match '状态：proposed')|not-started=$($c -match '实施状态：not-started')|candidates=$($c -match '## 候选方案')|rollback=$($c -match '## 回滚方案')|verify=$($c -match '## 验证方式')"}
```

Expected: ADR_COUNT=6，每份 ADR 的五项检查全部为 True。

---

### Task 7: 执行完整文档验证

**Files:**
- Verify: 根目录和 docs 下全部 Markdown。

**Interfaces:**
- Consumes: 全部修改和新增文档。
- Produces: 文件保护、链接、围栏、名称、状态和规则覆盖的验证证据。

- [ ] **Step 1:** 验证六份原文件仍在固定路径。
- [ ] **Step 2:** 检查全部 Markdown 的围栏数量为偶数；解析相对链接并确认目标存在。
- [ ] **Step 3:** 检查 Auroa 只存在于历史文件名说明、关联路径和设计历史；检查六份维护基线及六份 ADR 状态。
- [ ] **Step 4:** 检查 Git 差异。

```powershell
git status --short
git diff --check
git diff --stat
git diff
```

Expected: 没有空白错误、删除或重命名；差异只包含批准的校正、规则追加和新文档。

---

### Task 8: 提交并发布到 GitHub

**Files:**
- Commit: 全部批准的 Markdown 变更。

**Interfaces:**
- Consumes: Task 7 的完整通过结果。
- Produces: 本地正式提交和 GitHub main 分支。

- [ ] **Step 1:** 创建文档治理提交。

```powershell
git add --all
git diff --cached --check
git diff --cached --name-status
git commit -m "docs: establish Aurora agent development governance"
```

Expected: 提交包含 AURORA_RULES.md、AGENTS.md、六份 proposed ADR 和六份规范的原位校正，不存在删除或重命名。

- [ ] **Step 2:** 推送前重新确认远端没有意外变化。

```powershell
git fetch origin --prune
git ls-remote --heads origin
```

Expected: 远端仍无分支。若远端出现提交，停止并整合历史，禁止强推。

- [ ] **Step 3:** 推送并验证。

```powershell
git push -u origin main
gh repo view GehrmannMerlin/Aurora --json nameWithOwner,defaultBranchRef,url
git status --short
git log --oneline --decorate -2
```

Expected: GitHub 默认分支为 main，本地工作区干净，最近两次提交分别为原始基线和文档治理提交。
