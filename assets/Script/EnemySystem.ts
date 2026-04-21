import {
    _decorator,
    Component,
    director,
    instantiate,
    Node,
    NodePool,
    Prefab,
    randomRange,
    Vec3,
    v3,
} from 'cc';
import { Enemy } from './Enemy';
import { NetClient, EnemyNetState } from './Net/NetClient';
import { ChasePlayer } from './Skill/Enemy/ChasePlayer';
import { Eat } from './Skill/Enemy/Eat';
const { ccclass, property } = _decorator;

const NET_ENEMY_ID_KEY = '__netEnemyId';
type EnemyNodeWithNetId = Node & { __netEnemyId?: string };

@ccclass('EnemySystem')
export class EnemySystem extends Component {
    @property({ type: Prefab, tooltip: 'Enemy prefab to spawn.' })
    public enemyPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: 'Player node target.' })
    public player: Node | null = null;

    @property({ tooltip: 'Enemy node name marker used for scene count detection.' })
    public enemyName: string = 'Enemy';

    @property({ tooltip: 'Spawn interval (seconds).' })
    public spawnIntervalSeconds: number = 5;

    @property({ tooltip: 'Max active enemies in scene.' })
    public maxEnemyCount: number = 20;

    @property({ tooltip: 'Spawn radius min around player/system.' })
    public spawnMinRadius: number = 180;

    @property({ tooltip: 'Spawn radius max around player/system.' })
    public spawnMaxRadius: number = 420;

    @property({ tooltip: 'Enemy move speed (units per second).' })
    public moveSpeed: number = 120;

    @property({ tooltip: 'Enemy stop distance to target.' })
    public stopDistance: number = 16;

    @property({ tooltip: 'Whether this client can simulate enemy spawn and AI.' })
    public isNetworkAuthority: boolean = true;

    @property({ tooltip: 'Enemy snapshot broadcast interval (seconds).' })
    public enemySyncIntervalSeconds: number = 0.1;

    @property({ tooltip: 'Replica enemy interpolation speed.' })
    public enemyInterpolationSpeed: number = 14;

    private readonly _enemyPool: NodePool = new NodePool();
    private readonly _activeEnemies: Node[] = [];
    private readonly _sceneEnemies: Node[] = [];
    private readonly _spawnCenter: Vec3 = v3();
    private readonly _spawnWorldPos: Vec3 = v3();
    private readonly _enemyVisualPos: Vec3 = v3();
    private readonly _snapshotBuffer: EnemyNetState[] = [];
    private readonly _replicatedEnemies: Map<string, Node> = new Map();
    private readonly _replicatedTargetPos: Map<string, Vec3> = new Map();

    private _netClient: NetClient | null = null;
    private _generateCallCount: number = 0;
    private _enemyIdCounter: number = 1;
    private _runtimeAuthority: boolean = false;
    private _snapshotListenerAttached: boolean = false;

    private readonly _onEnemySnapshot = (states: EnemyNetState[]) => {
        this.applyEnemySnapshot(states);
    };

    onEnable() {
        this._netClient = NetClient.getInstance();
        this.resolvePlayer();
        this.syncActiveEnemiesFromScene();
        this.refreshNetworkMode(true);
    }

    onDisable() {
        this.unschedule(this.generate);
        this.unschedule(this.syncEnemySnapshot);
        this.detachSnapshotListener();
    }

    onDestroy() {
        this.onDisable();
        this._activeEnemies.length = 0;
        this._sceneEnemies.length = 0;
        this._snapshotBuffer.length = 0;
        this._replicatedEnemies.clear();
        this._replicatedTargetPos.clear();
        this._enemyPool.clear();
    }

    update(dt: number) {
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
        }

        if (!authority && !this._snapshotListenerAttached && this._netClient) {
            this.attachSnapshotListener();
        }
    }

    public generate() {
        if (!this.isAuthoritative()) {
            return;
        }

        this.resolvePlayer();
        this.compactActiveEnemies();
        this._generateCallCount++;
        if (this.shouldSyncSceneEnemies()) {
            this.syncActiveEnemiesFromScene();
            this.refreshAllEnemyConfigs();
        }

        const maxCount = Math.max(1, Math.floor(this.maxEnemyCount));
        if (this._activeEnemies.length >= maxCount) {
            return;
        }

        this.spawnEnemy();
    }

    public spawnEnemy() {
        if (!this.isAuthoritative()) {
            return;
        }
        if (!this.enemyPrefab) {
            console.warn('[EnemySystem] enemyPrefab is not assigned.');
            return;
        }

        const parent = this.resolveSpawnParent();
        if (!parent) {
            console.warn('[EnemySystem] Missing spawn parent.');
            return;
        }

        const enemyNode =
            this._enemyPool.size() > 0 ? this._enemyPool.get()! : instantiate(this.enemyPrefab);
        enemyNode.name = this.enemyName;
        enemyNode.setParent(parent);
        this.computeSpawnWorldPosition(this._spawnWorldPos);
        enemyNode.setWorldPosition(this._spawnWorldPos);
        enemyNode.active = true;

        this.ensureEnemyNetId(enemyNode);
        this.configureEnemy(enemyNode, true);

        if (this._activeEnemies.indexOf(enemyNode) < 0) {
            this._activeEnemies.push(enemyNode);
        }
    }

    public recycleEnemy(enemyNode: Node) {
        const index = this._activeEnemies.indexOf(enemyNode);
        if (index >= 0) {
            this._activeEnemies.splice(index, 1);
        }

        this.clearEnemyTarget(enemyNode);
        enemyNode.active = false;
        this._enemyPool.put(enemyNode);
    }

    private isAuthoritative(): boolean {
        const net = this._netClient || NetClient.getInstance();
        if (!net || !net.isConnected()) {
            return this.isNetworkAuthority;
        }
        if (!net.isGameStarted()) {
            return false;
        }
        return this.isNetworkAuthority && net.isHost();
    }

    private refreshNetworkMode(force: boolean = false) {
        const authority = this.isAuthoritative();
        const previousAuthority = this._runtimeAuthority;
        if (!force && authority === this._runtimeAuthority) {
            return;
        }
        this._runtimeAuthority = authority;

        this.resolvePlayer();
        this.refreshAllEnemyConfigs();

        this.unschedule(this.generate);
        this.unschedule(this.syncEnemySnapshot);

        if (authority) {
            this.detachSnapshotListener();
            this.schedule(this.generate, Math.max(0.1, this.spawnIntervalSeconds));
            this.schedule(this.syncEnemySnapshot, Math.max(0.05, this.enemySyncIntervalSeconds));
            this.generate();
            return;
        }

        if (previousAuthority || force) {
            this.cleanupForReplicaMode();
        }
        this.attachSnapshotListener();
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
        if (!this.isAuthoritative()) {
            return;
        }

        const net = this._netClient || NetClient.getInstance();
        if (!net || !net.isConnected() || !net.isHost()) {
            return;
        }

        this.compactActiveEnemies();
        this._snapshotBuffer.length = 0;

        for (const enemy of this._activeEnemies) {
            if (!enemy || !enemy.isValid || !enemy.activeInHierarchy) {
                continue;
            }

            const enemyId = this.ensureEnemyNetId(enemy);
            enemy.getWorldPosition(this._spawnWorldPos);
            this._snapshotBuffer.push({
                id: enemyId,
                x: this._spawnWorldPos.x,
                y: this._spawnWorldPos.y,
                z: this._spawnWorldPos.z,
            });
        }

        net.sendEnemySnapshot(this._snapshotBuffer);
    }

    private applyEnemySnapshot(states: EnemyNetState[]) {
        if (this.isAuthoritative()) {
            return;
        }
        if (!this.enemyPrefab) {
            return;
        }

        const parent = this.resolveSpawnParent();
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
                enemyNode = this.findActiveEnemyByNetId(id);
                if (enemyNode) {
                    this._replicatedEnemies.set(id, enemyNode);
                }
            }
            if (!enemyNode || !enemyNode.isValid) {
                enemyNode =
                    this._enemyPool.size() > 0
                        ? this._enemyPool.get()!
                        : instantiate(this.enemyPrefab);
                enemyNode.name = this.enemyName;
                enemyNode.active = true;
                enemyNode.setParent(parent);
                this.setEnemyNetId(enemyNode, id);
                this.configureEnemy(enemyNode, false);
                this._replicatedEnemies.set(id, enemyNode);
                if (this._activeEnemies.indexOf(enemyNode) < 0) {
                    this._activeEnemies.push(enemyNode);
                }
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
                this.recycleEnemy(enemyNode);
            }
        }
    }

    private cleanupForReplicaMode() {
        const allEnemies = this._activeEnemies.slice();
        this._replicatedEnemies.clear();
        this._replicatedTargetPos.clear();
        for (const enemy of allEnemies) {
            if (!enemy || !enemy.isValid) {
                continue;
            }
            this.recycleEnemy(enemy);
        }
        this._activeEnemies.length = 0;
    }

    private updateReplicaEnemyVisuals(dt: number) {
        if (dt <= 0) {
            return;
        }
        const interpolation = Math.min(
            1,
            Math.max(0, dt * Math.max(0.1, this.enemyInterpolationSpeed)),
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

    private compactActiveEnemies() {
        for (let i = this._activeEnemies.length - 1; i >= 0; i--) {
            const node = this._activeEnemies[i];
            if (!node || !node.isValid) {
                this._activeEnemies.splice(i, 1);
            }
        }
    }

    private shouldSyncSceneEnemies(): boolean {
        const syncEveryCalls = Math.max(
            1,
            Math.ceil(30 / Math.max(0.1, this.spawnIntervalSeconds)),
        );
        return this._generateCallCount % syncEveryCalls === 0;
    }

    private syncActiveEnemiesFromScene() {
        const sceneEnemies = this.collectSceneEnemies();
        this._activeEnemies.length = 0;
        for (const enemy of sceneEnemies) {
            this._activeEnemies.push(enemy);
        }
    }

    private refreshAllEnemyConfigs() {
        for (const enemy of this._activeEnemies) {
            if (!enemy || !enemy.isValid) {
                continue;
            }
            this.ensureEnemyNetId(enemy);
            this.configureEnemy(enemy, this.isAuthoritative());
        }
    }

    private configureEnemy(enemyNode: Node, enableLogic: boolean) {
        const enemyComp = enemyNode.getComponent(Enemy);
        if (!enemyComp) {
            return;
        }

        let chaseComp = enemyNode.getComponent(ChasePlayer);
        if (!chaseComp) {
            chaseComp = enemyNode.addComponent(ChasePlayer);
        }

        const eatComp = enemyNode.getComponent(Eat);

        chaseComp.enabled = enableLogic;
        if (eatComp) {
            eatComp.enabled = enableLogic;
        }

        if (enableLogic) {
            chaseComp.target = this.player;
            chaseComp.moveSpeed = Math.max(0, this.moveSpeed);
            chaseComp.stopDistance = Math.max(0, this.stopDistance);
        } else {
            chaseComp.target = null;
        }
    }

    private clearEnemyTarget(enemyNode: Node) {
        const chaseComp = enemyNode.getComponent(ChasePlayer);
        if (!chaseComp) {
            return;
        }
        chaseComp.target = null;
    }

    private resolvePlayer() {
        if (this.player && this.player.isValid) {
            return;
        }

        const scene = director.getScene();
        if (!scene) {
            return;
        }

        this.player = this.findNodeByName(scene, 'Player');
    }

    private resolveSpawnParent(): Node | null {
        const scene = director.getScene();
        if (!scene) {
            return this.node && this.node.isValid ? this.node : null;
        }

        if (this.node && this.node.parent && this.node.parent.isValid) {
            return this.node.parent;
        }

        return scene;
    }

    private computeSpawnWorldPosition(out: Vec3) {
        const minRadius = Math.max(0, this.spawnMinRadius);
        const maxRadius = Math.max(minRadius, this.spawnMaxRadius);
        const angle = randomRange(0, Math.PI * 2);
        const radius = randomRange(minRadius, maxRadius);

        if (this.player && this.player.isValid) {
            this.player.getWorldPosition(this._spawnCenter);
        } else {
            this.node.getWorldPosition(this._spawnCenter);
        }

        out.set(
            this._spawnCenter.x + Math.cos(angle) * radius,
            this._spawnCenter.y + Math.sin(angle) * radius,
            this._spawnCenter.z,
        );
    }

    private collectSceneEnemies(): Node[] {
        this._sceneEnemies.length = 0;
        const scene = director.getScene();
        if (!scene) {
            return this._sceneEnemies;
        }

        this.walkTree(scene, (node: Node) => {
            if (this.isSceneEnemyNode(node)) {
                this._sceneEnemies.push(node);
            }
        });
        return this._sceneEnemies;
    }

    private isSceneEnemyNode(node: Node): boolean {
        if (!node || !node.isValid || !node.activeInHierarchy) {
            return false;
        }
        if (!node.getComponent(Enemy)) {
            return false;
        }
        if (!this.enemyName) {
            return true;
        }
        return node.name === this.enemyName;
    }

    private findNodeByName(root: Node, targetName: string): Node | null {
        if (root.name === targetName) {
            return root;
        }

        for (const child of root.children) {
            const found = this.findNodeByName(child, targetName);
            if (found) {
                return found;
            }
        }
        return null;
    }

    private walkTree(root: Node, visitor: (node: Node) => void) {
        visitor(root);
        for (const child of root.children) {
            this.walkTree(child, visitor);
        }
    }

    private setEnemyNetId(enemyNode: Node, id: string) {
        const netEnemyNode = enemyNode as EnemyNodeWithNetId;
        netEnemyNode[NET_ENEMY_ID_KEY] = id;
    }

    private getEnemyNetId(enemyNode: Node): string {
        const netEnemyNode = enemyNode as EnemyNodeWithNetId;
        return String(netEnemyNode[NET_ENEMY_ID_KEY] || '');
    }

    private ensureEnemyNetId(enemyNode: Node): string {
        const existed = this.getEnemyNetId(enemyNode);
        if (existed) {
            return existed;
        }
        const id = `e-${this._enemyIdCounter++}`;
        this.setEnemyNetId(enemyNode, id);
        return id;
    }

    private findActiveEnemyByNetId(id: string): Node | null {
        for (const enemy of this._activeEnemies) {
            if (!enemy || !enemy.isValid) {
                continue;
            }
            if (this.getEnemyNetId(enemy) === id) {
                return enemy;
            }
        }
        return null;
    }
}
