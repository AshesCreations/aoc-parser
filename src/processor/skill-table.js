import fs from 'fs';
import path from 'path';
import { parseSkillTable } from '../tools/parse-skill-table.js';
import { batchSaveSkillTableToDatabase } from '../db/operations.js';
import { extractLastQuotedValue } from '../utils.js';

const CLASS_NAMES = ['Fighter','Tank','Cleric','Bard','Mage','Ranger','Rogue','Summoner'];

async function processSkillTables(directoryData) {
  const dir = path.join(directoryData, 'SkillTree/SkillTree');
  const files = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        (f.startsWith('SkillTable_') || f.startsWith('SkillTableRecord_')) &&
        f.endsWith('.json')
    );
  const allSkills = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const tableData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const tableName = extractLastQuotedValue(tableData.displayName || tableData.name);
    if (!tableName) continue;
    if (!CLASS_NAMES.includes(tableName) && !tableName.startsWith('Weapon_')) continue;
    if (tableName.includes('_Stage')) continue;
    const match = file.match(/SkillTable(?:Record)?_(\d+)/);
    if (!match) continue;
    const tableId = match[1];
    const skills = parseSkillTable(tableId, directoryData);
    for (const s of skills) {
      s.tableId = tableId;
      s.tableName = tableName;
    }
    allSkills.push(...skills);
  }
  await batchSaveSkillTableToDatabase(allSkills);
  console.log(`Successfully processed ${allSkills.length} skills from skill tables`);
  return allSkills.length;
}

export { processSkillTables };
