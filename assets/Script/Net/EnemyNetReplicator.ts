import { _decorator, Component, Node, Vec3 } from 'cc';
import { EnemySystem } from '../EnemySystem';
import { EnemyNetState, NetClient } from './NetClient';
const { ccclass, property } = _decorator;

@ccclass('EnemyNetReplicator')
export class EnemyNetReplicator extends Component {
    @property({ type: EnemySystem, tooltip: '需要复制同步的敌人系统组件。' })
    public enemySystem: EnemySystem | null = null;

    private readonly _snapshotBuffer: EnemyNetState[] = [];
    private readonly _replicatedEnemies: Map<string, Node> = new Map();
    private readonly _replicatedTargetPos: Map<string, Vec3> = new Map();
    private readonly _enemyVisualPos: Vec3 = new Vec3();

    private _netClient: NetClient | null = null;
    private _runtimeAuthority: boolean = false;
    private _snapshotListenerAttached: boolean = false;

    private readonly _onEnemySnapshot = (states: EnemyNetState[]) => {
        this.applyEnemySnapshot(states);
    };

    onEnable() {
        this.bindEnemySystem();
        this._netClient = NetClient.getInstance();
        if (this.enemySystem) {
            this.enemySystem.applyLogicToActiveEnemies(this.isAuthoritative());
        }
        this.refreshNetworkMode(true);
    }

    onDisable() {
        this.unschedule(this.tickGenerate);
        this.unschedule(this.syncEnemySnapshot);
        this.detachSnapshotListener();
    }

    onDestroy() {
        this.onDisable();
        this._snapshotBuffer.length = 0;
        this._replicatedEnemies.clear();
        this._replicatedTargetPos.clear();
    }

    update(dt: number) {
        this.bindEnemySystem();
        if (!this.enemySystem) {
            return;
        }

        const latestNet = NetClient.getInstance();
        if (latestNet !== this._netClient) {
            this.detachSnapshotListener();
            this._netClient = latestNet;
            this.refreshNetworkMode(true);
            return;
        }

        const authority = this.isAuthoritative();
        if (authority !== this._runtimeAuthority) {
            this.refreshNetworkMode(true);
            return;
        }

        if (!authority) {
            this.updateReplicaEnemyVisuals(dt);
            if (!this._snapshotListenerAttached && this._netClient) {
                this.attachSnapshotListener();
            }
        }
    }

    public isAuthoritative(): boolean {
        const system = this.enemySystem;
        if (!system) {
            return false;
        }
        const net = this._netClient || NetClient.getInstance();
        if (!net || !net.isConnected()) {
            return system.isNetworkAuthority;
        }
        if (!net.isGameStarted()) {
            return false;
        }
        return system.isNetworkAuthority && net.isHost();
    }

    private bindEnemySystem() {
        if (!this.enemySystem || !this.enemySystem.isValid) {
            this.enemySystem = this.getComponent(EnemySystem);
        }
    }

    private refreshNetworkMode(force: boolean = false) {
        const system = this.enemySystem;
        if (!system) {
            return;
        }

        const authority = this.isAuthoritative();
        const previousAuthority = this._runtimeAuthority;
        if (!force && authority === this._runtimeAuthority) {
            return;
        }
        this._runtimeAuthority = authority;

        system.applyLogicToActiveEnemies(authority);
        this.unschedule(this.tickGenerate);
        this.unschedule(this.syncEnemySnapshot);

        if (authority) {
            this.detachSnapshotListener();
            this.schedule(this.tickGenerate, Math.max(0.1, system.spawnIntervalSeconds));
            this.schedule(this.syncEnemySnapshot, Math.max(0.05, system.enemySyncIntervalSeconds));
            this.tickGenerate();
            return;
        }

        if (previousAuthority || force) {
            this.clearReplicaMaps();
            system.cleanupForReplicaMode();
        }
        this.attachSnapshotListener();
    }

    private tickGenerate() {
        if (!this.isAuthoritative() || !this.enemySystem) {
            return;
        }
        this.enemySystem.generate();
    }

    private attachSnapshotListener() {
        if (!this._netClient || this._snapshotListenerAttached) {
            return;
        }
        this._netClient.onEnemySnapshot(this._onEnemySnapshot);
        this._snapshotListenerAttached = true;
    }

    private detachSnapshotListener() {
        if (!this._snapshotListenerAttached) {
            return;
        }
        if (this._netClient) {
            this._netClient.offEnemySnapshot(this._onEnemySnapshot);
        }
        this._snapshotListenerAttached = false;
    }

    private syncEnemySnapshot() {
        const system = this.enemySystem;
        if (!system || !this.isAuthoritative()) {
            return;
        }

        const net = this._netClient || NetClient.getInstance();
        if (!net || !net.isConnected() || !net.isHost()) {
            return;
        }

        system.compactActiveEnemies();
        this._snapshotBuffer.length = 0;

        for (const enemy of system.getActiveEnemies()) {
            if (!enemy || !enemy.isValid || !enemy.activeInHierarchy) {
                continue;
            }

            const enemyId = system.ensureEnemyNetId(enemy);
            enemy.getWorldPosition(this._enemyVisualPos);
            this._snapshotBuffer.push({
                id: enemyId,
                x: this._enemyVisualPos.x,
                y: this._enemyVisualPos.y,
                z: this._enemyVisualPos.z,
            });
        }

        net.sendEnemySnapshot(this._snapshotBuffer);
    }

    private applyEnemySnapshot(states: EnemyNetState[]) {
        const system = this.enemySystem;
        if (!system || this.isAuthoritative()) {
            return;
        }
        if (!system.enemyPrefab) {
            return;
        }

        const parent = system.resolveSpawnParent();
        if (!parent) {
            return;
        }

        const validIds = new Set<string>();
        for (const state of states) {
            const id = String(state.id || '');
            if (!id) {
                continue;
            }
            validIds.add(id);

            let enemyNode = this._replicatedEnemies.get(id) || null;
            if (!enemyNode || !enemyNode.isValid) {
                enemyNode = system.findActiveEnemyByNetId(id);
                if (enemyNode) {
                    this._replicatedEnemies.set(id, enemyNode);
                }
            }

            if (!enemyNode || !enemyNode.isValid) {
                enemyNode = system.acquireEnemyNode(parent);
                if (!enemyNode) {
                    continue;
                }
                system.setEnemyNetId(enemyNode, id);
                system.configureEnemy(enemyNode, false);
                system.registerActiveEnemy(enemyNode);
                this._replicatedEnemies.set(id, enemyNode);
                enemyNode.setWorldPosition(state.x, state.y, state.z);
            }

            const targetPos = this._replicatedTargetPos.get(id) || new Vec3();
            targetPos.set(state.x, state.y, state.z);
            this._replicatedTargetPos.set(id, targetPos);
        }

        for (const [id, enemyNode] of this._replicatedEnemies) {
            if (!validIds.has(id)) {
                this._replicatedEnemies.delete(id);
                this._replicatedTargetPos.delete(id);
                system.recycleEnemy(enemyNode);
            }
        }
    }

    private updateReplicaEnemyVisuals(dt: number) {
        if (dt <= 0 || !this.enemySystem) {
            return;
        }
        const interpolation = Math.min(
            1,
            Math.max(0, dt * Math.max(0.1, this.enemySystem.enemyInterpolationSpeed)),
        );
        for (const [id, enemyNode] of this._replicatedEnemies) {
            if (!enemyNode || !enemyNode.isValid || !enemyNode.activeInHierarchy) {
                continue;
            }
            const targetPos = this._replicatedTargetPos.get(id);
            if (!targetPos) {
                continue;
            }

            enemyNode.getWorldPosition(this._enemyVisualPos);
            Vec3.lerp(this._enemyVisualPos, this._enemyVisualPos, targetPos, interpolation);
            enemyNode.setWorldPosition(this._enemyVisualPos);
        }
    }

    private clearReplicaMaps() {
        this._replicatedEnemies.clear();
        this._replicatedTargetPos.clear();
    }
}
