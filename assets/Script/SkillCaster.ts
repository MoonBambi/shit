import { _decorator } from 'cc';
import { PlayerSkillCaster } from './Skill/Player/PlayerSkillCaster';
const { ccclass } = _decorator;

@ccclass('SkillCaster')
export class SkillCaster extends PlayerSkillCaster {}
