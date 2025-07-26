import fs from 'fs';
import path from 'path';
import { savePlayerStatsToDatabase } from '../db/operations.js';
import { extractExpressionId } from '../utils.js';

const defaultGuids = new Set([
  '108986356618873',
  '109183578756729',
  '109343399171808',
  '109343399106257',
]);

const classFiles = [
  { value: 100, name: 'Default', file: 'StatInitializerList_6064630101072872893.json', isDefault: true },
  { value: 0, name: 'Bard', file: 'StatInitializerList_6064630736345890821.json' },
  { value: 1, name: 'Cleric', file: 'StatInitializerList_6064630372724375553.json' },
  { value: 2, name: 'Fighter', file: 'StatInitializerList_6064630372725096450.json' },
  { value: 3, name: 'Mage', file: 'StatInitializerList_6064630533573115931.json' },
  { value: 4, name: 'Ranger', file: 'StatInitializerList_6064630533572591642.json' },
  { value: 5, name: 'Rogue', file: 'StatInitializerList_6064632655562356508.json' },
  { value: 6, name: 'Summoner', file: 'StatInitializerList_6064632655604299549.json' },
  { value: 7, name: 'Tank', file: 'StatInitializerList_6064630372720508928.json' },
];

function sanitize(name) {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join('');
}

async function processClass(dataDir, cls, statIdToName) {
  const filePath = path.join(
    dataDir,
    'Stats',
    'StatInitializerList',
    cls.file
  );
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const json = JSON.parse(raw);
  const attrs = {};
  for (const entry of json.statIds || []) {
    const guid = entry.statId?.guid;
    const expr = entry.valueExpression?.expression || '';
    if (!guid) continue;
    if (cls.isDefault && !defaultGuids.has(guid)) continue;

    if (expr.includes('GetStatInitRunningTotal() -')) {
      const subMatch = expr.match(/-\s*(\d+(?:\.\d+)?)/);
      const subVal = subMatch ? parseFloat(subMatch[1]) : 0;
      const value = 1 - subVal;
      const levels = {};
      for (let lvl = 1; lvl <= 50; lvl++) {
        levels[lvl] = value;
      }
      const name = sanitize(statIdToName[guid] || guid);
      attrs[name] = levels;
      continue;
    }
    if (!expr.includes('EvalCurve')) continue;
    const name = sanitize(statIdToName[guid] || guid);
    const curveId = extractExpressionId(expr);
    if (!curveId) continue;
    const curvePath = path.join(
      dataDir,
      'Stats',
      'StatCurve',
      `StatCurve_${curveId}.json`
    );
    let curve;
    try {
      curve = JSON.parse(await fs.promises.readFile(curvePath, 'utf8'));
    } catch {
      continue;
    }
    const keys = curve.curve?.editorCurveData?.keys || [];
    const multMatch = expr.match(/\*\s*(-?\d+(?:\.\d+)?)/);
    const multiplier = multMatch ? parseFloat(multMatch[1]) : 1;
    const useRound = expr.includes('Round(');
    const useRunning = expr.includes('GetStatInitRunningTotal');
    const levels = {};
    let total = 0;
    for (const k of keys) {
      const lvl = k.time;
      let val = k.value * multiplier;
      if (cls.isDefault) {
        // Default class should use raw values without multipliers or running totals
        levels[lvl] = k.value;
        continue;
      }
      if (useRound) val = Math.round(val);
      if (useRunning) {
        total += val;
        levels[lvl] = Math.round(total);
      } else {
        levels[lvl] = val;
      }
    }
    attrs[name] = levels;
  }
  await savePlayerStatsToDatabase({
    class: cls.value,
    className: cls.name,
    attributes: attrs,
  });
}

async function processPlayerStats(directoryPath, statIdToName) {
  for (const cls of classFiles) {
    await processClass(directoryPath, cls, statIdToName);
  }
  return classFiles.length;
}

export { processPlayerStats };
