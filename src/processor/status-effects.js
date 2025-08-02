import fs from 'fs';
import path from 'path';
import { batchSaveStatusEffectsToDatabase } from '../db/operations.js';
import { getJson, extractDescription, extractLastQuotedValue, parseValueExpression, formatTime } from '../utils.js';

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
  result = result.replace(/\$statmod(\d+)\.(by%|nostat)\$/gi, (m, idx, type) => {
    const index = parseInt(idx, 10);
    const ref = statMods[index];
    if (!ref) return m;
    let mod = getJson(dataDir, '/Effects/StatMod', `StatMod_${ref.guid}.json`);
    if (!mod || Object.keys(mod).length === 0) {
      mod = getJson(dataDir, '/Effects/StatMod', `StatModRecord_${ref.guid}.json`);
    }
    if (!mod || Object.keys(mod).length === 0) return m;
    let expr = parseValueExpression(
      mod.value?.expression || '',
      mod.valueInputTerms,
      statIdToName,
      dataDir
    );
    const val = evaluateExpression(expr);
    const statName = statIdToName[mod.statRefId?.guid] || '';
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
      description = resolvePlaceholders(description, data, directoryData, statIdToName);
    }

    entries.push({
      effectName: name,
      effectDescription: description,
      effectIcon: data.effectIcon,
    });
  }

  await batchSaveStatusEffectsToDatabase(entries);
  console.log(`Successfully processed ${entries.length} status effects`);
  return entries.length;
}

export { processStatusEffects };
