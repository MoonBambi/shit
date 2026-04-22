import { _decorator, Component, Vec3, randomRange, v3 } from 'cc';
import { Enemy } from '../../Enemy';
import { ChasePlayer } from './ChasePlayer';
const { ccclass, property } = _decorator;

@ccclass('Wander')
export class Wander extends Component {
    private static readonly QUADRANT_COUNT = 4;
    private static readonly TARGET_PICK_RETRY_COUNT = 8;
    private static readonly ARRIVE_EPSILON = 0.2;

    @property({ tooltip: '游走移动速度。' })
    public moveSpeed: number = 80;

    @property({ tooltip: '游走到达停止距离。' })
    public stopDistance: number = 6;

    @property({ tooltip: '以世界中心为左下角原点的矩形宽度。' })
    public width: number = 800;

    @property({ tooltip: '以世界中心为左下角原点的矩形高度。' })
    public height: number = 600;

    private readonly _myPos: Vec3 = v3();
    private readonly _wanderTarget: Vec3 = v3();
    private readonly _direction: Vec3 = v3();

    private _enemy: Enemy | null = null;
    private _chasePlayer: ChasePlayer | null = null;
    private _hasWanderTarget: boolean = false;
    private _currentQuadrant: number = 0;

    // 启用时缓存依赖并重置游走状态。
    onEnable() {
        this._enemy = this.node.getComponent(Enemy);
        this._chasePlayer = this.node.getComponent(ChasePlayer);
        this._hasWanderTarget = false;
        this._currentQuadrant = this.getQuadrantByPosition(this.node.worldPosition.x, this.node.worldPosition.y);
    }

    // 每帧在未追击时执行游走移动。
    update(dt: number) {
        if (dt <= 0) {
            return;
        }
        if (!this._enemy) {
            this._enemy = this.node.getComponent(Enemy);
            if (!this._enemy) {
                return;
            }
        }
        if (this._chasePlayer && this._chasePlayer.isChasing()) {
            this._hasWanderTarget = false;
            return;
        }
        if (!this._enemy.canMove()) {
            return;
        }

        if (!this._hasWanderTarget) {
            this.pickWanderTarget();
        }
        this.moveToWanderTarget(dt);
    }

    // 在矩形范围内挑选新目标，且与当前位置距离至少为宽度的 2/3。
    private pickWanderTarget() {
        this.node.getWorldPosition(this._myPos);
        const minTargetDistance = Math.max(0, this.width) * (2 / 3);
        let nextQuadrant = this._currentQuadrant;

        for (let i = 0; i < Wander.TARGET_PICK_RETRY_COUNT; i++) {
            nextQuadrant = this.pickNextQuadrant(this._currentQuadrant);
            this.setRandomTargetInQuadrant(nextQuadrant);
            if (this.isTargetFarEnough(this._myPos, minTargetDistance)) {
                break;
            }
        }

        this._hasWanderTarget = true;
        this._currentQuadrant = nextQuadrant;
    }

    // 向当前游走目标点移动，抵达后等待下一次重算。
    private moveToWanderTarget(dt: number) {
        this.node.getWorldPosition(this._myPos);
        Vec3.subtract(this._direction, this._wanderTarget, this._myPos);

        const distance = this._direction.length();
        const stopDistance = Math.max(0, this.stopDistance);
        if (distance <= stopDistance + Wander.ARRIVE_EPSILON || distance <= 0.0001) {
            this._hasWanderTarget = false;
            return;
        }

        this._direction.multiplyScalar(1 / distance);
        const remain = Math.max(0, distance - stopDistance);
        if (remain <= Wander.ARRIVE_EPSILON) {
            this._hasWanderTarget = false;
            return;
        }
        const step = Math.min(Math.max(0, this.moveSpeed) * dt, remain);
        this._myPos.add(this._direction.multiplyScalar(step));
        this.node.setWorldPosition(this._myPos);
    }

    // 检查当前位置与目标点距离是否满足最小距离约束。
    private isTargetFarEnough(currentPos: Vec3, minDistance: number): boolean {
        if (minDistance <= 0) {
            return true;
        }
        Vec3.subtract(this._direction, this._wanderTarget, currentPos);
        return this._direction.lengthSqr() >= minDistance * minDistance;
    }

    // 根据世界坐标判定当前所在象限（以左下角原点矩形中心线分区）。
    private getQuadrantByPosition(x: number, y: number): number {
        const width = Math.max(0, this.width);
        const height = Math.max(0, this.height);
        const midX = width * 0.5;
        const midY = height * 0.5;
        if (x >= midX && y >= midY) {
            return 0;
        }
        if (x < midX && y >= midY) {
            return 1;
        }
        if (x < midX && y < midY) {
            return 2;
        }
        return 3;
    }

    // 选择一个不同于当前象限的新象限，避免局部反复打转。
    private pickNextQuadrant(currentQuadrant: number): number {
        const start = Math.max(0, Math.min(Wander.QUADRANT_COUNT - 1, Math.floor(currentQuadrant)));
        const offset = Math.floor(randomRange(1, Wander.QUADRANT_COUNT));
        return (start + offset) % Wander.QUADRANT_COUNT;
    }

    // 在指定象限内随机一个目标点，并写入游走目标坐标。
    private setRandomTargetInQuadrant(quadrant: number) {
        const width = Math.max(0, this.width);
        const height = Math.max(0, this.height);
        const midX = width * 0.5;
        const midY = height * 0.5;
        const safeQuadrant = Math.max(0, Math.min(Wander.QUADRANT_COUNT - 1, Math.floor(quadrant)));

        let minX = 0;
        let maxX = width;
        let minY = 0;
        let maxY = height;

        if (safeQuadrant === 0) {
            minX = midX;
            minY = midY;
        } else if (safeQuadrant === 1) {
            maxX = midX;
            minY = midY;
        } else if (safeQuadrant === 2) {
            maxX = midX;
            maxY = midY;
        } else {
            minX = midX;
            maxY = midY;
        }

        this._wanderTarget.set(randomRange(minX, maxX), randomRange(minY, maxY), 0);
    }
}
