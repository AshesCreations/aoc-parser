/**
 * Comprehensive Items processor module for parsing all game item data.
 * Combines gear, resources, and craftable items with recipe trees.
 * - Weapons, Armor, Equipment (Gear)
 * - Resources, Consumables, Materials
 * - All craftable items with recipe trees
 */

import fs from "fs";
import path from "path";
import {
  batchFindItemRecipes,
  batchFindRecipes,
  batchSaveItemsToDatabase,
  saveStatToDatabase,
} from "../db/operations.js";
import {
  extractDescription,
  extractLastQuotedValue,
  extractTagParts,
  extractValues,
  getJson,
  getItemJson,
  getVendorCost,
  getReagentVendorCost,
  extractLastValue,
  checkForUndefinedValues,
  logMissingIcon,
  extractExpressionId,
  formatTime,
  createEmptyStatsObject,
} from "../utils.js";
import { rewardTableIdToItemRewardId } from "../config.js";

function deepClone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Rounds a number to at most 2 decimal places
 * @param {number} value - The value to round
 * @returns {number} The rounded value
 */
function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function getOutputQuantity(rtId, itemId, directoryData, rewardTableCache) {
  if (!rtId) return 1;
  if (!rewardTableCache[rtId]) {
    rewardTableCache[rtId] = getJson(
      directoryData,
      "/Reward/RewardTable",
      `RewardTable_${rtId}.json`
    );
  }
  const rtData = rewardTableCache[rtId];
  if (!rtData || !Array.isArray(rtData.rewardDefContainers)) return 1;
  for (const container of rtData.rewardDefContainers) {
    for (const reward of container.rewards || []) {
      for (const itemReward of reward.itemRewards || []) {
        if (itemReward.item?.itemId?.guid === itemId) {
          const qty = Number(itemReward.quantity?.expression);
          return Number.isNaN(qty) ? 1 : qty;
        }
      }
    }
  }
  return 1;
}

/**
 * Get crafting currency cost for a recipe by following the chain:
 * Recipe -> craftingCurrencyCostId -> CraftingCurrencyCost file -> currencyCostValue
 * OR Recipe -> standardCurrencyCost -> expression value directly
 */
function getCraftingCurrencyCost(recipe, directoryData, currencyCostCache = {}) {
  // First try craftingCurrencyCostId approach
  if (recipe?.craftingCurrencyCostId?.guid && recipe.craftingCurrencyCostId.guid !== "0") {
    const costId = recipe.craftingCurrencyCostId.guid;

    // Use cache to avoid re-reading the same files
    if (currencyCostCache[costId] !== undefined) {
      return currencyCostCache[costId];
    }

    try {
      const costData = getJson(
        directoryData,
        "/Crafting/CraftingCurrencyCost",
        `CraftingCurrencyCost_${costId}.json`
      );

      if (costData?.currencyCostValue?.expression) {
        const cost = Number(costData.currencyCostValue.expression);
        currencyCostCache[costId] = Number.isNaN(cost) ? 0 : cost;
        return currencyCostCache[costId];
      }
    } catch (error) {
      console.warn(`Could not load CraftingCurrencyCost_${costId}.json:`, error.message);
    }

    // Cache the result as 0 to avoid repeated attempts
    currencyCostCache[costId] = 0;
    return 0;
  }

  // Fallback to standardCurrencyCost if craftingCurrencyCostId didn't work
  if (recipe?.standardCurrencyCost?.expression) {
    const cost = Number(recipe.standardCurrencyCost.expression);
    return Number.isNaN(cost) ? 0 : cost;
  }

  return 0;
}

function buildRecipeTree(
  itemId,
  itemToRewardTables,
  rewardIdToRecipe,
  directoryData,
  rewardTableCache,
  currencyCostCache = {},
  memo = new Map(),
  visiting = new Set()
) {
  if (!itemId) return null;

  if (memo.has(itemId)) {
    return deepClone(memo.get(itemId));
  }

  if (visiting.has(itemId)) {
    return null;
  }

  visiting.add(itemId);

  const itemData = getItemJson(directoryData, "/Item/Item", itemId);
  if (!itemData || Object.keys(itemData).length === 0) {
    visiting.delete(itemId);
    return null;
  }
  const vendorCostInfo = getVendorCost(directoryData, itemId);
  const tree = {
    item: { name: itemData.name, guid: itemId },
    recipes: [],
    craftCost: null,
    craftFee: null,
    sellPrice: vendorCostInfo.sellPrice,
  };
  const costOptions = [];
  const craftFeeOptions = [];
  if (vendorCostInfo.buyPrice != null) costOptions.push(vendorCostInfo.buyPrice);
  const tables = itemToRewardTables[itemId] || [];
  for (const rtId of tables) {
    const recipe = rewardIdToRecipe[rtId];
    if (!recipe) continue;

    const baseCraftCost = getCraftingCurrencyCost(recipe, directoryData, currencyCostCache);

    const biomes = [];
    if (Array.isArray(recipe.availabilityPredicates)) {
      for (const predicate of recipe.availabilityPredicates) {
        if (predicate.type === "Biome" && Array.isArray(predicate.biomes)) {
          biomes.push(...predicate.biomes);
        }
      }
    }

    const recipeNode = {
      outputQuantity: getOutputQuantity(rtId, itemId, directoryData, rewardTableCache),
      primaryResources: [],
      generalResources: [],
      craftCost: baseCraftCost,
      craftFee: baseCraftCost,
      baseCraftingCost: baseCraftCost,
      biomes: [...new Set(biomes)],
      learnable: recipe.learnable || false,
    };
    if (Array.isArray(recipe.primaryResourceCosts)) {
      for (const pr of recipe.primaryResourceCosts) {
        let sub = null;
        // Get the resource item data to check its tags
        const resourceItemData = getItemJson(directoryData, "/Item/Item", pr.item?.guid);
        const resourceTags = resourceItemData ? [...extractTagParts(resourceItemData, [])] : [];
        const resourceName = resourceItemData?.name || "";
        
        // Only build sub-recipe tree and calculate costs if the resource is not a raw material
        // Check for "Raw" tag part which indicates raw materials, or "Raw" in the name
        const isRawMaterial = resourceTags.includes("Raw") || resourceName.includes("Resource_Raw");
        if (!isRawMaterial) {
          sub = buildRecipeTree(
            pr.item?.guid,
            itemToRewardTables,
            rewardIdToRecipe,
            directoryData,
            rewardTableCache,
            currencyCostCache,
            memo,
            visiting
          );
        }
        const costInfo = getReagentVendorCost(directoryData, pr.item?.guid);
        const vendor = costInfo.buyPrice;
        const subCraftCost = sub?.craftCost;
        const resolvedVendorCost = typeof vendor === "number" ? vendor : 0;
        const componentCost = subCraftCost ?? resolvedVendorCost;
        const quantity = Number(pr.quantity) || 0;

        recipeNode.craftCost += (componentCost ?? 0) * quantity;
        const itemData = getItemJson(directoryData, "/Item/Item", pr.item?.guid);
        recipeNode.primaryResources.push({
          item: itemData,
          quantity: pr.quantity,
          rarity: pr.rarity,
          resourceCost: typeof vendor === "number" && !itemData.name.includes("Resource_Raw") ? vendor : null,
          sellPrice: costInfo.sellPrice ?? null,
          details: extractLastQuotedValue(itemData?.details || ""),
          craftCost: subCraftCost ?? null,
          craftFee: sub?.craftFee ?? null,
          subMaterials: sub,
        });
      }
    }
    if (Array.isArray(recipe.generalResourceCost)) {
      for (const gr of recipe.generalResourceCost) {
        let sub = null;
        // Get the resource item data to check its tags
        const resourceItemData = getItemJson(directoryData, "/Item/Item", gr.item?.guid);
        const resourceTags = resourceItemData ? [...extractTagParts(resourceItemData, [])] : [];
        const resourceName = resourceItemData?.name || "";
        
        // Only build sub-recipe tree and calculate costs if the resource is not a raw material
        // Check for "Raw" tag part which indicates raw materials, or "Raw" in the name
        const isRawMaterial = resourceTags.includes("Raw") || resourceName.includes("Resource_Raw");
        if (!isRawMaterial) {
          sub = buildRecipeTree(
            gr.item?.guid,  
            itemToRewardTables,
            rewardIdToRecipe,
            directoryData,
            rewardTableCache,
            currencyCostCache,
            memo,
            visiting
          );
        }
        const costInfo = getReagentVendorCost(directoryData, gr.item?.guid);
        const vendor = costInfo.buyPrice;
        const subCraftCost = sub?.craftCost;
        const resolvedVendorCost = typeof vendor === "number" ? vendor : 0;
        const componentCost = subCraftCost ?? resolvedVendorCost;
        const quantity = Number(gr.quantity) || 0;

        recipeNode.craftCost += (componentCost ?? 0) * quantity;
        const itemData = getItemJson(directoryData, "/Item/Item", gr.item?.guid);
        recipeNode.generalResources.push({
          item: itemData,
          quantity: gr.quantity,
          resourceCost: typeof vendor === "number" && !itemData.name.includes("Resource_Raw") ? vendor : null,
          sellPrice: costInfo.sellPrice ?? null,
          details: extractLastQuotedValue(itemData?.details || ""),
          craftCost: subCraftCost ?? null,
          craftFee: sub?.craftFee ?? null,
          subMaterials: sub,
        });
      }
    }
    tree.recipes.push(recipeNode);
    costOptions.push(recipeNode.craftCost);
    craftFeeOptions.push(recipeNode.craftFee);
  }
  if (costOptions.length > 0) {
    tree.craftCost = Math.min(...costOptions);
  }
  if (craftFeeOptions.length > 0) {
    tree.craftFee = Math.min(...craftFeeOptions);
  }
  visiting.delete(itemId);

  const cachedTree = deepClone(tree);
  memo.set(itemId, cachedTree);
  return deepClone(tree);
}


/**
 * Process all JSON files in the item directory for comprehensive items database
 * @param {string} directoryData - Path to the Data directory
 * @param {Array<string>} itemTypes - Array of item types to include
 * @param {Array<string>} tagsToExclude - Array of tags to exclude from extraction
 * @param {string} missingIconLogPath - Path to log file for missing icons
 * @param {string} undefinedLogPath - Path to log file for undefined values
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processComprehensiveItemFiles(
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

    console.log(`Found ${jsonFiles.length} JSON files to process for comprehensive items`);
    let totalItemsProcessed = 0;
    let itemsWithUndefined = 0;
    let itemsWithMissingIcons = 0;
    let itemsByType = {};

    // Prepare batch processing arrays
    const allItems = [];
    const itemIds = [];

    // First loop: Parse all files and collect data without DB operations
    for (const file of jsonFiles) {
      const filePath = path.join(directoryItem, file);
      const data = fs.readFileSync(filePath, "utf8");
      let jsonData = JSON.parse(data);

      // Skip items with no meaningful data
      if (Object.keys(jsonData).length === 0) {
        continue;
      }

      // Determine if this is a recipe item (skip these as they're handled separately)
      const isRecipe =
        jsonData.hasOwnProperty("learnableRecipeIds") &&
        Array.isArray(jsonData["learnableRecipeIds"]) &&
        jsonData["learnableRecipeIds"].length > 0;

      if (isRecipe) {
        continue;
      }

      // Extract tag parts for typeDescription
      const typeDescTags = [
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
          "Consumable",
          "Enchanting",
          "Resource",
          "Raw",
          "resource",
          "Fuel",
          "Processing",
          "Processed",
          "ability",
          "MagicalScalingOverride",
          "PhysicalScalingOverride",
        ]),
      ];

      // Create comprehensive item object with all potential fields
      let item = {
        id: jsonData.guid,
        name: extractLastQuotedValue(jsonData.itemName),
        description: extractDescription(jsonData.description),
        type: jsonData.inventoryFilterType,
        subType: jsonData.subType,
        tag: [...extractTagParts(jsonData, tagsToExclude)],
        icon: jsonData.displayIcon
          ? jsonData.displayIcon.split(".")[0] + ".webp"
          : undefined,
        rarityMin: jsonData.rarityMin,
        rarityMax: jsonData.rarityMax,
        level: jsonData.level,
        grade: jsonData.grade,
        statsId: jsonData.statBlockId?.guid,
        setBonusIds: extractValues(jsonData.setBonusIds, "guid"),
        enchantmentId: jsonData.enchantmentDefId?.guid,
        deconstructionRecipeId: jsonData.deconstructionRecipeId?.guid,
        slots: jsonData.equipSlots || [],
        itemRecipeId: [],
        recipeId: [],
        craftingRecipes: [],
        recipeTree: null,
        layout: "comprehensive-item",
        typeDescription: typeDescTags.reverse().join(" "),
        inventoryDimension: jsonData.inventoryDimension && jsonData.inventoryDimension.x && jsonData.inventoryDimension.y ? `${jsonData.inventoryDimension.x}x${jsonData.inventoryDimension.y}` : null,
        maxStackSize: jsonData.maxStackSize || null,
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
        ["learnableRecipeIds", "recipeTree"]
      );
      if (hasUndefined) {
        itemsWithUndefined++;
      }

      // Check if the icon path doesn't contain "/Game/UI/Icons/"
      if (item.icon && !item.icon.includes("/Game/UI/Icons/")) {
        logMissingIcon(item.id, jsonData.name, item.type, missingIconLogPath);
        itemsWithMissingIcons++;
      }

      // Process ability descriptions for consumables
      if (item.description && item.description.includes && item.description.includes("$AbilityDescription$")) {
        // Get description stats
        let stats = [];
        if (jsonData.statBlockId?.guid && jsonData.statBlockId.guid !== "0") {
          const statData = getJson(
            directoryData,
            "/Item/ItemStatBlock",
            `ItemStatBlock_${jsonData.statBlockId.guid}.json`
          );
          if (statData?.statArchetype) {
            stats = [...Object.keys(statData.statArchetype)];
          }
        }

        // Get ability data
        const abilityData = getJson(
          directoryData,
          "/Abilities/AoCAbility",
          `AoCAbility_${jsonData.activationCastId?.guid}.json`
        );

        if (abilityData) {
          let description = extractLastValue(abilityData.abilityDescription);

          // Process cooldown
          if (description && description.includes && description.includes("$cd$")) {
            const id = extractExpressionId(abilityData.cooldown?.expression);
            if (id) {
              const statFormulaData = getJson(
                directoryData,
                "/Stats/StatFormulaType",
                `StatFormulaType_${id}.json`
              );
              if (statFormulaData?.equationId?.guid) {
                const statEquationData = getJson(
                  directoryData,
                  "/Stats/StatEquationType",
                  `StatEquationType_${statFormulaData.equationId.guid}.json`
                );
                if (statEquationData?.equation?.expression) {
                  const cd = statEquationData.equation.expression;
                  description = description.replace("$cd$", formatTime(cd));
                }
              }
            }
          }

          // Process stat replacements
          if (description && description.includes) {
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
                `AbilityHit_${abilityData.hitsIds?.["1"]?.guid}.json`
              );
              if (hitData?.applyEffects?.[0]?.effectId?.guid) {
                const effectData = getJson(
                  directoryData,
                  "/Effects/Effect",
                  `Effect_${hitData.applyEffects[0].effectId.guid}.json`
                );
                if (effectData) {
                  const effectDescription = extractLastValue(
                    effectData.effectDescription
                  );
                  description = description.replace(
                    "$hit1:apply0.description$",
                    effectDescription
                  );
                  const duration = formatTime(effectData.effectDuration?.expression);
                  description = description
                    .replace("$duration$", duration)
                    .replace("$statmod0.by%$", "Gain " + (statIdToName[stats[0]] || ""))
                    .replace("$tick0:statmod0.%$", statIdToName[stats[0]] || "")
                    .replace("$tick0:statmod1.%$", statIdToName[stats[1]] || "")
                    .replace("$statmod0.onlystat$", statIdToName[stats[0]] || "")
                    .replace("$statmod1.onlystat$", statIdToName[stats[1]] || "")
                    .replace("$tick0:statmod0.onlystat$", statIdToName[stats[0]] || "")
                    .replace("$tick0:statmod1.onlystat$", statIdToName[stats[1]] || "")
                    .replace("$tick$", `${effectData.tickTimer} seconds` || "");
                }
              }
            }

            // Process additional effects
            if (description.includes("$effect1.description$") && abilityData.effectsIds?.[1]) {
              const effectData = getJson(
                directoryData,
                "/Effects/Effect",
                `Effect_${abilityData.effectsIds[1].guid}.json`
              );
              if (effectData) {
                const effectDescription = extractLastValue(
                  effectData.effectDescription
                );
                description = description.replace(
                  "$effect1.description$",
                  effectDescription
                );
                const duration = formatTime(effectData.effectDuration?.expression);
                description = description
                  .replace("$duration$", duration)
                  .replace("$statmod0.by%$", "Gain " + (statIdToName[stats[0]] || ""))
                  .replace("$tick0:statmod0.%$", statIdToName[stats[0]] || "")
                  .replace("$tick0:statmod1.%$", statIdToName[stats[1]] || "")
                  .replace("$statmod0.onlystat$", statIdToName[stats[0]] || "")
                  .replace("$statmod1.onlystat$", statIdToName[stats[1]] || "")
                  .replace("$tick0:statmod0.onlystat$", statIdToName[stats[0]] || "")
                  .replace("$tick0:statmod1.onlystat$", statIdToName[stats[1]] || "")
                  .replace("$tick$", `${effectData.tickTimer} seconds` || "");
              }
            }

            if (description.includes("$effect2.description$") && abilityData.effectsIds?.[2]) {
              const effectData = getJson(
                directoryData,
                "/Effects/Effect",
                `Effect_${abilityData.effectsIds[2].guid}.json`
              );
              if (effectData) {
                const effectDescription = extractLastValue(
                  effectData.effectDescription
                );
                description = description.replace(
                  "$effect2.description$",
                  effectDescription
                );
                const duration = formatTime(effectData.effectDuration?.expression);
                description = description
                  .replace("$duration$", duration)
                  .replace("$statmod0.by%$", "Gain " + (statIdToName[stats[0]] || ""))
                  .replace("$tick0:statmod0.%$", statIdToName[stats[0]] || "")
                  .replace("$tick0:statmod1.%$", statIdToName[stats[1]] || "")
                  .replace("$statmod0.onlystat$", statIdToName[stats[0]] || "")
                  .replace("$statmod1.onlystat$", statIdToName[stats[1]] || "")
                  .replace("$tick0:statmod0.onlystat$", statIdToName[stats[0]] || "")
                  .replace("$tick0:statmod1.onlystat$", statIdToName[stats[1]] || "")
                  .replace("$tick$", `${effectData.tickTimer} seconds` || "");
              }
            }
          }

          item.description = `On Consume: ${description}`.split("\\r\\n");
        }
      }

      // Process embedded stat data if present
      if (jsonData.stats && jsonData.statArchetype) {
        try {
          // Create processed object structure with empty arrays for each rarity and stat type
          const processedObject = {
            id: jsonData.guid,
            ...createEmptyStatsObject(),
          };

          // Process stats based on statArchetype
          const rarities = [
            "common",
            "uncommon",
            "rare",
            "heroic",
            "epic",
            "legendary",
            "artifact",
          ];

          for (const statId in jsonData.statArchetype) {
            const statData = jsonData.stats[statId];
            const statName = statIdToName[statId] || "";
            const statType =
              jsonData.statArchetype[statId] === "Primary" ? "primary" : "core";

            // Process each rarity for this stat
            rarities.forEach((rarity) => {
              const minKey = `${rarity}Min`;
              const maxKey = `${rarity}Max`;

              if (statData.hasOwnProperty(minKey) && statData.hasOwnProperty(maxKey)) {
                const minValue = statData[minKey];
                const maxValue = statData[maxKey];

                // Add to the appropriate stat array
                processedObject[rarity][statType].push({
                  id: statId,
                  name: statName,
                  min: roundToTwoDecimals(minValue),
                  max: roundToTwoDecimals(maxValue),
                });
              }
            });
          }

          // Check for durability stat
          if (jsonData.stats["6064629444242636800"]) {
            processedObject.durability = roundToTwoDecimals(jsonData.stats["6064629444242636800"]);
          }

          // Save the embedded stat data to database
          await saveStatToDatabase(processedObject);
          console.log(`Processed embedded stats for item: ${jsonData.name || jsonData.guid}`);
        } catch (error) {
          console.error(`Error processing embedded stats for item ${jsonData.guid}:`, error.message);
        }
      }

      // Add to batch arrays
      allItems.push(item);
      itemIds.push(item.id);
      totalItemsProcessed++;
    }

    // Batch query for recipes for all items at once
    const itemRecipesMap = await batchFindItemRecipes(itemIds);
    const recipesMap = await batchFindRecipes(itemIds);

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
    const currencyCostCache = {}; // Cache for crafting currency costs
    const recipeMemo = new Map(); // Cache for previously computed recipe trees

    // Apply recipes to items and gather crafting recipes
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      if (itemRecipesMap[item.id] && itemRecipesMap[item.id].length > 0) {
        item.itemRecipeId = itemRecipesMap[item.id];
      }
      if (recipesMap[item.id] && recipesMap[item.id].length > 0) {
        item.recipeId = recipesMap[item.id];
      }

      const tables = itemToRewardTables[item.id] || [];
      const craftingRecipes = [];

      // First, check recipes from reward table mapping
      for (const rtId of tables) {
        if (!rtId || rtId === "0") continue;
        const recipe = rewardIdToRecipe[rtId];
        if (recipe) {
          craftingRecipes.push(recipe);
        }
      }

      // Also check ALL recipes to see if any produce this item
      // This ensures we don't miss processing recipes that might not be in the reward table mapping
      for (const [rewardId, recipe] of Object.entries(rewardIdToRecipe)) {
        if (recipe && recipe.rewardId?.guid) {
          // Check if this recipe's reward table contains the current item
          const recipeRewardTableId = recipe.rewardId.guid;
          if (!rewardTableCache[recipeRewardTableId]) {
            rewardTableCache[recipeRewardTableId] = getJson(
              directoryData,
              "/Reward/RewardTable",
              `RewardTable_${recipeRewardTableId}.json`
            );
          }
          const rtData = rewardTableCache[recipeRewardTableId];
          if (rtData && Array.isArray(rtData.rewardDefContainers)) {
            for (const container of rtData.rewardDefContainers) {
              for (const reward of container.rewards || []) {
                for (const itemReward of reward.itemRewards || []) {
                  if (itemReward.item?.itemId?.guid === item.id) {
                    // This recipe produces the current item, add it if not already added
                    if (!craftingRecipes.some(r => r.rewardId?.guid === recipe.rewardId?.guid)) {
                      craftingRecipes.push(recipe);
                    }
                  }
                }
              }
            }
          }
        }
      }

      // If any recipes are found for this item, build the recipe tree
      if (craftingRecipes.length > 0) {
        item.craftingRecipes = craftingRecipes;
        // Don't create recipe tree for raw gem materials
          item.recipeTree = buildRecipeTree(
            item.id,
            itemToRewardTables,
            rewardIdToRecipe,
            directoryData,
            rewardTableCache,
            currencyCostCache
          );
        
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
    console.log("\nComprehensive Items processing:");
    console.log(`- Total items processed: ${totalItemsProcessed}`);
    console.log(
      `- Items with undefined values: ${itemsWithUndefined} (logged to ${undefinedLogPath})`
    );
    console.log(
      `- Items with missing icons: ${itemsWithMissingIcons} (logged to ${missingIconLogPath})`
    );
    console.log(`- Items by type:`);
    console.log(`${typesSummary}`);

    return totalItemsProcessed;
  } catch (error) {
    console.error(`Error processing comprehensive items: ${error.message}`);
    throw error;
  }
}

export { processComprehensiveItemFiles };

