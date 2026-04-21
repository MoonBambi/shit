import { _decorator, Component, director, Node, Prefab, Vec3, v3 } from 'cc';
import { Enemy } from '../../Enemy';
import { ChasePlayer } from './ChasePlayer';
import { FoodRegistry } from '../Food/FoodRegistry';
const { ccclass, property } = _decorator;

enum EatState {
    Searching = 'Searching',
    MovingToFood = 'MovingToFood',
    Cooldown = 'Cooldown',
}

@ccclass('Eat')
export class Eat extends Component {
    private static readonly EAT_DISABLE_MOVE_SECONDS = 2;

    @property({ tooltip: '吃掉目标前的停止距离。' })
    public stopDistance: number = 5;

    @property({ tooltip: '开始追踪可吃目标的距离。' })
    public trackDistance: number = 100;

    @property({ type: Prefab, tooltip: '可吃目标预制体（可在编辑器拖拽）。' })
    public foodPrefab: Prefab | null = null;

    @property({ tooltip: '吃技能冷却时间（秒）。' })
    public cd: number = 3;

    @property({ tooltip: '分片查询数（越大同帧查询敌人越少）。' })
    public querySlice: number = 5;

    @property({ tooltip: '到达判定容差（解决边界卡住）。' })
    public reachEpsilon: number = 0.2;

    private readonly _enemyPos: Vec3 = v3();
    private readonly _foodPos: Vec3 = v3();
    private readonly _direction: Vec3 = v3();
    private _enemy: Enemy | null = null;
    private _chasePlayer: ChasePlayer | null = null;
    private _targetFood: Node | null = null;
    private _cooldownSeconds: number = 0;
    private _cachedChaseTarget: Node | null = null;
    private _isEatOverriding: boolean = false;
    private _queryOffset: number = 0;
    private _state: EatState = EatState.Searching;

    // 启用时缓存依赖组件并检查食物预制体配置。
    onEnable() {
        this._enemy = this.node.getComponent(Enemy);
        this._chasePlayer = this.node.getComponent(ChasePlayer);
        this._queryOffset = this.computeQueryOffset();
        this._cooldownSeconds = 0;
        this._state = EatState.Searching;
        if (!this.foodPrefab) {
            console.warn('[Eat] foodPrefab is not assigned.');
        }
    }

    // 禁用时恢复追踪状态并清空当前食物目标。
    onDisable() {
        this.endEatOverride();
        this._targetFood = null;
        this._cooldownSeconds = 0;
        this._state = EatState.Searching;
    }

    // 每帧更新冷却、扫描目标并驱动吃食物行为。
    update(dt: number) {
        if (dt <= 0) {
            return;
        }

        switch (this._state) {
            case EatState.Searching:
                this.updateSearching();
                break;
            case EatState.MovingToFood:
                this.updateMovingToFood(dt);
                break;
            case EatState.Cooldown:
                this.updateCooldown(dt);
                break;
        }
    }

    // 技能统一入口，当前由自动逻辑驱动可保持空实现。
    public cast() {}

    // 执行向食物移动与吞食结算逻辑。
    private eat(dt: number, foodNode: Node): boolean {
        this.node.getWorldPosition(this._enemyPos);
        foodNode.getWorldPosition(this._foodPos);
        Vec3.subtract(this._direction, this._foodPos, this._enemyPos);

        const distance = this._direction.length();
        const stopDistance = Math.max(0, this.stopDistance);
        const reachDistance = stopDistance + Math.max(0, this.reachEpsilon);
        if (distance <= reachDistance || distance <= 0.0001) {
            if (foodNode.isValid) {
                foodNode.destroy();
            }
            if (this._enemy) {
                this._enemy.lockMovement(Eat.EAT_DISABLE_MOVE_SECONDS);
            }
            return true;
        }

        this._direction.multiplyScalar(1 / distance);
        const moveSpeed = this._chasePlayer ? Math.max(0, this._chasePlayer.moveSpeed) : 100;
        const step = Math.min(moveSpeed * dt, Math.max(0, distance - stopDistance));
        this._enemyPos.add(this._direction.multiplyScalar(step));
        this.node.setWorldPosition(this._enemyPos);

        if (this._enemy) {
            this._enemy.lockMovement(0.1);
        }
        return false;
    }

    // 开始吃食物抢占，暂停追踪玩家技能目标。
    private beginEatOverride() {
        if (!this._chasePlayer || this._isEatOverriding) {
            return;
        }
        this._cachedChaseTarget = this._chasePlayer.target;
        this._chasePlayer.target = null;
        this._isEatOverriding = true;
    }

    // 结束吃食物抢占，恢复追踪玩家技能目标。
    private endEatOverride() {
        if (!this._chasePlayer || !this._isEatOverriding) {
            return;
        }
        this._chasePlayer.target = this._cachedChaseTarget;
        this._cachedChaseTarget = null;
        this._isEatOverriding = false;
    }

    // 在追踪范围内查找最近的可吃目标节点。
    private findNearestFoodInRange(maxDistance: number): Node | null {
        if (maxDistance <= 0) {
            return null;
        }

        this.node.getWorldPosition(this._enemyPos);
        let nearest: Node | null = null;
        let nearestDistanceSqr = maxDistance * maxDistance;
        const foods = FoodRegistry.getFoods();
        for (const food of foods) {
            if (!this.isFoodNode(food)) {
                continue;
            }

            food.getWorldPosition(this._foodPos);
            Vec3.subtract(this._direction, this._foodPos, this._enemyPos);
            const distanceSqr = this._direction.lengthSqr();
            if (distanceSqr <= nearestDistanceSqr) {
                nearestDistanceSqr = distanceSqr;
                nearest = food;
            }
        }

        return nearest;
    }

    // 判断节点是否匹配食物预制体的实例名称。
    private isFoodNode(node: Node): boolean {
        const prefabRootName = this.getFoodPrefabRootName();
        if (!prefabRootName) {
            return false;
        }
        return !!(
            node &&
            node.isValid &&
            node.activeInHierarchy &&
            (node.name === prefabRootName || node.name.indexOf(prefabRootName + '(') === 0)
        );
    }

    // 获取食物预制体根节点名称用于场景匹配。
    private getFoodPrefabRootName(): string {
        if (!this.foodPrefab || !this.foodPrefab.data) {
            return '';
        }
        return this.foodPrefab.data.name || '';
    }

    // 判断当前帧是否命中自己的分片查询窗口。
    private shouldQueryThisFrame(): boolean {
        const slice = Math.max(1, Math.floor(this.querySlice));
        return director.getTotalFrames() % slice === this._queryOffset;
    }

    // 基于节点 uuid 计算稳定分片偏移，确保敌人查询错峰。
    private computeQueryOffset(): number {
        const slice = Math.max(1, Math.floor(this.querySlice));
        if (slice === 1) {
            return 0;
        }

        const source = this.node.uuid || this.node.name;
        let hash = 0;
        for (let i = 0; i < source.length; i++) {
            hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
        }
        return hash % slice;
    }

    // 搜索状态：按分片查询最近食物并进入移动状态。
    private updateSearching() {
        if (this._targetFood && this._targetFood.isValid && this._targetFood.activeInHierarchy) {
            this.beginEatOverride();
            this._state = EatState.MovingToFood;
            return;
        }

        this._targetFood = null;
        if (!this.shouldQueryThisFrame()) {
            return;
        }

        this._targetFood = this.findNearestFoodInRange(Math.max(0, this.trackDistance));
        if (!this._targetFood) {
            return;
        }

        this.beginEatOverride();
        this._state = EatState.MovingToFood;
    }

    // 移动状态：持续追食物并在到达后进入冷却状态。
    private updateMovingToFood(dt: number) {
        if (!this._targetFood || !this._targetFood.isValid || !this._targetFood.activeInHierarchy) {
            this._targetFood = null;
            this.endEatOverride();
            this._state = EatState.Searching;
            return;
        }

        const reached = this.eat(dt, this._targetFood);
        if (!reached) {
            return;
        }

        this._targetFood = null;
        this.endEatOverride();
        this._cooldownSeconds = Math.max(0, this.cd);
        this._state = EatState.Cooldown;
    }

    // 冷却状态：倒计时结束后回到搜索状态。
    private updateCooldown(dt: number) {
        this._cooldownSeconds = Math.max(0, this._cooldownSeconds - dt);
        if (this._cooldownSeconds > 0) {
            return;
        }
        this._state = EatState.Searching;
    }
}
