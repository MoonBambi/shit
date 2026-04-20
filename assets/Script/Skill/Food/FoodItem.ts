import { _decorator, Component } from 'cc';
import { FoodRegistry } from './FoodRegistry';
const { ccclass } = _decorator;

@ccclass('FoodItem')
export class FoodItem extends Component {
    // 启用时向食物注册表登记自己。
    onEnable() {
        FoodRegistry.register(this.node);
    }

    // 禁用时从食物注册表移除自己。
    onDisable() {
        FoodRegistry.unregister(this.node);
    }

    // 销毁时再次兜底移除，兼容对象池与手动销毁。
    onDestroy() {
        FoodRegistry.unregister(this.node);
    }
}
