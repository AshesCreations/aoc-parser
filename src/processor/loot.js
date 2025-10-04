import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { saveLootInfoToDatabase, batchSaveLootInfoToDatabase, batchSaveMobLootInfoToDatabase } from "../db/operations.js";
import { getJson, getItemJson, extractLastQuotedValue } from "../utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for reward table lookups
const rewardTableCache = {};
const itemNameCache = {};
const chanceCache = {};
const poolSizeCache = {};
const rewardSources = {};
const rewardItemsCache = {};
const hierarchicalCache = {};

async function processLootFiles(directoryData) {
  const lootInfo = []; // All loot entries
  const mobLootInfo = []; // Monster loot entries only (gear items)
  const processingErrors = []; // Track all processing errors

  // Define walk function first
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

  // Define readJsonFilesParallel function
  async function readJsonFilesParallel(filePaths) {
    const promises = filePaths.map(async (filePath) => {
      try {
        const data = fs.readFileSync(filePath, "utf8");
        return JSON.parse(data);
      } catch (error) {
        processingErrors.push({
          type: 'file_read',
          file: filePath,
          error: error.message
        });
        return null;
      }
    });
    return await Promise.all(promises);
  }

  /**
   * Clean and normalize gear item names for better display
   * @param {string} rawName - Raw item name from data
   * @returns {string} Cleaned item name
   */
  function cleanItemName(rawName) {
    if (!rawName || typeof rawName !== "string") return "Unknown Item";

    let cleaned = rawName;

    // Remove common prefixes/suffixes that make names look weird
    cleaned = cleaned
      .replace(/^(Item_|Weapon_|Armor_|Gear_|Equipment_)/i, '') // Remove prefixes
      .replace(/(_Item|_Weapon|_Armor|_Gear|_Equipment)$/i, '') // Remove suffixes
      .replace(/_/g, ' ') // Replace underscores with spaces
      .replace(/\s+/g, ' ') // Normalize multiple spaces
      .trim(); // Remove leading/trailing spaces

    // Title case the name
    cleaned = cleaned.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );

    // Handle specific patterns that might still look weird
    cleaned = cleaned
      .replace(/\bOf\b/g, 'of') // Fix "Of" to "of"
      .replace(/\bThe\b/g, 'the') // Fix "The" to "the"
      .replace(/\bAnd\b/g, 'and') // Fix "And" to "and"
      .replace(/\s+/g, ' ') // Final space cleanup
      .trim();

    return cleaned || "Unknown Item";
  }

  /**
   * Find reward tables that contain a specific gear item
   * @param {string} baseDir - Root data directory
   * @param {string} itemId - Gear item GUID to search for
   * @returns {Set<string>} Set of reward table GUIDs
   */
  async function findRewardTablesForItem(baseDir, itemId) {
    const rewardTables = new Set();
    let processedTables = 0;
    let errorCount = 0;

    const rewardTableDir = path.join(baseDir, "Reward/RewardTable");
    if (!fs.existsSync(rewardTableDir)) return rewardTables;

    const rewardTableFiles = walk(rewardTableDir);
    
    // Process in batches for better performance
    const batchSize = 100;
    for (let i = 0; i < rewardTableFiles.length; i += batchSize) {
      const batch = rewardTableFiles.slice(i, i + batchSize);
      const batchData = await readJsonFilesParallel(batch);

      for (const rt of batchData) {
        processedTables++;
        if (!rt) {
          errorCount++;
          continue;
        }

        const rtId = rt.guid;
        if (!rtId || rtId === "0") continue;

        try {
          // Get all items in this reward table (including nested)
          const itemsInTable = getItemsFromRewardTable(baseDir, rtId);
          if (itemsInTable.includes(itemId)) {
            rewardTables.add(rtId);
          }
        } catch (error) {
          errorCount++;
          processingErrors.push({
            type: 'reward_table_scan',
            table: rtId,
            error: error.message
          });
        }
      }
    }

    console.log(`Reward table scan: ${processedTables} processed, ${errorCount} errors, ${rewardTables.size} matches for item`);
    return rewardTables;
  }

  /**
   * Find Population instances by directly scanning lootTablesIds
   * This bypasses the broken assetSetsIds linking
   * @param {string} baseDir - Root data directory
   * @param {string} rewardTableId - Reward table GUID to search for
   * @returns {Array} Array of Population instances with this loot table
   */
  async function findPopulationInstancesWithLootTable(baseDir, rewardTableId) {
    const matches = [];
    let processedInstances = 0;
    let errorCount = 0;

    const instanceDir = path.join(baseDir, "Population/PopulationInstance");
    if (!fs.existsSync(instanceDir)) return matches;

    const instanceFiles = walk(instanceDir);
    const instanceData = await readJsonFilesParallel(instanceFiles);

    for (const inst of instanceData) {
      processedInstances++;
      if (!inst) {
        errorCount++;
        continue;
      }

      try {
        // Check if this instance's lootTablesIds contains our reward table
        const lootTableIds = (inst.lootTablesIds || []).map(lt => lt.guid).filter(id => id && id !== "0");
        
        if (lootTableIds.includes(rewardTableId)) {
          // Load location data for this instance
          const locationInfo = await getPopulationLocationInfo(baseDir, inst.guid);
          
          matches.push({
            guid: inst.guid,
            name: inst.name || "Unknown Monster",
            levelMin: inst.levelMin || 1,
            levelMax: inst.levelMax || 1,
            respawnTime: inst.respawnTime || 300,
            ...locationInfo
          });
        }
      } catch (error) {
        errorCount++;
        processingErrors.push({
          type: 'population_instance_scan',
          instance: inst.guid,
          error: error.message
        });
      }
    }

    console.log(`Population scan: ${processedInstances} processed, ${errorCount} errors, ${matches.length} matches`);
    return matches;
  }

  /**
   * Get location information for a Population instance
   * @param {string} baseDir - Root data directory
   * @param {string} instanceId - Population instance GUID
   * @returns {Object} Location information
   */
  async function getPopulationLocationInfo(baseDir, instanceId) {
    const locationInfo = {
      zone: null,
      worldSpawnLocation: null,
      zoneCoordinates: null,
      worldCoordinates: null
    };

    try {
      // Load Population sets to find location mapping
      const setDir = path.join(baseDir, "Population/PopulationSet");
      if (fs.existsSync(setDir)) {
        const setFiles = walk(setDir);
        const setData = await readJsonFilesParallel(setFiles);
        
        const populationSet = setData.find(set => set && set.guid === instanceId);
        if (populationSet) {
          locationInfo.zoneCoordinates = populationSet.location;
          
          // Find world spawn information
          const worldSpawnDir = path.join(baseDir, "Population/WorldSpawn");
          if (fs.existsSync(worldSpawnDir)) {
            const worldSpawnFiles = walk(worldSpawnDir);
            const worldSpawnData = await readJsonFilesParallel(worldSpawnFiles);
            
            const worldSpawn = worldSpawnData.find(ws => ws && ws.guid === populationSet.setId);
            if (worldSpawn) {
              locationInfo.zone = worldSpawn.mapName;
              locationInfo.worldSpawnLocation = worldSpawn.name;
              locationInfo.worldCoordinates = worldSpawn.location;
            }
          }
        }
      }
    } catch (error) {
      processingErrors.push({
        type: 'location_lookup',
        instance: instanceId,
        error: error.message
      });
    }

    return locationInfo;
  }

  // NEW APPROACH: Start from gear items and work backwards to monsters
  console.log("Starting reverse loot processing: gear items → reward tables → monsters");

  // Get all gear items from the equipment processing
  const allGearItems = new Set();
  const gearItemData = new Map(); // itemId -> item data
  let gearProcessingErrors = 0;

  // Read equipment files to get all gear items
  const equipmentDir = path.join(directoryData, "Item/Item");
  if (fs.existsSync(equipmentDir)) {
    const equipmentFiles = walk(equipmentDir);
    const equipmentData = await readJsonFilesParallel(equipmentFiles);

    for (const item of equipmentData) {
      if (!item) {
        gearProcessingErrors++;
        continue;
      }

      try {
        // Check if this is gear using our isGearItem function
        if (isGearItem(directoryData, item.guid)) {
          allGearItems.add(item.guid);
          gearItemData.set(item.guid, {
            name: cleanItemName(extractLastQuotedValue(item.itemName) || item.name || "Unknown Item"),
            inventoryFilterType: item.inventoryFilterType,
            type: item.type,
            subType: item.subType,
            level: item.level || 1
          });
        }
      } catch (error) {
        gearProcessingErrors++;
        processingErrors.push({
          type: 'gear_processing',
          item: item.guid || 'unknown',
          error: error.message
        });
      }
    }
  }

  console.log(`Gear processing: ${allGearItems.size} gear items found, ${gearProcessingErrors} errors`);

  // Process each gear item to find its monster drops
  let totalMonsterLootEntries = 0;
  let processedGearItems = 0;

  // Process gear items in parallel batches for better performance
  const gearBatchSize = 10; // Process 10 items at once
  const gearItemArray = Array.from(allGearItems);

  for (let i = 0; i < gearItemArray.length; i += gearBatchSize) {
    const batch = gearItemArray.slice(i, i + gearBatchSize);
    
    const batchPromises = batch.map(async (itemId) => {
      const itemData = gearItemData.get(itemId);
      const itemLootEntries = [];
      
      try {
        // Find all reward tables that contain this gear item
        const rewardTables = await findRewardTablesForItem(directoryData, itemId);
        
        for (const rtId of rewardTables) {
          try {
            // Find Population instances that have this reward table in their lootTablesIds
            const populationInstances = await findPopulationInstancesWithLootTable(directoryData, rtId);
            
            for (const instance of populationInstances) {
              // Calculate drop chance and supporting roll data from this reward table
              const chanceDetails = computeItemChance(directoryData, rtId, itemId);
              const dropChance = chanceDetails.chance;

              // Generate level-based chances using available level data
              const levelMin = instance.levelMin ?? itemData.level ?? 1;
              const levelMax = instance.levelMax ?? levelMin;
              const mobLevel = (levelMin + levelMax) / 2;
              const levelChances = generateLevelBasedChances(dropChance, mobLevel);

              const mobLootEntry = {
                id: `${itemId}_${instance.guid || 'unknown'}_${rtId}`,
                itemId,
                itemName: itemData.name,
                monsterName: instance.name,
                npcName: instance.name || "Unknown Monster",
                levelMin: instance.levelMin,
                levelMax: instance.levelMax,
                zone: instance.zone,
                worldSpawnLocation: instance.worldSpawnLocation,
                zoneCoordinates: instance.zoneCoordinates,
                worldCoordinates: instance.worldCoordinates,
                dropChance: dropChance,
                dropChancePerRoll: chanceDetails.perRollChance,
                levelChances: levelChances,
                levelBasedChances: levelChances,
                difficulty: null, // Could be enhanced from Population asset data
                spawnRate: instance.respawnTime,
                rewardTableId: rtId,
                inventoryFilterType: itemData.inventoryFilterType,
                type: itemData.type,
                subType: itemData.subType,
                rolls: chanceDetails.rolls,
                poolSize: chanceDetails.poolSize,
              };

              itemLootEntries.push(mobLootEntry);
            }
          } catch (error) {
            processingErrors.push({
              type: 'reward_table_processing',
              item: itemId,
              rewardTable: rtId,
              error: error.message
            });
          }
        }
      } catch (error) {
        processingErrors.push({
          type: 'item_processing',
          item: itemId,
          error: error.message
        });
      }
      
      return itemLootEntries;
    });

    const batchResults = await Promise.all(batchPromises);
    
    // Flatten results and add to main collection
    for (const itemResults of batchResults) {
      mobLootInfo.push(...itemResults);
      totalMonsterLootEntries += itemResults.length;
      processedGearItems++;
    }

    // Progress update every batch
    console.log(`Processed ${Math.min(i + gearBatchSize, gearItemArray.length)}/${gearItemArray.length} gear items...`);
  }

  console.log(`Monster loot processing: ${totalMonsterLootEntries} entries created from ${processedGearItems} gear items`);

  // Save results unless DB writes are disabled
  if (!process.env.SKIP_DB) {
    console.log(`Saving ${lootInfo.length} total loot entries and ${mobLootInfo.length} monster loot entries to database...`);

    // Save all loot entries to DatabaseLootInfo
    try {
      await batchSaveLootInfoToDatabase(lootInfo);
      console.log(`General loot save complete: ${lootInfo.length} successful, 0 failed`);
    } catch (error) {
      console.error(`Error saving general loot entries: ${error.message}`);
      console.log(`General loot save complete: 0 successful, ${lootInfo.length} failed`);
    }

    // Save monster loot entries to DatabaseMobLootInfo
    if (mobLootInfo.length > 0) {
      try {
        await batchSaveMobLootInfoToDatabase(mobLootInfo);
        console.log(`Monster loot save complete: ${mobLootInfo.length} successful, 0 failed`);
      } catch (error) {
        console.error(`Error saving monster loot entries: ${error.message}`);
        console.log(`Monster loot save complete: 0 successful, ${mobLootInfo.length} failed`);
      }
    }
  }

  // Report processing errors to file for cleanup
  if (processingErrors.length > 0) {
    const errorLogPath = path.join(__dirname, "../logs/processing-errors.log");
    const errorReport = processingErrors.map(err => 
      `[${err.type}] ${err.file || err.item || err.table || err.instance || 'unknown'}: ${err.error}`
    ).join('\n');
    
    try {
      fs.writeFileSync(errorLogPath, errorReport);
      console.log(`Error report: ${processingErrors.length} issues logged to ${errorLogPath}`);
    } catch (writeError) {
      console.error(`Failed to write error log: ${writeError.message}`);
    }
  }

  if (process.env.WRITE_LOOT_JSON) {
    const outPath = path.join(__dirname, "../json/loot-info-enhanced.json");
    fs.writeFileSync(outPath, JSON.stringify(lootInfo, null, 2));
  }

  return lootInfo;
}

/**
 * Find monsters that drop a specific gear item by following reward table hierarchies
 * @param {string} baseDir - Root data directory
 * @param {string} rtId - Reward table GUID to start from
 * @param {string} targetItemId - The gear item we're looking for
 * @returns {Array} Array of monster information objects
 */
async function findMonstersForRewardTable(baseDir, rtId, targetItemId) {
  const monsters = [];
  const visited = new Set();

  // First, let's trace the reward table hierarchy to find monster-related tables
  function traverseRewardTables(rtId, depth = 0) {
    if (!rtId || rtId === "0" || visited.has(rtId) || depth > 10) return;
    visited.add(rtId);

    const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
    if (!data || Object.keys(data).length === 0) return;

    // Check if this reward table has level requirements (indicates monster-specific table)
    const tableInfo = getRewardTableInfo(baseDir, rtId);
    
    // Look for monster name patterns in the reward table name
    const tableName = data.name || "";
    const monsterNameMatch = tableName.match(/^(.+?)(_Loot|_Drop|_Reward|_Table|Loot|Drop|Reward|Table)/i);
    
    if (monsterNameMatch && (tableInfo.levelMin || tableInfo.levelMax)) {
      const monsterName = monsterNameMatch[1].replace(/_/g, ' ').trim();
      
      // Calculate drop chance for this item in this reward table
      const dropChance = computeItemChance(baseDir, rtId, targetItemId).chance;
      
      if (dropChance > 0) {
        const mobLevel = tableInfo.levelMin || tableInfo.levelMax || 1;
        const levelChances = generateLevelBasedChances(dropChance, mobLevel);

        monsters.push({
          name: monsterName,
          levelMin: tableInfo.levelMin,
          levelMax: tableInfo.levelMax,
          biome: tableInfo.biome,
          dropChance,
          levelChances,
          difficulty: null,
          rewardTableId: rtId
        });
      }
    }

    // Continue traversing sub-tables
    const subIds = data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
    for (const subId of subIds) {
      traverseRewardTables(subId, depth + 1);
    }
  }

  traverseRewardTables(rtId);
  return monsters;
}

/**
 * Find Population instances that match monster criteria and have the reward table
 * @param {string} baseDir - Root data directory
 * @param {Object} monster - Monster information object
 * @returns {Array} Array of matching Population instances with location data
 */
async function findMatchingPopulationInstances(baseDir, monster) {
  const matches = [];

  // Load all Population data as you suggested
  const populationAssets = new Map();
  const populationInstances = new Map();
  const populationSets = new Map();
  const worldSpawns = new Map();

  // Load PopulationAsset files (contain monster info like names, levels)
  const assetDir = path.join(baseDir, "Population/PopulationAsset");
  if (fs.existsSync(assetDir)) {
    const assetFiles = walk(assetDir);
    const assetData = await readJsonFilesParallel(assetFiles);
    
    for (const asset of assetData) {
      if (!asset) continue;
      populationAssets.set(asset.guid, asset);
    }
  }

  // Load PopulationInstance files (contain lootTablesIds and spawn info)
  const instanceDir = path.join(baseDir, "Population/PopulationInstance");
  if (fs.existsSync(instanceDir)) {
    const instanceFiles = walk(instanceDir);
    const instanceData = await readJsonFilesParallel(instanceFiles);
    
    for (const instance of instanceData) {
      if (!instance) continue;
      populationInstances.set(instance.guid, instance);
    }
  }

  // Load PopulationSet files (contain location mapping)
  const setDir = path.join(baseDir, "Population/PopulationSet");
  if (fs.existsSync(setDir)) {
    const setFiles = walk(setDir);
    const setData = await readJsonFilesParallel(setFiles);
    
    for (const set of setData) {
      if (!set) continue;
      populationSets.set(set.guid, set);
    }
  }

  // Load WorldSpawn files (contain zone/map information)
  const worldSpawnDir = path.join(baseDir, "Population/WorldSpawn");
  if (fs.existsSync(worldSpawnDir)) {
    const worldSpawnFiles = walk(worldSpawnDir);
    const worldSpawnData = await readJsonFilesParallel(worldSpawnFiles);
    
    for (const spawn of worldSpawnData) {
      if (!spawn) continue;
      worldSpawns.set(spawn.guid, spawn);
    }
  }

  // Now find Population instances that have our reward table in their lootTablesIds
  for (const [instanceId, instance] of populationInstances) {
    if (!instance.lootTablesIds || !Array.isArray(instance.lootTablesIds)) continue;

    // Check if this instance has our reward table (or any nested table that leads to it)
    const hasRewardTable = instance.lootTablesIds.some(loot => {
      if (loot.guid === monster.rewardTableId) return true;
      
      // Also check if any of the nested reward tables from this loot table contain our target
      const nestedTables = getAllNestedRewardTables(baseDir, [loot.guid]);
      return nestedTables.includes(monster.rewardTableId);
    });

    if (!hasRewardTable) continue;

    // Check level matching
    const matchesLevel = (!monster.levelMin || !instance.levelMin || instance.levelMin >= monster.levelMin - 5) &&
                        (!monster.levelMax || !instance.levelMax || instance.levelMax <= monster.levelMax + 5);

    // Try to match monster name with instance name or find matching PopulationAsset
    let matchesName = false;
    let assetName = instance.name || "";

    // Search for matching PopulationAsset by name
    for (const [assetId, asset] of populationAssets) {
      if (!asset.name) continue;
      
      if (asset.name.toLowerCase().includes(monster.name.toLowerCase()) ||
          monster.name.toLowerCase().includes(asset.name.toLowerCase())) {
        matchesName = true;
        assetName = asset.name;
        break;
      }
    }

    // Also check direct instance name matching
    if (!matchesName && instance.name) {
      matchesName = instance.name.toLowerCase().includes(monster.name.toLowerCase()) ||
                   monster.name.toLowerCase().includes(instance.name.toLowerCase());
      if (matchesName) {
        assetName = instance.name;
      }
    }

    // For level-based monster names, be more lenient with name matching
    if (!matchesName && monster.name.includes("Level")) {
      matchesName = true;
      assetName = instance.name || "Unknown Monster";
    }

    if (matchesLevel && matchesName) {
      // Find location data for this instance
      let zone = null;
      let worldSpawnLocation = null;
      let zoneCoordinates = null;
      let worldCoordinates = null;

      // Find the PopulationSet that contains location info
      const set = populationSets.get(instanceId);
      if (set) {
        zoneCoordinates = set.location;
        
        // Find the WorldSpawn that contains zone info
        const worldSpawn = worldSpawns.get(set.setId);
        if (worldSpawn) {
          zone = worldSpawn.mapName;
          worldSpawnLocation = worldSpawn.name;
          worldCoordinates = worldSpawn.location;
        }
      }

      matches.push({
        guid: instance.guid,
        name: assetName,
        levelMin: instance.levelMin,
        levelMax: instance.levelMax,
        respawnTime: instance.respawnTime,
        zone,
        worldSpawnLocation,
        zoneCoordinates,
        worldCoordinates,
      });
    }
  }

  return matches;
}
function isGearItem(baseDir, itemId) {
  if (!itemId) return false;

  const data = getItemJson(baseDir, "/Item/Item", itemId);
  if (!data || Object.keys(data).length === 0) return false;

  // Check inventory filter type first - most reliable indicator
  const inventoryFilterType = data.inventoryFilterType;
  if (inventoryFilterType === "Equipment") {
    return true;
  }

  // Fallback to type and subtype checks
  const itemType = data.type?.toLowerCase();
  const subType = data.subType?.toLowerCase();

  // Weapons
  if (itemType === "weapon" || subType?.includes("weapon")) return true;

  // Armor types - check against all possible gear slots
  const gearSlots = ["Back", "Chest", "EarLeft", "EarRight", "Feet", "Hands", "Belt", "Helmet", "Legs", "Necklace", "Primary", "Ranged", "RangedOffHand", "RingLeft", "RingRight", "Secondary", "Shirt", "Shoulders", "ToolBelt", "Undergarment", "Wrists"];
  if (gearSlots.some(slot => subType?.toLowerCase().includes(slot.toLowerCase()))) return true;

  return false;
}

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
 * Clean and normalize gear item names for better display
 * @param {string} rawName - Raw item name from data
 * @returns {string} Cleaned item name
 */
function cleanItemName(rawName) {
  if (!rawName || typeof rawName !== "string") return "Unknown Item";

  let cleaned = rawName;

  // Remove common prefixes/suffixes that make names look weird
  cleaned = cleaned
    .replace(/^(Item_|Weapon_|Armor_|Gear_|Equipment_)/i, '') // Remove prefixes
    .replace(/(_Item|_Weapon|_Armor|_Gear|_Equipment)$/i, '') // Remove suffixes
    .replace(/_/g, ' ') // Replace underscores with spaces
    .replace(/\s+/g, ' ') // Normalize multiple spaces
    .trim(); // Remove leading/trailing spaces

  // Title case the name
  cleaned = cleaned.replace(/\w\S*/g, (txt) => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );

  // Handle specific patterns that might still look weird
  cleaned = cleaned
    .replace(/\bOf\b/g, 'of') // Fix "Of" to "of"
    .replace(/\bThe\b/g, 'the') // Fix "The" to "the"
    .replace(/\bAnd\b/g, 'and') // Fix "And" to "and"
    .replace(/\s+/g, ' ') // Final space cleanup
    .trim();

  return cleaned || "Unknown Item";
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
  const rawName = extractLastQuotedValue(data.itemName) || data.name || "";
  const cleanedName = cleanItemName(rawName);
  itemNameCache[itemId] = cleanedName;
  return cleanedName;
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
 * Recursively collect all reward table GUIDs reachable from a set of root reward tables.
 * This follows subTableIds to find all nested reward tables.
 * @param {string} baseDir - Root data directory
 * @param {string[]} rootTableIds - Array of root reward table GUIDs
 * @returns {string[]} Array of all reachable reward table GUIDs
 */
function getAllNestedRewardTables(baseDir, rootTableIds) {
  const visited = new Set();
  const result = new Set();

  function traverse(rtId) {
    if (!rtId || rtId === "0" || visited.has(rtId)) return;
    visited.add(rtId);
    result.add(rtId);

    const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
    if (!data || Object.keys(data).length === 0) return;

    const subIds = data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
    for (const subId of subIds) {
      traverse(subId);
    }
  }

  for (const rootId of rootTableIds) {
    traverse(rootId);
  }

  return Array.from(result);
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
      if (id && !shouldFilterItem(baseDir, id)) {
        items.add(id);
      }
    }
  }

  // Add cycle detection to prevent infinite recursion
  const visited = new Set();
  const maxDepth = 50; // Prevent excessive recursion

  function traverseSubTables(subIds, depth = 0) {
    if (depth >= maxDepth) {
      return; // Skip max depth warnings
    }

    for (const subId of subIds) {
      if (!subId || subId === "0" || visited.has(subId)) continue;
      visited.add(subId);

      try {
        const subItems = getItemsFromRewardTable(baseDir, subId);
        for (const it of subItems) {
          if (!shouldFilterItem(baseDir, it)) {
            items.add(it);
          }
        }
      } catch (error) {
        // Skip subtable errors silently
      }
    }
  }

  const subIds =
    data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
  traverseSubTables(subIds);

  rewardItemsCache[rtId] = Array.from(items);
  return rewardItemsCache[rtId];
}

/**
 * Check if an item should be filtered out (Resources, Glint, etc.)
 * @param {string} baseDir - Root data directory
 * @param {string} itemId - Item GUID to check
 * @returns {boolean} True if item should be filtered out
 */
function shouldFilterItem(baseDir, itemId) {
  if (!itemId || itemId === "0") return true;

  const data = getItemJson(baseDir, "/Item/Item", itemId);
  if (!data || Object.keys(data).length === 0) return true;

  // Filter out Resources and Glint
  const inventoryFilterType = data.inventoryFilterType;
  if (inventoryFilterType === "Material" || inventoryFilterType === "Glint") {
    return true;
  }

  // Also check tags for Resource-related items
  if (data.gameplayTags?.gameplayTags) {
    const tags = data.gameplayTags.gameplayTags.map(tag => tag.tagName.toLowerCase());
    if (tags.some(tag => tag.includes("resource") || tag.includes("glint"))) {
      return true;
    }
  }

  return false;
}
function calculateLevelModifier(charLevel, mobLevel) {
  const levelDiff = Math.abs(charLevel - mobLevel);

  // Within 7 levels: full chance
  if (levelDiff <= 7) return 1.0;

  // Beyond 7 levels: reduced chance, scaling down to 0 at level diff of 15+
  if (levelDiff <= 15) {
    return Math.max(0.1, 1.0 - (levelDiff - 7) * 0.15);
  }

  // Too far apart: minimal chance
  return 0.05;
}

/**
 * Generate drop chance list for different character levels relative to mob level.
 * @param {number} mobLevel - Mob level
 * @returns {Array<{level: number, chance: number}>}
 */
function generateLevelBasedChances(baseChance, mobLevel) {
  const chances = [];
  const minLevel = Math.max(1, mobLevel - 7);
  const maxLevel = mobLevel + 7;

  for (let level = minLevel; level <= maxLevel; level++) {
    const modifier = calculateLevelModifier(level, mobLevel);
    chances.push({
      level: level,
      chance: baseChance * modifier
    });
  }

  return chances;
}

/**
 * Recursively compute the probability that a reward table yields a given item.
 * Enhanced to handle hierarchical reward tables with weights and biome/level predicates.
 * @param {string} baseDir - Root data directory
 * @param {string} rtId - Reward table GUID
 * @param {string} itemId - Item GUID to search for
 * @param {Object} context - Context with biome and level info
 * @returns {{chance:number, perRollChance:number, rolls:number, poolSize:number, biome:string|null, levelMin:number|null, levelMax:number|null}}
 */
function computeItemChance(baseDir, rtId, itemId, context = {}) {
  const key = `${rtId}_${itemId}_${JSON.stringify(context)}`;
  if (!rtId || rtId === "0") {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: 0,
      biome: null,
      levelMin: null,
      levelMax: null
    };
    return chanceCache[key];
  }
  if (chanceCache[key]) return chanceCache[key];

  const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
  const totalPool = getPoolSize(baseDir, rtId);
  const tableInfo = getRewardTableInfo(baseDir, rtId);

  if (!data || Object.keys(data).length === 0) {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: totalPool,
      biome: tableInfo.biome,
      levelMin: tableInfo.levelMin,
      levelMax: tableInfo.levelMax
    };
    return chanceCache[key];
  }

  // Check biome predicate
  if (tableInfo.biome && context.biome && tableInfo.biome !== context.biome) {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: totalPool,
      biome: tableInfo.biome,
      levelMin: tableInfo.levelMin,
      levelMax: tableInfo.levelMax
    };
    return chanceCache[key];
  }

  // Check level predicate
  if (tableInfo.levelMin && context.level && context.level < tableInfo.levelMin) {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: totalPool,
      biome: tableInfo.biome,
      levelMin: tableInfo.levelMin,
      levelMax: tableInfo.levelMax
    };
    return chanceCache[key];
  }
  if (tableInfo.levelMax && context.level && context.level > tableInfo.levelMax) {
    chanceCache[key] = {
      chance: 0,
      perRollChance: 0,
      rolls: 0,
      poolSize: totalPool,
      biome: tableInfo.biome,
      levelMin: tableInfo.levelMin,
      levelMax: tableInfo.levelMax
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
          biome: tableInfo.biome,
          levelMin: tableInfo.levelMin,
          levelMax: tableInfo.levelMax
        };
        return chanceCache[key];
      }
    }
  }

  // Table with subtables - handle hierarchical system
  const subIds =
    data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
  if (subIds.length) {
    const rolls = data.numberOfSubtablesToSelect || 1;
    let weights = data.weightsPerSubTable || [];

    // Handle expression-based weights
    if (!weights.length && Array.isArray(data.expressionWeightsPerSubTable)) {
      weights = data.expressionWeightsPerSubTable.map((e) => {
        const match = e.expression.match(/:(\d+)/);
        const n = match ? parseFloat(match[1]) : NaN;
        return isNaN(n) ? 1 : n;
      });
    }

    // Handle percentage-based weights
    if (!weights.length && Array.isArray(data.percentagePerSubTable)) {
      weights = data.percentagePerSubTable.map((p) => {
        const match = p.expression.match(/EvalFormula.*:(\d+)/);
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
      const subChance = computeItemChance(baseDir, subId, itemId, context);
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
      biome: tableInfo.biome,
      levelMin: tableInfo.levelMin,
      levelMax: tableInfo.levelMax
    };
    return chanceCache[key];
  }

  chanceCache[key] = {
    chance: 0,
    perRollChance: 0,
    rolls: 0,
    poolSize: totalPool,
    biome: tableInfo.biome,
    levelMin: tableInfo.levelMin,
    levelMax: tableInfo.levelMax
  };
  return chanceCache[key];
}

/**
 * Add crafting sources for items
 * @param {string} baseDir
 * @param {string} itemId
 */
function addCraftingSources(baseDir, itemId) {
  // Skip if item should be filtered
  if (shouldFilterItem(baseDir, itemId)) return;

  // Search for crafting recipes that produce this item
  const craftingDir = path.join(baseDir, "Crafting/CraftingRecipeDef");
  if (fs.existsSync(craftingDir)) {
    for (const file of walk(craftingDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data.rewardId && data.rewardId.guid && data.rewardId.guid !== "0") {
        const rewardTableData = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${data.rewardId.guid}.json`);
        if (rewardTableData) {
          const items = getItemsFromRewardTable(baseDir, data.rewardId.guid);
          if (items.includes(itemId)) {
            addRewardSource(data.rewardId.guid, {
              type: "crafting",
              recipeName: data.overrideName || data.name || "Unknown Recipe",
              profession: data.professionId?.name || "Unknown",
              certification: data.certificationLevelId?.name || "Unknown",
              materials: data.primaryResourceCosts || []
            });
          }
        }
      }
    }
  }
}

/**
 * Add gear token sources for items
 * @param {string} baseDir
 * @param {string} itemId
 */
function addGearTokenSources(baseDir, itemId) {
  // Skip if item should be filtered
  if (shouldFilterItem(baseDir, itemId)) return;

  // Search for items that have activation loot tables containing this item
  const itemDir = path.join(baseDir, "Item/Item");
  if (fs.existsSync(itemDir)) {
    for (const file of walk(itemDir)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data.activationLootBoxData?.rewardTable?.guid && data.activationLootBoxData.rewardTable.guid !== "0") {
        const rewardTableData = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${data.activationLootBoxData.rewardTable.guid}.json`);
        if (rewardTableData) {
          const items = getItemsFromRewardTable(baseDir, data.activationLootBoxData.rewardTable.guid);
          if (items.includes(itemId)) {
            addRewardSource(data.activationLootBoxData.rewardTable.guid, {
              type: "gear_token",
              tokenName: extractLastQuotedValue(data.itemName) || data.name || "Unknown Token",
              tokenLevel: data.level || 1
            });
          }
        }
      }
    }
  }

  // Build NPC loot sources with enhanced coordinate tracking
  for (const [assetId, asset] of Object.entries(assets)) {
    const assetLootTables = (asset.lootTablesIds || []).map((l) => l.guid).filter((rt) => rt && rt !== "0");
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
            lootTables: (inst.lootTablesIds || []).map((l) => l.guid).filter((rt) => rt && rt !== "0"),
          });
        }
      }
    }
    const hasTables =
      assetLootTables.length || spawnInfos.some((s) => (s.lootTables || []).length);
    if (!hasTables) continue;
    const difficulty =
      asset.gameplayTags && asset.gameplayTags.gameplayTags
        ? asset.gameplayTags.gameplayTags.map((t) => t.tagName).join(" ")
        : null;
    for (const info of spawnInfos) {
      const tables = [...assetLootTables, ...(info.lootTables || [])];
      // Get ALL nested reward tables from the monster's loot tables
      const allNestedTables = getAllNestedRewardTables(directoryData, tables);
      for (const rt of allNestedTables) {
        if (rt && rt !== "0") {
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
  }

  // Add crafting sources for all items
  console.log("Processing crafting sources...");
  // Temporarily commenting out problematic orphaned code
  /*
  const allItems = new Set();
  for (const rt of Object.keys(rewardSources)) {
    if (!rt || rt === "0") continue;
    const items = getItemsFromRewardTable(directoryData, rt);
    for (const item of items) {
      allItems.add(item);
    }
  }

  // Add crafting sources for all items (parallel processing)
  console.log("Processing crafting sources...");
  const validItems = Array.from(allItems).filter(itemId => !shouldFilterItem(directoryData, itemId));
  const craftingPromises = validItems.map(itemId => addCraftingSources(directoryData, itemId));
  await Promise.all(craftingPromises);

  // Add gear token sources for all items (parallel processing)
  console.log("Processing gear token sources...");
  const tokenPromises = validItems.map(itemId => addGearTokenSources(directoryData, itemId));
  await Promise.all(tokenPromises);
  */

  // Combine reward sources with items and calculate enhanced probabilities
  console.log(`Processing ${Object.keys(rewardSources).length} reward tables...`);
  let processedTables = 0;
  const totalTables = Object.keys(rewardSources).length;

  for (const [rt, sources] of Object.entries(rewardSources)) {
    if (!rt || rt === "0" || !sources.length) continue;
    const items = getItemsFromRewardTable(directoryData, rt);
    if (!items.length) continue;
    const tableInfo = getRewardTableInfo(directoryData, rt);

    processedTables++;
    if (processedTables % 100 === 0) {
      console.log(`Processed ${processedTables}/${totalTables} reward tables...`);
    }

    for (const item of items) {
      // Additional check to ensure filtered items are skipped
      if (shouldFilterItem(directoryData, item)) continue;
      const itemName = getItemName(directoryData, item);
      if (!itemName) continue;

      for (const src of sources) {
        if (src.type === "npc" && !src.zone && !src.worldSpawnLocation && !src.zoneCoordinates) {
          continue; // skip NPC drops without any location data
        }
        if (src.type !== "quest" && src.type !== "npc" && src.type !== "crafting" && src.type !== "gear_token") {
          continue; // only keep supported source types
        }

        let id;
        if (src.type === "quest") {
          id = `${item}_${src.questName}_${src.step}`;
        } else if (src.type === "crafting") {
          id = `${item}_${src.recipeName}_crafting`;
        } else if (src.type === "gear_token") {
          id = `${item}_${src.tokenName}_token`;
        } else {
          const coord = src.zoneCoordinates || { x: 0, y: 0, z: 0 };
          id = `${item}_${src.npcName}_${coord.x}_${coord.y}_${coord.z}`;
        }

        // Calculate base chance
        const context = {
          biome: src.zone === "Tropical" ? "Tropics" : null,
          level: src.levelMin || src.levelMax || tableInfo.levelMin || tableInfo.levelMax
        };
        const chanceInfo = computeItemChance(directoryData, rt, item, context);

        // Generate level-based chances for NPCs
        let levelChances = [];
        if (src.type === "npc" && (src.levelMin || src.levelMax)) {
          const mobLevel = src.levelMin || src.levelMax;
          levelChances = generateLevelBasedChances(chanceInfo.chance, mobLevel);
        }

        // Create loot entry
        const lootEntry = {
          id,
          itemId: item,
          itemName,
          questName: src.type === "quest" ? src.questName : null,
          step: src.type === "quest" ? src.step : null,
          npcName: src.type === "npc" ? src.npcName : null,
          recipeName: src.type === "crafting" ? src.recipeName : null,
          tokenName: src.type === "gear_token" ? src.tokenName : null,
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
          sourceType: src.type,
          levelBasedChances: levelChances,
          materials: src.type === "crafting" ? src.materials : null,
          profession: src.type === "crafting" ? src.profession : null,
          certification: src.type === "crafting" ? src.certification : null,
          tokenLevel: src.type === "gear_token" ? src.tokenLevel : null
        };

        // Add to general loot info
        lootInfo.push(lootEntry);

        // Add to monster loot info if it's gear from monsters
        if (src.type === "npc" && isGearItem(directoryData, item)) {
          // Create a simplified entry for monster loot (remove quest/crafting fields)
          const mobLootEntry = {
            id,
            itemId: item,
            itemName,
            npcName: src.npcName,
            levelMin: tableInfo.levelMin ?? src.levelMin ?? null,
            levelMax: tableInfo.levelMax ?? src.levelMax ?? null,
            difficulty: src.difficulty,
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
            levelBasedChances: levelChances
          };
          mobLootInfo.push(mobLootEntry);
        }
      }
    }
}

/**
 * Find monster information by following a reward table hierarchy down to the base
  if (!process.env.SKIP_DB) {
    console.log(`Saving ${lootInfo.length} total loot entries and ${mobLootInfo.length} monster loot entries to database...`);

    // Save all loot entries to DatabaseLootInfo
    try {
      await batchSaveLootInfoToDatabase(lootInfo);
      console.log(`General loot save complete: ${lootInfo.length} successful, 0 failed`);
    } catch (error) {
      console.error(`Error saving general loot entries: ${error.message}`);
      console.log(`General loot save complete: 0 successful, ${lootInfo.length} failed`);
    }

    // Save monster loot entries to DatabaseMobLootInfo
    if (mobLootInfo.length > 0) {
      try {
        await batchSaveMobLootInfoToDatabase(mobLootInfo);
        console.log(`Monster loot save complete: ${mobLootInfo.length} successful, 0 failed`);
      } catch (error) {
        console.error(`Error saving monster loot entries: ${error.message}`);
        console.log(`Monster loot save complete: 0 successful, ${mobLootInfo.length} failed`);
      }
    }

  if (process.env.WRITE_LOOT_JSON) {
    const outPath = path.join(__dirname, "../json/loot-info-enhanced.json");
    fs.writeFileSync(outPath, JSON.stringify(lootInfo, null, 2));
  }

  return lootInfo;
}

/**
 * Find monster information by following a reward table hierarchy down to the base
 * @param {string} baseDir - Root data directory
 * @param {string} rtId - Reward table GUID to start from
 * @param {string} targetItemId - The gear item we're looking for
 * @returns {Array} Array of monster information objects
 */
async function findMonstersForRewardTable(baseDir, rtId, targetItemId) {
  const monsters = [];
  const visited = new Set();

  function traverse(rtId) {
    if (!rtId || rtId === "0" || visited.has(rtId)) return;
    visited.add(rtId);

    const data = getJson(baseDir, "/Reward/RewardTable", `RewardTable_${rtId}.json`);
    if (!data || Object.keys(data).length === 0) return;

    // Check if this reward table has monster information in its predicates
    const tableInfo = getRewardTableInfo(baseDir, rtId);
    if (tableInfo.levelMin || tableInfo.levelMax) {
      // This table has level requirements - it might be monster-specific
      const monsterName = extractMonsterNameFromRewardTable(data, tableInfo);

      if (monsterName) {
        // Calculate drop chance for this specific item in this table
        const dropChance = computeItemChance(baseDir, rtId, targetItemId).chance;
        const mobLevel = tableInfo.levelMin || tableInfo.levelMax || 1;
        const levelChances = generateLevelBasedChances(dropChance, mobLevel);

        monsters.push({
          name: monsterName,
          levelMin: tableInfo.levelMin,
          levelMax: tableInfo.levelMax,
          biome: tableInfo.biome,
          dropChance,
          levelChances,
          difficulty: null, // Will be determined from Population data
          rewardTableId: rtId
        });
      }
    }

    // Continue traversing sub-tables
    const subIds = data.subTablesIds?.map((s) => s.guid).filter((id) => id && id !== "0") || [];
    for (const subId of subIds) {
      traverse(subId);
    }
  }

  traverse(rtId);
  return monsters;
}

/**
 * Extract monster name from reward table data
 * @param {Object} rewardTableData - The reward table JSON data
 * @param {Object} tableInfo - Table info with level/biome data
 * @returns {string|null} Monster name or null if not found
 */
function extractMonsterNameFromRewardTable(rewardTableData, tableInfo) {
  // Look for monster names in the reward table name or description
  const tableName = rewardTableData.name || "";
  const description = rewardTableData.description || "";

  // Common monster name patterns in reward table names
  const monsterPatterns = [
    /(.+)_Loot/i,
    /(.+)_Drop/i,
    /(.+)_Reward/i,
    /(.+)_Table/i
  ];

  for (const pattern of monsterPatterns) {
    const match = tableName.match(pattern) || description.match(pattern);
    if (match && match[1]) {
      return match[1].replace(/_/g, ' ');
    }
  }

  // If no pattern matches, try to infer from level range and biome
  if (tableInfo.levelMin && tableInfo.levelMax) {
    const levelRange = `${tableInfo.levelMin}-${tableInfo.levelMax}`;
    const biome = tableInfo.biome || "Unknown";
    return `Level ${levelRange} ${biome} Monster`;
  }

  return null;
}

/**
 * Find Population instances that match the monster criteria
 * @param {string} baseDir - Root data directory
 * @param {Object} monster - Monster information object
 * @returns {Array} Array of matching Population instances
 */
async function findMatchingPopulationInstances(baseDir, monster) {
  const matches = [];

  // Load Population data
  const worldSpawns = {};
  const setMap = {};

  // Load world spawn data
  const worldSpawnDir = path.join(baseDir, "Population/WorldSpawn");
  if (fs.existsSync(worldSpawnDir)) {
    const worldSpawnFiles = walk(worldSpawnDir);
    const worldSpawnData = await readJsonFilesParallel(worldSpawnFiles);
    for (const data of worldSpawnData) {
      if (!data) continue;
      worldSpawns[data.guid] = {
        name: data.name || "",
        mapName: data.mapName || "",
        location: data.location || null,
      };
    }
  }

  // Load set data
  const setDir = path.join(baseDir, "Population/PopulationSet");
  if (fs.existsSync(setDir)) {
    const setFiles = walk(setDir);
    const setData = await readJsonFilesParallel(setFiles);
    for (const data of setData) {
      if (!data) continue;
      setMap[data.guid] = data;
    }
  }

  // Load Population instances
  const instanceDir = path.join(baseDir, "Population/PopulationInstance");
  if (fs.existsSync(instanceDir)) {
    const instanceFiles = walk(instanceDir);
    const instanceData = await readJsonFilesParallel(instanceFiles);

    for (const inst of instanceData) {
      if (!inst) continue;

      // Check if this instance matches our monster criteria
      const matchesLevel = (!monster.levelMin || inst.levelMin >= monster.levelMin) &&
                          (!monster.levelMax || inst.levelMax <= monster.levelMax);

      const matchesName = !monster.name || inst.name?.toLowerCase().includes(monster.name.toLowerCase()) ||
                         monster.name.toLowerCase().includes(inst.name?.toLowerCase() || "");

      if (matchesLevel && matchesName) {
        // Find location data for this instance
        const instId = inst.guid;
        const s = setMap[instId];
        const w = s ? worldSpawns[s.setId] : null;

        matches.push({
          guid: inst.guid,
          name: inst.name,
          levelMin: inst.levelMin,
          levelMax: inst.levelMax,
          respawnTime: inst.respawnTime,
          zone: w ? w.mapName : null,
          worldSpawnLocation: w ? w.name : null,
          zoneCoordinates: s ? s.location : null,
          worldCoordinates: w ? w.location : null,
        });
      }
    }
  }

  return matches;
}
}

export { processLootFiles };
