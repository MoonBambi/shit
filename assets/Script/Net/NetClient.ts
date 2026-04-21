import { _decorator, Component, instantiate, Node, Prefab, Vec3, v3 } from 'cc';
import { FoodRegistry } from '../Skill/Food/FoodRegistry';
const { ccclass, property } = _decorator;

export interface NetPlayerState {
    x: number;
    y: number;
    z: number;
    dx: number;
    dy: number;
    ts: number;
}

export interface EnemyNetState {
    id: string;
    x: number;
    y: number;
    z: number;
}

export interface SkillCastNetState {
    castId: string;
    skillType: string;
    x: number;
    y: number;
    z: number;
    ttl: number;
    ts: number;
}

const NET_SKILL_CAST_ID_KEY = '__netSkillCastId';
type SkillNodeWithCastId = Node & { __netSkillCastId?: string };

type EnemySnapshotListener = (states: EnemyNetState[]) => void;
type NetPayload = {
    t?: unknown;
    [key: string]: unknown;
};

@ccclass('NetClient')
export class NetClient extends Component {
    private static _instance: NetClient | null = null;

    @property({ tooltip: 'WebSocket server URL.' })
    public serverUrl: string = 'ws://127.0.0.1:8080';

    @property({ tooltip: 'Room id.' })
    public roomId: string = 'default';

    @property({ tooltip: 'Connect automatically on enable.' })
    public autoConnect: boolean = true;

    @property({ tooltip: 'Reconnect automatically after unexpected disconnect.' })
    public autoReconnect: boolean = true;

    @property({ tooltip: 'Reconnect delay in milliseconds.' })
    public reconnectDelayMs: number = 1500;

    @property({ type: Node, tooltip: 'Remote player node to visualize peer movement.' })
    public remotePlayer: Node | null = null;

    @property({ tooltip: 'Upload interval in milliseconds.' })
    public sendIntervalMs: number = 50;

    @property({ tooltip: 'Interpolation speed for remote player.' })
    public interpolationSpeed: number = 12;

    @property({ type: Prefab, tooltip: 'Remote excretion skill prefab.' })
    public remoteExcretionPrefab: Prefab | null = null;

    @property({
        type: Node,
        tooltip: 'Parent for remote skill instances. Fallback to remote player parent.',
    })
    public remoteSkillParent: Node | null = null;

    @property({ tooltip: 'Fallback TTL seconds for remote skill instances.' })
    public remoteSkillFallbackTtlSeconds: number = 180;

    @property({ tooltip: 'Enable debug logs in NetClient.update().' })
    public debugUpdateLog: boolean = false;

    @property({ tooltip: 'Interval seconds for update debug logs.' })
    public debugUpdateLogIntervalSeconds: number = 0.5;

    private _socket: WebSocket | null = null;
    private _isConnected: boolean = false;
    private _playerId: string = '';
    private _remotePlayerId: string = '';
    private _isHost: boolean = false;
    private _gameStarted: boolean = false;
    private _lastSentMs: number = 0;
    private _skillCastSeq: number = 0;
    private _reconnectScheduled: boolean = false;
    private _debugUpdateLogCooldown: number = 0;

    private readonly _remoteTargetPos: Vec3 = v3();
    private readonly _remoteVisualPos: Vec3 = v3();
    private _remoteHasState: boolean = false;

    private readonly _enemySnapshotListeners: EnemySnapshotListener[] = [];
    private readonly _seenCastIds: Map<string, number> = new Map();
    private readonly _skillNodesByCastId: Map<string, Node> = new Map();
    private readonly _reconnectTask = () => {
        this._reconnectScheduled = false;
        if (!this.isValid || !this.enabledInHierarchy || !this.autoConnect) {
            return;
        }
        this.connect();
    };

    onLoad() {
        NetClient._instance = this;
    }

    onEnable() {
        if (this.autoConnect) {
            this.connect();
        }
    }

    onDisable() {
        this.disconnect();
    }

    onDestroy() {
        if (NetClient._instance === this) {
            NetClient._instance = null;
        }
        this.disconnect();
        this._enemySnapshotListeners.length = 0;
        this._seenCastIds.clear();
        this._skillNodesByCastId.clear();
        this.cancelReconnect();
    }

    update(dt: number) {
        if (this.debugUpdateLog) {
            this._debugUpdateLogCooldown = Math.max(0, this._debugUpdateLogCooldown - dt);
            if (this._debugUpdateLogCooldown <= 0) {
                this._debugUpdateLogCooldown = Math.max(0.05, this.debugUpdateLogIntervalSeconds);
                console.log(
                    `[NetClient:update] dt=${dt.toFixed(4)} connected=${this._isConnected} hasRemote=${this._remoteHasState}`,
                );
            }
        }

        if (!this._remoteHasState || !this.remotePlayer || !this.remotePlayer.isValid) {
            return;
        }

        this.remotePlayer.getWorldPosition(this._remoteVisualPos);
        const lerpFactor = Math.min(1, Math.max(0, dt * this.interpolationSpeed));
        Vec3.lerp(this._remoteVisualPos, this._remoteVisualPos, this._remoteTargetPos, lerpFactor);
        this.remotePlayer.setWorldPosition(this._remoteVisualPos);
    }

    public static getInstance(): NetClient | null {
        if (!this._instance || !this._instance.isValid) {
            return null;
        }
        return this._instance;
    }

    public connect() {
        if (this._socket) {
            return;
        }
        if (typeof WebSocket === 'undefined') {
            console.warn('[NetClient] WebSocket API is unavailable in this runtime.');
            return;
        }

        this.cancelReconnect();
        this._socket = new WebSocket(this.serverUrl);

        this._socket.onopen = () => {
            this._isConnected = true;
            this.cancelReconnect();
            this.sendRaw({ t: 'join', roomId: this.roomId });
        };

        this._socket.onmessage = (event) => {
            void this.handleMessage(event.data);
        };

        this._socket.onclose = () => {
            this.resetConnectionState();
            this.scheduleReconnect();
        };

        this._socket.onerror = () => {
            this.resetConnectionState();
            this.scheduleReconnect();
        };
    }

    public disconnect() {
        if (!this._socket) {
            this.resetConnectionState();
            return;
        }

        try {
            this._socket.onopen = null;
            this._socket.onmessage = null;
            this._socket.onclose = null;
            this._socket.onerror = null;
            this._socket.close();
        } catch (_error) {
            // Ignore close errors.
        }

        this._socket = null;
        this.resetConnectionState();
        this.cancelReconnect();
    }

    public isConnected(): boolean {
        return this._isConnected;
    }

    public isHost(): boolean {
        return this._isHost;
    }

    public isGameStarted(): boolean {
        return this._gameStarted;
    }

    public getPlayerId(): string {
        return this._playerId;
    }

    public sendLocalPlayerState(worldPos: Vec3, moveDirection: Vec3) {
        if (!this._isConnected || !this._socket) {
            return;
        }

        const now = Date.now();
        const interval = Math.max(1, Math.floor(this.sendIntervalMs));
        if (now - this._lastSentMs < interval) {
            return;
        }
        this._lastSentMs = now;

        const state: NetPlayerState = {
            x: worldPos.x,
            y: worldPos.y,
            z: worldPos.z,
            dx: moveDirection.x,
            dy: moveDirection.y,
            ts: now,
        };

        this.sendRaw({ t: 'state', state });
    }

    public sendEnemySnapshot(states: EnemyNetState[]) {
        if (!this._isConnected || !this._socket || !this._isHost) {
            return;
        }

        this.sendRaw({
            t: 'enemy_snapshot',
            enemies: states,
        });
    }

    public sendSkillCast(skillType: string, worldPos: Vec3, ttlSeconds: number): string {
        if (!this._isConnected || !this._socket) {
            return '';
        }

        const now = Date.now();
        this._skillCastSeq++;
        const castId = `${this._playerId || 'p'}-${now}-${this._skillCastSeq}`;
        const ttl = Math.max(0.1, Math.min(600, ttlSeconds));

        const cast: SkillCastNetState = {
            castId,
            skillType,
            x: worldPos.x,
            y: worldPos.y,
            z: worldPos.z,
            ttl,
            ts: now,
        };

        this.sendRaw({ t: 'skill_cast', cast });
        return castId;
    }

    public sendSkillDestroy(castId: string) {
        if (!this._isConnected || !this._socket) {
            return;
        }
        const normalizedId = String(castId || '');
        if (!normalizedId) {
            return;
        }
        this.sendRaw({
            t: 'skill_destroy',
            castId: normalizedId,
        });
    }

    public sendFoodDestroy(foodId: string) {
        if (!this._isConnected || !this._socket) {
            return;
        }
        const normalizedId = String(foodId || '');
        if (!normalizedId) {
            return;
        }
        this.sendRaw({
            t: 'food_destroy',
            foodId: normalizedId,
        });
    }

    public registerSkillNode(castId: string, node: Node) {
        const normalizedId = String(castId || '');
        if (!normalizedId || !node || !node.isValid) {
            return;
        }
        this._skillNodesByCastId.set(normalizedId, node);
    }

    public unregisterSkillNode(castId: string) {
        const normalizedId = String(castId || '');
        if (!normalizedId) {
            return;
        }
        this._skillNodesByCastId.delete(normalizedId);
    }

    public static setSkillCastId(node: Node, castId: string) {
        const skillNode = node as SkillNodeWithCastId;
        skillNode[NET_SKILL_CAST_ID_KEY] = castId;
    }

    public static getSkillCastId(node: Node): string {
        const skillNode = node as SkillNodeWithCastId;
        return String(skillNode[NET_SKILL_CAST_ID_KEY] || '');
    }

    public onEnemySnapshot(listener: EnemySnapshotListener) {
        if (this._enemySnapshotListeners.includes(listener)) {
            return;
        }
        this._enemySnapshotListeners.push(listener);
    }

    public offEnemySnapshot(listener: EnemySnapshotListener) {
        const index = this._enemySnapshotListeners.indexOf(listener);
        if (index >= 0) {
            this._enemySnapshotListeners.splice(index, 1);
        }
    }

    private async handleMessage(rawData: string | ArrayBuffer | Blob) {
        const text = await this.decodeMessageText(rawData);
        if (!text) {
            return;
        }

        let payload: unknown = null;
        try {
            payload = JSON.parse(text);
        } catch (_error) {
            return;
        }

        if (!payload || typeof payload !== 'object') {
            return;
        }

        const message = payload as NetPayload;

        switch (message.t) {
            case 'join':
                this._playerId = String(message.playerId || '');
                this._isHost = !!message.isHost;
                this._remotePlayerId = '';
                this._remoteHasState = false;
                this._gameStarted = false;
                break;
            case 'role':
                this._isHost = !!message.isHost;
                break;
            case 'peer_joined':
                this._remotePlayerId = String(message.playerId || '');
                this._remoteHasState = false;
                break;
            case 'match_ready':
                this._gameStarted = true;
                break;
            case 'leave':
                if (String(message.playerId || '') === this._remotePlayerId) {
                    this._remotePlayerId = '';
                    this._remoteHasState = false;
                    this._gameStarted = false;
                }
                break;
            case 'peer_state':
                this.applyPeerState(message);
                break;
            case 'enemy_snapshot':
                this.notifyEnemySnapshot(message.enemies);
                break;
            case 'peer_skill_cast':
                this.applyPeerSkillCast(message);
                break;
            case 'peer_skill_destroy':
                this.applyPeerSkillDestroy(message);
                break;
            case 'peer_food_destroy':
                this.applyPeerFoodDestroy(message);
                break;
            case 'error':
                console.warn(
                    `[NetClient] ${String(message.code || 'error')}: ${String(message.message || '')}`,
                );
                break;
            default:
                break;
        }
    }

    private async decodeMessageText(rawData: string | ArrayBuffer | Blob): Promise<string> {
        if (typeof rawData === 'string') {
            return rawData;
        }

        if (rawData instanceof ArrayBuffer) {
            return this.decodeArrayBuffer(rawData);
        }

        if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
            try {
                return await rawData.text();
            } catch (_error) {
                return '';
            }
        }

        return '';
    }

    private decodeArrayBuffer(buffer: ArrayBuffer): string {
        try {
            if (typeof TextDecoder !== 'undefined') {
                return new TextDecoder().decode(new Uint8Array(buffer));
            }
        } catch (_error) {
            // Fallback below.
        }

        const bytes = new Uint8Array(buffer);
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            result += String.fromCharCode(bytes[i]);
        }
        return result;
    }

    private applyPeerState(payload: NetPayload) {
        const peerId = String(payload.playerId || '');
        if (!peerId || peerId === this._playerId) {
            return;
        }
        if (this._remotePlayerId && peerId !== this._remotePlayerId) {
            return;
        }

        const state = payload.state as Partial<NetPlayerState> | undefined;
        if (!state || typeof state !== 'object') {
            return;
        }

        this._remoteTargetPos.set(Number(state.x) || 0, Number(state.y) || 0, Number(state.z) || 0);
        this._remoteHasState = true;
    }

    private notifyEnemySnapshot(rawStates: unknown) {
        if (this._isHost) {
            return;
        }

        const states: EnemyNetState[] = [];
        if (Array.isArray(rawStates)) {
            for (const item of rawStates) {
                if (!item || typeof item !== 'object') {
                    continue;
                }
                const state = item as Record<string, unknown>;
                states.push({
                    id: String(state.id || ''),
                    x: Number(state.x) || 0,
                    y: Number(state.y) || 0,
                    z: Number(state.z) || 0,
                });
            }
        }

        for (const listener of this._enemySnapshotListeners) {
            listener(states);
        }
    }

    private applyPeerSkillCast(payload: NetPayload) {
        const peerId = String(payload.playerId || '');
        if (!peerId || peerId === this._playerId) {
            return;
        }
        if (this._remotePlayerId && peerId !== this._remotePlayerId) {
            return;
        }

        const cast = payload.cast as Partial<SkillCastNetState> | undefined;
        if (!cast || typeof cast !== 'object') {
            return;
        }

        const castId = String(cast.castId || '');
        const skillType = String(cast.skillType || '');
        if (!castId || !skillType) {
            return;
        }

        const now = Date.now();
        this.cleanupSeenCasts(now);
        if (this._seenCastIds.has(castId)) {
            return;
        }

        const ttlSeconds = Math.max(
            0.1,
            Math.min(600, Number(cast.ttl) || this.remoteSkillFallbackTtlSeconds),
        );
        this._seenCastIds.set(castId, now + ttlSeconds * 1000 + 3000);

        this.spawnRemoteSkill(
            castId,
            skillType,
            Number(cast.x) || 0,
            Number(cast.y) || 0,
            Number(cast.z) || 0,
            ttlSeconds,
        );
    }

    private spawnRemoteSkill(
        castId: string,
        skillType: string,
        x: number,
        y: number,
        z: number,
        ttlSeconds: number,
    ) {
        let prefab: Prefab | null = null;
        if (skillType === 'excretion') {
            prefab = this.remoteExcretionPrefab;
        }

        if (!prefab) {
            return;
        }

        const parent = this.resolveRemoteSkillParent();
        if (!parent) {
            return;
        }

        const skillNode = instantiate(prefab);
        parent.addChild(skillNode);
        skillNode.setWorldPosition(x, y, z);
        NetClient.setSkillCastId(skillNode, castId);
        this.registerSkillNode(castId, skillNode);

        this.scheduleOnce(() => {
            if (skillNode.isValid) {
                skillNode.destroy();
            }
            this.unregisterSkillNode(castId);
        }, ttlSeconds);
    }

    private applyPeerSkillDestroy(payload: NetPayload) {
        const peerId = String(payload.playerId || '');
        if (!peerId || peerId === this._playerId) {
            return;
        }
        if (this._remotePlayerId && peerId !== this._remotePlayerId) {
            return;
        }

        const castId = String(payload.castId || '');
        if (!castId) {
            return;
        }

        const skillNode = this._skillNodesByCastId.get(castId);
        if (!skillNode) {
            return;
        }

        this.unregisterSkillNode(castId);
        if (skillNode.isValid) {
            skillNode.destroy();
        }
    }

    private applyPeerFoodDestroy(payload: NetPayload) {
        const peerId = String(payload.playerId || '');
        if (!peerId || peerId === this._playerId) {
            return;
        }
        if (this._remotePlayerId && peerId !== this._remotePlayerId) {
            return;
        }

        const foodId = String(payload.foodId || '');
        if (!foodId) {
            return;
        }

        const foodNode = FoodRegistry.getFoodById(foodId);
        if (!foodNode || !foodNode.isValid) {
            return;
        }
        foodNode.destroy();
    }

    private resolveRemoteSkillParent(): Node | null {
        if (this.remoteSkillParent && this.remoteSkillParent.isValid) {
            return this.remoteSkillParent;
        }
        if (this.remotePlayer && this.remotePlayer.isValid && this.remotePlayer.parent) {
            return this.remotePlayer.parent;
        }
        if (this.node && this.node.isValid) {
            return this.node;
        }
        return null;
    }

    private cleanupSeenCasts(nowMs: number) {
        for (const [castId, expiresAt] of this._seenCastIds) {
            if (expiresAt <= nowMs) {
                this._seenCastIds.delete(castId);
            }
        }
    }

    private sendRaw(payload: object) {
        if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this._socket.send(JSON.stringify(payload));
    }

    private resetConnectionState() {
        this._socket = null;
        this._isConnected = false;
        this._isHost = false;
        this._playerId = '';
        this._remotePlayerId = '';
        this._remoteHasState = false;
        this._gameStarted = false;
        this._skillNodesByCastId.clear();
    }

    private scheduleReconnect() {
        if (!this.autoReconnect || this._reconnectScheduled) {
            return;
        }
        if (!this.isValid || !this.enabledInHierarchy || !this.autoConnect) {
            return;
        }
        const delaySeconds = Math.max(0.1, Math.floor(this.reconnectDelayMs) / 1000);
        this._reconnectScheduled = true;
        this.scheduleOnce(this._reconnectTask, delaySeconds);
    }

    private cancelReconnect() {
        if (!this._reconnectScheduled) {
            return;
        }
        this.unschedule(this._reconnectTask);
        this._reconnectScheduled = false;
    }
}
