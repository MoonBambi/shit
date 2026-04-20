import { _decorator, Component, EventKeyboard, input, Input, KeyCode, Vec3, v3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('PlayerController')
export class PlayerController extends Component {
    @property({ tooltip: 'Move speed.' })
    public speed: number = 300;

    private readonly _moveDirection: Vec3 = v3();
    private readonly _keyPressed: Map<KeyCode, boolean> = new Map();
    private readonly _displacement: Vec3 = v3();
    private readonly _nextPosition: Vec3 = v3();

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        this._keyPressed.clear();
        this._moveDirection.set(0, 0, 0);
    }

    private onKeyDown(event: EventKeyboard) {
        this._keyPressed.set(event.keyCode, true);
    }

    private onKeyUp(event: EventKeyboard) {
        this._keyPressed.set(event.keyCode, false);
    }

    update(dt: number) {
        this.updateMoveDirection();

        if (this._moveDirection.lengthSqr() > 0) {
            this._moveDirection.normalize();
            this._displacement.set(this._moveDirection).multiplyScalar(this.speed * dt);
            this._nextPosition.set(this.node.position).add(this._displacement);
            this.node.setPosition(this._nextPosition);
        }
    }

    private updateMoveDirection() {
        let x = 0;
        let y = 0;

        if (this._keyPressed.get(KeyCode.KEY_W)) y += 1;
        if (this._keyPressed.get(KeyCode.KEY_S)) y -= 1;
        if (this._keyPressed.get(KeyCode.KEY_A)) x -= 1;
        if (this._keyPressed.get(KeyCode.KEY_D)) x += 1;

        this._moveDirection.set(x, y, 0);
    }
}
