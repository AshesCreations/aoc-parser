import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractLastQuotedValue,
  parseValueExpression,
} from '../utils.js';
import { statIdToName } from '../config.js';

function evaluateExpression(expr) {
  if (!expr) return NaN;
  const sanitized = expr.replace(/[^0-9+\-*/().\s]/g, '');
  if (!sanitized) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    return Function(`return (${sanitized});`)();
  } catch {
    return NaN;
  }
}

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

const CLASS_PREFIXES = ['Fighter','Tank','Cleric','Bard','Mage','Ranger','Rogue','Summoner','Weapon'];

function formatEffectName(name) {
  if (!name) return '';
  let out = name
    .replace(/^Status_/, '')
    .replace(/^Effect_/, '')
    .replace(/^Weapon_Description_/, '')
    .replace(/^Weapon_description_/, '')
    .replace(/^Weapon_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  for (const p of CLASS_PREFIXES) {
    if (out.startsWith(p + ' ')) {
      out = out.slice(p.length + 1);
      break;
    }
  }
  out = out.replace(/\b[Ss]tat\b/, '').trim();
  out = out.replace(/\b\w/g, (c) => c.toUpperCase());
  return out;
}

function parseManaCost(ability, dataDir) {
  let costsArray = ability.statCosts || [];
  if ((!costsArray || costsArray.length === 0) && Array.isArray(ability.costs)) {
    const first = ability.costs[0];
    if (first && Array.isArray(first.statCosts)) {
      costsArray = first.statCosts;
    }
  }
  const entry = (costsArray || []).find(
    (c) =>
      c.stat?.name === 'Stat_Mana' ||
      c.stat?.guid === '109183576135288'
  );
  if (!entry) return null;
  const expr = entry.value?.expression || '';
  const numericOnly = expr.trim().match(/^[-]?\d+(?:\.\d+)?$/);
  if (numericOnly) {
    const constant = parseFloat(expr.trim());
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

function parseDamageRange(hitKey, part, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  if (!hit) return null;
  const elementTag = hit.eventTags?.[0]?.tagName || '';
  const element = elementTag.split('.').pop();
  const statGuid = hit.statModsIds?.[0]?.guid;
  if (!statGuid) return null;
  const mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', statGuid);
  const modAlt = Object.keys(mod).length ? mod : loadJson(dataDir, 'Effects/StatMod', '', statGuid);
  const terms = modAlt.valueInputTerms || [];
  const idx = part === 'min' ? 0 : part === 'max' ? 1 : -1;
  if (idx < 0 || !terms[idx]) return null;
  const val = parseFloat(terms[idx].value?.expression);
  if (Number.isNaN(val)) return null;
  return `${val * 100}% ${element} Damage`;
}

function parseLingerTick(name, dataDir) {
  const dir = path.join(dataDir, 'Abilities/LingeringEffect');
  let file = findJsonFile(dir, 'LingeringEffect', name);
  if (!file) {
    const match = fs.readdirSync(dir).find(f => fs.readFileSync(path.join(dir, f), 'utf8').includes(`"name": "${name}"`));
    if (match) file = path.join(dir, match);
  }
  if (!file) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rate = data.tickRate || 0;
  return rate ? `${rate} second${rate === 1 ? '' : 's'}` : null;
}

function loadAbilityHit(hitKey, dataDir) {
  let hit = loadJson(dataDir, 'Abilities/AbilityHit', 'AbilityHit', hitKey);
  if (!hit || Object.keys(hit).length === 0) {
    const dir = path.join(dataDir, 'Abilities/AbilityHit');
    const file = fs
      .readdirSync(dir)
      .find((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(`"name": "${hitKey}"`));
    if (file) {
      hit = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  }
  return hit;
}

function parseApplyEffectName(hitKey, index, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  if (!hit || !Array.isArray(hit.applyEffects)) return null;
  const effGuid = hit.applyEffects[index]?.effectId?.guid;
  if (!effGuid || effGuid === '0') return null;
  const eff = loadJson(dataDir, 'Effects/Effect', 'Effect', effGuid);
  const effName = extractLastQuotedValue(eff.effectName);
  return effName ? formatEffectName(effName) : null;
}

function resolveEffectToken(token, dataDir) {
  let eff = loadJson(dataDir, 'Effects/Effect', 'Effect', token);
  if (!eff || Object.keys(eff).length === 0)
    eff = loadJson(dataDir, 'Effects/Effect', 'EffectRecord', token);
  if (!eff || Object.keys(eff).length === 0) {
    const dir = path.join(dataDir, 'Effects/Effect');
    const file = fs
      .readdirSync(dir)
      .find((f) => f.includes(token));
    if (file) eff = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  const name = extractLastQuotedValue(eff.effectName);
  return name ? formatEffectName(name) : formatEffectName(token);
}

function resolveSkillName(skillToken, dataDir) {
  let ability = loadJson(
    dataDir,
    'Abilities/AoCAbility',
    'AoCAbility',
    skillToken
  );
  if (!ability || Object.keys(ability).length === 0)
    ability = loadJson(
      dataDir,
      'Abilities/AoCAbility',
      'AoCAbilityRecord',
      skillToken
    );
  if (ability && Object.keys(ability).length) {
    const n = extractLastQuotedValue(ability.abilityName);
    if (n) return n;
  }
  // try effect
  const eff = loadJson(dataDir, 'Effects/Effect', 'Effect', skillToken);
  if (eff && Object.keys(eff).length) {
    const n = extractLastQuotedValue(eff.effectName);
    if (n) return n;
  }
  return formatEffectName(skillToken);
}

function resolveStatModPlaceholders(text, ability, dataDir) {
  if (!text) return text;

  const replaceMod = (mod, type) => {
    if (!mod) return '';
    const statName = statIdToName[mod.statRefId?.guid] || '';
    let expr = parseValueExpression(
      mod.value?.expression || '',
      mod.valueInputTerms,
      statIdToName,
      dataDir
    );
    const val = evaluateExpression(expr);
    const t = type.toLowerCase();
    if (t.includes('onlystat')) return statName || '';
    if (t.includes('by%') || t.startsWith('f%')) {
      if (!isNaN(val)) {
        return `${(val * 100).toFixed(0)}%${statName ? ' ' + statName : ''}`.trim();
      }
      return `${expr}${statName ? ' ' + statName : ''}`.trim();
    }
    if (!isNaN(val)) {
      return `${val}${statName ? ' ' + statName : ''}`.trim();
    }
    return `${expr}${statName ? ' ' + statName : ''}`.trim();
  };

  const statMods = ability.statModsIds || [];
  text = text.replace(/\$statmod(\d+)\.([^$]+)\$/gi, (m, idx, type) => {
    const ref = statMods[parseInt(idx, 10)];
    if (!ref) return m;
    let mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', ref.guid);
    if (!mod || Object.keys(mod).length === 0) {
      mod = loadJson(dataDir, 'Effects/StatMod', 'StatModRecord', ref.guid);
    }
    if (!mod || Object.keys(mod).length === 0) return m;
    return replaceMod(mod, type);
  });

  text = text.replace(/\$hit(\d+):statmod(\d+)\.([^$]+)\$/gi, (m, hitIdx, modIdx, type) => {
    const hitRef = ability.hitsIds?.[hitIdx];
    if (!hitRef) return m;
    const hit = loadAbilityHit(hitRef.guid, dataDir);
    if (!hit) return m;
    const ref = (hit.statModsIds || [])[parseInt(modIdx, 10)];
    if (!ref) return m;
    let mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', ref.guid);
    if (!mod || Object.keys(mod).length === 0) {
      mod = loadJson(dataDir, 'Effects/StatMod', 'StatModRecord', ref.guid);
    }
    if (!mod || Object.keys(mod).length === 0) return m;
    return replaceMod(mod, type);
  });

  return text;
}

function formatDescription(desc, ability, dataDir) {
  let text = extractLastQuotedValue(desc);
  text = resolveStatModPlaceholders(text, ability, dataDir);

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

  text = text.replace(/\$hit:([^\.]+)\.min\$/g, (m, name) => {
    const val = parseDamageRange(name, 'min', dataDir);
    return val || m;
  });

  text = text.replace(/\$hit:([^\.]+)\.max\$/g, (m, name) => {
    const val = parseDamageRange(name, 'max', dataDir);
    return val || m;
  });

  text = text.replace(/\$hit(\d+):apply(\d+)(?:\.[^$]+)?\$/g, (m, hitNum, idx) => {
    const id = ability.hitsIds?.[hitNum]?.guid;
    if (!id) return '';
    const eff = parseApplyEffectName(id, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\$hit(\d+)\.apply(\d+)(?:fordur)?(?:\.[^$]+)?\$/g, (m, hitNum, idx) => {
    const id = ability.hitsIds?.[hitNum]?.guid;
    if (!id) return '';
    const eff = parseApplyEffectName(id, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\$hit:([^\.]+)\.apply(\d+)(?:fordur)?\$/g, (m, name, idx) => {
    const eff = parseApplyEffectName(name, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\{hit:([^\.\}]+)\.apply(\d+)\}/g, (m, name, idx) => {
    const eff = parseApplyEffectName(name, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\{hit:([^\.\}]+)(?:\.[^\}]+)?\}/g, (m, name) => {
    const dmg = parseDamage(name, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : '';
  });

  text = text.replace(/\$linger:([^\.]+)\.tick\$/g, (m, name) => {
    const val = parseLingerTick(name, dataDir);
    return val || m;
  });

  text = text.replace(/\$effect(\d+)(?:\.[^$]+)?\$/g, (m, idx) => {
    const guid = ability.effectsIds?.[idx]?.guid;
    if (!guid) return '';
    const eff = loadJson(dataDir, 'Effects/Effect', 'Effect', guid);
    const name = formatEffectName(extractLastQuotedValue(eff.effectName));
    return name ? `[${name}]` : '';
  });

  text = text.replace(/\{effect(\d+)(?:\.[^\}]+)?\}/g, (m, idx) => {
    const guid = ability.effectsIds?.[idx]?.guid;
    if (!guid) return '';
    const eff = loadJson(dataDir, 'Effects/Effect', 'Effect', guid);
    const name = formatEffectName(extractLastQuotedValue(eff.effectName));
    return name ? `[${name}]` : '';
  });

  const effRegex = /\$effect:([^\.\$]+)(?:\.[^\$]+)?\$|\{effect:([^\.\}]+)(?:\.[^\}]+)?\}/g;
  text = text.replace(effRegex, (_, e1, e2) => `[${resolveEffectToken(e1 || e2, dataDir)}]`);

  text = text.replace(/\{hit(\d+)\}/g, (m, n) => {
    const id = ability.hitsIds?.[n]?.guid;
    if (!id) return '';
    const dmg = parseDamage(id, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : '';
  });

  text = text.replace(/\{hit(\d+)\.apply(\d+)\}/g, (m, n, idx) => {
    const id = ability.hitsIds?.[n]?.guid;
    if (!id) return '';
    const eff = parseApplyEffectName(id, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\{skill:([^:}]+):([^:}]+):([^}]+)\}/g, (m, cls, sk, desc) => {
    const name = resolveSkillName(sk, dataDir);
    const clean = desc.replace(/<[^>]+>/g, '').trim();
    return `${name}: ${clean}`;
  });

  text = text.replace(/: ([^:<>]+:[^:<>]+):<>/g, (_, name) => `: [${name}]<br>`);
  text = text.replace(/([A-Za-z][A-Za-z' ]+?)<>/g, (_, name) => `[${name.trim()}]`);
  text = text.replace(/<>/g, '');
  text = text.replace(/\r\n|\n/g, '<br>');

  text = text.replace(/\$charges\$/g, () => {
    const val = parseFloat(ability.cooldownCharges?.expression);
    return Number.isNaN(val) ? '0' : String(val);
  });

  text = text.replace(/rnrn/g, '  ');
  text = text.replace(/<img[^>]*id=\"([^\"]+)\"[^>]*>/g, (_, id) => `[${formatEffectName(id)}]`);
  text = text.replace(/\((\s*\[[^\]]+\]\s*)+\)/g, (m) => m.slice(1, -1));
  text = text.replace(/Healing Damage/gi, 'Healing');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function parseSkillTable(id, dataDir) {
  const table = loadJson(dataDir, 'SkillTree/SkillTree', 'SkillTable', id);
  const result = [];
  for (const node of table.skills || []) {
    const nodeData = loadJson(
      dataDir,
      'SkillTree/SkillTreeNode',
      'SkillTreeNode',
      node.treeNodeId.guid
    );

    const skillIds = [];
    const directSkill = nodeData.skillId?.guid;
    if (directSkill && directSkill !== '0') skillIds.push(directSkill);

    const slotGuid = nodeData.skillSlotId?.guid;
    if (slotGuid && slotGuid !== '0') {
      const slot = loadJson(
        dataDir,
        'SkillTree/SkillTreeSlot',
        'SkillTreeSlot',
        slotGuid
      );
      for (const s of slot.skillsIds || []) {
        if (s.guid && s.guid !== '0') skillIds.push(s.guid);
      }
    }

    for (const skillId of skillIds) {
      const skill = loadJson(dataDir, 'SkillTree/Skill', 'SkillRecord', skillId);
      const rankGuid = skill.skillRanksIds?.[0]?.guid;
      let rank = loadJson(
        dataDir,
        'SkillTree/SkillRank',
        'SkillRank',
        rankGuid
      );
      if (Object.keys(rank).length === 0)
        rank = loadJson(
          dataDir,
          'SkillTree/SkillRank',
          'SkillRankRecord',
          rankGuid
        );
      const abilityGuid = rank.abilityIdId?.guid;
      const effectGuid = rank.effectIdId?.guid;
      let type = 'passive';
      let name = rank.name;
      let description = extractLastQuotedValue(rank.tooltipText);
      let icon =
        rank.tooltipIcon?.replace('/Game/UI', '/cdn').split('.')[0] + '.png';
      let cooldown = null;
      let manaCost = null;
      if (abilityGuid && abilityGuid !== '0') {
        type = 'skill';
        const ability = loadJson(
          dataDir,
          'Abilities/AoCAbility',
          'AoCAbility',
          abilityGuid
        );
        if (Object.keys(ability).length === 0) {
          // try Record prefix
          ability = loadJson(
            dataDir,
            'Abilities/AoCAbility',
            'AoCAbilityRecord',
            abilityGuid
          );
        }
        if (ability && Object.keys(ability).length) {
          name = extractLastQuotedValue(ability.abilityName) || name;
          description = formatDescription(
            ability.abilityDescription,
            ability,
            dataDir
          );
          icon = ability.abilityIcon
            ? ability.abilityIcon.replace('/Game/UI', '/cdn').split('.')[0] +
              '.png'
            : icon;
          const cd = parseFloat(ability.cooldown?.expression);
          if (!Number.isNaN(cd)) cooldown = cd;
          manaCost = parseManaCost(ability, dataDir);
        }
      } else if (effectGuid && effectGuid !== '0') {
        type = 'passive';
        const effect = loadJson(dataDir, 'Effects/Effect', 'Effect', effectGuid);
        if (Object.keys(effect).length) {
          name = extractLastQuotedValue(effect.effectName) || name;
          description = formatDescription(
            effect.effectDescription,
            {},
            dataDir
          );
          icon = effect.effectIcon
            ? effect.effectIcon.replace('/Game/UI', '/cdn').split('.')[0] +
              '.png'
            : icon;
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
          prerequisites: (nodeData.skillsRequired || [])
            .map((r) => {
              const reqGuid = r.skillRequirementId?.guid;
              if (!reqGuid || reqGuid === '0') return null;
              const req = loadJson(
                dataDir,
                'SkillTree/SkillRequirement',
                'SkillRequirement',
                reqGuid
              );
              let reqSkillId = req.name;
              const targetGuid = req.skillRecordId?.guid;
              if (targetGuid && targetGuid !== '0') {
                const sk = loadJson(
                  dataDir,
                  'SkillTree/Skill',
                  'SkillRecord',
                  targetGuid
                );
                const rankGuidReq = sk.skillRanksIds?.[0]?.guid;
                let rankReq = loadJson(
                  dataDir,
                  'SkillTree/SkillRank',
                  'SkillRank',
                  rankGuidReq
                );
                if (Object.keys(rankReq).length === 0)
                  rankReq = loadJson(
                    dataDir,
                    'SkillTree/SkillRank',
                    'SkillRankRecord',
                    rankGuidReq
                  );
                if (rankReq && rankReq.name) reqSkillId = rankReq.name;
              }
              return reqSkillId || null;
            })
            .filter(Boolean),
        },
      });
    }
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
