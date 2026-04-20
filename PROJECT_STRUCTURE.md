# 项目结构说明

> 说明：以下按当前项目目录整理，每个文件给出一行用途说明，便于后续维护与协作。

## 根目录

- `.editorconfig`：编辑器统一格式配置（缩进、换行等）。
- `.eslintignore`：ESLint 忽略扫描文件列表。
- `.eslintrc.cjs`：ESLint 规则配置文件。
- `.gitignore`：Git 忽略文件配置。
- `.prettierignore`：Prettier 忽略文件列表。
- `.prettierrc.json`：Prettier 代码格式化规则。
- `package.json`：项目依赖与 npm 脚本入口。
- `package-lock.json`：依赖锁定文件，确保安装版本一致。
- `tsconfig.json`：TypeScript 编译配置（项目侧覆写）。

## assets 目录

### `assets/Prefab`

- `Enemy.prefab`：敌人预制体。
- `Shit.prefab`：大便。

### `assets/Script`

- `Enemy.ts`：敌人基础移动能力组件（移动锁与 moveTowards 能力）。
- `EnemySystem.ts`：敌人生成/对象池/数量控制系统。
- `PlayerController.ts`：玩家移动或控制逻辑脚本。
- `SkillCaster.ts`：玩家技能兼容入口脚本（继承玩家技能施放器）。

#### `assets/Script/Skill/Enemy`

- `ChasePlayer.ts`：敌人追踪玩家技能组件（目标、速度、停止距离）。
- `Eat.ts`：敌人吃食物技能组件（搜索、追踪、吞食、禁移）。

#### `assets/Script/Skill/Player`

- `PlayerSkillCaster.ts`：玩家按键施法组件（按 J 生成技能对象）。

### `assets/Sences`

- `word1.scene`：当前主场景资源文件。

### `assets` 顶层元数据

- `Prefab.meta`：`Prefab` 目录元数据。
- `Script.meta`：`Script` 目录元数据。
- `Sences.meta`：`Sences` 目录元数据。

## settings 目录

### `settings/v2/packages`

- `builder.json`：构建流程相关设置。
- `cocos-service.json`：Cocos 服务配置。
- `device.json`：设备预览/运行配置。
- `engine.json`：引擎相关项目配置。
- `information.json`：项目信息配置。
- `program.json`：程序运行参数配置。
- `project.json`：项目级编辑器设置。
