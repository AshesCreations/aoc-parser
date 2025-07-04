/**
 * </Item/Item> processor module for parsing "Item" that is Gear.
 * - Weapons
 * - Armor
 * - Equipment - that has "equipSlots" Data
 */

import fs from "fs";
import path from "path";
import {
  batchSaveGearToDatabase,
  batchFindItemRecipes,
} from "../db/operations.js";
import {
  extractDescription,
  extractLastQuotedValue,
  extractTagParts,
  extractValues,
  getJson,
} from "../utils.js";
import { rewardTableIdToItemRewardId } from "../config.js";

function buildRecipeTree(
  itemId,
  itemToRewardTables,
  rewardIdToRecipe,
  directoryData,
  visited = new Set()
) {
  if (!itemId || visited.has(itemId)) return null;
  visited.add(itemId);
  const itemData = getJson(
    directoryData,
    "/Item/Item",
    `Item_${itemId}.json`
  );
  if (!itemData || Object.keys(itemData).length === 0) {
    return null;
  }
  const tree = {
    item: { name: itemData.name, guid: itemId },
    recipes: [],
  };
  const tables = itemToRewardTables[itemId] || [];
  for (const rtId of tables) {
    const recipe = rewardIdToRecipe[rtId];
    if (!recipe) continue;
    const recipeNode = { primaryResources: [], generalResources: [] };
    if (Array.isArray(recipe.primaryResourceCosts)) {
      for (const pr of recipe.primaryResourceCosts) {
        const sub = buildRecipeTree(
          pr.item?.guid,
          itemToRewardTables,
          rewardIdToRecipe,
          directoryData,
          visited
        );
        recipeNode.primaryResources.push({
          item: getJson(
            directoryData,
            "/Item/Item",
            `Item_${pr.item?.guid}.json`
          ),
          quantity: pr.quantity,
          rarity: pr.rarity,
          subMaterials: sub,
        });
      }
    }
    if (Array.isArray(recipe.generalResourceCost)) {
      for (const gr of recipe.generalResourceCost) {
        const sub = buildRecipeTree(
          gr.item?.guid,
          itemToRewardTables,
          rewardIdToRecipe,
          directoryData,
          visited
        );
        recipeNode.generalResources.push({
          item: getJson(
            directoryData,
            "/Item/Item",
            `Item_${gr.item?.guid}.json`
          ),
          quantity: gr.quantity,
          subMaterials: sub,
        });
      }
    }
    tree.recipes.push(recipeNode);
  }
  return tree;
}

/**
 * Process all JSON files in the item directory
 * @param {string} directoryPath - Path to the item directory
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processItemGearFiles(directoryData) {
  let totalItemsProcessed = 0;
  let itemsBySlot = {};

  try {
    // Read all files in the directory
    const directoryItem = path.join(directoryData, "/Item/Item");
    const files = fs.readdirSync(directoryItem);

    // Filter for JSON files
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );
    console.log(`Found ${jsonFiles.length} JSON files to process`);

    // Prepare batch processing arrays
    const allItems = [];
    const itemIds = [];

    // First loop: Parse all files and collect data without DB operations
    for (const file of jsonFiles) {
      // load file
      const filePath = path.join(directoryItem, file);
      const data = fs.readFileSync(filePath, "utf8");
      let jsonData = JSON.parse(data);

      // Filter for "Gear"
      if (
        !jsonData.hasOwnProperty("inventoryFilterType") ||
        // !jsonData.hasOwnProperty("subType") || // several older items are missing "subType"
        jsonData.equipSlots.length === 0 ||
        !(
          jsonData.inventoryFilterType === "Armor" ||
          jsonData.inventoryFilterType === "Weapon" ||
          jsonData.inventoryFilterType === "Equipment"
        )
      ) {
        continue;
      }

      // Create item object with all potential fields that might be undefined
      let item = {
        id: jsonData.guid,
        name: extractLastQuotedValue(jsonData.itemName),
        typeDescription: [
          ...extractTagParts(jsonData, [
            "Item",
            "item",
            "Gear",
            "Slot",
            "Armor",
            "Weapon",
            "Artisan",
            "Accessory",
            "Artisanship",
            "Gathering",
            "ability",
            "MagicalScalingOverride",
            "PhysicalScalingOverride",
          ]),
        ]
          .reverse()
          .join(" "),

        description: extractDescription(jsonData.description),
        type: jsonData.inventoryFilterType,
        subType: jsonData.subType, // currently, always "None"
        tag: [...extractTagParts(jsonData, [""])],
        icon: jsonData.displayIcon
          ? jsonData.displayIcon.replace("/Game/UI/", "/cdn/").split(".")[0] +
            ".png"
          : undefined,
        rarityMin: jsonData.rarityMin,
        rarityMax: jsonData.rarityMax,
        slots: jsonData.equipSlots,
        statsId: jsonData.statBlockId?.guid,
        setBonusIds: extractValues(jsonData.setBonusIds, "guid"),
        level: jsonData.level,
        grade: jsonData.grade,
        enchantmentId: jsonData.enchantmentDefId?.guid,
        deconstructionRecipeId: jsonData.deconstructionRecipeId?.guid,
        itemRecipeId: [],
        craftingRecipes: [],
      };

      // Track items by slot type
      if (!itemsBySlot[item.slots]) {
        itemsBySlot[item.slots] = 0;
      }
      itemsBySlot[item.slots]++;

      // Add to batch arrays
      allItems.push(item);
      itemIds.push(item.id);

      totalItemsProcessed++;
    }

    // Batch query for recipes for all items at once
    const allRecipes = await batchFindItemRecipes(itemIds);

    // Build itemId -> reward table ids map from reward-id.json
    const itemToRewardTables = {};
    for (const [rtId, items] of Object.entries(rewardTableIdToItemRewardId)) {
      items.forEach((id) => {
        if (!itemToRewardTables[id]) itemToRewardTables[id] = [];
        itemToRewardTables[id].push(rtId);
      });
    }

    // Build rewardId -> crafting recipe map once
    const craftingDir = path.join(directoryData, "/Crafting/CraftingRecipeDef");
    const craftingFiles = fs.readdirSync(craftingDir).filter((f) =>
      f.toLowerCase().endsWith(".json")
    );
    const rewardIdToRecipe = {};
    for (const file of craftingFiles) {
      const data = fs.readFileSync(path.join(craftingDir, file), "utf8");
      const json = JSON.parse(data);
      const rId = json?.rewardId?.guid;
      if (rId) {
        rewardIdToRecipe[rId] = json;
      }
    }

    const rewardTableCache = {};

    // Apply recipes to items and gather crafting recipes
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      if (allRecipes[item.id] && allRecipes[item.id].length > 0) {
        item.itemRecipeId = allRecipes[item.id];
      }

      const tables = itemToRewardTables[item.id] || [];
      const craftingRecipes = [];
      for (const rtId of tables) {
        if (!rewardTableCache[rtId]) {
          rewardTableCache[rtId] = getJson(
            directoryData,
            "/Reward/RewardTable",
            `RewardTable_${rtId}.json`
          );
        }
        const rtData = rewardTableCache[rtId];
        if (rtData && rtData.name && rtData.name.startsWith("Recipe")) {
          const recipe = rewardIdToRecipe[rtId];
          if (recipe) {
            craftingRecipes.push(recipe);
          }
        }
      }
      if (craftingRecipes.length > 0) {
        item.craftingRecipes = craftingRecipes;
        item.recipeTree = buildRecipeTree(
          item.id,
          itemToRewardTables,
          rewardIdToRecipe,
          directoryData
        );
      }
    }

    // Save all items in a single batch operation
    await batchSaveGearToDatabase(allItems);

    // Create summary of items by type
    let slotsSummary = "";
    for (const [type, count] of Object.entries(itemsBySlot)) {
      slotsSummary += `  - ${type}: ${count} items\n`;
    }

    // print summary
    console.log("\nGear processing:");
    console.log(`- Total Gear found and processed: ${totalItemsProcessed}`);
    console.log(`- Gear by slot:`);
    console.log(`${slotsSummary}`);

    return totalItemsProcessed;
  } catch (error) {
    console.error(`Error processing directory: ${error.message}`);
    throw error;
  }
}

export { processItemGearFiles };
