/**
 * </Item/Item> processor module for parsing "Item" that is Equipment
 * and not Gear
 * - Equipment - that has empty "equipSlots" Data
 */

import fs from "fs";
import path from "path";
import {
  batchSaveEquipmentToDatabase,
  batchFindItemRecipes,
} from "../db/operations.js";
import {
  extractDescription,
  extractLastQuotedValue,
  extractTagParts,
} from "../utils.js";

/**
 * Process all JSON files in the item directory
 * @param {string} directoryPath - Path to the item directory
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processItemEquipmentFiles(directoryData) {
  let totalItemsProcessed = 0;
  let itemsBySubType = {};

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
        jsonData.equipSlots.length !== 0 ||
        !(jsonData.inventoryFilterType === "Equipment")
      ) {
        continue;
      }

      // Create item object with all potential fields that might be undefined
      let tag = [...extractTagParts(jsonData, ["item", "Item"])]
        .reverse()
        .join(" ");
      if (tag === "BeastOfBurden") {
        tag = "Beast Of Burden";
      }

      let item = {
        id: jsonData.guid,
        name: extractLastQuotedValue(jsonData.itemName),
        typeDescription: tag,
        description: extractDescription(jsonData.description),
        type: jsonData.inventoryFilterType,
        subType: jsonData.subType,
        tag: [...extractTagParts(jsonData, [""])],
        icon: jsonData.displayIcon
          ? jsonData.displayIcon.replace("/Game/UI/", "/cdn/").split(".")[0] +
            ".png"
          : undefined,
        rarityMin: jsonData.rarityMin,
        rarityMax: jsonData.rarityMax,
        statsId: jsonData.statBlockId?.guid,
        level: jsonData.level,
        grade: jsonData.grade,
        itemRecipeId: [],
      };
      console.log(item.id, item.name);
      // Track items by sub type
      if (!itemsBySubType[item.subType]) {
        itemsBySubType[item.subType] = 0;
      }
      itemsBySubType[item.subType]++;

      // Add to batch arrays
      allItems.push(item);
      itemIds.push(item.id);

      totalItemsProcessed++;
    }

    // Batch query for recipes for all items at once
    const allRecipes = await batchFindItemRecipes(itemIds);

    // Apply recipes to items and save all at once
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      if (allRecipes[item.id] && allRecipes[item.id].length > 0) {
        item.itemRecipeId = allRecipes[item.id];
      }
    }

    // Save all items in a single batch operation
    await batchSaveEquipmentToDatabase(allItems);

    // Create summary of items by type
    let subTypeSummary = "";
    for (const [type, count] of Object.entries(itemsBySubType)) {
      subTypeSummary += `  - ${type}: ${count} items\n`;
    }

    // print summary
    console.log("\nEquipment processing:");
    console.log(
      `- Total Equipment found and processed: ${totalItemsProcessed}`
    );
    console.log(`- Equipment by subType:`);
    console.log(`${subTypeSummary}`);

    return totalItemsProcessed;
  } catch (error) {
    console.error(`Error processing directory: ${error.message}`);
    throw error;
  }
}

export { processItemEquipmentFiles };
