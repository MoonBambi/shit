import { _decorator, Component, Node, Vec3, v3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Enemy')
export class Enemy extends Component {
    public target: Node | null = null;

    @property({ tooltip: 'Enemy move speed (units per second).' })
    public moveSpeed: number = 100;

    @property({ tooltip: 'Enemy stop distance to target.' })
    public stopDistance: number = 16;

    private readonly _myPos: Vec3 = v3();
    private readonly _targetPos: Vec3 = v3();
    private readonly _dir: Vec3 = v3();

    update(dt: number) {
        if (dt <= 0) {
            return;
        }
        if (!this.target || !this.target.isValid) {
            return;
        }

        this.node.getWorldPosition(this._myPos);
        this.target.getWorldPosition(this._targetPos);

        Vec3.subtract(this._dir, this._targetPos, this._myPos);
        const distance = this._dir.length();
        const stopDistance = Math.max(0, this.stopDistance);
        if (distance <= stopDistance || distance <= 0.0001) {
            return;
        }

        this._dir.multiplyScalar(1 / distance);
        const maxStep = Math.max(0, distance - stopDistance);
        const step = Math.min(Math.max(0, this.moveSpeed) * dt, maxStep);
        this._myPos.add(this._dir.multiplyScalar(step));
        this.node.setWorldPosition(this._myPos);
    }
}
