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
function cleanItemName(rawName) {
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
  
  console.log("📋 Building reward table → items lookup...");
  const rewardToItems = await buildRewardTableLookup();
  console.log(`   Found ${Object.keys(rewardToItems).length} reward tables with items`);
  
  console.log("📋 Building population → reward tables lookup...");
  const popToRewards = await buildPopulationLookup();
  console.log(`   Found ${Object.keys(popToRewards).length} population instances with loot`);
  
  console.log("📋 Building population info lookup...");
  const popInfo = await buildPopulationInfoLookup();
  console.log(`   Found ${Object.keys(popInfo).length} population info entries`);
  
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`✅ All lookup tables built in ${elapsed.toFixed(2)}s`);
  
  return { rewardToItems, popToRewards, popInfo };
}

/**
 * Build reward table → items lookup
 */
async function buildRewardTableLookup() {
  const rewardToItems = {};
  const rewardTablesDir = path.join(directoryData, "Reward", "RewardTable");
  
  if (!fsSync.existsSync(rewardTablesDir)) {
    console.warn(`Reward tables directory not found: ${rewardTablesDir}`);
    return rewardToItems;
  }
  
  const files = fsSync.readdirSync(rewardTablesDir)
    .filter(file => file.endsWith('.json') && file.startsWith('RewardTable_'));
  
  for (const file of files) {
    try {
      const filePath = path.join(rewardTablesDir, file);
      const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
      
      if (data.guid && data.rewardDefContainers && Array.isArray(data.rewardDefContainers)) {
        const itemIds = [];
        
        // Traverse the reward structure
        for (const container of data.rewardDefContainers) {
          if (container.rewards && Array.isArray(container.rewards)) {
            for (const reward of container.rewards) {
              if (reward.itemRewards && Array.isArray(reward.itemRewards)) {
                for (const itemReward of reward.itemRewards) {
                  if (itemReward.item?.itemId?.guid) {
                    itemIds.push(itemReward.item.itemId.guid);
                  }
                }
              }
            }
          }
        }
        
        if (itemIds.length > 0) {
          rewardToItems[data.guid] = itemIds;
        }
        
        // Also track subtable references for chaining
        if (data.subTablesIds && Array.isArray(data.subTablesIds)) {
          for (const subTable of data.subTablesIds) {
            if (subTable.guid) {
              if (!rewardToItems[data.guid]) {
                rewardToItems[data.guid] = [];
              }
              // Mark this as a subtable reference (we'll process these in a second pass)
              if (!rewardToItems[data.guid].includes(`SUBTABLE:${subTable.guid}`)) {
                rewardToItems[data.guid].push(`SUBTABLE:${subTable.guid}`);
              }
            }
          }
        }
      }
    } catch (error) {
      // Silently skip invalid files
    }
  }
  
  return rewardToItems;
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
 * Get all gear items from item files
 */
/**
 * Get gear items that are actually referenced in reward tables
 */
async function getAllReferencedGearItems(rewardToItems) {
  const gearItems = [];
  const uniqueItemIds = new Set();
  
  // Collect all item IDs from reward tables
  for (const [rewardId, items] of Object.entries(rewardToItems)) {
    for (const itemId of items) {
      if (!itemId.startsWith('SUBTABLE:')) {
        uniqueItemIds.add(itemId);
      }
    }
  }
  
  console.log(`   Found ${uniqueItemIds.size} unique items in reward tables`);
  
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
    const { rewardToItems, popToRewards, popInfo } = await buildLookupTables();    // Step 2: Get gear items that are actually referenced in reward tables
    const gearItems = await getAllReferencedGearItems(rewardToItems);
    console.log(`📦 Found ${gearItems.length} gear items`);
    
    // Step 3: Fast reverse lookup processing
    console.log("⚡ Processing items with fast lookups...");
    const lootEntries = [];
    let foundItems = 0;
    
    for (const item of gearItems) {
      let itemFoundInRewards = false;
      
      // Find which reward tables contain this item
      for (const [rewardGuid, itemIds] of Object.entries(rewardToItems)) {
        if (itemIds.includes(item.guid)) {
          itemFoundInRewards = true;
          
          // Find which populations use this reward table
          for (const [popGuid, rewardGuids] of Object.entries(popToRewards)) {
            if (rewardGuids.includes(rewardGuid)) {
              const mobInfo = popInfo[popGuid];
              
              if (mobInfo) {
                lootEntries.push({
                  mobGuid: popGuid,
                  mobName: mobInfo.name,
                  itemId: item.id,
                  itemName: item.name,
                  zone: mobInfo.zone,
                  level: mobInfo.level,
                  maxLevel: mobInfo.maxLevel,
                  dropChance: 0.1, // Default drop chance
                  rewardTableId: rewardGuid
                });
              }
            }
          }
        }
      }
      
      if (!itemFoundInRewards) {
        errors.push(`Item not found in any reward table: ${item.name} (${item.guid})`);
      } else {
        foundItems++;
      }
      
      // Progress update every 100 items
      if ((foundItems % 100) === 0 && foundItems > 0) {
        console.log(`📈 Processed ${foundItems} items, found ${lootEntries.length} loot entries...`);
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
    console.log(`   - Loot entries created: ${lootEntries.length}`);
    console.log(`   - Errors: ${errors.length}`);
    
    return lootEntries.length;
    
  } catch (error) {
    console.error(`❌ Fatal error in fast loot processing: ${error.message}`);
    throw error;
  }
}

export { processLootFiles };
