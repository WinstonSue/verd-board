# 思维导图节点宽度规则说明

## 概述

本文档详细说明思维导图节点的宽度计算规则，包括 topic（标题）和 note（笔记）的宽度行为。

## 节点宽度规则

### 1. Topic 初始宽度

**规则**：节点的初始宽度取决于 topic 内容的宽度，但不超过 200px。

**行为**：

- 当 topic 文本宽度 ≤ 200px 时，节点宽度 = topic 文本宽度
- 当 topic 文本宽度 > 200px 时，节点宽度 = 200px，topic 文本自动换行

**实现**：

- 常量 `TOPIC_DEFAULT_MAX_WIDTH = 200`（定义在 `constants/node-topic-style.ts`）
- 函数 `NodeSpace.getTopicMaxDynamicWidth()` 返回 200px 作为最大宽度
- 文本测量时使用此最大宽度作为容器宽度，超出部分自动换行

**示例**：

```
短文本 → 节点宽度 = 文本实际宽度（如 80px）
很长的文本内容超过了200像素 → 节点宽度 = 200px，文本换行显示
```

### 2. 手动调整宽度

**规则**：用户手动调整节点宽度后，节点宽度固定为用户设置的值，不再受内容变化影响。

**行为**：

- 用户拖拽调整节点宽度后，`element.manualWidth` 被设置为用户指定的宽度
- 后续无论 topic 或 note 内容如何变化，节点宽度保持不变
- 内容超出宽度时自动换行，不会撑开节点

**实现**：

- `element.manualWidth` 字段存储用户手动设置的宽度
- `NodeSpace.getTopicMaxDynamicWidth()` 优先返回 `manualWidth`
- `NodeSpace.getTopicDynamicWidth()` 在计算时优先使用 `manualWidth`

**示例**：

```
初始状态：topic = "短文本"，节点宽度 = 80px
用户拖拽：节点宽度调整为 300px，manualWidth = 300
修改内容：topic = "很长的文本内容"，节点宽度仍为 300px
```

### 3. Note 宽度

**规则**：note 的宽度始终撑满节点宽度。

**行为**：

- note 宽度 = 节点宽度（即 topic 的动态宽度）
- 无论节点宽度如何变化（初始计算或手动调整），note 都自动适应
- note 内容超出宽度时自动换行

**实现**：

- `noteTextManage.getRectangle()` 使用 `NodeSpace.getTopicDynamicWidth()` 获取节点宽度
- `getTopicDynamicWidth()` 返回值受 `manualWidth` 影响，确保 note 与节点同宽

**示例**：

```
初始状态：节点宽度 = 200px → note 宽度 = 200px
手动调整：节点宽度 = 400px → note 宽度 = 400px
```

## 宽度计算流程

### 初始渲染

```
1. 计算 topic 文本宽度
2. 与 TOPIC_DEFAULT_MAX_WIDTH (200px) 比较
3. 取较小值作为节点宽度
4. note 宽度 = 节点宽度
```

### 手动调整后

```
1. 用户拖拽调整宽度
2. 设置 element.manualWidth = 用户指定宽度
3. 节点宽度 = manualWidth
4. note 宽度 = manualWidth
5. 内容变化不影响宽度
```

## 相关代码文件

### 常量定义

- `packages/engine/mind/src/constants/node-topic-style.ts`
  - `TOPIC_DEFAULT_MAX_WIDTH = 200`

### 宽度计算

- `packages/engine/mind/src/utils/space/node-space.ts`
  - `getTopicMaxDynamicWidth()`: 返回 topic 的最大宽度（200px 或 manualWidth）
  - `getTopicDynamicWidth()`: 返回 topic 的实际宽度
  - `getNodeWidth()`: 返回节点的总宽度

### 组件实现

- `packages/engine/mind/src/mind-node.component.ts`
  - `topicTextManage.getRectangle()`: topic 的位置和尺寸
  - `noteTextManage.getRectangle()`: note 的位置和尺寸（宽度撑满）

## 设计考虑

### 为什么 topic 最大宽度是 200px？

1. **可读性**：过长的单行文本不利于阅读，200px 是一个合理的平衡点
2. **布局美观**：限制宽度可以避免节点过宽，影响思维导图整体布局
3. **自动换行**：超过 200px 的文本自动换行，保持节点紧凑

### 为什么 note 要撑满节点宽度？

1. **视觉一致性**：note 作为 topic 的补充说明，应该与 topic 对齐
2. **空间利用**：充分利用节点宽度，提供更好的编辑和阅读体验
3. **用户预期**：用户调整节点宽度时，期望 note 也相应调整

### 为什么手动调整后宽度固定？

1. **用户意图**：用户手动调整宽度表示有明确的布局需求
2. **布局稳定**：避免内容变化导致布局抖动
3. **精确控制**：允许用户精确控制思维导图的视觉呈现

## 未来优化方向

1. **智能宽度**：根据内容类型（纯文本、富文本、图片）智能调整默认宽度
2. **宽度预设**：提供几个预设宽度选项（小、中、大）
3. **自适应模式**：提供"自动适应内容"选项，允许节点根据内容动态调整
