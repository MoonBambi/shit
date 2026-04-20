import { _decorator, Component, Node } from 'cc';
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

    private _enemy: Enemy | null = null;

    onEnable() {
        this._enemy = this.node.getComponent(Enemy);
    }

    update(dt: number) {
        if (dt <= 0 || !this.target || !this.target.isValid) {
            return;
        }
        if (!this._enemy) {
            this._enemy = this.node.getComponent(Enemy);
            if (!this._enemy) {
                return;
            }
        }

        this._enemy.moveTowards(
            this.target,
            Math.max(0, this.moveSpeed),
            Math.max(0, this.stopDistance),
            dt,
        );
    }
}
