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
const { ccclass, property } = _decorator;

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

    private readonly _enemyPool: NodePool = new NodePool();
    private readonly _activeEnemies: Node[] = [];
    private readonly _sceneEnemies: Node[] = [];
    private readonly _spawnCenter: Vec3 = v3();
    private readonly _spawnWorldPos: Vec3 = v3();
    private _generateCallCount: number = 0;

    // 启用时初始化玩家并启动定时生成。
    onEnable() {
        this.resolvePlayer();
        this.syncActiveEnemiesFromScene();
        this.unschedule(this.generate);
        this.schedule(this.generate, Math.max(0.1, this.spawnIntervalSeconds));
        this.generate();
    }

    // 禁用时停止定时生成。
    onDisable() {
        this.unschedule(this.generate);
    }

    // 执行一次生成检查并在未达上限时创建敌人。
    public generate() {
        this.resolvePlayer();
        this.compactActiveEnemies();
        this._generateCallCount++;
        if (this.shouldSyncSceneEnemies()) {
            this.syncActiveEnemiesFromScene();
        }

        const maxCount = Math.max(1, Math.floor(this.maxEnemyCount));
        if (this._activeEnemies.length >= maxCount) {
            return;
        }

        this.spawnEnemy();
    }

    // 从对象池或预制体创建并初始化一个敌人实例。
    public spawnEnemy() {
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

        this.configureEnemy(enemyNode);

        if (this._activeEnemies.indexOf(enemyNode) < 0) {
            this._activeEnemies.push(enemyNode);
        }
    }

    // 回收敌人节点并从活动列表中移除。
    public recycleEnemy(enemyNode: Node) {
        const index = this._activeEnemies.indexOf(enemyNode);
        if (index >= 0) {
            this._activeEnemies.splice(index, 1);
        }

        this.clearEnemyTarget(enemyNode);

        enemyNode.active = false;
        this._enemyPool.put(enemyNode);
    }

    // 清理活动列表中已失效的节点引用。
    private compactActiveEnemies() {
        for (let i = this._activeEnemies.length - 1; i >= 0; i--) {
            const node = this._activeEnemies[i];
            if (!node || !node.isValid) {
                this._activeEnemies.splice(i, 1);
            }
        }
    }

    // 低频触发全量同步，避免计数因外部销毁而漂移。
    private shouldSyncSceneEnemies(): boolean {
        const syncEveryCalls = Math.max(1, Math.ceil(30 / Math.max(0.1, this.spawnIntervalSeconds)));
        return this._generateCallCount % syncEveryCalls === 0;
    }

    // 使用场景扫描结果校准活动敌人列表。
    private syncActiveEnemiesFromScene() {
        const sceneEnemies = this.collectSceneEnemies();
        this._activeEnemies.length = 0;
        for (const enemy of sceneEnemies) {
            this._activeEnemies.push(enemy);
        }
    }

    // 配置单个敌人的目标与移动参数。
    private configureEnemy(enemyNode: Node) {
        const enemyComp = enemyNode.getComponent(Enemy);
        if (!enemyComp) {
            return;
        }

        enemyComp.target = this.player;
        enemyComp.moveSpeed = Math.max(0, this.moveSpeed);
        enemyComp.stopDistance = Math.max(0, this.stopDistance);
    }

    // 清空单个敌人的目标引用。
    private clearEnemyTarget(enemyNode: Node) {
        const enemyComp = enemyNode.getComponent(Enemy);
        if (!enemyComp) {
            return;
        }
        enemyComp.target = null;
    }

    // 在未绑定玩家时自动查找名为 Player 的节点。
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

    // 解析敌人生成父节点并提供安全回退。
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

    // 计算敌人在玩家周围的随机出生世界坐标。
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

    // 收集当前场景中符合条件的敌人节点。
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

    // 判断节点是否应计入敌人统计。
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

    // 递归按名称查找节点。
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

    // 深度优先遍历节点树并执行访问回调。
    private walkTree(root: Node, visitor: (node: Node) => void) {
        visitor(root);
        for (const child of root.children) {
            this.walkTree(child, visitor);
        }
    }

}
