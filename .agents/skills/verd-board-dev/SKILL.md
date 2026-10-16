---
name: verd-board-dev
description: VerdBoard 本仓开发口径：包落点、workspace 依赖、命令与发布、文档策略、画布/Mind 改码入口。改本仓代码、加包、改画布或文档时使用。行业通识不在此重复。
---

# VerdBoard 开发规范

只写本仓库要统一的结论。技术栈版本、命令细节以 `doc/` 为准，不要猜。

## 先读文档

- 架构 / 版本：`doc/architecture/ARCHITECTURE.md`
- 命令、提交、测试、发布：`doc/development/README.md`
- 文档怎么改：`doc/DOCUMENTATION_GUIDE.md`
- 画布 / Mind / 元素改哪份代码：`doc/guides/配置与源码索引.md`
- 包索引：`doc/packages/README.md`

## 包落点

- 产品 UI：`packages/product/ui`（`@sue/verd-board-ui`）
- 应用壳：`packages/product/app`（`@sue/verd-board-app`）
- 引擎：`packages/engine`（`@sue/board-common`、`core`、`layouts`、`draw`、`mind`、`text`、`workflow`、`architecture`）
- React 适配：`packages/react/board`、`text`、`mind`、`workflow`、`architecture`
- 领域画布有两条入口：标准文档 `*DocumentCanvas`（`value/onChange`，调用方持有 VerdBoard 文档）和第三方投影 `*Canvas`（adapter/accessors + `onIntent`）。Markdown/Mermaid 只在转换器边界导入导出。
- 转换器：`packages/converters`
- 内部依赖：`workspace:*`

## 本仓约定

- TypeScript 严格模式；目录 kebab-case，组件 PascalCase
- Conventional Commits；分支 `main` / `develop` / `feature/*` / `hotfix/*`
- 单测 Vitest（`pnpm test`）；E2E 在 `tests/web-e2e` 用 Playwright
- `pnpm start` = 桌面端；Web：`turbo run dev --filter=web`
- 发布：`pnpm release` 再 `pnpm pub`（Changesets）
- 根 README 与 `doc/README.md` / `doc/README_en.md` 双语同步；**不要**再建按月的 `doc/change-log/`

## 画布与属性

- 没有独立 json/yaml 配置；模型在 TypeScript 接口与常量里
- 改元素属性走 `@sue/board-core` 的 `Transforms.setNode`
- 右侧「画布」面板写入 `board.theme`（背景、网格），经 `BoardTransforms.updateCanvasSettings`
- Web/Desktop 持久化走 `@sue/verd-board-app` 的 `BoardStorageAdapter`

细节见 `doc/guides/配置与源码索引.md`。
