# VerdBoard Desktop

基于 Electron 的 VerdBoard 桌面应用程序。

## 功能特性

- 使用本地文件系统存储数据（而非 IndexedDB）
- 跨平台支持（macOS、Windows、Linux）
- 完整的 VerdBoard 绘图功能

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev

# 构建应用
pnpm run build

# 构建但不打包（用于测试）
pnpm run build:dir
```

## 数据存储

数据以工作区文件夹的形式按画布拆分存储（每个画布一个 `.verd.json`）：

- macOS: `~/Library/Application Support/VerdBoard/workspaces/default/`
- Windows: `%APPDATA%/VerdBoard/workspaces/default/`
- Linux: `~/.config/VerdBoard/workspaces/default/`

开发模式默认打开本目录的 `workspace/` 文件夹（已 gitignore）。首次启动时若
工作区为空，应用会把本目录的 `verdboard-data.json` 旧清单迁移为工作区内
的多个画布文件并默认打开根画布；该文件是工作区存储集合（清单与各 Frame
记录），不是菜单「打开」接受的单个 FrameSnapshot 文件。

## 架构与流程 demo

仓内 demo 包含产品导览和八个可编辑专题：分层依赖、运行时协作、核心模型、加载迁移、编辑历史、保存关闭、导入导出、开发验收。双击专题进入详情，返回后定位原外壳。

生成源在 `architecture/documents.mjs`，依赖关系读取当前 workspace 的 `package.json`；两份 `.mmd` 参考图从同一源生成。

```bash
# 从仓库根目录运行：刷新 demo JSON 和两份 Mermaid 参考图
pnpm --filter desktop generate-architecture

# 只读校验：检查原生格式及托管内容是否与生成源一致
pnpm --filter desktop generate-architecture --check

# 读取当前仓内工作区，输出到独立文件；不修改仓内 JSON 或参考图
pnpm --filter desktop generate-architecture --output /tmp/verdboard-demo.json

# 生成器保护与幂等测试
node --test apps/desktop/architecture/generate.test.mjs
```

生成器重建托管专题，保留其它图表、首页标注、分组和用户新增的领域成员。损坏输入、未知 ID 冲突或无法保留的关系会阻止写入。未变化的记录与时间戳保持原样；默认写入采用临时文件原子替换，发现并发自动保存后停止。

刷新前退出正在读写仓内 JSON 的开发 Desktop；否则下一次自动保存可能覆盖生成结果。可使用 `--output` 先检查结果。验证 demo 时使用临时 Electron userData，避免测试写入实际工作区。

## 技术栈

- Electron
- React 19
- Vite
- TypeScript
- `@sue/verd-board-ui` 与 `@sue/board-*` 核心库
