import { _decorator, Component, EventKeyboard, input, Input, KeyCode, Vec3, v3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('PlayerMovement')
export class PlayerMovement extends Component {

    @property({ tooltip: '移动速度' })
    public speed: number = 300;

    private _moveDir: Vec3 = v3();
    private _keyState: Map<KeyCode, boolean> = new Map();

    onLoad() {
        // 注册键盘事件（兼容开发环境 WASD）
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private onKeyDown(event: EventKeyboard) {
        this._keyState.set(event.keyCode, true);
    }

    private onKeyUp(event: EventKeyboard) {
        this._keyState.set(event.keyCode, false);
    }

    update(dt: number) {
        this.updateMoveDir();
        
        if (this._moveDir.length() > 0) {
            // 归一化向量，防止斜向移动过快
            this._moveDir.normalize();
            
            // 计算位移：方向 * 速度 * 每帧时间
            const displacement = this._moveDir.clone().multiplyScalar(this.speed * dt);
            const newPos = this.node.position.clone().add(displacement);
            
            this.node.setPosition(newPos);

            // 可选：让角色朝向移动方向
            // let angle = Math.atan2(this._moveDir.y, this._moveDir.x) * 180 / Math.PI;
            // this.node.angle = angle - 90; // 假设初始朝上
        }
    }

    private updateMoveDir() {
        let x = 0;
        let y = 0;

        if (this._keyState.get(KeyCode.KEY_W)) y += 1;
        if (this._keyState.get(KeyCode.KEY_S)) y -= 1;
        if (this._keyState.get(KeyCode.KEY_A)) x -= 1;
        if (this._keyState.get(KeyCode.KEY_D)) x += 1;

        this._moveDir.set(x, y, 0);
    }
}