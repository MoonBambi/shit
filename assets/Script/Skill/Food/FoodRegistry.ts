import { _decorator, Component, director, Node } from 'cc';
import { FoodItem } from './FoodItem';
const { ccclass } = _decorator;

@ccclass('FoodRegistry')
export class FoodRegistry extends Component {
    private static _instance: FoodRegistry | null = null;
    private readonly _foods: Set<Node> = new Set<Node>();
    private readonly _foodById: Map<string, FoodItem> = new Map();

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
        this._foodById.clear();
    }

    // 注册一个可被敌人检索的食物节点。
    public static register(foodItem: FoodItem) {
        if (!foodItem || !foodItem.isValid) {
            return;
        }
        const registry = this.ensureInstance();
        if (!registry) {
            return;
        }
        const foodNode = foodItem.node;
        const foodId = foodItem.getFoodId();
        if (foodNode && foodNode.isValid) {
            registry._foods.add(foodNode);
        }
        if (foodId) {
            registry._foodById.set(foodId, foodItem);
        }
    }

    // 注销一个食物节点。
    public static unregister(foodItem: FoodItem) {
        const registry = this._instance;
        if (!registry || !foodItem) {
            return;
        }
        registry._foods.delete(foodItem.node);
        const foodId = foodItem.getFoodId();
        if (foodId) {
            registry._foodById.delete(foodId);
        }
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

    // 根据 foodId 获取有效食物节点。
    public static getFoodById(foodId: string): Node | null {
        const registry = this._instance;
        if (!registry) {
            return null;
        }
        const normalizedId = String(foodId || '');
        if (!normalizedId) {
            return null;
        }
        const foodItem = registry._foodById.get(normalizedId);
        if (!foodItem || !foodItem.isValid) {
            return null;
        }
        const foodNode = foodItem.node;
        if (!foodNode || !foodNode.isValid || !foodNode.activeInHierarchy) {
            return null;
        }
        return foodNode;
    }

    // 移除已失效的食物节点，防止列表长期累积脏数据。
    private pruneInvalidFoods() {
        for (const food of this._foods) {
            if (!food || !food.isValid || !food.activeInHierarchy) {
                this._foods.delete(food);
            }
        }
        for (const [foodId, foodItem] of this._foodById) {
            if (!foodItem || !foodItem.isValid) {
                this._foodById.delete(foodId);
                continue;
            }
            const foodNode = foodItem.node;
            if (!foodNode || !foodNode.isValid || !foodNode.activeInHierarchy) {
                this._foodById.delete(foodId);
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

        const registry =
            registryNode.getComponent(FoodRegistry) || registryNode.addComponent(FoodRegistry);
        this._instance = registry;
        return registry;
    }
}
