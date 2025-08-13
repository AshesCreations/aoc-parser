import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { saveLootInfoToDatabase } from "../db/operations.js";
import { getJson, getItemJson, extractLastQuotedValue } from "../utils.js";

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

// Cache for reward table lookups
const rewardTableCache = {};
const itemNameCache = {};
const chanceCache = {};
const poolSizeCache = {};
const rewardSources = {};
const rewardItemsCache = {};

/**
 * Parse predicate expressions from reward tables to extract
 * level ranges or biome restrictions.
 * @param {string} expression
 * @returns {{levelMin: number|null, levelMax: number|null, biome: string|null}}
 */
function parsePredicate(expression) {
  const result = { levelMin: null, levelMax: null, biome: null };
  if (!expression || typeof expression !== "string") return result;

  const minMatch = expression.match(/GetNPCLevel\(\)\s*>=\s*(\d+)/);
  const maxMatch = expression.match(/GetNPCLevel\(\)\s*<=\s*(\d+)/);
  const biomeMatch = expression.match(/GetNodeBiome\(\)\s*==\s*EBiomeType::(\w+)/);

  if (minMatch) result.levelMin = parseInt(minMatch[1], 10);
  if (maxMatch) result.levelMax = parseInt(maxMatch[1], 10);
  if (biomeMatch) result.biome = biomeMatch[1];
  return result;
}

/**
 * Load reward table predicates (level/biome).
 * Results are cached to avoid redundant file reads.
 * @param {string} baseDir - Root data directory
 * @param {string} rtId - Reward table GUID
 * @returns {{levelMin: number|null, levelMax: number|null, biome: string|null}}
 */
function getRewardTableInfo(baseDir, rtId) {
  if (!rtId || rtId === "0") {
    return { levelMin: null, levelMax: null, biome: null };
  }
  if (rewardTableCache[rtId]) return rewardTableCache[rtId];

  const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
  const info = { levelMin: null, levelMax: null, biome: null };

  if (data?.predicate?.expression) {
    const pred = parsePredicate(data.predicate.expression);
    info.levelMin = pred.levelMin;
    info.levelMax = pred.levelMax;
    info.biome = pred.biome;
  }

  rewardTableCache[rtId] = info;
  return info;
}

/**
 * Get display name for an item by GUID.
 * @param {string} baseDir
 * @param {string} itemId
 * @returns {string}
 */
function getItemName(baseDir, itemId) {
  if (itemNameCache[itemId]) return itemNameCache[itemId];
  const data = getItemJson(baseDir, "/Item/Item", itemId);
  const name = extractLastQuotedValue(data.itemName) || "";
  itemNameCache[itemId] = name;
  return name;
}

/**
 * Compute total number of item rewards reachable from a reward table.
 * @param {string} baseDir
 * @param {string} rtId
 * @returns {number}
 */
function getPoolSize(baseDir, rtId) {
  if (!rtId || rtId === "0") {
    poolSizeCache[rtId] = 0;
    return 0;
  }
  if (poolSizeCache[rtId] !== undefined) return poolSizeCache[rtId];

  const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
  if (!data || Object.keys(data).length === 0) {
    poolSizeCache[rtId] = 0;
    return 0;
  }

  const container = data?.rewardDefContainers?.[0];
  const rewards = container?.rewards || [];
  if (rewards.length) {
    poolSizeCache[rtId] = rewards.length;
    return rewards.length;
  }

  const subIds =
    data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
  let total = 0;
  for (const subId of subIds) {
    total += getPoolSize(baseDir, subId);
  }
  poolSizeCache[rtId] = total;
  return total;
}

function addRewardSource(rtId, source) {
  if (!rtId || rtId === "0") return;
  if (!rewardSources[rtId]) rewardSources[rtId] = [];
  rewardSources[rtId].push(source);
}

/**
 * Recursively collect all item IDs reachable from a reward table.
 * @param {string} baseDir - Root data directory
 * @param {string} rtId - Reward table GUID
 * @returns {string[]} Array of item GUIDs
 */
function getItemsFromRewardTable(baseDir, rtId) {
  if (!rtId || rtId === "0") return [];
  if (rewardItemsCache[rtId]) return rewardItemsCache[rtId];

  const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
  if (!data || Object.keys(data).length === 0) {
    rewardItemsCache[rtId] = [];
    return [];
  }

  const items = new Set();
  const container = data?.rewardDefContainers?.[0];
  const rewards = container?.rewards || [];
  for (const reward of rewards) {
    const itemRewards = reward.itemRewards || [];
    for (const ir of itemRewards) {
      const id = ir.item?.itemId?.guid;
      if (id) items.add(id);
    }
  }

  const subIds =
    data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
  for (const subId of subIds) {
    for (const it of getItemsFromRewardTable(baseDir, subId)) {
      items.add(it);
    }
  }

  rewardItemsCache[rtId] = Array.from(items);
  return rewardItemsCache[rtId];
}

/**
 * Recursively compute the probability that a reward table yields a given item.
 * Returns details about per-roll odds and roll counts.
 * @param {string} baseDir - Root data directory
 * @param {string} rtId - Reward table GUID
 * @param {string} itemId - Item GUID to search for
 * @returns {{chance:number, perRollChance:number, rolls:number, poolSize:number}}
 */
function computeItemChance(baseDir, rtId, itemId) {
  const key = `${rtId}_${itemId}`;
  if (!rtId || rtId === "0") {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: 0,
    };
    return chanceCache[key];
  }
  if (chanceCache[key]) return chanceCache[key];

  const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
  const totalPool = getPoolSize(baseDir, rtId);
  if (!data || Object.keys(data).length === 0) {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: totalPool,
    };
    return chanceCache[key];
  }

  // Leaf table with item rewards
  const container = data?.rewardDefContainers?.[0];
  const rewards = container?.rewards || [];
  if (rewards.length) {
    const weights = container.weightsPerReward || [];
    const rolls = container.numberToSelect || 1;
    let totalWeight = 0;
    for (let i = 0; i < rewards.length; i++) {
      totalWeight += weights.length ? weights[i] ?? 1 : 1;
    }
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i];
      const items = reward.itemRewards || [];
      const rId = items[0]?.item?.itemId?.guid;
      const weight = weights.length ? weights[i] ?? 1 : 1;
      if (rId === itemId) {
        const perRoll = totalWeight > 0 ? weight / totalWeight : 0;
        const chance = 1 - Math.pow(1 - perRoll, rolls);
        chanceCache[key] = {
          chance,
          perRollChance: perRoll,
          rolls,
          poolSize: totalPool,
        };
        return chanceCache[key];
      }
    }
  }

  // Table with subtables
  const subIds =
    data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
  if (subIds.length) {
    const rolls = data.numberOfSubtablesToSelect || 1;
    let weights = data.weightsPerSubTable || [];
    if (!weights.length && Array.isArray(data.expressionWeightsPerSubTable)) {
      weights = data.expressionWeightsPerSubTable.map((e) => {
        const match = e.expression.match(/:(\d+)/);
        const n = match ? parseFloat(match[1]) : NaN;
        return isNaN(n) ? 1 : n;
      });
    }
    if (!weights.length) weights = new Array(subIds.length).fill(1);
    const totalWeight = weights.reduce((sum, w) => sum + (w || 0), 0);
    let totalChance = 0;
    let perRollAccum = 0;
    let rollAccum = 0;
    for (let i = 0; i < subIds.length; i++) {
      const subId = subIds[i];
      const subWeight = weights[i] || 0;
      const subChance = computeItemChance(baseDir, subId, itemId);
      if (subChance.chance > 0) {
        const perRoll = totalWeight > 0 ? subWeight / totalWeight : 0;
        const selectChance = 1 - Math.pow(1 - perRoll, rolls);
        totalChance += selectChance * subChance.chance;
        perRollAccum = Math.max(perRollAccum, subChance.perRollChance);
        rollAccum = Math.max(rollAccum, rolls * subChance.rolls);
      }
    }
    chanceCache[key] = {
      chance: totalChance,
      perRollChance: perRollAccum,
      rolls: rollAccum,
      poolSize: totalPool,
    };
    return chanceCache[key];
  }

  chanceCache[key] = {
    chance: 0,
    perRollChance: 0,
    rolls: 0,
    poolSize: totalPool,
  };
  return chanceCache[key];
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
      const name = data.name || "";
      if (data.populationSetsMap) {
        for (const entry of Object.values(data.populationSetsMap)) {
          if (entry.setId && entry.setId.guid) {
            worldSpawns[entry.setId.guid] = {
              mapName,
              location: entry.location,
              name,
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
        addRewardSource(rt, { type: "quest", questName, step });
      }
    }
  }

  // Build NPC loot sources
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
            spawnWeight: def.weight,
            spawnRate: inst.respawnTime,
            zone: w ? w.mapName : null,
            worldSpawnLocation: w ? w.name : null,
            zoneCoordinates: s ? s.location : null,
            worldCoordinates: w ? w.location : null,
          });
        }
      }
    }

    for (const rt of lootTables) {
      const difficulty =
        asset.gameplayTags && asset.gameplayTags.gameplayTags
          ? asset.gameplayTags.gameplayTags.map((t) => t.tagName).join(" ")
          : null;
      for (const info of spawnInfos) {
        addRewardSource(rt, {
          type: "npc",
          npcName: asset.name,
          levelMin: info.levelMin,
          levelMax: info.levelMax,
          spawnRate: info.spawnRate,
          zone: info.zone,
          worldSpawnLocation: info.worldSpawnLocation,
          zoneCoordinates: info.zoneCoordinates,
          worldCoordinates: info.worldCoordinates,
          difficulty,
        });
      }
    }
  }

  // Combine reward sources with items
  for (const [rt, sources] of Object.entries(rewardSources)) {
    if (!sources.length) continue;
    const items = getItemsFromRewardTable(directoryData, rt);
    if (!items.length) continue;
    const tableInfo = getRewardTableInfo(directoryData, rt);
    for (const item of items) {
      const chanceInfo = computeItemChance(directoryData, rt, item);
      const itemName = getItemName(directoryData, item);
      if (!itemName) {
        continue; // skip entries without a valid item definition
      }
      for (const src of sources) {
        if (src.type === "npc" && !src.zone && !src.worldSpawnLocation) {
          continue; // skip NPC drops without location data
        }
        if (src.type !== "quest" && src.type !== "npc") {
          continue; // only quest or NPC sources are kept
        }
        let id;
        if (src.type === "quest") {
          id = `${item}_${src.questName}_${src.step}`;
        } else {
          const coord = src.zoneCoordinates || { x: 0, y: 0, z: 0 };
          id = `${item}_${src.npcName}_${coord.x}_${coord.y}_${coord.z}`;
        }
        lootInfo.push({
          id,
          itemId: item,
          itemName,
          questName: src.type === "quest" ? src.questName : null,
          step: src.type === "quest" ? src.step : null,
          npcName: src.type === "npc" ? src.npcName : null,
          levelMin: tableInfo.levelMin ?? src.levelMin ?? null,
          levelMax: tableInfo.levelMax ?? src.levelMax ?? null,
          difficulty: src.type === "npc" ? src.difficulty : null,
          zone: src.zone || tableInfo.biome || null,
          spawnRate: src.spawnRate ?? null,
          dropChance: chanceInfo.chance,
          dropChancePerRoll: chanceInfo.perRollChance,
          rolls: chanceInfo.rolls,
          poolSize: chanceInfo.poolSize,
          zoneCoordinates: src.zoneCoordinates ?? null,
          worldCoordinates: src.worldCoordinates ?? null,
          rewardTableId: rt,
          worldSpawnLocation: src.worldSpawnLocation ?? null,
        });
      }
    }
  }

  // Save results unless DB writes are disabled
  if (!process.env.SKIP_DB) {
    for (const entry of lootInfo) {
      await saveLootInfoToDatabase(entry);
    }
  }

  const outPath = path.join(__dirname, "../json/loot-info.json");
  fs.writeFileSync(outPath, JSON.stringify(lootInfo, null, 2));

  return lootInfo.length;
}

export { processLootFiles };
