# Cocos Creator 3.x 代码规范

适用范围：`assets/Script/**/*.ts`，面向 Cocos Creator `3.x`（当前项目 `3.8.8`）。

## 1. 命名与结构

- 类名使用 `PascalCase`，变量/方法使用 `camelCase`，私有字段使用 `_camelCase`。
- 文件名与主类名一致（示例：`EnemySystem.ts` 对应 `EnemySystem`）。
- `@ccclass('Name')` 与导出类名保持一致，避免序列化和维护混淆。
- 目录按职责分层：`System / Skill / Component / Registry`。

## 2. 生命周期与事件

- 输入/事件监听统一在 `onEnable` 注册，在 `onDisable` 注销。
- 资源、对象池、全局引用在 `onDestroy` 清理。
- `update(dt)` 内先做早返回（空引用、`dt <= 0`、禁用状态）。

## 3. 组件职责

- 组件单一职责：
- `Enemy` 只做基础移动能力；
- `ChasePlayer` 只做追踪策略；
- `Eat` 只做吃食物行为；
- `EnemySystem` 只做生成与数量治理；
- `FoodRegistry` 只做食物注册查询。
- 行为组件优先组合，不在一个组件里混合“输入 + 生成 + AI + UI”。

## 4. 性能规则

- 禁止“每敌人全场景遍历”查找目标；使用注册中心（如 `FoodRegistry`）。
- 查找最近目标时优先平方距离（`lengthSqr`），减少开方。
- 大量 AI 查询使用分片错峰（按 `frame % slice`）。
- 复用 `Vec3` 临时变量，避免 `update` 中频繁分配。

## 5. 资源与对象池

- 高频创建节点必须对象池化（`NodePool`）。
- 池对象回收时重置行为状态（目标引用、临时标记、激活状态）。
- `NodePool` 在系统销毁时 `clear()`，防止场景切换残留。

## 6. 可维护性

- 注释、tooltip 统一 UTF-8 可读文本，禁止乱码。
- `console.warn` 内容包含模块名（如 `[EnemySystem] ...`）。
- 参数边界统一显式收敛（`Math.max(0, value)`）。
- 代码提交前必须通过：
- `npm run lint`
- `npm run format:check`

## 7. 审查清单（PR Checklist）

- 是否存在未解绑监听或未清理资源？
- 是否存在跨层级隐式耦合（例如敌人挂在玩家子树）？
- 是否存在 O(敌人数 × 场景节点数) 的重复扫描？
- `@ccclass`、文件名、类名是否一致？
- 是否通过 lint 与格式检查？
