import { _decorator, Component, EventKeyboard, input, Input, instantiate, KeyCode, Prefab } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Skill')
export class Skill extends Component {

    @property({ type: Prefab, tooltip: '按下 J 键生成的预制体（拖拽 assets/Prefab/Shit.prefab）' })
    public skillPrefab: Prefab | null = null;

    private _isJPressed: boolean = false;

    onLoad() {
        // 注册键盘事件（按下 J 释放技能）
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode !== KeyCode.KEY_J) {
            return;
        }

        // 防止长按触发重复生成
        if (this._isJPressed) {
            return;
        }

        this._isJPressed = true;
        this.castSkill();
    }

    private onKeyUp(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_J) {
            this._isJPressed = false;
        }
    }

    private castSkill() {
        if (!this.skillPrefab) {
            console.warn('[Skill] 未绑定 skillPrefab，请拖拽 Prefab/Shit.prefab');
            return;
        }

        const parent = this.node.parent;
        if (!parent) {
            console.warn('[Skill] 当前节点没有父节点，无法确定生成层级');
            return;
        }

        const skillNode = instantiate(this.skillPrefab);
        skillNode.setPosition(this.node.position);
        parent.addChild(skillNode);
    }
}
