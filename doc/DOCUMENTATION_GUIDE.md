# 文档维护指南

本文档说明 VerdBoard 项目的文档维护策略和规范。

## 文档语言策略

为了降低长期维护成本，项目采用以下文档语言策略：

### 中英双语文档

以下文档保持**中英双语**，以便国际化推广：

- `doc/README.md` / `doc/README_en.md` - 项目主文档
- `README.md` (根目录) - 项目简介

**维护要求**:

- 重要更新需同步更新中英文版本

### 以中文为主的文档

以下文档**以中文为主**，降低维护成本：

- `doc/product/产品概览.md` - 产品定位、能力与文档索引
- `doc/architecture/ARCHITECTURE.md` - 架构文档
- `doc/development/README.md` - 开发指南
- `doc/guides/SETUP.md` - 安装配置指南
- `doc/guides/配置与源码索引.md` - 画布 / Mind / 元素属性源码落点
- `doc/guides/ai-canvas-data-spec.md` - 面向 AI 的画布数据生成规范（含 `doc/examples/ai-canvas/` 示例）
- `doc/packages/README.md` - 包文档索引
- `doc/packages/react/README.md` - React 包文档
- `doc/packages/board/*.md` - Board 引擎相关设计文档

**说明**:

- 这些文档主要面向项目贡献者和深度使用者
- 如有国际化需求，可按需翻译特定章节
- 代码示例和 API 说明本身具有通用性

## 文档结构

```
doc/
├── README.md                    # 项目主文档 (中文) ✓ 双语
├── README_en.md                 # 项目主文档 (英文) ✓ 双语
├── DOCUMENTATION_GUIDE.md       # 文档维护指南 (本文档)
├── product/
│   └── 产品概览.md               # 产品文档 (中文为主)
├── architecture/
│   └── ARCHITECTURE.md          # 架构文档 (中文为主)
├── development/
│   └── README.md                # 开发指南 (中文为主)
├── guides/
│   ├── SETUP.md                 # 安装配置 (中文为主)
│   ├── ai-canvas-data-spec.md   # 面向 AI 的画布数据生成规范 (中文为主)
│   └── 配置与源码索引.md         # 画布/Mind/元素属性源码索引 (中文为主)
├── examples/
│   └── ai-canvas/               # 规范配套示例（契约测试保证与内嵌代码块一致）
└── packages/
    ├── README.md                # 包索引 (中文为主)
    ├── react/
    │   └── README.md            # React 包文档 (中文为主)
    └── board/
        ├── mind-features.md     # Mind 等行为与技术落点（合并维护）
        ├── canvas-modes.md      # 独占编辑器与白板特殊组件
        └── *.md                 # 其它 Board 设计 / 规范文档 (中文为主)
```

较大功能的产品摘要写入 `doc/product/产品概览.md` 对应能力小节；技术落点、文件索引写入 `doc/packages/board/`（如 `mind-features.md`）或 `doc/architecture/ARCHITECTURE.md`，并在 `doc/packages/README.md` 或产品文档「文档索引」表中登记链接。**不再**使用按年月分目录的 `doc/change-log/`。各包根目录 `CHANGELOG.md` 仅保留当前预发布版本说明，历史条目不在这里维护。

## 文档更新规范

### 1. 技术栈更新

当技术栈发生变化时，需要更新以下文档：

- `doc/README.md` / `doc/README_en.md` - 技术栈章节
- `doc/architecture/ARCHITECTURE.md` - 技术栈和依赖章节
- 相关包的 `package.json`

### 2. 命令更新

当 npm scripts 发生变化时，需要更新：

- `doc/README.md` / `doc/README_en.md` - 快速开始章节
- `doc/development/README.md` - 开发、构建、测试章节
- `doc/guides/SETUP.md` - 相关命令说明

### 3. 项目结构更新

当添加/删除包或目录时，需要更新：

- `doc/README.md` / `doc/README_en.md` - 项目结构章节
- `doc/architecture/ARCHITECTURE.md` - 项目结构章节
- `doc/packages/README.md` - 包列表

### 4. 发布流程更新

当发布流程变化时，需要更新：

- `doc/development/README.md` - 发布流程章节
- 相关的发布脚本注释

## 文档质量要求

### 准确性

- ✅ 命令必须可执行
- ✅ 路径必须正确
- ✅ 版本号必须与实际一致
- ✅ 代码示例必须可运行

### 一致性

- ✅ 术语使用统一：中文产品名青编，英文产品名 VerdBoard，代码与包名仍用 VerdBoard
- ✅ 包名使用统一（`@sue/board-*`、`@sue/verd-board-*`）
- ✅ 命令格式统一
- ✅ 目录结构描述一致

### 可维护性

- ✅ 避免重复内容，使用链接引用
- ✅ 保持文档结构清晰
- ✅ 及时清理过时内容
- ✅ 添加更新日期标记

## 常见问题

### Q: 何时需要更新英文文档？

A: 以下情况需要更新英文文档：

- 项目重大版本发布
- 核心功能变更
- 安装/使用流程变化
- 技术栈重大更新

### Q: 文档更新的优先级？

A: 优先级顺序：

1. 主文档 (README.md)
2. 开发指南 (development/README.md)
3. 架构文档 (architecture/ARCHITECTURE.md)
4. 包文档 (packages/*.md)

## 贡献者指南

### 添加新文档

1. 确定文档类型和语言策略
2. 在相应目录创建文档
3. 在索引文档中添加链接
4. 遵循现有文档格式

### 更新现有文档

1. 检查相关联的文档
2. 同步更新所有相关章节
3. 验证链接和命令的正确性
4. 更新文档修改日期

---

**最后更新**: 2026-04-20
**维护者**: VerdBoard Team
