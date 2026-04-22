import { _decorator, Component, Node, Vec3, v3 } from 'cc';
import { Enemy } from '../../Enemy';
const { ccclass, property } = _decorator;

@ccclass('ChasePlayer')
export class ChasePlayer extends Component {
    @property({ type: Node, tooltip: '追踪目标（通常是 Player）。' })
    public target: Node | null = null;

    @property({ tooltip: '追踪移动速度。' })
    public moveSpeed: number = 100;

    @property({ tooltip: '追踪停止距离。' })
    public stopDistance: number = 16;

    @property({ tooltip: '追踪触发范围（超出后交给巡逻）。' })
    public chaseRange: number = 260;

    private readonly _myPos: Vec3 = v3();
    private readonly _targetPos: Vec3 = v3();
    private readonly _direction: Vec3 = v3();
    private _enemy: Enemy | null = null;
    private _isChasing: boolean = false;

    // 启用时缓存依赖组件。
    onEnable() {
        this._enemy = this.node.getComponent(Enemy);
        this._isChasing = false;
    }

    // 返回当前是否处于追击状态，供其他技能决策。
    public isChasing(): boolean {
        return this._isChasing;
    }

    // 每帧在范围内追击玩家，范围外由巡逻技能接管。
    update(dt: number) {
        if (dt <= 0 || !this.target || !this.target.isValid) {
            this._isChasing = false;
            return;
        }
        if (!this._enemy) {
            this._enemy = this.node.getComponent(Enemy);
            if (!this._enemy) {
                this._isChasing = false;
                return;
            }
        }

        this.node.getWorldPosition(this._myPos);
        this.target.getWorldPosition(this._targetPos);
        Vec3.subtract(this._direction, this._targetPos, this._myPos);

        const chaseRange = Math.max(0, this.chaseRange);
        if (chaseRange > 0 && this._direction.lengthSqr() > chaseRange * chaseRange) {
            this._isChasing = false;
            return;
        }

        this._isChasing = true;
        this._enemy.moveTowards(
            this.target,
            Math.max(0, this.moveSpeed),
            Math.max(0, this.stopDistance),
            dt,
        );
    }
}
