import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractLastQuotedValue,
  parseValueExpression,
  extractCoefficient,
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
  if (out.toLowerCase() === 'hemorraging') out = 'Hemorrhaging';
  return out;
}

const HIDDEN_EFFECTS = new Set([
  'Physical',
  'Attack',
  'Speed',
  'Combat Momentum',
]);

const PLACEHOLDER_TEXTS = new Set(['helo?', 'testing']);

const statusEffectCache = new Map();

function getStatusEffectNames(dataDir) {
  if (statusEffectCache.has(dataDir)) return statusEffectCache.get(dataDir);
  const dir = path.join(dataDir, 'Effects/Effect');
  let names = [];
  if (fs.existsSync(dir)) {
    names = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          const raw = extractLastQuotedValue(data.effectName) || data.effectName;
          return formatEffectName(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  const filtered = names.filter((n) => !HIDDEN_EFFECTS.has(n));
  statusEffectCache.set(dataDir, filtered);
  return filtered;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapStatusEffects(text, dataDir) {
  const names = getStatusEffectNames(dataDir).sort((a, b) => b.length - a.length);
  const isWrapped = (str, start, end) => {
    const open = str.lastIndexOf('[', start);
    const close = str.indexOf(']', end);
    return open !== -1 && close !== -1 && open < start && close >= end;
  };
  for (const n of names) {
    const regex = new RegExp(`\\b${escapeRegExp(n)}\\b`, 'g');
    text = text.replace(regex, (match, offset, str) => {
      if (isWrapped(str, offset, offset + match.length)) return match;
      return `[${match}]`;
    });
  }
  return text;
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

function parseDamage(hitKey, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  if (!hit) return null;
  const elementTag = hit.eventTags?.[0]?.tagName || '';
  const element = elementTag.split('.').pop();
  const statGuid = hit.statModsIds?.[0]?.guid;
  let percent = null;
  if (statGuid) {
    const mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', statGuid);
    const modAlt = Object.keys(mod).length
      ? mod
      : loadJson(dataDir, 'Effects/StatMod', '', statGuid);
    let expr =
      modAlt.valueInputTerms?.[0]?.value?.expression || modAlt.value?.expression;
    if (expr) {
      expr = parseValueExpression(
        expr,
        modAlt.valueInputTerms,
        statIdToName,
        dataDir
      );
      let v = evaluateExpression(expr);
      if (Number.isNaN(v)) {
        const coeff = parseFloat(extractCoefficient(expr));
        if (!Number.isNaN(coeff)) v = coeff;
        else {
          const m = expr.match(/-?\d*\.\d+|-?\d+/);
          if (m) v = parseFloat(m[0]);
        }
      }
      if (!Number.isNaN(v)) percent = Math.max(0, v) * 100;
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
  const modAlt = Object.keys(mod).length
    ? mod
    : loadJson(dataDir, 'Effects/StatMod', '', statGuid);
  const terms = modAlt.valueInputTerms || [];
  const idx = part === 'min' ? 0 : part === 'max' ? 1 : -1;
  if (idx < 0 || !terms[idx]) return null;
  let expr = terms[idx].value?.expression;
  if (!expr) return null;
  expr = parseValueExpression(
    expr,
    terms[idx].valueInputTerms || [],
    statIdToName,
    dataDir
  );
  let val = evaluateExpression(expr);
  if (Number.isNaN(val)) {
    const coeff = parseFloat(extractCoefficient(expr));
    if (!Number.isNaN(coeff)) val = coeff;
    else {
      const m = expr.match(/-?\d*\.\d+|-?\d+/);
      if (m) val = parseFloat(m[0]);
    }
  }
  if (Number.isNaN(val)) return null;
  return `${Math.max(0, val) * 100}% ${element} Damage`;
}

function parseDamageMinMax(hitKey, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  if (!hit) return null;
  const elementTag = hit.eventTags?.[0]?.tagName || '';
  const element = elementTag.split('.').pop();
  const statGuid = hit.statModsIds?.[0]?.guid;
  if (!statGuid) return null;
  const mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', statGuid);
  const modAlt = Object.keys(mod).length
    ? mod
    : loadJson(dataDir, 'Effects/StatMod', '', statGuid);
  const terms = modAlt.valueInputTerms || [];
  if (terms.length < 2) return null;
  let exprMin = terms[0]?.value?.expression;
  let exprMax = terms[1]?.value?.expression;
  if (!exprMin || !exprMax) return null;
  exprMin = parseValueExpression(
    exprMin,
    terms[0].valueInputTerms || [],
    statIdToName,
    dataDir
  );
  exprMax = parseValueExpression(
    exprMax,
    terms[1].valueInputTerms || [],
    statIdToName,
    dataDir
  );
  let min = evaluateExpression(exprMin);
  if (Number.isNaN(min)) {
    const coeff = parseFloat(extractCoefficient(exprMin));
    if (!Number.isNaN(coeff)) min = coeff;
    else {
      const m = exprMin.match(/-?\d*\.\d+|-?\d+/);
      if (m) min = parseFloat(m[0]);
    }
  }
  let max = evaluateExpression(exprMax);
  if (Number.isNaN(max)) {
    const coeff = parseFloat(extractCoefficient(exprMax));
    if (!Number.isNaN(coeff)) max = coeff;
    else {
      const m = exprMax.match(/-?\d*\.\d+|-?\d+/);
      if (m) max = parseFloat(m[0]);
    }
  }
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return {
    min: Math.max(0, min) * 100,
    max: Math.max(0, max) * 100,
    element,
  };
}

function loadLingeringEffectByName(name, dataDir) {
  const dir = path.join(dataDir, 'Abilities/LingeringEffect');
  let file = findJsonFile(dir, 'LingeringEffect', name);
  if (!file) {
    const match = fs
      .readdirSync(dir)
      .find((f) =>
        fs.readFileSync(path.join(dir, f), 'utf8').includes(`"name": "${name}"`)
      );
    if (match) file = path.join(dir, match);
  }
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadProjectile(projKey, dataDir) {
  let proj = loadJson(dataDir, 'Abilities/Projectile', 'Projectile', projKey);
  if (!proj || Object.keys(proj).length === 0) {
    proj = loadJson(dataDir, 'Abilities/Projectile', 'ProjectileRecord', projKey);
  }
  if (!proj || Object.keys(proj).length === 0) {
    const dir = path.join(dataDir, 'Abilities/Projectile');
    const file = fs
      .readdirSync(dir)
      .find((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(projKey));
    if (file) proj = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  return proj;
}

function loadAbilityHit(hitKey, dataDir) {
  let hit = loadJson(dataDir, 'Abilities/AbilityHit', 'AbilityHit', hitKey);
  if (!hit || Object.keys(hit).length === 0) {
    const dir = path.join(dataDir, 'Abilities/AbilityHit');
    const file = fs
      .readdirSync(dir)
      .find((f) =>
        fs.readFileSync(path.join(dir, f), 'utf8').includes(`"name": "${hitKey}"`)
      );
    if (file) {
      hit = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  }

  if (!hit || Object.keys(hit).length === 0) {
    let ability = loadJson(
      dataDir,
      'Abilities/AoCAbility',
      'AoCAbility',
      hitKey
    );
    if (!ability || Object.keys(ability).length === 0)
      ability = loadJson(
        dataDir,
        'Abilities/AoCAbility',
        'AoCAbilityRecord',
        hitKey
      );
    if (!ability || Object.keys(ability).length === 0) {
      const dir = path.join(dataDir, 'Abilities/AoCAbility');
      const file = fs
        .readdirSync(dir)
        .find((f) => {
          const content = fs.readFileSync(path.join(dir, f), 'utf8');
          return (
            content.includes(`"abilityName": "${hitKey}"`) ||
            content.includes(`"name": "${hitKey}"`)
          );
        });
      if (file) ability = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    const firstHit =
      ability?.hitsIds?.['1']?.guid ||
      ability?.hitsIds?.['0']?.guid ||
      ability?.hitsIds?.[0]?.guid;
    if (firstHit) {
      hit = loadJson(dataDir, 'Abilities/AbilityHit', 'AbilityHit', firstHit);
      if (!hit || Object.keys(hit).length === 0) {
        const dir = path.join(dataDir, 'Abilities/AbilityHit');
        const file = fs
          .readdirSync(dir)
          .find((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(firstHit));
        if (file) hit = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      }
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

function parseApplyEffectDuration(hitKey, index, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  const durExpr = hit?.applyEffects?.[index]?.effectDuration?.expression || '';
  if (!durExpr) return null;
  let expr = parseValueExpression(durExpr, [], statIdToName, dataDir);
  let val = evaluateExpression(expr);
  if (!Number.isNaN(val) && val > 0) {
    return `${val} second${val === 1 ? '' : 's'}`;
  }
  const lerp = durExpr.match(/Lerp\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
  if (lerp) {
    const min = parseFloat(lerp[1]);
    const max = parseFloat(lerp[2]);
    return `${min}-${max} seconds`;
  }
  return null;
}

function getProjectileHitGuid(ability, projIdx, hitIdx, dataDir) {
  const projRef = ability.projectilesIds?.[projIdx];
  if (!projRef) return null;
  const proj = loadProjectile(projRef.guid, dataDir);
  const hitRef = proj.hitsIds?.[hitIdx] || proj.hitsIds?.[String(hitIdx)];
  return hitRef?.guid || null;
}

function resolveEffectToken(token, ability, dataDir) {
  const isGuid = /^\d+$/.test(token);
  let eff;
  if (isGuid) {
    eff = loadJson(dataDir, 'Effects/Effect', 'Effect', token);
  } else {
    eff = loadJson(dataDir, 'Effects/Effect', 'Effect', token);
  }
  const name = extractLastQuotedValue(eff.effectName) || eff.effectName || token;
  const formatted = formatEffectName(name);
  return HIDDEN_EFFECTS.has(formatted) ? null : formatted;
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
    const t = (type || '').toLowerCase();
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
  text = text.replace(/\$statmod(\d+)(?:\.([^$]+))?\$/gi, (m, idx, type) => {
    const ref = statMods[parseInt(idx, 10)];
    if (!ref) return m;
    let mod = loadJson(dataDir, 'Effects/StatMod', 'StatMod', ref.guid);
    if (!mod || Object.keys(mod).length === 0) {
      mod = loadJson(dataDir, 'Effects/StatMod', 'StatModRecord', ref.guid);
    }
    if (!mod || Object.keys(mod).length === 0) return m;
    return replaceMod(mod, type);
  });

  text = text.replace(/\$hit(\d+):statmod(\d+)(?:\.([^$]+))?\$/gi, (m, hitIdx, modIdx, type) => {
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

  // Handle custom markup tags before other placeholder processing
  const tagStack = [];
  text = text.replace(/<Bold>|<bold>|<Flavor>|<flavor>|<>/g, (tag) => {
    const lower = tag.toLowerCase();
    if (lower === '<bold>') {
      tagStack.push('b');
      return '<b>';
    }
    if (lower === '<flavor>') {
      tagStack.push('i');
      return '<i>';
    }
    if (tag === '<>') {
      const last = tagStack.pop();
      return last ? `</${last}>` : '';
    }
    return tag;
  });

  if (ability.hitsIds && ability.hitsIds['1']) {
    const dmg = parseDamage(ability.hitsIds['1'].guid, dataDir);
    if (dmg && dmg.percent) {
      const dmgStr = `${dmg.percent}% ${dmg.element} Damage`;
      text = text.replace('$hit1$', dmgStr);
    }
  }
  text = text.replace(/\$hit(\d+):(?:hide)?apply(\d+)(?:hide)?(?:\.[^$]+)?\$/g, (m, hitNum, idx) => {
    const id = ability.hitsIds?.[hitNum]?.guid;
    if (!id) return '';
    const eff = parseApplyEffectName(id, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\$hit(\d+)\.(?:hide)?apply(\d+)(?:hide)?(?:fordur)?(?:\.[^$]+)?\$/g, (m, hitNum, idx) => {
    const id = ability.hitsIds?.[hitNum]?.guid;
    if (!id) return '';
    const eff = parseApplyEffectName(id, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\$hit:([^\.]+)\.(?:hide)?apply(\d+)(?:hide)?(?:fordur)?\$/g, (m, name, idx) => {
    const eff = parseApplyEffectName(name, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\{hit:([^\.\}]+)\.(?:hide)?apply(\d+)(?:hide)?\}/g, (m, name, idx) => {
    const eff = parseApplyEffectName(name, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\{hit:([^\.\}]+)(?:\.[^\}]+)?\}/g, (m, name) => {
    const dmg = parseDamage(name, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : '';
  });

  // replace hit tokens with computed damage when possible
  text = text.replace(/\$hit(\d+)(?:\.[^$]+)?\$/g, (m, n) => {
    const id = ability.hitsIds?.[n]?.guid;
    if (!id) return m;
    const dmg = parseDamage(id, dataDir);
    return dmg && dmg.percent !== null
      ? `${dmg.percent}% ${dmg.element} Damage`
      : '';
  });

  text = text.replace(/\$hit:([^.$]+)\$/g, (m, name) => {
    const dmg = parseDamage(name, dataDir);
    return dmg && dmg.percent !== null
      ? `${dmg.percent}% ${dmg.element} Damage`
      : '';
  });

  text = text.replace(/\$hit:([^\.]+)\.min\$/g, (m, name) => {
    const val = parseDamageRange(name, 'min', dataDir);
    return val || m;
  });

  text = text.replace(/\$hit:([^\.]+)\.max\$/g, (m, name) => {
    const val = parseDamageRange(name, 'max', dataDir);
    return val || m;
  });

  text = text.replace(/\$proj(\d+):hit(\d+)\$/g, (m, pIdx, hIdx) => {
    const hitGuid = getProjectileHitGuid(ability, pIdx, hIdx, dataDir);
    if (!hitGuid) return m;
    const dmg = parseDamage(hitGuid, dataDir);
    return dmg && dmg.percent !== null
      ? `${dmg.percent}% ${dmg.element} Damage`
      : '';
  });

  text = text.replace(
    /\$proj(\d+):hit(\d+)\.apply(\d+)(fordur)?\$/g,
    (m, pIdx, hIdx, aIdx, fordur) => {
      const hitGuid = getProjectileHitGuid(ability, pIdx, hIdx, dataDir);
      if (!hitGuid) return '';
      const eff = parseApplyEffectName(hitGuid, parseInt(aIdx, 10), dataDir);
      if (!eff) return '';
      if (fordur) {
        const dur = parseApplyEffectDuration(hitGuid, parseInt(aIdx, 10), dataDir);
        return dur ? `[${eff}] for ${dur}` : `[${eff}]`;
      }
      return `[${eff}]`;
    }
  );

  text = text.replace(/\$linger:([^\.]+)\.tick\$/g, (m, name) => {
    const eff = loadLingeringEffectByName(name, dataDir);
    const rate = eff?.tickRate;
    if (!rate) return m;
    return `${rate} second${rate === 1 ? '' : 's'}`;
  });

  text = text.replace(/\$linger:([^\.]+)\.duration\$/g, (m, name) => {
    const eff = loadLingeringEffectByName(name, dataDir);
    const dur = eff?.lifeTime;
    if (dur === undefined) return m;
    return `${dur} second${dur === 1 ? '' : 's'}`;
  });

  text = text.replace(/\$linger(\d+)\.duration\$/g, (m, idx) => {
    const guid = ability.lingeringEffectsIds?.[idx]?.guid;
    if (!guid) return m;
    const eff = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      guid
    );
    const dur = eff.lifeTime;
    if (dur === undefined) return m;
    return `${dur} second${dur === 1 ? '' : 's'}`;
  });

  text = text.replace(/\$linger(\d+):init(\d+)\$/g, (m, lIdx, hIdx) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return m;
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.initialHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return m;
    const dmg = parseDamage(hitGuid, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : m;
  });

  text = text.replace(/\$linger(\d+):init(\d+)\.apply(\d+)(fordur)?\$/g, (m, lIdx, hIdx, aIdx, fordur) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return '';
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.initialHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return '';
    const eff = parseApplyEffectName(hitGuid, parseInt(aIdx, 10), dataDir);
    if (!eff) return '';
    if (fordur) {
      const dur = parseApplyEffectDuration(hitGuid, parseInt(aIdx, 10), dataDir);
      return dur ? `[${eff}] for ${dur}` : `[${eff}]`;
    }
    return `[${eff}]`;
  });

  text = text.replace(/\$linger(\d+):linger(\d+)\.minmax\$/g, (m, lIdx, hIdx) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return m;
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.lingeringHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return m;
    const dmg = parseDamageMinMax(hitGuid, dataDir);
    if (!dmg) return m;
    return `${Math.round(dmg.min)}-${Math.round(dmg.max)}% ${dmg.element} Damage`;
  });

  text = text.replace(/\$linger(\d+):linger(\d+)\.apply(\d+)(?:fordur)?\$/g, (m, lIdx, hIdx, aIdx) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return '';
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.lingeringHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return '';
    const eff = parseApplyEffectName(hitGuid, parseInt(aIdx, 10), dataDir);
    return eff ? `[${eff}]` : '';
  });

  text = text.replace(/\$linger(\d+):linger(\d+)\$/g, (m, lIdx, hIdx) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return m;
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.lingeringHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return m;
    const dmg = parseDamage(hitGuid, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : m;
  });

  text = text.replace(/\$linger(\d+):beginOverlap(\d+)\.apply(\d+)(?:fordur)?\$/g, (m, lIdx, hIdx, aIdx, fordur) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return '';
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.onBeginOverlapHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return '';
    const eff = parseApplyEffectName(hitGuid, parseInt(aIdx, 10), dataDir);
    if (!eff) return '';
    if (fordur) {
      const dur = parseApplyEffectDuration(hitGuid, parseInt(aIdx, 10), dataDir);
      return dur ? `[${eff}] for ${dur}` : `[${eff}]`;
    }
    return `[${eff}]`;
  });

  text = text.replace(/\$linger(\d+):beginOverlap(\d+)\$/g, (m, lIdx, hIdx) => {
    const lGuid = ability.lingeringEffectsIds?.[lIdx]?.guid;
    if (!lGuid) return m;
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      lGuid
    );
    const hitGuid = ling.onBeginOverlapHitsIds?.[hIdx]?.guid;
    if (!hitGuid) return m;
    const dmg = parseDamage(hitGuid, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : m;
  });

  text = text.replace(/\$linger(\d+)\.tick\$/g, (m, idx) => {
    const guid = ability.lingeringEffectsIds?.[idx]?.guid;
    if (!guid) return m;
    const ling = loadJson(
      dataDir,
      'Abilities/LingeringEffect',
      'LingeringEffect',
      guid
    );
    const rate = ling.tickRate;
    if (!rate) return m;
    return `${rate} second${rate === 1 ? '' : 's'}`;
  });

  text = text.replace(/\$target(\d+)\.radius\$/g, (m, idx) => {
    const guid = ability.targetsIds?.[idx]?.guid;
    if (!guid) return m;
    const target = loadJson(
      dataDir,
      'Abilities/AbilityTarget',
      'AbilityTarget',
      guid
    );
    const radius = target.areaRadius || target.radius;
    if (radius === undefined) return m;
    return `${radius} meter${radius === 1 ? '' : 's'}`;
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
  text = text.replace(effRegex, (_, e1, e2) => {
    const name = resolveEffectToken(e1 || e2, ability, dataDir);
    return name ? `[${name}]` : '';
  });

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

  text = text.replace(/\{hit(\d+):apply(\d+)(fordur)?\}/g, (m, n, idx, fordur) => {
    const id = ability.hitsIds?.[n]?.guid;
    if (!id) return '';
    const eff = parseApplyEffectName(id, parseInt(idx, 10), dataDir);
    if (!eff) return '';
    if (fordur) {
      const dur = parseApplyEffectDuration(id, parseInt(idx, 10), dataDir);
      return dur ? `[${eff}] for ${dur}` : `[${eff}]`;
    }
    return `[${eff}]`;
  });

  text = text.replace(/\{skill:([^:}]+):([^:}]+):(.*)\}/g, (m, cls, sk, desc) => {
    const clean = desc.replace(/<[^>]+>/g, '').replace(/\}$/g, '').trim();
    if (!clean) return '';
    if (clean.startsWith('{effect')) return '';
    if (/^\[[^\]]+\]$/.test(clean)) return '';
    if (/^\d+$/.test(clean)) return clean;
    const name = resolveSkillName(sk, dataDir);
    return `${name}: ${clean}`;
  });

  const abilityName = (extractLastQuotedValue(ability.abilityName) || '').toLowerCase();
  if (abilityName === 'doublestrike') {
    text = text.replace(/: ([^:<>]+):<>/g, ':<br>$1<br>');
    text = text.replace(/([^:<>]+):<>/g, '$1<br>');
    text = text.replace(/([^:<>]+)<>/g, '$1');
  } else {
    text = text.replace(/: ([^:<>]+:[^:<>]+):<>/g, (_, name) => `: [${name}]<br>`);
    text = text.replace(/([A-Za-z][A-Za-z' ]+?)<>/g, (_, name) => `[${name.trim()}]`);
    text = text.replace(/<>/g, '');
  }
  // Replace escaped newline sequences with a single line break
  text = text.replace(/rnrn/g, '<br>');
  text = text.replace(/(^|\W)rn/g, '$1<br>');
  text = text.replace(/\r\n|\n|\r/g, '<br>');
  text = text.replace(/(<br>)+/g, '<br>');

  text = text.replace(/(?:<br>)?\s*\$charges\$(?:\.)?/g, () => {
    const val = parseFloat(ability.cooldownCharges?.expression);
    if (Number.isNaN(val) || val <= 1) return '';
    return `<br>${val} Charges`;
  });

  text = text.replace(/<img[^>]*id=\"([^\"]+)\"[^>]*>/g, (_, id) => `[${formatEffectName(id)}]`);
  text = text.replace(/\((\s*\[[^\]]+\]\s*)+\)/g, (m) => m.slice(1, -1));
  text = text.replace(/<\/?highlight>/gi, '');
  text = text.replace(/\$flavor:([^$]+)\$/gi, (_, w) => `<i>${w.replace(/^"|"$/g, '')}</i>`);
  text = text.replace(/\\'/g, "'");
  text = text.replace(/Healing Damage/gi, 'Healing');
  // Status effect names are already resolved from ability data; avoid auto-wrapping
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/(<br>)+$/g, '').trim();
  if (text && !/[.!?]$/.test(text)) text += '.';
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
        rank.tooltipIcon?.split('.')[0] + '.webp';
      let cooldown = null;
      let manaCost = null;
      let maxRange = null;
      let angle = null;
      if (abilityGuid && abilityGuid !== '0') {
        type = 'skill';
        let ability = loadJson(
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
        if (Object.keys(ability).length === 0) {
          const dir = path.join(dataDir, 'Abilities/AoCAbility');
          const file = fs
            .readdirSync(dir)
            .find((f) => {
              const content = fs.readFileSync(path.join(dir, f), 'utf8');
              return (
                content.includes(`"abilityName": "${rank.name}"`) ||
                content.includes(`"name": "${rank.name}"`)
              );
            });
          if (file) ability = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        }
        if (ability && Object.keys(ability).length) {
          name = extractLastQuotedValue(ability.abilityName) || name;
          description = formatDescription(
            rank.tooltipText,
            ability,
            dataDir
          );
          const cleanedDesc = description
            ? description.replace(/[.!?]+$/, '').trim().toLowerCase()
            : '';
          if (!cleanedDesc || PLACEHOLDER_TEXTS.has(cleanedDesc)) {
            description = formatDescription(
              ability.abilityDescription,
              ability,
              dataDir
            );
          }
          icon = ability.abilityIcon
            ? ability.abilityIcon.split('.')[0] +
              '.webp'
            : icon;
          const cd = parseFloat(ability.cooldown?.expression);
          if (!Number.isNaN(cd)) cooldown = cd;
          manaCost = parseManaCost(ability, dataDir);
          if (typeof ability.validDistance === 'number') {
            maxRange = ability.validDistance / 100;
          }
          if (typeof ability.validAngle === 'number') {
            angle = ability.validAngle;
          }
        }
      } else if (effectGuid && effectGuid !== '0') {
        type = 'passive';
        const effect = loadJson(dataDir, 'Effects/Effect', 'Effect', effectGuid);
        if (Object.keys(effect).length) {
          name = extractLastQuotedValue(effect.effectName) || name;
          description = formatDescription(
            rank.tooltipText || effect.effectDescription,
            effect,
            dataDir
          );
          const cleanedEff = description
            ? description.replace(/[.!?]+$/, '').trim().toLowerCase()
            : '';
          if (!cleanedEff || PLACEHOLDER_TEXTS.has(cleanedEff)) {
            description = formatDescription(
              effect.effectDescription,
              effect,
              dataDir
            );
          }
          icon = effect.effectIcon
            ? effect.effectIcon.split('.')[0] +
              '.webp'
            : icon;
        }
      }
      const maxRank = rank.skillCost?.skillPointCosts?.[0]?.quantity || 1;
      result.push({
        id: rank.name,
        type,
        cooldown,
        manaCost,
        maxRange,
        angle,
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

export { parseSkillTable, formatDescription, loadJson };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.length >= 4) {
  const tableId = process.argv[2];
  const baseDir = process.argv[3];
  const data = parseSkillTable(tableId, baseDir);
  console.log(JSON.stringify(data, null, 2));
}
