/**
 * Item processor module for parsing game recipe data.
 */

import fs from "fs";
import path from "path";
import { extractLastQuotedValue } from "../utils.js";
import { saveRecipeToDatabase } from "../db/operations.js";

async function processRecipeFiles(
  directoryData,
  professionIdToName,
  certificationIdToName,
  rewardTableIdToItemRewardId
) {
  try {
    // Read all files in the directory
    const professionName = professionIdToName;
    const certificationName = certificationIdToName;
    const rewardId = rewardTableIdToItemRewardId;
    const directoryRecipe = path.join(
      directoryData,
      "/Crafting/CraftingRecipeDef"
    );
    const files = fs.readdirSync(directoryRecipe);

    // Filter for JSON files
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );

    console.log(`Found ${jsonFiles.length} JSON files to process`);
    let totalItemsProcessed = 0;
    let itemsByProfession = {};
    let itemsByCertification = {};

    for (const file of jsonFiles) {
      const filePath = path.join(directoryRecipe, file);
      try {
        const data = fs.readFileSync(filePath, "utf8");
        const jsonData = JSON.parse(data);
        if (Object.keys(jsonData).length !== 0) {
          let recipe = {
            id: jsonData.guid,
            name: jsonData.name,
            profession: professionName[jsonData.professionId?.guid] || "",
            certification:
              certificationName[jsonData.certificationLevelId?.guid] || "",
            learnable: jsonData.learnable,
            overrideName: extractLastQuotedValue(jsonData.overrideName),
            overrides: [],
            tags: jsonData.categoryTag?.tagName.split(".") || "",
            fuel: jsonData.fuel,
            baseDuration: jsonData.baseDuration,
            rewardId: jsonData.rewardId?.guid || "",
            primaryResourceCosts: [],
            generalResourceCost: [],
            qualityFormula: jsonData.qualityFormula?.expression || "",
            craftingCurrencyCostId: jsonData.craftingCurrencyCostId?.guid,
            rewardItem: [],
          };

          // Populate primary resource cost, includes rarity
          if (jsonData.primaryResourceCosts) {
            for (const resource in jsonData.primaryResourceCosts) {
              recipe.primaryResourceCosts.push({
                itemId: jsonData.primaryResourceCosts[resource].item?.guid,
                rarity: jsonData.primaryResourceCosts[resource].rarity,
                quantity: jsonData.primaryResourceCosts[resource].quantity,
              });
            }
          }

          // Populate general resource cost
          if (jsonData.generalResourceCost) {
            for (const resource in jsonData.generalResourceCost) {
              recipe.generalResourceCost.push({
                itemId: jsonData.generalResourceCost[resource].item?.guid,
                quantity: jsonData.generalResourceCost[resource].quantity,
              });
            }
          }

          // Populate overrides
          if (jsonData.overrides) {
            for (const override in jsonData.overrides) {
              recipe.overrides.push({
                quantity: jsonData.overrides[override].quantity,
                duration: jsonData.overrides[override].duration,
                fuel: jsonData.overrides[override].fuel,
              });
            }
          }

          // Populate item reward
          if (recipe.rewardId) {
            let id = rewardId[recipe.rewardId];
            if (!id) {
              console.log(
                `Warning: [${recipe.name}][${recipe.id}] Recipe reward id is undefined.`
              );
              id = [];
            } else if (id.length === 0) {
              console.log(
                `Warning: [${recipe.name}][${recipe.id}] Recipe reward id is empty.`
              );
            }
            if (id?.[0] === "0") {
              console.log(
                `Warning: [${recipe.name}][${recipe.id}] Recipe reward id is invalid, "0"`
              );
              id = [];
            }
            recipe.rewardItem = [...id];
          }

          // Track recipe by Profession
          if (!itemsByProfession[recipe.profession]) {
            itemsByProfession[recipe.profession] = 0;
          }
          itemsByProfession[recipe.profession]++;

          // Track recipe by Certification
          if (!itemsByCertification[recipe.certification]) {
            itemsByCertification[recipe.certification] = 0;
          }
          itemsByCertification[recipe.certification]++;

          // Save item to database
          await saveRecipeToDatabase(recipe);
          totalItemsProcessed++;
        }
      } catch (error) {
        console.log(error);
      }
    }

    // Create summary of recipes by profession
    let professionSummary = "";
    for (const [profession, count] of Object.entries(itemsByProfession)) {
      professionSummary += `  - ${profession}: ${count} items\n`;
    }

    // Create summary of recipes by certification
    let certificationSummary = "";
    for (const [certification, count] of Object.entries(itemsByCertification)) {
      certificationSummary += `  - ${certification}: ${count} items\n`;
    }

    // print summary
    console.log("\nItem processing:");
    console.log(`- Total items processed: ${totalItemsProcessed}`);
    console.log(`- Item by profession:`);
    console.log(`${professionSummary}`);
    console.log(`- Item by certification:`);
    console.log(`${certificationSummary}`);

    return totalItemsProcessed;
  } catch (error) {
    console.error(`Error processing directory: ${error.message}`);
    throw error;
  }
}

export { processRecipeFiles };
