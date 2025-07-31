import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

function parseCurve(curveData) {
  const keys =
    curveData?.curve?.editorCurveData?.keys || [];
  const result = {};
  for (const k of keys) {
    const lvl = parseInt(k.time, 10);
    if (!Number.isNaN(lvl)) {
      result[lvl] = k.value;
    }
  }
  return result;
}

function formatEffectName(name) {
  if (!name) return '';
  return name
    .replace(/^Status_/, '')
    .replace(/^Effect_/, '')
    .replace(/^Weapon_Description_/, '')
    .replace(/^Weapon_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

function parseManaCost(ability, dataDir) {
  let costsArray = ability.statCosts || [];
  if ((!costsArray || costsArray.length === 0) && Array.isArray(ability.costs)) {
    const first = ability.costs[0];
    if (first && Array.isArray(first.statCosts)) {
      costsArray = first.statCosts;
    }
  }
  const entry = (costsArray || []).find((c) => c.stat?.name === 'Stat_Mana');
  if (!entry) return null;
  const expr = entry.value?.expression || '';
  const constant = parseFloat(expr);
  if (!Number.isNaN(constant)) {
    const costs = {};
    for (let i = 1; i <= 50; i++) costs[i] = constant;
    return costs;
  }
  const multMatch = expr.match(/([0-9.]+)\s*\*\s*EvalFormula\([^:]+:(\d+)/);
  const evalMatch = expr.match(/EvalFormula\([^:]+:(\d+)/);
  const formulaGuid = multMatch ? multMatch[2] : evalMatch ? evalMatch[1] : null;
  const mult = multMatch ? parseFloat(multMatch[1]) : 1;
  if (!formulaGuid) return null;
  const formula = loadJson(
    dataDir,
    'Stats/StatFormulaType',
    'StatFormulaType',
    formulaGuid
  );
  const eqGuid = formula.equationId?.guid;
  const equation = loadJson(
    dataDir,
    'Stats/StatEquationType',
    'StatEquationType',
    eqGuid
  );
  const eqExpr = equation.equation?.expression || '';
  const curveMatch = eqExpr.match(/EvalCurve\([^:]+:(\d+)/);
  const divMatch = eqExpr.match(/\/([0-9.]+)\s*$/);
  const div = divMatch ? parseFloat(divMatch[1]) : 1;
  const curveGuid = curveMatch ? curveMatch[1] : null;
  if (!curveGuid) return null;
  const curve = loadJson(
    dataDir,
    'Stats/StatCurve',
    'StatCurve',
    curveGuid
  );
  const curveVals = parseCurve(curve);
  const costs = {};
  for (const [lvlStr, val] of Object.entries(curveVals)) {
    const lvl = parseInt(lvlStr, 10);
    costs[lvl] = Math.round(mult * (val / div));
  }
  return costs;
}

function parseDamage(hitGuid, dataDir) {
  let hit = loadJson(dataDir, 'Abilities/AbilityHit', 'AbilityHit', hitGuid);
  if (!hit || Object.keys(hit).length === 0) {
    // attempt lookup by name
    const dir = path.join(dataDir, 'Abilities/AbilityHit');
    const file = fs
      .readdirSync(dir)
      .find((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(`"name": "${hitGuid}"`));
    if (file) {
      hit = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } else {
      return null;
    }
  }
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
  // replace hit tokens with computed damage when possible
  text = text.replace(/\$hit(\d+)(?:\.[^$]+)?\$/g, (m, n) => {
    const id = ability.hitsIds?.[n]?.guid;
    if (!id) return m;
    const dmg = parseDamage(id, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : m;
  });

  text = text.replace(/\{hit:([^\.\}]+)(?:\.[^\}]+)?\}/g, (m, name) => {
    const dmg = parseDamage(name, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : '';
  });

  const effRegex = /\$effect:([^\.\$]+)(?:\.[^\$]+)?\$|\{effect:([^\.\}]+)(?:\.[^\}]+)?\}/g;
  text = text.replace(effRegex, (_, e1, e2) => `[${formatEffectName(e1 || e2)}]`);

  text = text.replace(/\{skill:[^\}]*\}/g, '');
  text = text.replace(/\r\n|\n/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
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
    let manaCost = null;
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
        manaCost = parseManaCost(ability, dataDir);
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
      manaCost,
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

export { parseSkillTable };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.length >= 4) {
  const tableId = process.argv[2];
  const baseDir = process.argv[3];
  const data = parseSkillTable(tableId, baseDir);
  console.log(JSON.stringify(data, null, 2));
}
