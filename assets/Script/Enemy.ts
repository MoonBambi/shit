import { _decorator, Component, Node, Vec3, v3 } from 'cc';
const { ccclass } = _decorator;

@ccclass('Enemy')
export class Enemy extends Component {
    private readonly _myPos: Vec3 = v3();
    private readonly _dir: Vec3 = v3();
    private _movementLockSeconds: number = 0;

    public lockMovement(seconds: number) {
        this._movementLockSeconds = Math.max(this._movementLockSeconds, Math.max(0, seconds));
    }

    public canMove(): boolean {
        return this._movementLockSeconds <= 0;
    }

    public moveTowards(target: Node, moveSpeed: number, stopDistance: number, dt: number): boolean {
        if (!target || !target.isValid || dt <= 0 || !this.canMove()) {
            return false;
        }

        this.node.getWorldPosition(this._myPos);
        target.getWorldPosition(this._dir);
        Vec3.subtract(this._dir, this._dir, this._myPos);

        const distance = this._dir.length();
        const minDistance = Math.max(0, stopDistance);
        if (distance <= minDistance || distance <= 0.0001) {
            return false;
        }

        this._dir.multiplyScalar(1 / distance);
        const maxStep = Math.max(0, distance - minDistance);
        const step = Math.min(Math.max(0, moveSpeed) * dt, maxStep);
        this._myPos.add(this._dir.multiplyScalar(step));
        this.node.setWorldPosition(this._myPos);
        return true;
    }

    update(dt: number) {
        if (dt <= 0) {
            return;
        }
        if (this._movementLockSeconds > 0) {
            this._movementLockSeconds = Math.max(0, this._movementLockSeconds - dt);
        }
    }
}
