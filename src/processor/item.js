/**
 * Item processor module for parsing game item data.
 */

import fs from "fs";
import path from "path";
import {
  batchFindItemRecipes,
  batchFindRecipes,
  batchSaveItemsToDatabase,
} from "../db/operations.js";

import {
  extractTagParts,
  filterByTypes,
  extractLastQuotedValue,
  extractLastValue,
  extractDescription,
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
async function processItemFiles(
  directoryData,
  itemTypes,
  tagsToExclude,
  missingIconLogPath,
  undefinedLogPath,
  statIdToName
) {
  try {
    // Read all files in the directory
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

    // Prepare batch processing arrays
    const allItems = [];
    const itemIds = [];

    for (const file of jsonFiles) {
      const filePath = path.join(directoryItem, file);

      // Filter for itemType files, removes equipment
      const jsonData = filterByTypes(filePath, itemTypes);
      const isRecipe =
        jsonData.hasOwnProperty("learnableRecipeIds") &&
        Array.isArray(jsonData["learnableRecipeIds"]) &&
        jsonData["learnableRecipeIds"].length > 0;

      if (Object.keys(jsonData).length !== 0 && !isRecipe) {
        // Extract tag parts for typeDescription, including the specified tags
        const typeDescTags = [
          ...extractTagParts(jsonData, [
            "Item",
            "item",
            "Consumable",
            "Enchanting",
            "Resource",
            "Raw",
            "Artisanship",
            "Gathering",
            "resource",
            "Fuel",
            "Processing",
            "Processed",
          ]),
        ];

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
          itemRecipeId: [],
          recipeId: [],
          layout: "item",
          typeDescription: typeDescTags.reverse().join(" "),
        };

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

        // Process ability descriptions
        if (item.description.includes("$AbilityDescription$")) {
          // Existing code for ability description processing
          // Get description stats
          let stats = [];
          if (jsonData.statBlockId.guid && jsonData.statBlockId.guid !== "0") {
            const statData = getJson(
              directoryData,
              "/Item/ItemStatBlock",
              `ItemStatBlock_${jsonData.statBlockId?.guid}.json`
            );
            stats = [...Object.keys(statData.statArchetype)];
          }

          // Get replace base description
          const abilityData = getJson(
            directoryData,
            "/Abilities/AoCAbility",
            `AoCAbility_${jsonData.activationCastId?.guid}.json`
          );
          let description = extractLastValue(abilityData.abilityDescription);
          // get base description cool down
          if (description.includes("$cd$")) {
            const id = extractExpressionId(abilityData.cooldown?.expression);
            const statFormulaData = getJson(
              directoryData,
              "/Stats/StatFormulaType",
              `StatFormulaType_${id}.json`
            );
            const statEquationData = getJson(
              directoryData,
              "/Stats/StatEquationType",
              `StatEquationType_${statFormulaData.equationId?.guid}.json`
            );
            const cd = statEquationData.equation?.expression;
            description = description.replace("$cd$", formatTime(cd));
          }

          // Process additional description replacements
          // [Existing code for description replacements...]
          if (description.includes("$hit1:statmod0.addonlystat$")) {
            description = description.replace(
              "$hit1:statmod0.addonlystat$",
              statIdToName[stats[0]] || ""
            );
          }

          if (description.includes("$hit1:apply0.description$")) {
            const hitData = getJson(
              directoryData,
              "/Abilities/AbilityHit",
              `AbilityHit_${abilityData.hitsIds["1"].guid}.json`
            );
            const effectData = getJson(
              directoryData,
              "/Effects/Effect",
              `Effect_${hitData.applyEffects[0].effectId.guid}.json`
            );
            const effectDescription = extractLastValue(
              effectData.effectDescription
            );
            description = description.replace(
              "$hit1:apply0.description$",
              effectDescription
            );
            const duration = formatTime(effectData.effectDuration.expression);

            description = description
              .replace("$duration$", duration)
              .replace("$statmod0.by%$", "Gain " + statIdToName[stats[0]] || "")
              .replace("$tick0:statmod0.%$", statIdToName[stats[0]] || "")
              .replace("$tick0:statmod1.%$", statIdToName[stats[1]] || "")
              .replace("$statmod0.onlystat$", statIdToName[stats[0]] || "")
              .replace("$statmod1.onlystat$", statIdToName[stats[1]] || "")
              .replace(
                "$tick0:statmod0.onlystat$",
                statIdToName[stats[0]] || ""
              )
              .replace(
                "$tick0:statmod1.onlystat$",
                statIdToName[stats[1]] || ""
              )
              .replace("$tick$", `${effectData.tickTimer} seconds` || "");
          }

          if (description.includes("$effect1.description$")) {
            const effectData = getJson(
              directoryData,
              "/Effects/Effect",
              `Effect_${abilityData.effectsIds[1].guid}.json`
            );
            const effectDescription = extractLastValue(
              effectData.effectDescription
            );
            description = description.replace(
              "$effect1.description$",
              effectDescription
            );
            const duration = formatTime(effectData.effectDuration.expression);
            description = description
              .replace("$duration$", duration)
              .replace("$statmod0.by%$", "Gain " + statIdToName[stats[0]] || "")
              .replace("$tick0:statmod0.%$", statIdToName[stats[0]] || "")
              .replace("$tick0:statmod1.%$", statIdToName[stats[1]] || "")
              .replace("$statmod0.onlystat$", statIdToName[stats[0]] || "")
              .replace("$statmod1.onlystat$", statIdToName[stats[1]] || "")
              .replace(
                "$tick0:statmod0.onlystat$",
                statIdToName[stats[0]] || ""
              )
              .replace(
                "$tick0:statmod1.onlystat$",
                statIdToName[stats[1]] || ""
              )
              .replace("$tick$", `${effectData.tickTimer} seconds` || "");
          }

          if (description.includes("$effect2.description$")) {
            const effectData = getJson(
              directoryData,
              "/Effects/Effect",
              `Effect_${abilityData.effectsIds[2].guid}.json`
            );
            const effectDescription = extractLastValue(
              effectData.effectDescription
            );
            description = description.replace(
              "$effect2.description$",
              effectDescription
            );
            const duration = formatTime(effectData.effectDuration.expression);
            description = description
              .replace("$duration$", duration)
              .replace("$statmod0.by%$", "Gain " + statIdToName[stats[0]] || "")
              .replace("$tick0:statmod0.%$", statIdToName[stats[0]] || "")
              .replace("$tick0:statmod1.%$", statIdToName[stats[1]] || "")
              .replace("$statmod0.onlystat$", statIdToName[stats[0]] || "")
              .replace("$statmod1.onlystat$", statIdToName[stats[1]] || "")
              .replace(
                "$tick0:statmod0.onlystat$",
                statIdToName[stats[0]] || ""
              )
              .replace(
                "$tick0:statmod1.onlystat$",
                statIdToName[stats[1]] || ""
              )
              .replace("$tick$", `${effectData.tickTimer} seconds` || "");
          }

          item.description = `On Consume: ${description}`.split("\\r\\n");
        }

        // Add to batch arrays
        allItems.push(item);
        itemIds.push(item.id);
        totalItemsProcessed++;
      }
    }

    // Batch query for recipes for all items at once (similar to gear processing)
    const itemRecipesMap = await batchFindItemRecipes(itemIds);
    const recipesMap = await batchFindRecipes(itemIds);

    // Apply recipes to items
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      if (itemRecipesMap[item.id] && itemRecipesMap[item.id].length > 0) {
        item.itemRecipeId = itemRecipesMap[item.id];
      }
      if (recipesMap[item.id] && recipesMap[item.id].length > 0) {
        item.recipeId = recipesMap[item.id];
      }
    }

    // Save all items in a single batch operation
    await batchSaveItemsToDatabase(allItems);

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

export { processItemFiles };
