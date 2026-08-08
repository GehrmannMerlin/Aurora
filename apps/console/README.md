# apps/console (`@aurora/console`)

Aurora 管理平台前端 Vue 3 SPA 壳层（PLT-02），私有包。所在工作区层为 `console`，仅允许依赖 `contract` 与 `tooling` 层（不得依赖 `data`/`service` 内部包）。命令：`build`（先构建 `@aurora/platform-contract` 再 `vite build`）、`build:test`（`vite build --mode test` 输出 `dist-test`）、`typecheck`（`vue-tsc --noEmit`）、`test` / `test:coverage`（vitest + jsdom）、`test:package`（构建产物结构门禁）、`test:browser`（Playwright 真实浏览器可达性）。`--mode test` 构建启用 MSW（仅前端测试；生产构建不包含 MSW 与 `contract-testkit`）。

## Task 1 compat 修正（2026-08-08 安装/验证时记录）

- `vitest.config.ts` 增加 `plugins: [vue()]`：Vitest 优先使用 `vitest.config.ts`，不会继承 `vite.config.ts` 的插件，缺少 Vue 插件时 `.vue` SFC 无法解析。
- `vitest.config.ts` coverage 增加 `exclude: ['src/main.ts']`：Vitest 4 默认 `coverage.all=true`，未单测的应用入口 `src/main.ts` 会把行/语句覆盖率拉到 0% 导致阈值失败；与 `packages/platform-contract`/`event-schema` 排除入口 `index.ts` 的仓库先例一致。
- `apps/console/tsconfig.json` 增加 `skipLibCheck: true`：`@testing-library/vue@8.1.0` 发布类型里 `import { RemoveIndexSignature } from 'type-fest'` 为幽灵依赖，当前 type-fest 4.x/5.x 均已移除该导出；仓库 tsconfig 默认 `skipLibCheck:false` 会把它当错误。`skipLibCheck` 是 Vue 生态（create-vue）默认，仅对本应用生效，不削弱 SDK/后端类型检查。
- 根 `pnpm-workspace.yaml` `allowBuilds` 增加 `msw: true`：msw 2.15.0 带无害 postinstall（仅当包声明 `msw.workerDirectory` 时复制 worker 脚本），仓库 `strictDepBuilds:true` 需显式允许。
- 根 `eslint` 保持 `10.8.0`（计划拟升级 `10.8.1`，但该版本发布于 `minimumReleaseAge` 24 小时门槛内被仓库供应链策略拦截；`10.8.0` 为已成熟原 pin，不改动）。
- `src/vite-env.d.ts` 增加 `declare module '*.vue'`（`DefineComponent` 类型 shim）：eslint 的类型化规则（`no-unsafe-argument`）需要 `.vue` 导入有类型，而 vite/vue 均不内置 `*.vue` 声明；`vue-tsc` 原生理解 SFC 不受影响。
