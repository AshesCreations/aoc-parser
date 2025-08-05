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

  // Statmod placeholders
  const statMods = effectData.statModsIds || [];
  result = result.replace(/\$statmod(\d+)\.(by%|nostat|onlystat)\$/gi, (m, idx, type) => {
    const index = parseInt(idx, 10);
    const ref = statMods[index];
    if (!ref) return m;
    let mod = getJson(dataDir, '/Effects/StatMod', `StatMod_${ref.guid}.json`);
    if (!mod || Object.keys(mod).length === 0) {
      mod = getJson(dataDir, '/Effects/StatMod', `StatModRecord_${ref.guid}.json`);
    }
    if (!mod || Object.keys(mod).length === 0) return m;
    const statName = statIdToName[mod.statRefId?.guid] || '';
    if (type.toLowerCase() === 'onlystat') {
      return statName || m;
    }
    let expr = parseValueExpression(
      mod.value?.expression || '',
      mod.valueInputTerms,
      statIdToName,
      dataDir
    );
    const val = evaluateExpression(expr);
    if (type.toLowerCase() === 'by%') {
      if (!isNaN(val)) {
        const num = (val * 100).toFixed(0);
        return `${num}%${statName ? ' ' + statName : ''}`.trim();
      }
      return `${expr}${statName ? ' ' + statName : ''}`.trim();
    }
    if (!isNaN(val)) return String(val);
    return expr;
  });

  // Tick statmod placeholders (e.g., $tick0:statmod0.onlystat$)
  result = result.replace(
    /\$tick(\d+):statmod(\d+)\.(by%|nostat|onlystat)\$/gi,
    (m, tickIdx, modIdx, type) => {
      const tIdx = parseInt(tickIdx, 10);
      const mIdx = parseInt(modIdx, 10);
      const hitRef = (effectData.tickHitsIds || [])[tIdx];
      if (!hitRef) return m;
      const hit = getJson(
        dataDir,
        '/Abilities/AbilityHit',
        `AbilityHit_${hitRef.guid}.json`
      );
      const mods = hit.statModsIds || [];
      const ref = mods[mIdx];
      if (!ref) return m;
      let mod = getJson(dataDir, '/Effects/StatMod', `StatMod_${ref.guid}.json`);
      if (!mod || Object.keys(mod).length === 0) {
        mod = getJson(dataDir, '/Effects/StatMod', `StatModRecord_${ref.guid}.json`);
      }
      if (!mod || Object.keys(mod).length === 0) return m;
      const statName = statIdToName[mod.statRefId?.guid] || '';
      if (type.toLowerCase() === 'onlystat') {
        return statName || m;
      }
      let expr = parseValueExpression(
        mod.value?.expression || '',
        mod.valueInputTerms,
        statIdToName,
        dataDir
      );
      const val = evaluateExpression(expr);
      if (type.toLowerCase() === 'by%') {
        if (!isNaN(val)) {
          const num = (val * 100).toFixed(0);
          return `${num}%${statName ? ' ' + statName : ''}`.trim();
        }
        return `${expr}${statName ? ' ' + statName : ''}`.trim();
      }
      if (!isNaN(val)) return String(val);
      return expr;
    }
  );

  // Tick timer placeholder
  if (result.includes('$tick$')) {
    const tickTime = effectData.tickTimer;
    if (typeof tickTime === 'number' && tickTime > 0) {
      result = result.replace(/\$tick\$/g, `${tickTime} seconds`);
    }
  }

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

    const name = extractLastQuotedValue(data.effectName) || data.effectName || '';
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
