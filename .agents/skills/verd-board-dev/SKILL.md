---
name: verd-board-dev
description: VerdBoard 本仓开发口径：包落点、workspace 依赖、命令与发布、原生文档策略、画布/Mind 改码入口。改本仓代码、加包、改画布或文档时使用。行业通识不在此重复。
---

# VerdBoard 开发规范

只写本仓库要统一的结论。项目知识正文位于根 workspace/文档/，画布位于同一 workspace；版本以 package.json、pnpm-workspace.yaml overrides 和 pnpm-lock.yaml 为准。

## 先读原生文档

- 总入口：`workspace/文档/文档导航.verd-doc.json`
- 架构与数据流：`workspace/文档/架构/系统架构.verd-doc.json`
- 命令、提交、测试、发布：`workspace/文档/开发/开发指南.verd-doc.json`
- 文档维护：`workspace/文档/开发/文档维护指南.verd-doc.json`
- 画布 / Mind / 元素源码落点：`workspace/文档/指南/配置与源码索引.verd-doc.json`
- 包索引：`workspace/文档/包/包索引.verd-doc.json`

原生文档是 JSON，完整结构正文在 `text.content`，快速阅读可取 `text.plainText`。修改正文同时保持缓存与内容一致；不得只改 plainText。文档 id 与 text.id 一致，移动重命名不改身份。内部链接使用 `verd://file/<编码后的稳定ID>#<编码后的GitHub标题slug>`。不要新建 Markdown 正文、导出兼容树或正文 JS 生成源。

## 包落点

- 产品 UI：`packages/product/ui`（`@sue/verd-board-ui`）
- 工作区会话与应用：`packages/product/app`（`@sue/verd-board-app`）
- 引擎：`packages/engine`（common、core、layouts、draw、mind、text、workflow、architecture）
- React：`packages/react`（board、text、mind、workflow、architecture）
- 领域图统一由 `FrameCanvas` 通过注册与扩展提供，标准接入 `value/onChange`，外部宿主 `adapter/onIntent`；旧领域 Canvas 已删除。
- 独立文字文件为 `DocumentFileV1` / `.verd-doc.json`，正文为 `BoardTextDocument`，经 `DocumentPage/DocumentEditor` 编辑；不混入画布 CellStore。
- 转换器：`packages/converters`。Markdown/Mermaid-to-board 读写 FrameSnapshot，markdown-to-text 读写独立文档正文；内部依赖使用 `workspace:*`。

## 本仓约定

- TypeScript 严格模式；目录 kebab-case，组件 PascalCase；提交用 Conventional Commits。
- 单测 Vitest（`pnpm test`）；Web E2E 在 `tests/web-e2e`，Desktop E2E 在 `tests/desktop-e2e`。
- `pnpm start` 启动 Desktop，`pnpm dev:web` 启动 Web；`pnpm build` 排除 Desktop，桌面构建使用 `pnpm build:desktop`。
- `pnpm workspace:check` 校验原生文档、图与链接；包依赖发生变化时用 `pnpm workspace:refresh` 刷新包架构图派生内容。
- 发布使用 Changesets：`pnpm release` 再 `pnpm pub`。
- 根 README、中文原生导航与英文 Documentation 同步重大定位与入口；不再建按月变更目录，不恢复另一份正文源。
- AI 样例位于 `tests/fixtures/ai-canvas/`，契约测试直接读原生规范 codeBlock；修改时同步正文和输入夹具。

## 数据、画布与保存

- 修改元素经 CellTransaction / CellRuntime 和 FrameCanvasController；主题位于 `FrameCell.view`，相机只在内存。
- 工作区唯一写入入口为 `WorkspaceSession`，经 `WorkspaceHost` 对画布与文档做 expectedVersion 条件提交、统一历史、保存、冲突与回收管理。
- Desktop 开发默认根 workspace/；打包应用使用用户目录副本，既有数据和已记住的目录优先，不覆盖用户修改。

细节见原生系统架构、源码索引与相关包说明。
