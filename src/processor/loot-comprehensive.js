/**
 * Comprehensive loot tracing system
 * Traces items through complete reward table hierarchy to find all monsters, locations, and spawn data
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { batchSaveMobLootInfoToDatabase } from "../db/operations.js";
import { initDatabase, setupConnection } from "../db/config.js";
import { extractLastQuotedValue } from "../utils.js";
import { directoryData } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively get all JSON files in a directory
 */
async function getAllJsonFiles(dir) {
    let results = [];
    try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                const subResults = await getAllJsonFiles(fullPath);
                results = results.concat(subResults);
            } else if (item.name.endsWith('.json')) {
                results.push(fullPath);
            }
        }
    } catch (error) {
        // Directory doesn't exist or can't read
    }
    return results;
}

/**
 * Parse predicate expressions to extract meaningful data
 */
function parsePredicate(expression) {
    const result = {};
    
    if (expression.includes('GetNPCLevel()')) {
        const levelMatch = expression.match(/GetNPCLevel\(\)\s*>=\s*(\d+)\s*&&\s*GetNPCLevel\(\)\s*<=\s*(\d+)/);
        if (levelMatch) {
            result.levelMin = parseInt(levelMatch[1]);
            result.levelMax = parseInt(levelMatch[2]);
        }
    }
    
    if (expression.includes('GetNodeBiome()')) {
        const biomeMatch = expression.match(/GetNodeBiome\(\)\s*==\s*EBiomeType::(\w+)/);
        if (biomeMatch) {
            result.biome = biomeMatch[1];
        }
    }
    
    return result;
}

/**
 * Build comprehensive reward table lookup with hierarchy tracking
 */
async function buildRewardTableHierarchy() {
    const rewardTables = new Map();
    const rewardTablesDir = path.join(directoryData, "Reward", "RewardTable");
    
    if (!fsSync.existsSync(rewardTablesDir)) {
        console.warn(`Reward tables directory not found: ${rewardTablesDir}`);
        return rewardTables;
    }
    
    const files = fsSync.readdirSync(rewardTablesDir).filter(file => file.endsWith('.json'));
    console.log(`   Loading ${files.length} reward tables...`);
    
    for (const file of files) {
        try {
            const filePath = path.join(rewardTablesDir, file);
            const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
            
            const tableInfo = {
                guid: data.guid,
                name: data.name,
                predicate: parsePredicate(data.predicate?.expression || ''),
                items: [],
                subTables: [],
                selectionRules: {}
            };
            
            // Extract items from rewards (both direct items and with variations)
            if (data.rewardDefContainers && Array.isArray(data.rewardDefContainers)) {
                for (const container of data.rewardDefContainers) {
                    if (container.rewards && Array.isArray(container.rewards)) {
                        for (const reward of container.rewards) {
                            if (reward.itemRewards && Array.isArray(reward.itemRewards)) {
                                for (const itemReward of reward.itemRewards) {
                                    if (itemReward.item?.itemId?.guid) {
                                        tableInfo.items.push({
                                            guid: itemReward.item.itemId.guid,
                                            quantity: itemReward.quantity?.expression || "1",
                                            variationId: itemReward.item.variationId?.guid || null
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // Extract subtables
            if (data.subTablesIds && Array.isArray(data.subTablesIds)) {
                tableInfo.subTables = data.subTablesIds.map(sub => sub.guid);
                
                // Extract selection rules
                tableInfo.selectionRules = {
                    numberOfSubtablesToSelect: data.numberOfSubtablesToSelect || 0,
                    weightsPerSubTable: data.weightsPerSubTable || [],
                    expressionWeightsPerSubTable: data.expressionWeightsPerSubTable || [],
                    selectionAlgorithm: data.subTableSelectionAlgorithm || 'None'
                };
            }
            
            rewardTables.set(data.guid, tableInfo);
        } catch (error) {
            // Silent error tracking
        }
    }
    
    console.log(`   Loaded ${rewardTables.size} reward tables`);
    return rewardTables;
}

/**
 * Build population lookup with detailed spawn information
 */
async function buildPopulationLookup() {
    const populations = new Map();
    const populationDir = path.join(directoryData, "Population", "PopulationInstance");
    
    if (!fsSync.existsSync(populationDir)) {
        console.warn(`Population directory not found: ${populationDir}`);
        return populations;
    }
    
    const files = await getAllJsonFiles(populationDir);
    console.log(`   Loading ${files.length} population instances...`);
    
    for (const file of files) {
        try {
            const content = await fs.readFile(file, 'utf8');
            const data = JSON.parse(content);
            
            if (data.lootTablesIds && Array.isArray(data.lootTablesIds) && data.lootTablesIds.length > 0) {
                const popInfo = {
                    guid: data.guid,
                    name: data.name,
                    lootTables: data.lootTablesIds.map(table => table.guid),
                    levelMin: data.nPCLevelMin || 0,
                    levelMax: data.nPCLevelMax || 0,
                    respawnTime: data.respawnTime || 0,
                    nodeLevelMin: data.nodeLevelMin || 'Unknown',
                    nodeLevelMax: data.nodeLevelMax || 'Unknown'
                };
                
                populations.set(data.guid, popInfo);
            }
        } catch (error) {
            // Silent error tracking
        }
    }
    
    console.log(`   Loaded ${populations.size} population instances with loot`);
    return populations;
}

/**
 * Trace an item through the complete reward table hierarchy using dual-path system
 * Handles both specific monster tables AND general biome/level-based hierarchy
 */
function traceItemToMonsters(itemGuid, rewardTables, populations) {
    const monsters = [];
    const processedPaths = new Set(); // Avoid duplicate entries
    
    // Step 1: Find all reward tables containing the item by itemId
    const directTables = [];
    for (const [tableId, tableData] of rewardTables.entries()) {
        const hasDirectItem = tableData.items.some(item => item.guid === itemGuid);
        if (hasDirectItem) {
            directTables.push({ tableId, tableData });
        }
    }
    
    console.log(`   Found ${directTables.length} tables with item references`);
    
    // Step 2: For each table containing the item, trace all possible paths to monsters
    for (const directTable of directTables) {
        traceTableToMonsters(directTable.tableId, directTable.tableData, rewardTables, populations, monsters, [], processedPaths);
    }
    
    return monsters;
}

/**
 * Recursively trace a reward table to all possible monster sources
 */
function traceTableToMonsters(tableId, tableData, rewardTables, populations, monsters, currentPath, processedPaths) {
    // Avoid infinite loops
    if (currentPath.some(p => p.tableId === tableId)) {
        return;
    }
    
    const pathEntry = {
        tableId,
        tableName: tableData.name,
        predicate: tableData.predicate,
        selectionRules: tableData.selectionRules
    };
    const newPath = [...currentPath, pathEntry];
    
    // Check if this table is directly used by any populations (monsters)
    for (const [popGuid, popInfo] of populations.entries()) {
        if (popInfo.lootTables.includes(tableId)) {
            const pathKey = `${popGuid}-${tableId}-${newPath.map(p => p.tableId).join('-')}`;
            if (processedPaths.has(pathKey)) continue;
            processedPaths.add(pathKey);
            
            // Collect all predicates from the path
            const levelRestrictions = [];
            const biomeRestrictions = [];
            
            for (const pathItem of newPath) {
                if (pathItem.predicate.levelMin !== undefined && pathItem.predicate.levelMax !== undefined) {
                    levelRestrictions.push({
                        min: pathItem.predicate.levelMin,
                        max: pathItem.predicate.levelMax
                    });
                }
                if (pathItem.predicate.biome) {
                    biomeRestrictions.push(pathItem.predicate.biome);
                }
            }
            
            // Calculate drop rate through the path
            const dropRate = calculateDropRate(newPath);
            
            monsters.push({
                monsterGuid: popGuid,
                monsterName: popInfo.name,
                levelMin: popInfo.levelMin || 1,
                levelMax: popInfo.levelMax || 50,
                biome: popInfo.biome || 'Unknown',
                respawnTime: popInfo.respawnTime || 300,
                nodeLevelMin: popInfo.nodeLevelMin || popInfo.levelMin || 1,
                nodeLevelMax: popInfo.nodeLevelMax || popInfo.levelMax || 50,
                dropRate,
                rewardPath: newPath,
                levelRestrictions,
                biomeRestrictions,
                itemSource: currentPath.length === 0 ? 'direct' : 'hierarchy'
            });
        }
    }
    
    // Find parent tables that reference this table (going up the hierarchy)
    for (const [parentTableId, parentTableData] of rewardTables.entries()) {
        if (parentTableData.subTables.includes(tableId)) {
            traceTableToMonsters(parentTableId, parentTableData, rewardTables, populations, monsters, newPath, processedPaths);
        }
    }
}

/**
 * Get all gear items using same logic as gear processor
 */
async function getAllGearItems() {
    const gearItems = [];
    const itemDir = path.join(directoryData, 'Item', 'Item');
    
    const itemFiles = await getAllJsonFiles(itemDir);
    console.log(`   Scanning ${itemFiles.length} item files for gear...`);
    
    for (const file of itemFiles) {
        try {
            const content = await fs.readFile(file, 'utf8');
            const jsonData = JSON.parse(content);
            
            // Same filter logic as gear.js processor
            if (
                (jsonData.equipSlots && jsonData.equipSlots.length > 0) ||
                (jsonData.inventoryFilterType === "Armor" ||
                 jsonData.inventoryFilterType === "Weapon" ||
                 jsonData.inventoryFilterType === "Equipment")
            ) {
                const itemName = extractLastQuotedValue(jsonData.itemName) || jsonData.name || 'Unknown';
                
                gearItems.push({
                    guid: jsonData.guid,
                    name: itemName,
                    level: jsonData.level || 0,
                    slots: jsonData.equipSlots || [],
                    type: jsonData.inventoryFilterType,
                    rarity: jsonData.rarityMin || 'Common'
                });
            }
        } catch (error) {
            // Silent error tracking
        }
    }
    
    console.log(`   Found ${gearItems.length} gear items`);
    return gearItems;
}

/**
 * Calculate drop rate probability based on reward table hierarchy
 */
function calculateDropRate(hierarchyPath) {
    let probability = 1.0;
    
    for (const table of hierarchyPath) {
        if (table.selectionRules && table.selectionRules.numberOfSubtablesToSelect > 0) {
            const totalSubtables = table.selectionRules.weightsPerSubTable.length;
            const selected = table.selectionRules.numberOfSubtablesToSelect;
            
            if (totalSubtables > 0) {
                // Calculate probability based on selection algorithm
                probability *= selected / totalSubtables;
            }
        }
    }
    
    return probability;
}

/**
 * Main comprehensive loot processing function
 */
async function processComprehensiveLoot() {
    console.log("🔍 Starting COMPREHENSIVE loot analysis...");
    
    try {
        // Initialize database
        await initDatabase();
        await setupConnection();
        console.log("✅ Database initialized");
        
        const startTime = Date.now();
        
        // Step 1: Build comprehensive lookups
        console.log("📋 Building comprehensive reward table hierarchy...");
        const rewardTables = await buildRewardTableHierarchy();
        
        console.log("📋 Building population lookup...");
        const populations = await buildPopulationLookup();
        
        // Step 2: Get all gear items
        console.log("📦 Getting all gear items...");
        const gearItems = await getAllGearItems();
        
        // Step 3: Trace each item through the complete hierarchy
        console.log("🔍 Tracing items through reward hierarchy...");
        const lootEntries = [];
        const itemAnalysis = [];
        
        let processedCount = 0;
        let itemsWithDrops = 0;
        let totalConnections = 0;
        
        for (const item of gearItems) {
            processedCount++;
            if (processedCount % 100 === 0) {
                console.log(`   Processed ${processedCount}/${gearItems.length} items... (${itemsWithDrops} with drops, ${totalConnections} connections)`);
            }
            
            const monsters = traceItemToMonsters(item.guid, rewardTables, populations);
            
            if (monsters.length > 0) {
                itemsWithDrops++;
                totalConnections += monsters.length;
                
                if (itemsWithDrops <= 5) {
                    console.log(`   Sample drop: ${item.name} → ${monsters.length} monsters (${monsters[0]?.monsterName || 'Unknown'})`);
                }
                
                // Create detailed analysis for this item
                const itemDetails = {
                    itemGuid: item.guid,
                    itemName: item.name,
                    itemLevel: item.level,
                    itemSlots: item.slots,
                    itemType: item.type,
                    itemRarity: item.rarity,
                    monsters: monsters.map(monster => ({
                        ...monster,
                        // Drop rate is already calculated in the monster object
                        dropRate: monster.dropRate
                    }))
                };
                
                itemAnalysis.push(itemDetails);
                
                // Create database entries
                for (const monster of monsters) {
                    const rewardPath = monster.rewardPath.map(table => table.tableName || 'Unknown').join(' → ');
                    
                    // Find the specific item entry in the reward table to get variation info
                    const rewardTable = rewardTables.get(monster.rewardPath[0]?.tableId);
                    const itemEntry = rewardTable?.items.find(item => item.guid === item.guid);
                    
                    lootEntries.push({
                        MobID: monster.monsterGuid || null,
                        MobName: monster.monsterName || null,
                        ItemID: item.guid || null,
                        ItemName: item.name || null,
                        DropRate: monster.dropRate || 0.0,
                        MinLevel: monster.levelMin || null,
                        MaxLevel: monster.levelMax || null,
                        RespawnTime: monster.respawnTime || null,
                        NodeLevelMin: monster.nodeLevelMin || null,
                        NodeLevelMax: monster.nodeLevelMax || null,
                        RewardTablePath: rewardPath || null,
                        BiomeRestrictions: (monster.biomeRestrictions && monster.biomeRestrictions.length > 0) ? monster.biomeRestrictions.join(', ') : null,
                        LevelRestrictions: (monster.levelRestrictions && monster.levelRestrictions.length > 0) ? monster.levelRestrictions.map(lr => `${lr.min || 0}-${lr.max || 50}`).join(', ') : null,
                        ItemSource: monster.itemSource || null,
                        ItemVariationId: itemEntry?.variationId || null
                    });
                }
            }
        }
        
        // Save to database if we have entries (unless in debug mode)
        if (lootEntries.length > 0 && !process.env.DEBUG_MODE) {
            console.log(`💾 Saving ${lootEntries.length} loot entries to database...`);
            await batchSaveMobLootInfoToDatabase(lootEntries);
        } else if (process.env.DEBUG_MODE) {
            console.log(`🔍 Debug mode: Would save ${lootEntries.length} entries`);
            console.log('Sample entry:', JSON.stringify(lootEntries[0], null, 2));
        }
        
        // Generate comprehensive report
        const reportPath = path.join(__dirname, '..', '..', 'logs', 'comprehensive-loot-analysis.json');
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(itemAnalysis, null, 2));
        
        const duration = (Date.now() - startTime) / 1000;
        console.log(`🎉 COMPREHENSIVE loot analysis completed in ${duration}s`);
        console.log(`   - Gear items analyzed: ${gearItems.length}`);
        console.log(`   - Items with monster drops: ${itemAnalysis.length}`);
        console.log(`   - Total loot entries created: ${lootEntries.length}`);
        console.log(`   - Detailed analysis saved to: ${reportPath}`);
        
        // Show sample of results
        if (itemAnalysis.length > 0) {
            console.log(`\n📋 Sample item analysis:`);
            const sample = itemAnalysis[0];
            console.log(`   Item: ${sample.itemName} (${sample.itemGuid})`);
            console.log(`   Level: ${sample.itemLevel}, Type: ${sample.itemType}, Rarity: ${sample.itemRarity}`);
            console.log(`   Found on ${sample.monsters.length} monster(s):`);
            
            for (const monster of sample.monsters.slice(0, 3)) {
                console.log(`     • ${monster.monsterName} (Level ${monster.levelMin}-${monster.levelMax})`);
                console.log(`       Drop Rate: ${(monster.dropRate * 100).toFixed(2)}%`);
                console.log(`       Respawn: ${monster.respawnTime}s`);
                console.log(`       Node Level: ${monster.nodeLevelMin} → ${monster.nodeLevelMax}`);
                if (monster.biomeRestrictions.length > 0) {
                    console.log(`       Biomes: ${monster.biomeRestrictions.join(', ')}`);
                }
                if (monster.levelRestrictions.length > 0) {
                    const levels = monster.levelRestrictions[0];
                    console.log(`       Level Restrictions: ${levels.min}-${levels.max}`);
                }
            }
        }
        
        return lootEntries.length;
        
    } catch (error) {
        console.error('❌ Fatal error in comprehensive loot processing:', error.message);
        throw error;
    }
}

export { processComprehensiveLoot };
