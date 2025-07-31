import fs from 'fs';
import path from 'path';
import { extractLastQuotedValue } from '../utils.js';

function findJsonFile(dir, prefix, id) {
  const direct = path.join(dir, `${prefix}_${id}.json`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(dir);
  const match = files.find(f => f.includes(id));
  return match ? path.join(dir, match) : null;
}

function loadJson(baseDir, subDir, prefix, id) {
  const dir = path.join(baseDir, subDir);
  let file = findJsonFile(dir, prefix, id);
  if (!file && prefix) {
    file = findJsonFile(dir, `${prefix}Record`, id);
  }
  if (!file) {
    const candidate = fs
      .readdirSync(dir)
      .find((f) => f.endsWith('.json') && fs.readFileSync(path.join(dir, f), 'utf8').includes(id));
    if (candidate) file = path.join(dir, candidate);
  }
  if (!file) return {};
  const data = fs.readFileSync(file, 'utf8');
  return JSON.parse(data);
}

function parseDamage(hitGuid, dataDir) {
  const hit = loadJson(dataDir, 'Abilities/AbilityHit', 'AbilityHit', hitGuid);
  if (!hit || Object.keys(hit).length === 0) return null;
  const elementTag = hit.eventTags?.[0]?.tagName || '';
  const element = elementTag.split('.').pop();
  const statGuid = hit.statModsIds?.[0]?.guid;
  let percent = null;
  if (statGuid) {
    const mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', statGuid);
    const modAlt = Object.keys(mod).length ? mod : loadJson(dataDir, 'Effects/StatMod', '', statGuid);
    const expr = modAlt.valueInputTerms?.[0]?.value?.expression || modAlt.value?.expression;
    if (expr) {
      const v = parseFloat(expr);
      if (!Number.isNaN(v)) percent = v * 100;
    }
  }
  return { element, percent };
}

function formatDescription(desc, ability, dataDir) {
  let text = extractLastQuotedValue(desc);
  if (ability.hitsIds && ability.hitsIds['1']) {
    const dmg = parseDamage(ability.hitsIds['1'].guid, dataDir);
    if (dmg && dmg.percent) {
      const dmgStr = `${dmg.percent}% ${dmg.element} Damage`;
      text = text.replace('$hit1$', dmgStr);
    }
  }
  text = text.replace(/\$effect:[^_]+_([^\.\$]+)(?:\.[^\$]+)?\$s?/g, (_, eff) =>
    eff
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
  );
  return text;
}

function parseSkillTable(id, dataDir) {
  const table = loadJson(dataDir, 'SkillTree/SkillTree', 'SkillTable', id);
  const result = [];
  for (const node of table.skills || []) {
    const nodeData = loadJson(dataDir, 'SkillTree/SkillTreeNode', 'SkillTreeNode', node.treeNodeId.guid);
    const skillId = nodeData.skillId?.guid;
    const skill = loadJson(dataDir, 'SkillTree/Skill', 'SkillRecord', skillId);
    const rankGuid = skill.skillRanksIds?.[0]?.guid;
    let rank = loadJson(dataDir, 'SkillTree/SkillRank', 'SkillRank', rankGuid);
    if (Object.keys(rank).length === 0) rank = loadJson(dataDir, 'SkillTree/SkillRank', 'SkillRankRecord', rankGuid);
    const abilityGuid = rank.abilityIdId?.guid;
    const effectGuid = rank.effectIdId?.guid;
    let type = 'passive';
    let name = rank.name;
    let description = extractLastQuotedValue(rank.tooltipText);
    let icon = rank.tooltipIcon?.replace('/Game/UI', '/cdn').split('.')[0] + '.png';
    let cooldown = null;
    if (abilityGuid && abilityGuid !== '0') {
      type = 'skill';
      const ability = loadJson(dataDir, 'Abilities/AoCAbility', 'AoCAbility', abilityGuid);
      if (Object.keys(ability).length === 0) {
        // try Record prefix
        ability = loadJson(dataDir, 'Abilities/AoCAbility', 'AoCAbilityRecord', abilityGuid);
      }
      if (ability && Object.keys(ability).length) {
        name = extractLastQuotedValue(ability.abilityName) || name;
        description = formatDescription(ability.abilityDescription, ability, dataDir);
        icon = ability.abilityIcon ? ability.abilityIcon.replace('/Game/UI', '/cdn').split('.')[0] + '.png' : icon;
        const cd = parseFloat(ability.cooldown?.expression);
        if (!Number.isNaN(cd)) cooldown = cd;
      }
    } else if (effectGuid && effectGuid !== '0') {
      type = 'passive';
      const effect = loadJson(dataDir, 'Effects/Effect', 'Effect', effectGuid);
      if (Object.keys(effect).length) {
        name = extractLastQuotedValue(effect.effectName) || name;
        description = extractLastQuotedValue(effect.effectDescription);
        icon = effect.effectIcon ? effect.effectIcon.replace('/Game/UI', '/cdn').split('.')[0] + '.png' : icon;
      }
    }
    const maxRank = rank.skillCost?.skillPointCosts?.[0]?.quantity || 1;
    result.push({
      id: rank.name,
      type,
      cooldown,
      imageUrl: icon,
      name,
      description,
      maxRank,
      position: { row: node.y, col: node.x },
      requirements: {
        pointsSpent: nodeData.pointRequirement,
        level: nodeData.levelRequirement,
        prerequisites: (nodeData.skillsRequired || []).map(r => r.skillRequirementId?.name).filter(Boolean)
      }
    });
  }
  return result;
}

if (process.argv.length >= 4) {
  const tableId = process.argv[2];
  const baseDir = process.argv[3];
  const data = parseSkillTable(tableId, baseDir);
  console.log(JSON.stringify(data, null, 2));
}
