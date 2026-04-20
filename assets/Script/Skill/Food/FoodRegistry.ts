import { _decorator, Component, director, Node } from 'cc';
const { ccclass } = _decorator;

@ccclass('FoodRegistry')
export class FoodRegistry extends Component {
    private static _instance: FoodRegistry | null = null;
    private readonly _foods: Set<Node> = new Set<Node>();

    // 初始化并记录场景中的唯一注册表实例。
    onLoad() {
        FoodRegistry._instance = this;
    }

    // 销毁时清理实例与缓存数据。
    onDestroy() {
        if (FoodRegistry._instance === this) {
            FoodRegistry._instance = null;
        }
        this._foods.clear();
    }

    // 注册一个可被敌人检索的食物节点。
    public static register(food: Node) {
        if (!food || !food.isValid) {
            return;
        }
        const registry = this.ensureInstance();
        if (!registry) {
            return;
        }
        registry._foods.add(food);
    }

    // 注销一个食物节点。
    public static unregister(food: Node) {
        const registry = this._instance;
        if (!registry || !food) {
            return;
        }
        registry._foods.delete(food);
    }

    // 获取当前有效食物列表快照。
    public static getFoods(): Node[] {
        const registry = this._instance;
        if (!registry) {
            return [];
        }
        registry.pruneInvalidFoods();
        return Array.from(registry._foods);
    }

    // 移除已失效的食物节点，防止列表长期累积脏数据。
    private pruneInvalidFoods() {
        for (const food of this._foods) {
            if (!food || !food.isValid || !food.activeInHierarchy) {
                this._foods.delete(food);
            }
        }
    }

    // 确保场景中存在注册表实例，缺失时自动创建。
    private static ensureInstance(): FoodRegistry | null {
        if (this._instance && this._instance.isValid) {
            return this._instance;
        }

        const scene = director.getScene();
        if (!scene) {
            return null;
        }

        let registryNode = scene.getChildByName('FoodRegistry');
        if (!registryNode) {
            registryNode = new Node('FoodRegistry');
            scene.addChild(registryNode);
        }

        const registry = registryNode.getComponent(FoodRegistry) || registryNode.addComponent(FoodRegistry);
        this._instance = registry;
        return registry;
    }
}
