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
import { EnemyNetReplicator } from './Net/EnemyNetReplicator';
import { ChasePlayer } from './Skill/Enemy/ChasePlayer';
import { Eat } from './Skill/Enemy/Eat';
import { Wander } from './Skill/Enemy/Wander';
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

    @property({ tooltip: 'Enemy chase range to player.' })
    public chaseRange: number = 260;

    @property({ tooltip: 'Enemy wander speed when no player in chase range.' })
    public wanderMoveSpeed: number = 80;

    @property({ tooltip: 'Enemy wander stop distance.' })
    public wanderStopDistance: number = 6;

    @property({ tooltip: 'Enemy wander rectangle width from world-origin lower-left.' })
    public wanderWidth: number = 800;

    @property({ tooltip: 'Enemy wander rectangle height from world-origin lower-left.' })
    public wanderHeight: number = 600;

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
    private _generateCallCount: number = 0;
    private _enemyIdCounter: number = 1;

    onEnable() {
        this.resolvePlayer();
        this.syncActiveEnemiesFromScene();
        this.applyLogicToActiveEnemies(this.canSimulateAi());
        if (!this.hasNetReplicator()) {
            this.schedule(this.generate, Math.max(0.1, this.spawnIntervalSeconds));
            this.generate();
        }
    }

    onDisable() {
        this.unschedule(this.generate);
    }

    onDestroy() {
        this.unschedule(this.generate);
        this._activeEnemies.length = 0;
        this._sceneEnemies.length = 0;
        this._enemyPool.clear();
    }

    public generate() {
        if (!this.canSimulateAi()) {
            return;
        }

        this.resolvePlayer();
        this.compactActiveEnemies();
        this._generateCallCount++;
        if (this.shouldSyncSceneEnemies()) {
            this.syncActiveEnemiesFromScene();
            this.applyLogicToActiveEnemies(this.canSimulateAi());
        }

        const maxCount = Math.max(1, Math.floor(this.maxEnemyCount));
        if (this._activeEnemies.length >= maxCount) {
            return;
        }

        this.spawnEnemy();
    }

    public spawnEnemy() {
        if (!this.canSimulateAi()) {
            return;
        }

        const parent = this.resolveSpawnParent();
        if (!parent) {
            console.warn('[EnemySystem] Missing spawn parent.');
            return;
        }

        const enemyNode = this.acquireEnemyNode(parent);
        if (!enemyNode) {
            return;
        }
        this.computeSpawnWorldPosition(this._spawnWorldPos);
        enemyNode.setWorldPosition(this._spawnWorldPos);

        this.ensureEnemyNetId(enemyNode);
        this.configureEnemy(enemyNode, true);
        this.registerActiveEnemy(enemyNode);
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

    public cleanupForReplicaMode() {
        const allEnemies = this._activeEnemies.slice();
        for (const enemy of allEnemies) {
            if (!enemy || !enemy.isValid) {
                continue;
            }
            this.recycleEnemy(enemy);
        }
        this._activeEnemies.length = 0;
    }

    public compactActiveEnemies() {
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

    public applyLogicToActiveEnemies(enableLogic: boolean) {
        this.resolvePlayer();
        for (const enemy of this._activeEnemies) {
            if (!enemy || !enemy.isValid) {
                continue;
            }
            this.ensureEnemyNetId(enemy);
            this.configureEnemy(enemy, enableLogic);
        }
    }

    public configureEnemy(enemyNode: Node, enableLogic: boolean) {
        const enemyComp = enemyNode.getComponent(Enemy);
        if (!enemyComp) {
            return;
        }

        let chaseComp = enemyNode.getComponent(ChasePlayer);
        if (!chaseComp) {
            chaseComp = enemyNode.addComponent(ChasePlayer);
        }
        let wanderComp = enemyNode.getComponent(Wander);
        if (!wanderComp) {
            wanderComp = enemyNode.addComponent(Wander);
        }

        const eatComp = enemyNode.getComponent(Eat);

        chaseComp.enabled = enableLogic;
        wanderComp.enabled = enableLogic;
        if (eatComp) {
            eatComp.enabled = enableLogic;
        }

        if (enableLogic) {
            chaseComp.target = this.player;
            chaseComp.moveSpeed = Math.max(0, this.moveSpeed);
            chaseComp.stopDistance = Math.max(0, this.stopDistance);
            chaseComp.chaseRange = Math.max(0, this.chaseRange);
            wanderComp.moveSpeed = Math.max(0, this.wanderMoveSpeed);
            wanderComp.stopDistance = Math.max(0, this.wanderStopDistance);
            wanderComp.width = Math.max(0, this.wanderWidth);
            wanderComp.height = Math.max(0, this.wanderHeight);
        } else {
            chaseComp.target = null;
        }
    }

    public acquireEnemyNode(parent: Node): Node | null {
        if (!this.enemyPrefab) {
            console.warn('[EnemySystem] enemyPrefab is not assigned.');
            return null;
        }
        const enemyNode =
            this._enemyPool.size() > 0 ? this._enemyPool.get()! : instantiate(this.enemyPrefab);
        enemyNode.name = this.enemyName;
        enemyNode.setParent(parent);
        enemyNode.active = true;
        return enemyNode;
    }

    public registerActiveEnemy(enemyNode: Node) {
        if (this._activeEnemies.indexOf(enemyNode) < 0) {
            this._activeEnemies.push(enemyNode);
        }
    }

    public getActiveEnemies(): Node[] {
        return this._activeEnemies;
    }

    public canSimulateAi(): boolean {
        const replicator = this.getNetReplicator();
        if (replicator && replicator.enabledInHierarchy) {
            return replicator.isAuthoritative();
        }
        return this.isNetworkAuthority;
    }

    public resolveSpawnParent(): Node | null {
        const scene = director.getScene();
        if (!scene) {
            return this.node && this.node.isValid ? this.node : null;
        }

        if (this.node && this.node.parent && this.node.parent.isValid) {
            return this.node.parent;
        }

        return scene;
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

    public setEnemyNetId(enemyNode: Node, id: string) {
        const netEnemyNode = enemyNode as EnemyNodeWithNetId;
        netEnemyNode[NET_ENEMY_ID_KEY] = id;
    }

    public getEnemyNetId(enemyNode: Node): string {
        const netEnemyNode = enemyNode as EnemyNodeWithNetId;
        return String(netEnemyNode[NET_ENEMY_ID_KEY] || '');
    }

    public ensureEnemyNetId(enemyNode: Node): string {
        const existed = this.getEnemyNetId(enemyNode);
        if (existed) {
            return existed;
        }
        const id = `e-${this._enemyIdCounter++}`;
        this.setEnemyNetId(enemyNode, id);
        return id;
    }

    public findActiveEnemyByNetId(id: string): Node | null {
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

    private hasNetReplicator(): boolean {
        return !!this.getNetReplicator();
    }

    private getNetReplicator(): EnemyNetReplicator | null {
        return this.getComponent(EnemyNetReplicator);
    }
}
