/**
 * Item processor module for parsing game item recipes data.
 */

import fs from "fs";
import path from "path";
import { saveItemRecipeToDatabase } from "../db/operations.js";
import {
  extractTagParts,
  filterByTypes,
  extractLastQuotedValue,
  extractLastValue,
  extractDescription,
  extractValues,
  checkForUndefinedValues,
  logMissingIcon,
  extractExpressionId,
  getJson,
  formatTime,
} from "../utils.js";

/**
 * Process all JSON files in the item directory
 * @param {string} directoryData - Path to the Data directory
 * @param {Array<string>} itemTypes - Array of item types to include
 * @param {Array<string>} tagsToExclude - Array of tags to exclude from extraction
 * @param {string} missingIconLogPath - Path to log file for missing icons
 * @param {string} undefinedLogPath - Path to log file for undefined values
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processItemRecipeFiles(
  directoryData,
  itemTypes,
  tagsToExclude,
  missingIconLogPath,
  undefinedLogPath,
  statIdToName,
  rewardTableIdToItemRewardId
) {
  try {
    // Read all files in the directory
    const rewardId = rewardTableIdToItemRewardId;
    const directoryItem = path.join(directoryData, "/Item/Item");
    const files = fs.readdirSync(directoryItem);

    // Filter for JSON files
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );

    console.log(`Found ${jsonFiles.length} JSON files to process`);
    let totalItemsProcessed = 0;
    let itemsWithUndefined = 0;
    let itemsWithMissingIcons = 0;
    let itemsByType = {};

    for (const file of jsonFiles) {
      const filePath = path.join(directoryItem, file);

      // Filter for itemType files, removes equipment
      const jsonData = filterByTypes(filePath, itemTypes);
      const isRecipe =
        jsonData.hasOwnProperty("learnableRecipeIds") &&
        Array.isArray(jsonData["learnableRecipeIds"]) &&
        jsonData["learnableRecipeIds"].length > 0;

      if (Object.keys(jsonData).length !== 0 && isRecipe) {
        // If object is an item and also a recipes
        // Create item object with all potential fields that might be undefined

        let item = {
          id: jsonData.guid,
          name: extractLastQuotedValue(jsonData.itemName),
          description: extractDescription(jsonData.description),
          type: jsonData.inventoryFilterType,
          tag: [...extractTagParts(jsonData, tagsToExclude)],
          icon: jsonData.displayIcon
            ? jsonData.displayIcon.replace("/Game/UI/", "/cdn/").split(".")[0] +
              ".png"
            : undefined,
          rarityMin: jsonData.rarityMin,
          rarityMax: jsonData.rarityMax,
          level: jsonData.level,
          statsId: jsonData.statBlockId?.guid,
          learnableRecipeIds: jsonData.learnableRecipeIds?.[0]?.guid,
          rewardId: [],
        };

        // TODO: log undefined icons
        // TODO: Add code for multiple learnable Recipes Ids and rewards

        if (item.learnableRecipeIds !== "0" && item.learnableRecipeIds) {
          const rewardData = getJson(
            directoryData,
            "/Crafting/CraftingRecipeDef",
            `CraftingRecipeDef_${item.learnableRecipeIds}.json`
          );
          let id = rewardId[rewardData.rewardId.guid];
          // Check reward for errors
          // TODO: Log error to file
          if (!id) {
            console.log(
              `Warning: [${item.name}][${item.id}] Recipe reward id is undefined.`
            );
            id = [];
          } else if (id.length === 0) {
            console.log(
              `Warning: [${item.name}][${item.id}] Recipe reward id is empty.`
            );
          }
          if (id?.[0] === "0") {
            console.log(
              `Warning: [${item.name}][${item.id}] Recipe reward id is invalid, "0"`
            );
            id = [];
          }
          item.rewardId = id;
        }

        // Track items by type
        if (!itemsByType[item.type]) {
          itemsByType[item.type] = 0;
        }
        itemsByType[item.type]++;

        // Check for undefined values
        const hasUndefined = checkForUndefinedValues(
          item,
          file,
          undefinedLogPath,
          ["learnableRecipeIds"]
        );
        if (hasUndefined) {
          itemsWithUndefined++;
        }

        // Check if the icon path doesn't contain "/Game/UI/Icons/"
        if (item.icon && !item.icon.includes("/Game/UI/Icons/")) {
          logMissingIcon(item.id, jsonData.name, item.type, missingIconLogPath);
          itemsWithMissingIcons++;
        }
        // Save item to database
        await saveItemRecipeToDatabase(item);
        totalItemsProcessed++;
      }
    }

    // Create summary of items by type
    let typesSummary = "";
    for (const [type, count] of Object.entries(itemsByType)) {
      typesSummary += `  - ${type}: ${count} items\n`;
    }

    // print summary
    console.log("\nItems processing:");
    console.log(`- Total items processed: ${totalItemsProcessed}`);
    console.log(
      `- Items with undefined values: ${itemsWithUndefined} (logged to ${undefinedLogPath})`
    );
    console.log(
      `- Items with missing icons: ${itemsWithMissingIcons} (logged to ${missingIconLogPath})`
    );

    console.log(`- Item by type:`);
    console.log(`${typesSummary}`);

    return totalItemsProcessed;
  } catch (error) {
    console.error(`Error processing directory: ${error.message}`);
    throw error;
  }
}

export { processItemRecipeFiles };
