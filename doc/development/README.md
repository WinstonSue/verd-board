# 开发指南

本文档介绍如何参与 VerdBoard 项目的开发。

## 环境要求

- **Node.js**: >= 22.0.0
- **pnpm**: >= 11.18.0
- **Git**: >= 2.0.0

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd verd-board
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 启动开发环境

```bash
# 启动桌面应用（根目录脚本）
pnpm start

# 启动 Web
turbo run dev --filter=web

# 监听构建某个包（示例）
turbo run dev --filter=@sue/board-react-text
```

### 4. 构建项目

```bash
# 构建所有包（不含 desktop 签名包）
pnpm build

# 构建特定包
pnpm build --filter @sue/board-react-text

# 类型检查（Desktop、应用、原生 Cell 内核、React/产品 API 和 consumer）
pnpm typecheck

# Desktop 前端构建（tsc && vite build，不含 electron-builder）
pnpm build:desktop
```

## 项目结构

```
verd-board/
├── apps/              # 应用层（web / desktop）
├── packages/          # 核心包
├── tests/             # E2E 与 consumer 验收
├── doc/              # 项目文档
└── scripts/          # 构建脚本
```

## 开发规范

### 代码规范

- **TypeScript**: 严格模式，所有函数都要有类型定义
- **ESLint**: 使用项目配置，提交前自动检查
- **Prettier**: 统一代码格式
- **文件命名**: kebab-case for folders, PascalCase for components

### Git 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 重构
test: 测试相关
chore: 构建工具、依赖更新
```

### 分支策略

- **main**: 主分支，稳定版本
- **develop**: 开发分支
- **feature/***: 功能分支
- **hotfix/***: 热修复分支

## 包开发

### 创建新包

1. 在 `packages/` 目录下创建新包
2. 添加 `package.json` 配置
3. 更新 `pnpm-workspace.yaml`
4. 在 `doc/packages/` 中添加文档

### 包依赖管理

React / React DOM 统一到 19.2.x：在根目录 `pnpm-workspace.yaml` 的 `overrides` 中锁定（pnpm 11 不再读取 `package.json` 的 `pnpm` 字段）。

使用 workspace 协议管理内部依赖：

```json
{
  "dependencies": {
    "@sue/board-common": "workspace:*"
  }
}
```

## 测试

### 单元测试

```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm test --filter @sue/board-react-text

# 监听模式
pnpm test --watch
```

### E2E 测试

项目使用 Playwright 进行 E2E 测试。

```bash
# 运行 E2E 测试
cd tests/web-e2e
pnpm exec playwright test

# 以 UI 模式运行
pnpm exec playwright test --ui

# 运行特定测试文件
pnpm exec playwright test src/example.spec.ts
```

### Desktop 产品 E2E

```bash
# 重建公开包与 Desktop 前端后，验证真实 Electron 产品路径
pnpm build:desktop
pnpm test:e2e:desktop
```

测试位于 `tests/desktop-e2e`，每个用例使用临时 userData 目录，覆盖关闭前的绘图/笔记保存、重启恢复、旧文件迁移备份、损坏文件加载错误，以及写入失败后的窗口保留和重试。测试运行构建产物；必须先重建，不能用旧 dist 验收新源码。

## 构建和发布

### 构建包

```bash
# 构建所有包
pnpm build

# 构建特定包
pnpm build --filter @sue/board-react-text
```

### 发布

发布使用 Changesets。需要发布的 `@sue/board-*` 与 `@sue/verd-board-*` 包都走同一条流：

```bash
pnpm changeset
pnpm release   # changeset version
pnpm pub       # build + changeset publish
```

发布前应跑通 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm build:web`、`pnpm test:e2e`、`pnpm test:e2e:desktop` 和 `pnpm test:consumer`。

## 调试

### VS Code 调试

使用项目提供的 `.vscode/launch.json` 配置。

### 浏览器调试

开发模式下支持热重载和 Source Map。

## 常见问题

### 依赖问题

如果遇到依赖问题，尝试：

```bash
# 清理依赖
pnpm clean

# 重新安装
pnpm install
```

### 构建问题

如果构建失败，检查：

1. TypeScript 类型错误
2. 依赖版本冲突
3. 环境变量配置

## 发布流程

项目使用 [Changesets](https://github.com/changesets/changesets) 管理版本与 changelog。

```bash
# 1. 记录本次变更
pnpm changeset

# 2. 升版本并生成 changelog
pnpm release

# 3. 构建并发布到 npm
pnpm pub
```

- `pnpm release` 对应 `changeset version`
- `pnpm pub` 会先 `pnpm build`，再 `changeset publish`
- 预发布版本使用 `0.4.0-beta.1` 格式，正式版本使用 `0.4.0`

发布前应跑通 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm build:web`、`pnpm test:e2e`、`pnpm test:e2e:desktop` 和 `pnpm test:consumer`。

### 注意事项

1. 发布前确保所有测试通过
2. 确保有 npm 发布权限
3. 不要使用 Nx release；本仓发布入口只有 Changesets

## Electron 28.3.3 EOL

当前桌面端锁定在 Electron **28.3.3**（`apps/desktop` 与根依赖均为 `electron@^28.0.0`，解析到 28.x）。Electron 28 已结束官方支持窗口，继续使用的风险主要是 Chromium / Node 安全补丁不再回端口，以及后续原生模块兼容性。

本轮**不升级 major**，原因：

1. Electron 29+ 会连带 Chromium 与 Node 大版本，桌面主进程、preload、sandbox 与打包配置都需要单独回归。
2. 北极星明确本轮只评估记录 + 打开 `webPreferences.sandbox`，不做 Electron major 升级。
3. 已通过 `sandbox: true`、IPC key 白名单（含 `main_board_content` / `main_workflow_registry` / `main_mind_content`）和存储原子写降低当前版本面上的风险。

建议下一轮单独排期：先在隔离分支升到仍在 LTS/支持窗口的 Electron，再跑 `pnpm build:desktop`、手动安装包与存储回归。

## 贡献流程

1. 创建功能分支
2. 提交代码
3. 发起评审
4. 合并代码

## 资源链接

- [项目架构](../architecture/ARCHITECTURE.md)
- [包文档](../packages/)
- [使用指南](../guides/)
