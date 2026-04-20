import {
    _decorator,
    Component,
    EventKeyboard,
    input,
    Input,
    instantiate,
    KeyCode,
    Prefab,
} from 'cc';
const { ccclass, property } = _decorator;

@ccclass('PlayerSkillCaster')
export class PlayerSkillCaster extends Component {
    private static readonly SKILL_LIFETIME_SECONDS = 180;

    @property({ type: Prefab, tooltip: 'Spawn prefab when pressing J.' })
    public skillPrefab: Prefab | null = null;

    private _isSkillKeyPressed: boolean = false;

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        this._isSkillKeyPressed = false;
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode !== KeyCode.KEY_J) {
            return;
        }

        if (this._isSkillKeyPressed) {
            return;
        }

        this._isSkillKeyPressed = true;
        this.castSkill();
    }

    private onKeyUp(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_J) {
            this._isSkillKeyPressed = false;
        }
    }

    private castSkill() {
        if (!this.skillPrefab) {
            console.warn('[PlayerSkillCaster] skillPrefab is not assigned.');
            return;
        }

        const parent = this.node.parent;
        if (!parent) {
            console.warn('[PlayerSkillCaster] Current node has no parent.');
            return;
        }

        const skillInstance = instantiate(this.skillPrefab);
        skillInstance.setPosition(this.node.position);
        parent.addChild(skillInstance);

        this.scheduleOnce(() => {
            if (skillInstance.isValid) {
                skillInstance.destroy();
            }
        }, PlayerSkillCaster.SKILL_LIFETIME_SECONDS);
    }
}
