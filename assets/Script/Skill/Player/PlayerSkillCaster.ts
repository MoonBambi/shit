import {
    _decorator,
    Component,
    EventKeyboard,
    input,
    Input,
    instantiate,
    KeyCode,
    Prefab,
    Vec3,
} from 'cc';
import { NetClient } from '../../Net/NetClient';
const { ccclass, property } = _decorator;

@ccclass('PlayerSkillCaster')
export class PlayerSkillCaster extends Component {
    private static readonly EXCRETION_LIFETIME_SECONDS = 180;

    @property({ type: Prefab, tooltip: '按 J 生成排便预制体。' })
    public excretionPrefab: Prefab | null = null;

    private _isExcretionKeyPressed: boolean = false;
    private readonly _castWorldPos: Vec3 = new Vec3();

    onEnable() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDisable() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        this._isExcretionKeyPressed = false;
    }

    private onKeyDown(event: EventKeyboard) {
        if (event.keyCode !== KeyCode.KEY_J) {
            return;
        }

        if (this._isExcretionKeyPressed) {
            return;
        }

        this._isExcretionKeyPressed = true;
        this.castExcretion();
    }

    private onKeyUp(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_J) {
            this._isExcretionKeyPressed = false;
        }
    }

    private castExcretion() {
        if (!this.excretionPrefab) {
            console.warn('[PlayerSkillCaster] excretionPrefab is not assigned.');
            return;
        }

        const parent = this.node.parent;
        if (!parent) {
            console.warn('[PlayerSkillCaster] Current node has no parent.');
            return;
        }

        const netClient = NetClient.getInstance();
        if (netClient && netClient.isConnected() && !netClient.isGameStarted()) {
            return;
        }

        this.node.getWorldPosition(this._castWorldPos);

        const excretionInstance = instantiate(this.excretionPrefab);
        parent.addChild(excretionInstance);
        excretionInstance.setWorldPosition(this._castWorldPos);
        const castId = netClient?.sendSkillCast(
            'excretion',
            this._castWorldPos,
            PlayerSkillCaster.EXCRETION_LIFETIME_SECONDS,
        );
        if (castId) {
            NetClient.setSkillCastId(excretionInstance, castId);
            netClient?.registerSkillNode(castId, excretionInstance);
        }

        this.scheduleOnce(() => {
            if (excretionInstance.isValid) {
                excretionInstance.destroy();
            }
            if (castId) {
                netClient?.unregisterSkillNode(castId);
            }
        }, PlayerSkillCaster.EXCRETION_LIFETIME_SECONDS);
    }
}
