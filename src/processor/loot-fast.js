import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { batchSaveMobLootInfoToDatabase } from "../db/operations.js";
import { initDatabase, setupConnection } from "../db/config.js";
import { getJson, getItemJson, extractLastQuotedValue } from "../utils.js";
import { directoryData } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Clean and normalize gear item names for better display
 */
function cleanGearName(rawName) {
  if (!rawName || typeof rawName !== "string") return "Unknown Item";

  let cleaned = rawName
    .replace(/^(Item_|Weapon_|Armor_|Gear_|Equipment_)/i, '')
    .replace(/(_Item|_Weapon|_Armor|_Gear|_Equipment)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Title case
  cleaned = cleaned.replace(/\w\S*/g, (txt) => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );

  return cleaned || "Unknown Item";
}

/**
 * Check if an item is gear based on equipment slots
 */
function isGearItem(item) {
  const gearSlots = [
    "Back", "Chest", "EarLeft", "EarRight", "Feet", "Hands", "Belt", 
    "Helmet", "Legs", "Necklace", "Primary", "Ranged", "RangedOffHand", 
    "RingLeft", "RingRight", "Secondary", "Shirt", "Shoulders", 
    "ToolBelt", "Undergarment", "Wrists"
  ];
  
  return item?.equipSlot && gearSlots.includes(item.equipSlot);
}

/**
 * Build lookup tables once for fast processing
 */
async function buildLookupTables() {
  const startTime = Date.now();

  console.log("� Building comprehensive item → reward tables mapping...");
  const itemToRewardTables = await buildItemToRewardTablesMap();

  console.log("📋 Building population → reward tables lookup...");
  const popToRewards = await buildPopulationLookup();
  console.log(`   Found ${Object.keys(popToRewards).length} population instances with loot`);

  console.log("📋 Building population info lookup...");
  const popInfo = await buildPopulationInfoLookup();
  console.log(`   Found ${Object.keys(popInfo).length} population info entries`);

  console.log("🔍 Finding direct item drops...");
  const directDrops = await findDirectItemDrops();

  console.log("📋 Building recipe → item relationships...");
  const recipeToItem = await buildRecipeToItemMap();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`✅ All lookup tables built in ${elapsed.toFixed(2)}s`);

  return { itemToRewardTables, popToRewards, popInfo, directDrops, recipeToItem };
}

/**
 * Build comprehensive item → reward tables mapping with full hierarchy traversal
 */
async function buildItemToRewardTablesMap() {
  console.log("🔗 Building comprehensive item → reward tables mapping...");

  const rewardTablesDir = path.join(directoryData, "Reward", "RewardTable");
  if (!fsSync.existsSync(rewardTablesDir)) {
    console.warn(`Reward tables directory not found: ${rewardTablesDir}`);
    return {};
  }

  // First pass: build reward table structure
  const rewardTableData = {};
  const files = fsSync.readdirSync(rewardTablesDir)
    .filter(file => file.endsWith('.json') && file.startsWith('RewardTable_'));

  for (const file of files) {
    try {
      const filePath = path.join(rewardTablesDir, file);
      const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));

      if (data.guid) {
        rewardTableData[data.guid] = {
          directItems: [],
          subTables: [],
          name: data.name || 'Unknown'
        };

        // Extract direct items
        if (data.rewardDefContainers && Array.isArray(data.rewardDefContainers)) {
          for (const container of data.rewardDefContainers) {
            if (container.rewards && Array.isArray(container.rewards)) {
              for (const reward of container.rewards) {
                if (reward.itemRewards && Array.isArray(reward.itemRewards)) {
                  for (const itemReward of reward.itemRewards) {
                    if (itemReward.item?.itemId?.guid) {
                      rewardTableData[data.guid].directItems.push(itemReward.item.itemId.guid);
                    }
                  }
                }
              }
            }
          }
        }

        // Extract subtables
        if (data.subTablesIds && Array.isArray(data.subTablesIds)) {
          for (const subTable of data.subTablesIds) {
            if (subTable.guid) {
              rewardTableData[data.guid].subTables.push(subTable.guid);
            }
          }
        }
      }
    } catch (error) {
      // Silently skip invalid files
    }
  }

  console.log(`   Found ${Object.keys(rewardTableData).length} reward tables`);

  // Second pass: build comprehensive item → reward tables mapping
  const itemToRewardTables = {};

  // Build reverse mapping: item -> direct reward tables (much more efficient)
  console.log(`   Building reverse item-to-reward-table mapping...`);
  for (const [rewardGuid, tableData] of Object.entries(rewardTableData)) {
    for (const itemId of tableData.directItems) {
      if (!itemToRewardTables[itemId]) {
        itemToRewardTables[itemId] = new Set();
      }
      itemToRewardTables[itemId].add(rewardGuid);
    }
  }

  // Pre-compute all parent relationships for efficiency
  console.log(`   Pre-computing parent table relationships...`);
  const parentCache = {};
  for (const [childGuid, childData] of Object.entries(rewardTableData)) {
    parentCache[childGuid] = new Set();
  }

  // Build parent relationships
  for (const [parentGuid, parentData] of Object.entries(rewardTableData)) {
    for (const childGuid of parentData.subTables) {
      if (parentCache[childGuid]) {
        parentCache[childGuid].add(parentGuid);
      }
    }
  }

  // Now expand each item's reward tables to include all parents (breadth-first, much faster)
  console.log(`   Expanding reward table hierarchies...`);
  const allItems = Object.keys(itemToRewardTables);
  let processedCount = 0;

  for (const itemId of allItems) {
    const directTables = itemToRewardTables[itemId];
    const allTables = new Set(directTables);

    // Breadth-first expansion of parent tables
    const toProcess = Array.from(directTables);
    const processed = new Set();

    while (toProcess.length > 0) {
      const currentTable = toProcess.shift();
      if (processed.has(currentTable)) continue;
      processed.add(currentTable);

      // Add all parents of this table
      if (parentCache[currentTable]) {
        for (const parentTable of parentCache[currentTable]) {
          if (!allTables.has(parentTable)) {
            allTables.add(parentTable);
            toProcess.push(parentTable); // Add to queue for further parent expansion
          }
        }
      }
    }

    itemToRewardTables[itemId] = Array.from(allTables);
    processedCount++;

    // Progress update every 500 items
    if (processedCount % 500 === 0) {
      console.log(`   Processed ${processedCount}/${allItems.length} items...`);
    }
  }

  console.log(`   Built comprehensive mapping for ${Object.keys(itemToRewardTables).length} items`);
  return itemToRewardTables;
}

/**
 * Build population → reward tables lookup
 */
async function buildPopulationLookup() {
  const popToRewards = {};
  const populationDir = path.join(directoryData, "Population", "PopulationInstance");
  
  if (!fsSync.existsSync(populationDir)) {
    console.warn(`Population directory not found: ${populationDir}`);
    return popToRewards;
  }
  
  // Get all JSON files recursively
  function getAllJsonFiles(dir) {
    let results = [];
    const items = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        results = results.concat(getAllJsonFiles(fullPath));
      } else if (item.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }
    return results;
  }
  
  const files = getAllJsonFiles(populationDir);
  
  for (const filePath of files) {
    try {
      const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
      
      if (data.guid && data.lootTablesIds && Array.isArray(data.lootTablesIds)) {
        const rewardIds = data.lootTablesIds
          .filter(loot => loot?.guid)
          .map(loot => loot.guid);
        
        if (rewardIds.length > 0) {
          popToRewards[data.guid] = rewardIds;
        }
      }
    } catch (error) {
      // Silently skip invalid files
    }
  }
  
  return popToRewards;
}

/**
 * Find direct item drops from monsters
 */
async function findDirectItemDrops() {
  console.log("🔍 Finding direct item drops from monsters...");

  const directDrops = {};
  const populationDir = path.join(directoryData, "Population", "PopulationInstance");

  if (!fsSync.existsSync(populationDir)) {
    return directDrops;
  }

  // Get all JSON files recursively
  function getAllJsonFiles(dir) {
    let results = [];
    const items = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        results = results.concat(getAllJsonFiles(fullPath));
      } else if (item.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const files = getAllJsonFiles(populationDir);

  for (const filePath of files) {
    try {
      const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));

      if (data.guid && data.lootTable && data.lootTable.length > 0) {
        // Check for direct item drops in loot table
        for (const lootEntry of data.lootTable) {
          if (lootEntry.item && lootEntry.item.itemId && lootEntry.item.itemId.guid) {
            const itemId = lootEntry.item.itemId.guid;
            if (!directDrops[itemId]) {
              directDrops[itemId] = [];
            }
            directDrops[itemId].push(data.guid);
          }
        }
      }
    } catch (error) {
      // Silently skip invalid files
    }
  }

  console.log(`   Found direct drops for ${Object.keys(directDrops).length} items`);
  return directDrops;
}

/**
 * Build recipe → item relationships for additional reference points
 */
async function buildRecipeToItemMap() {
  console.log("📋 Building recipe → item relationships...");

  const recipeToItem = {};
  const recipeDir = path.join(directoryData, "Crafting", "CraftingRecipeDef");

  if (!fsSync.existsSync(recipeDir)) {
    console.warn(`Recipe directory not found: ${recipeDir}`);
    return recipeToItem;
  }

  const files = fsSync.readdirSync(recipeDir)
    .filter(file => file.endsWith('.json') && file.startsWith('CraftingRecipeDef_'));

  for (const file of files) {
    try {
      const filePath = path.join(recipeDir, file);
      const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));

      if (data.guid && data.outputItem && data.outputItem.itemId && data.outputItem.itemId.guid) {
        const recipeId = data.guid;
        const itemId = data.outputItem.itemId.guid;
        recipeToItem[recipeId] = itemId;
      }
    } catch (error) {
      // Silently skip invalid files
    }
  }

  console.log(`   Found ${Object.keys(recipeToItem).length} recipe → item relationships`);
  return recipeToItem;
}

/**
 * Build population info lookup (names, zones, levels)
 */
async function buildPopulationInfoLookup() {
  const popInfo = {};
  const populationDir = path.join(directoryData, "Population", "PopulationInstance");
  
  if (!fsSync.existsSync(populationDir)) {
    return popInfo;
  }
  
  // Get all JSON files recursively
  function getAllJsonFiles(dir) {
    let results = [];
    const items = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        results = results.concat(getAllJsonFiles(fullPath));
      } else if (item.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }
    return results;
  }
  
  const files = getAllJsonFiles(populationDir);
  
  for (const filePath of files) {
    try {
      const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
      
      if (data.guid) {
        popInfo[data.guid] = {
          name: cleanItemName(extractLastQuotedValue(data.displayName) || data.name || 'Unknown'),
          zone: extractLastQuotedValue(data.zoneName) || 'Unknown',
          level: data.level || data.minLevel || 1,
          maxLevel: data.maxLevel || data.level || 1
        };
      }
    } catch (error) {
      // Silently skip invalid files
    }
  }
  
  return popInfo;
}

/**
 * Recursively get all items from a reward table, including items from subtables
 */
function getAllItemsFromRewardTable(rewardGuid, rewardToItems, visited = new Set()) {
  // Prevent infinite loops in case of circular references
  if (visited.has(rewardGuid)) {
    return new Set();
  }
  visited.add(rewardGuid);

  const allItems = new Set();
  const itemIds = rewardToItems[rewardGuid];

  if (!itemIds) {
    return allItems;
  }

  for (const itemId of itemIds) {
    if (itemId.startsWith('SUBTABLE:')) {
      // This is a subtable reference, recursively get items from it
      const subTableGuid = itemId.substring(9); // Remove 'SUBTABLE:' prefix
      const subTableItems = getAllItemsFromRewardTable(subTableGuid, rewardToItems, visited);
      subTableItems.forEach(item => allItems.add(item));
    } else {
      // This is a direct item
      allItems.add(itemId);
    }
  }

  return allItems;
}
async function getAllReferencedGearItems(itemToRewardTables) {
  const gearItems = [];
  const uniqueItemIds = new Set();

  // Collect all item IDs from the item-to-reward-tables mapping
  for (const itemId of Object.keys(itemToRewardTables)) {
    uniqueItemIds.add(itemId);
  }

  console.log(`   Found ${uniqueItemIds.size} unique items referenced in loot system`);
  
  // Now check which of these are actually gear items
  const itemDir = path.join(directoryData, 'Item', 'Item');
  let gearCount = 0;
  
  for (const itemId of uniqueItemIds) {
    try {
      const itemFile = path.join(itemDir, `Item_${itemId}.json`);
      if (fsSync.existsSync(itemFile)) {
        const content = fsSync.readFileSync(itemFile, 'utf8');
        const itemData = JSON.parse(content);
        
        // Same filter logic as gear.js processor - check for gear items
        if (
          (itemData.equipSlots && itemData.equipSlots.length > 0) ||
          (itemData.inventoryFilterType === "Armor" ||
           itemData.inventoryFilterType === "Weapon" ||
           itemData.inventoryFilterType === "Equipment")
        ) {
          const itemName = extractLastQuotedValue(itemData.itemName) || itemData.name || 'Unknown';
          gearItems.push({
            guid: itemId,
            name: itemName
          });
          gearCount++;
        }
      }
    } catch (error) {
      // Silent error tracking
    }
  }
  
  console.log(`   Found ${gearCount} gear items that are actually in reward tables`);
  return gearItems;
}

/**
 * Fast loot processing using pre-built lookups
 */
async function processLootFiles() {
  console.log("🚀 Starting FAST loot processing...");
  
  try {
    // Initialize database connection
    await initDatabase();
    await setupConnection();
    
    const startTime = Date.now();
    const errors = [];

    // Step 1: Build all lookup tables once
    const { itemToRewardTables, popToRewards, popInfo, directDrops, recipeToItem } = await buildLookupTables();
    
    // Step 2: Get gear items that are actually referenced in reward tables
    const gearItems = await getAllReferencedGearItems(itemToRewardTables);
    console.log(`📦 Found ${gearItems.length} gear items`);

    // Step 3: Comprehensive loot processing with full hierarchy traversal
    console.log("⚡ Processing items with comprehensive loot analysis...");

    // Pre-build reverse mappings for faster lookups
    console.log("   Pre-building reverse mappings for faster processing...");
    const rewardTableToPops = {};
    for (const [popGuid, rewardGuids] of Object.entries(popToRewards)) {
      for (const rewardGuid of rewardGuids) {
        if (!rewardTableToPops[rewardGuid]) {
          rewardTableToPops[rewardGuid] = [];
        }
        rewardTableToPops[rewardGuid].push(popGuid);
      }
    }

    const lootEntries = [];
    let foundItems = 0;
    let processedItems = 0;

    for (const item of gearItems) {
      let itemFound = false;
      processedItems++;

      // Method 1: Check reward table hierarchies (optimized)
      const rewardTables = itemToRewardTables[item.guid] || [];
      for (const rewardGuid of rewardTables) {
        // Use pre-built reverse mapping instead of nested loops
        const populations = rewardTableToPops[rewardGuid] || [];
        for (const popGuid of populations) {
          const mobInfo = popInfo[popGuid];

          if (mobInfo && mobInfo.name && mobInfo.name !== 'Unknown') {
            const level = mobInfo.level || 1;
            const maxLevel = mobInfo.maxLevel || level;

            if (level > 0 && level <= 100 && maxLevel >= level && maxLevel <= 100) {
              itemFound = true;
              lootEntries.push({
                id: `${popGuid}_${item.guid}_${rewardGuid}`,
                itemId: item.guid,
                itemName: item.name,
                npcName: mobInfo.name,
                levelMin: level,
                levelMax: maxLevel,
                zone: mobInfo.zone || 'Unknown',
                dropChance: 0.1,
                rewardTableId: rewardGuid,
                dropType: 'reward_table',
                difficulty: null,
                worldSpawnLocation: null,
                spawnRate: null,
                zoneCoordinates: {},
                worldCoordinates: {},
                levelBasedChances: [],
                dropChancePerRoll: null,
                rolls: null,
                poolSize: null
              });
            }
          }
        }
      }

      // Method 2: Check direct drops (already optimized with directDrops mapping)
      const directDropMobs = directDrops[item.guid] || [];
      for (const popGuid of directDropMobs) {
        const mobInfo = popInfo[popGuid];

        if (mobInfo && mobInfo.name && mobInfo.name !== 'Unknown') {
          const level = mobInfo.level || 1;
          const maxLevel = mobInfo.maxLevel || level;

          if (level > 0 && level <= 100 && maxLevel >= level && maxLevel <= 100) {
            itemFound = true;
            lootEntries.push({
              id: `${popGuid}_${item.guid}_direct`,
              itemId: item.guid,
              itemName: item.name,
              npcName: mobInfo.name,
              levelMin: level,
              levelMax: maxLevel,
              zone: mobInfo.zone || 'Unknown',
              dropChance: 0.1,
              rewardTableId: null,
              dropType: 'direct_drop',
              difficulty: null,
              worldSpawnLocation: null,
              spawnRate: null,
              zoneCoordinates: {},
              worldCoordinates: {},
              levelBasedChances: [],
              dropChancePerRoll: null,
              rolls: null,
              poolSize: null
            });
          }
        }
      }

      // Method 3: Check recipe drops (monsters that drop recipes also drop the crafted item)
      for (const [recipeId, recipeItemId] of Object.entries(recipeToItem)) {
        if (recipeItemId === item.guid) {
          // Find monsters that drop this recipe using optimized mappings
          const recipeRewardTables = itemToRewardTables[recipeId] || [];
          for (const rewardGuid of recipeRewardTables) {
            const populations = rewardTableToPops[rewardGuid] || [];
            for (const popGuid of populations) {
              const mobInfo = popInfo[popGuid];

              if (mobInfo && mobInfo.name && mobInfo.name !== 'Unknown') {
                const level = mobInfo.level || 1;
                const maxLevel = mobInfo.maxLevel || level;

                if (level > 0 && level <= 100 && maxLevel >= level && maxLevel <= 100) {
                  itemFound = true;
                  lootEntries.push({
                    id: `${popGuid}_${item.guid}_recipe_${recipeId}`,
                    itemId: item.guid,
                    itemName: item.name,
                    npcName: mobInfo.name,
                    levelMin: level,
                    levelMax: maxLevel,
                    zone: mobInfo.zone || 'Unknown',
                    dropChance: 0.05, // Lower chance for recipe-based drops
                    rewardTableId: rewardGuid,
                    dropType: 'recipe_drop',
                    difficulty: null,
                    worldSpawnLocation: null,
                    spawnRate: null,
                    zoneCoordinates: {},
                    worldCoordinates: {},
                    levelBasedChances: [],
                    dropChancePerRoll: null,
                    rolls: null,
                    poolSize: null
                  });
                }
              }
            }
          }

          // Also check direct recipe drops using optimized mapping
          const directRecipeMobs = directDrops[recipeId] || [];
          for (const popGuid of directRecipeMobs) {
            const mobInfo = popInfo[popGuid];

            if (mobInfo && mobInfo.name && mobInfo.name !== 'Unknown') {
              const level = mobInfo.level || 1;
              const maxLevel = mobInfo.maxLevel || level;

              if (level > 0 && level <= 100 && maxLevel >= level && maxLevel <= 100) {
                itemFound = true;
                lootEntries.push({
                  id: `${popGuid}_${item.guid}_recipe_direct_${recipeId}`,
                  itemId: item.guid,
                  itemName: item.name,
                  npcName: mobInfo.name,
                  levelMin: level,
                  levelMax: maxLevel,
                  zone: mobInfo.zone || 'Unknown',
                  dropChance: 0.05,
                  rewardTableId: null,
                  dropType: 'recipe_direct_drop',
                  difficulty: null,
                  worldSpawnLocation: null,
                  spawnRate: null,
                  zoneCoordinates: {},
                  worldCoordinates: {},
                  levelBasedChances: [],
                  dropChancePerRoll: null,
                  rolls: null,
                  poolSize: null
                });
              }
            }
          }
        }
      }

      if (!itemFound) {
        errors.push(`Item not found in any loot source: ${item.name} (${item.guid})`);
      } else {
        foundItems++;
      }

      // Progress update every 100 items
      if ((processedItems % 100) === 0 && processedItems > 0) {
        console.log(`📈 Processed ${processedItems} items, found ${lootEntries.length} loot entries...`);
      }
    }
    
    // Step 4: Save to database
    if (lootEntries.length > 0) {
      console.log(`💾 Saving ${lootEntries.length} loot entries to database...`);
      await batchSaveMobLootInfoToDatabase(lootEntries);
      console.log(`✅ Successfully saved ${lootEntries.length} loot entries`);
    } else {
      console.log("⚠️ No loot entries found to save");
    }
    
    // Step 5: Write error log
    if (errors.length > 0) {
      const logsDir = path.join(process.cwd(), 'logs');
      await fs.mkdir(logsDir, { recursive: true });
      const errorLogPath = path.join(logsDir, 'fast-loot-errors.log');
      await fs.writeFile(errorLogPath, errors.join('\n'));
      console.log(`📋 ${errors.length} errors logged to ${errorLogPath}`);
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`🎉 FAST loot processing completed in ${totalTime.toFixed(2)}s`);
    console.log(`   - Gear items processed: ${gearItems.length}`);
    console.log(`   - Items found in rewards: ${foundItems}`);
    console.log(`   - Total items processed: ${processedItems}`);
    console.log(`   - Loot entries created: ${lootEntries.length}`);
    console.log(`   - Errors: ${errors.length}`);
    
    // Log some statistics about the comprehensive processing
    const uniqueMobs = new Set(lootEntries.map(entry => entry.id.split('_')[0])).size;
    const uniqueZones = new Set(lootEntries.map(entry => entry.zone)).size;
    const dropTypes = {};
    lootEntries.forEach(entry => {
      dropTypes[entry.dropType] = (dropTypes[entry.dropType] || 0) + 1;
    });

    console.log(`   - Unique monsters: ${uniqueMobs}`);
    console.log(`   - Unique zones: ${uniqueZones}`);
    console.log(`   - Drop types:`, dropTypes);
    
    return lootEntries.length;
  }
  catch (error) {
    console.error(`❌ Fatal error in fast loot processing: ${error.message}`);
    throw error;
  }
}

export { processLootFiles };
