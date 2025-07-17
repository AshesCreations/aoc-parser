import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rewardMap from "../json/reward-id.json" with { type: "json" };
import { saveLootInfoToDatabase } from "../db/operations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of list) {
    const resolved = path.join(dir, file.name);
    if (file.isDirectory()) {
      results = results.concat(walk(resolved));
    } else if (file.name.toLowerCase().endsWith(".json")) {
      results.push(resolved);
    }
  }
  return results;
}

function parseAssetDefKey(key) {
  const match = key.match(/Guid=(\d+)/);
  return match ? match[1] : null;
}

async function processLootFiles(directoryData) {
  const lootInfo = [];

  // Build world spawn map
  const worldSpawns = {};
  const worldSpawnDir = path.join(directoryData, "Population/WorldSpawn");
  if (fs.existsSync(worldSpawnDir)) {
    for (const file of walk(worldSpawnDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const mapName = data.mapName || "";
      if (data.populationSetsMap) {
        for (const entry of Object.values(data.populationSetsMap)) {
          if (entry.setId && entry.setId.guid) {
            worldSpawns[entry.setId.guid] = {
              mapName,
              location: entry.location,
            };
          }
        }
      }
    }
  }

  // Build population set map
  const setMap = {};
  const setDir = path.join(directoryData, "Population/PopulationSet");
  if (fs.existsSync(setDir)) {
    for (const file of walk(setDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data.populationInstancesMap) {
        for (const entry of Object.values(data.populationInstancesMap)) {
          if (entry.instanceId && entry.instanceId.guid) {
            setMap[entry.instanceId.guid] = {
              setId: data.guid,
              location: entry.location,
            };
          }
        }
      }
    }
  }

  // Build population instance map
  const instanceMap = {};
  const instanceDir = path.join(directoryData, "Population/PopulationInstance");
  if (fs.existsSync(instanceDir)) {
    for (const file of walk(instanceDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      instanceMap[data.guid] = {
        assetSetIds: (data.assetSetsIds || []).map((a) => a.guid),
        levelMin: data.nPCLevelMin,
        levelMax: data.nPCLevelMax,
        respawnTime: data.respawnTime,
      };
    }
  }

  // Build asset set map
  const assetSetMap = {};
  const assetSetDir = path.join(directoryData, "Population/AssetSet");
  if (fs.existsSync(assetSetDir)) {
    for (const file of walk(assetSetDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      assetSetMap[data.guid] = [];
      if (data.assetDefMap) {
        for (const [k, v] of Object.entries(data.assetDefMap)) {
          const ag = parseAssetDefKey(k);
          if (ag) {
            assetSetMap[data.guid].push({ assetId: ag, weight: v.weight });
          }
        }
      }
    }
  }

  // Load population assets
  const assetDir = path.join(directoryData, "Population/PopulationAsset");
  const assets = {};
  if (fs.existsSync(assetDir)) {
    for (const file of walk(assetDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      assets[data.guid] = data;
    }
  }

  // Build quest loot
  const questBase = path.join(directoryData, "Quest");
  if (fs.existsSync(questBase)) {
    for (const file of walk(questBase)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const questName = data.questName || data.commissionName || data.name || "";
      const step = data.mainObjectiveText || data.name || path.basename(file);
      let rewardTables = [];
      if (Array.isArray(data.rewardTablesIds)) {
        rewardTables = data.rewardTablesIds.map((r) => r.guid);
      } else if (data.rewardTableId && data.rewardTableId.guid) {
        rewardTables = [data.rewardTableId.guid];
      }
      for (const rt of rewardTables) {
        const items = rewardMap[rt] || [];
        for (const item of items) {
          const id = `${item}_${questName}_${step}`;
          lootInfo.push({
            id,
            itemId: item,
            questName,
            step,
            npcName: null,
            levelMin: null,
            levelMax: null,
            difficulty: null,
            zone: null,
            spawnRate: null,
            dropChance: null,
            coordinates: null,
          });
        }
      }
    }
  }

  // Build NPC loot
  for (const [assetId, asset] of Object.entries(assets)) {
    const lootTables = (asset.lootTablesIds || []).map((l) => l.guid);
    if (!lootTables.length) continue;
    const spawnInfos = [];
    for (const [instId, inst] of Object.entries(instanceMap)) {
      if (!inst.assetSetIds) continue;
      for (const setId of inst.assetSetIds) {
        const defs = assetSetMap[setId] || [];
        const def = defs.find((d) => d.assetId === assetId);
        if (def) {
          const s = setMap[instId];
          const w = s ? worldSpawns[s.setId] : null;
          spawnInfos.push({
            levelMin: inst.levelMin,
            levelMax: inst.levelMax,
            weight: def.weight,
            spawnRate: inst.respawnTime,
            zone: w ? w.mapName : null,
            coordinates: s ? s.location : null,
          });
        }
      }
    }

    for (const rt of lootTables) {
      const items = rewardMap[rt] || [];
      for (const item of items) {
        for (const info of spawnInfos) {
          const coord = info.coordinates || { x: 0, y: 0, z: 0 };
          const id = `${item}_${asset.name}_${coord.x}_${coord.y}_${coord.z}`;
          lootInfo.push({
            id,
            itemId: item,
            questName: null,
            step: null,
            npcName: asset.name,
            levelMin: info.levelMin,
            levelMax: info.levelMax,
            difficulty: asset.gameplayTags && asset.gameplayTags.gameplayTags
              ? asset.gameplayTags.gameplayTags.map((t) => t.tagName).join(" ")
              : null,
            zone: info.zone,
            spawnRate: info.spawnRate,
            dropChance: info.weight,
            coordinates: info.coordinates,
          });
        }
      }
    }
  }

  // Save results
  for (const entry of lootInfo) {
    await saveLootInfoToDatabase(entry);
  }

  const outPath = path.join(__dirname, "../json/loot-info.json");
  fs.writeFileSync(outPath, JSON.stringify(lootInfo, null, 2));

  return lootInfo.length;
}

export { processLootFiles };
