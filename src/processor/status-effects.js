import fs from 'fs';
import path from 'path';
import { batchSaveStatusEffectsToDatabase } from '../db/operations.js';
import {
  getJson,
  extractDescription,
  extractLastQuotedValue,
  parseValueExpression,
  formatTime,
} from '../utils.js';
import { applySpecialCase } from '../special-cases.js';

const CLASS_PREFIXES = ['Fighter', 'Tank', 'Cleric', 'Bard', 'Mage', 'Ranger', 'Rogue', 'Summoner', 'Weapon'];

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

function resolveEffectToken(token, dataDir) {
  let eff = {};
  const isGuid = /^\d+$/.test(token);
  if (isGuid) {
    eff = getJson(dataDir, '/Effects/Effect', `Effect_${token}.json`);
    if (!eff || Object.keys(eff).length === 0)
      eff = getJson(dataDir, '/Effects/Effect', `EffectRecord_${token}.json`);
  }
  if (!isGuid || !eff || Object.keys(eff).length === 0) {
    const dir = path.join(dataDir, 'Effects/Effect');
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      if (content.includes(`"name": "${token}"`)) {
        eff = JSON.parse(content);
        break;
      }
    }
    if (!eff || Object.keys(eff).length === 0) {
      const file = files.find((f) => f.includes(token));
      if (file) eff = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  }
  const name = extractLastQuotedValue(eff.effectName);
  return name ? formatEffectName(name) : formatEffectName(token);
}

function loadAbilityHit(hitKey, dataDir) {
  const dir = path.join(dataDir, 'Abilities/AbilityHit');
  let file = path.join(dir, `AbilityHit_${hitKey}.json`);
  if (!fs.existsSync(file)) {
    const match = fs
      .readdirSync(dir)
      .find((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(hitKey));
    if (match) file = path.join(dir, match);
  }
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseDamage(hitKey, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  if (!hit) return null;
  const elementTag = hit.eventTags?.[0]?.tagName || '';
  const element = elementTag.split('.').pop();
  const statGuid = hit.statModsIds?.[0]?.guid;
  let percent = null;
  if (statGuid) {
    let mod = getJson(dataDir, '/Effects/StatMod', `StatMod_${statGuid}.json`);
    if (!mod || Object.keys(mod).length === 0)
      mod = getJson(dataDir, '/Effects/StatMod', `StatModRecord_${statGuid}.json`);
    const expr = mod.valueInputTerms?.[0]?.value?.expression || mod.value?.expression;
    if (expr) {
      const v = parseFloat(expr);
      if (!Number.isNaN(v)) percent = v * 100;
    }
  }
  return { element, percent };
}

function parseApplyEffectName(hitKey, index, dataDir) {
  const hit = loadAbilityHit(hitKey, dataDir);
  if (!hit || !Array.isArray(hit.applyEffects)) return null;
  const effGuid = hit.applyEffects[index]?.effectId?.guid;
  if (!effGuid || effGuid === '0') return null;
  let eff = getJson(dataDir, '/Effects/Effect', `Effect_${effGuid}.json`);
  if (!eff || Object.keys(eff).length === 0)
    eff = getJson(dataDir, '/Effects/Effect', `EffectRecord_${effGuid}.json`);
  const name = extractLastQuotedValue(eff.effectName);
  return name ? formatEffectName(name) : null;
}

function evaluateExpression(expr) {
  if (!expr) return NaN;
  const sanitized = expr
    .replace(/EvalFormula\([^)]*\)/g, '1')
    .replace(/[^0-9+\-*/().\s]/g, '');
  if (!sanitized) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    return Function(`return (${sanitized});`)();
  } catch {
    return NaN;
  }
}

function resolvePlaceholders(text, effectData, dataDir, statIdToName) {
  let result = text;

  // Duration placeholder
  if (result.includes('$duration$')) {
    let durationExpr = parseValueExpression(
      effectData.effectDuration?.expression || '',
      [],
      statIdToName,
      dataDir
    );
    const durationVal = evaluateExpression(durationExpr);
    const durationStr = !isNaN(durationVal)
      ? formatTime(durationVal)
      : durationExpr;
    result = result.replace(/\$duration\$/g, durationStr);
  }

  if (result.includes('$maxduration$')) {
    const maxDur = effectData.extendedMaximum;
    if (typeof maxDur === 'number' && maxDur > 0) {
      result = result.replace(/\$maxduration\$/g, formatTime(maxDur));
    }
  }

  // Statmod placeholders
  const statMods = effectData.statModsIds || [];
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
    if (t.includes('by%') || t.startsWith('f%') || t.includes('%by')) {
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

  result = result.replace(/\$statmod(\d+)(?:\.([^$]+))?\$/gi, (m, idx, type) => {
    const ref = statMods[parseInt(idx, 10)];
    if (!ref) return m;
    let mod = getJson(dataDir, '/Effects/StatMod', `StatMod_${ref.guid}.json`);
    if (!mod || Object.keys(mod).length === 0)
      mod = getJson(dataDir, '/Effects/StatMod', `StatModRecord_${ref.guid}.json`);
    if (!mod || Object.keys(mod).length === 0) return m;
    return replaceMod(mod, type);
  });

  // Tick statmod placeholders (e.g., $tick0:statmod0.onlystat$)
  result = result.replace(
    /\$tick(\d+):statmod(\d+)(?:\.([^$]+))?\$/gi,
    (m, tIdx, mIdx, type) => {
      const hitRef = (effectData.tickHitsIds || [])[parseInt(tIdx, 10)];
      if (!hitRef) return m;
      const hit = loadAbilityHit(hitRef.guid, dataDir);
      const mods = hit?.statModsIds || [];
      const ref = mods[parseInt(mIdx, 10)];
      if (!ref) return m;
      let mod = getJson(dataDir, '/Effects/StatMod', `StatMod_${ref.guid}.json`);
      if (!mod || Object.keys(mod).length === 0)
        mod = getJson(dataDir, '/Effects/StatMod', `StatModRecord_${ref.guid}.json`);
      if (!mod || Object.keys(mod).length === 0) return m;
      return replaceMod(mod, type);
    }
  );

  // Tick timer placeholder
  if (result.includes('$tick$')) {
    const tickTime = effectData.tickTimer;
    if (typeof tickTime === 'number' && tickTime > 0) {
      result = result.replace(/\$tick\$/g, `${tickTime} seconds`);
    }
  }

  result = result.replace(/\$tick(\d+)\$/g, (m, idx) => {
    const hitRef = (effectData.tickHitsIds || [])[parseInt(idx, 10)];
    if (!hitRef) return m;
    const dmg = parseDamage(hitRef.guid, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : m;
  });

  result = result.replace(/\$hit:([^\.]+)(?:\.[^$]+)?\$/g, (m, name) => {
    const dmg = parseDamage(name, dataDir);
    return dmg && dmg.percent ? `${dmg.percent}% ${dmg.element} Damage` : m;
  });

  result = result.replace(/\$hit:([^\.]+)\.apply(\d+)(?:fordur)?\$/g, (m, name, idx) => {
    const eff = parseApplyEffectName(name, parseInt(idx, 10), dataDir);
    return eff ? `[${eff}]` : m;
  });

  result = result.replace(/\$hit(\d+):apply(\d+)(?:fordur)?\$/g, (m, hIdx, aIdx) => {
    const hitRef = (effectData.applyHitsIds || [])[parseInt(hIdx, 10)];
    if (!hitRef) return m;
    const eff = parseApplyEffectName(hitRef.guid, parseInt(aIdx, 10), dataDir);
    return eff ? `[${eff}]` : m;
  });

  result = result.replace(/\$hit(\d+)\.apply(\d+)(?:fordur)?\$/g, (m, hIdx, aIdx) => {
    const hitRef = (effectData.applyHitsIds || [])[parseInt(hIdx, 10)];
    if (!hitRef) return m;
    const eff = parseApplyEffectName(hitRef.guid, parseInt(aIdx, 10), dataDir);
    return eff ? `[${eff}]` : m;
  });

  result = result.replace(/\$effect:([^\.\$]+)(?:\.[^\$]+)?\$/g, (m, name) => {
    const resolved = resolveEffectToken(name, dataDir);
    return `[${resolved}]`;
  });

  result = result.replace(/<[^>]+>/g, '');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

async function processStatusEffects(directoryData, statIdToName) {
  const dir = path.join(directoryData, 'Effects/Effect');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const entries = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      (data.effectCategory !== 'EFFECT_Debuff' && data.effectCategory !== 'EFFECT_Buff') ||
      !data.effectIcon ||
      data.effectIcon === 'None'
    ) {
      continue;
    }

    const rawName = extractLastQuotedValue(data.effectName) || data.effectName || '';
    const name = formatEffectName(rawName);
    const descArray = extractDescription(data.effectDescription);
    let description = descArray.join(' ').trim();
    if (description) {
      description = resolvePlaceholders(
        description,
        data,
        directoryData,
        statIdToName
      );
    }

    if (name === 'Bleeding') {
      const tick = data.tickHitsIds?.[0];
      const dmg = tick ? parseDamage(tick.guid, directoryData) : null;
      if (dmg && dmg.percent) {
        description = `Deals ${dmg.percent}% ${dmg.element} Damage over time`;
      }
    }
    ({ name, description } = applySpecialCase(name, description));

    let effectDuration = null;
    if (data.effectDuration?.expression) {
      const durExpr = parseValueExpression(
        data.effectDuration.expression,
        [],
        statIdToName,
        directoryData
      );
      const durVal = evaluateExpression(durExpr);
      effectDuration = !isNaN(durVal) ? durVal : null;
    }

    const effectElement = (data.effectTags || [])
      .map((t) => t.tagName)
      .find((t) => t.startsWith('Element.'))
      ?.split('.').pop();

    entries.push({
      effectName: name,
      effectDescription: description,
      effectIcon: data.effectIcon,
      effectCategory: data.effectCategory,
      effectElement: effectElement || null,
      effectDuration,
      effectDispellable: data.bDispellable ?? null,
    });
  }

  await batchSaveStatusEffectsToDatabase(entries);
  console.log(`Successfully processed ${entries.length} status effects`);
  return entries.length;
}

export { processStatusEffects };
