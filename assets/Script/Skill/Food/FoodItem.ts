import { _decorator, Component, Node } from 'cc';
import { FoodRegistry } from './FoodRegistry';
const { ccclass, property } = _decorator;

@ccclass('FoodItem')
export class FoodItem extends Component {
    @property({ tooltip: '食物同步ID（留空自动按层级路径生成）。' })
    public syncId: string = '';

    private _foodId: string = '';

    // 初始化食物唯一标识，优先使用手动配置，否则按层级路径生成。
    onLoad() {
        const manualSyncId = String(this.syncId || '').trim();
        this._foodId = manualSyncId || this.buildHierarchyPathId();
    }

    // 启用时向食物注册表登记自己。
    onEnable() {
        FoodRegistry.register(this);
    }

    // 禁用时从食物注册表移除自己。
    onDisable() {
        FoodRegistry.unregister(this);
    }

    // 销毁时再次兜底移除，兼容对象池与手动销毁。
    onDestroy() {
        FoodRegistry.unregister(this);
    }

    // 返回用于网络同步的食物唯一标识。
    public getFoodId(): string {
        return this._foodId;
    }

    // 构建稳定层级路径ID，避免不同客户端节点 uuid 不一致导致误判。
    private buildHierarchyPathId(): string {
        const segments: string[] = [];
        let current: Node | null = this.node;
        while (current) {
            const parent = current.parent;
            const siblingIndex = parent ? parent.children.indexOf(current) : 0;
            segments.push(`${current.name}#${siblingIndex}`);
            current = parent;
        }
        segments.reverse();
        return segments.join('/');
    }
}
