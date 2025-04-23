/**
 * Main entry point for the item parser system.
 * This script orchestrates the process of reading JSON files,
 * processing them, and saving to a PostgreSQL database.
 */

import fs from "fs";
import {
  initDatabase,
  setupConnection,
  closeConnections,
} from "./db/config.js";
import { processItemGearFiles } from "./processor/gear.js";
import { processItemRecipeFiles } from "./processor/itemRecipe.js";
import { processItemEquipmentFiles } from "./processor/equipment.js";
import { processItemFiles } from "./processor/item.js";
import { processStatBlockFiles } from "./processor/stat-block.js";
import { processSetBonusFiles } from "./processor/set-bonus.js";
import { processEnchantmentDefFiles } from "./processor/enchantment-def.js";
import { processEnchantmentLevelFiles } from "./processor/enchantment-level.js";
import { processRecipeFiles } from "./processor/recipe.js";
import {
  directoryStats,
  directorySetBonus,
  directoryEnchantmentDef,
  directoryEnchantmentLevel,
  directoryData,
  itemTypes,
  tagsToExclude,
  logFilePath,
  undefinedLogPath,
  statIdToName,
  professionIdToName,
  certificationIdToName,
  rewardTableIdToItemRewardId,
} from "./config.js";

/**
 * Main function to run the program
 */
async function main() {
  try {
    // Initialize log files
    console.log("\x1b[36m%s\x1b[0m", "Initialize new log files...");
    fs.writeFileSync(logFilePath, "Items with missing icons:\n");
    fs.writeFileSync(undefinedLogPath, "Items with undefined values:\n");

    // Establish database connection according to configuration mode
    console.log(
      "\x1b[36m%s\x1b[0m",
      `Starting database connection in ${
        process.env.CONNECTION_MODE || "ssh"
      } mode...`
    );
    await setupConnection();

    console.log("\x1b[36m%s\x1b[0m", "Starting database initialization...");
    await initDatabase();

    // Processing Recipe
    // Must be ran first, so other functions can use DB to populate values
    console.log("\nProcessing Recipe files...");
    const recipeProcessed = await processRecipeFiles(
      directoryData,
      professionIdToName,
      certificationIdToName,
      rewardTableIdToItemRewardId
    );
    console.log(
      `Recipe processing complete: ${recipeProcessed} files processed`
    );

    // Processing Item Recipes
    // Must be ran second, so other functions can use DB to populate values
    console.log("\nProcessing item recipe files...");
    const itemRecipesProcessed = await processItemRecipeFiles(
      directoryData,
      itemTypes,
      tagsToExclude,
      logFilePath,
      undefinedLogPath,
      statIdToName,
      rewardTableIdToItemRewardId
    );
    console.log(
      `Items Recipes processing complete: ${itemRecipesProcessed} files processed`
    );

    // Processing Items
    // REQUIRED: itemRecipes and recipes must be populated in DB before running.
    console.log("\nProcessing item files...");
    const itemsProcessed = await processItemFiles(
      directoryData,
      itemTypes,
      tagsToExclude,
      logFilePath,
      undefinedLogPath,
      statIdToName
    );
    console.log(`Items processing complete: ${itemsProcessed} files processed`);

    // Processing Stats
    console.log("\nProcessing stat block files...");
    const statsProcessed = await processStatBlockFiles(
      directoryStats,
      statIdToName
    );
    console.log(
      `Stat blocks processing complete: ${statsProcessed} files processed`
    );

    // Processing Set Bonus
    console.log("\nProcessing set bonus files...");
    const setBonusProcessed = await processSetBonusFiles(
      directorySetBonus,
      statIdToName
    );
    console.log(
      `Set bonus processing complete: ${setBonusProcessed} files processed`
    );

    // Processing Enchantment Definition
    console.log("\nProcessing enchantment definitions files...");
    const enchantmentDefProcessed = await processEnchantmentDefFiles(
      directoryEnchantmentDef
    );
    console.log(
      `Enchantment processing complete: ${enchantmentDefProcessed} files processed`
    );

    // Processing Enchantment Level
    console.log("\nProcessing enchantment Level files...");
    const enchantmentLevelProcessed = await processEnchantmentLevelFiles(
      directoryEnchantmentLevel
    );
    console.log(
      `Enchantment processing complete: ${enchantmentLevelProcessed} files processed`
    );

    // Processing Item:Gear
    // REQUIRED: itemRecipes must be populated in DB before running.
    console.log("\nProcessing Item:Gear files...");
    const gearProcessed = await processItemGearFiles(directoryData);
    console.log(
      `Item:Gear processing complete: ${gearProcessed} files processed`
    );

    // Processing Item:Equipment
    // REQUIRED: itemRecipes must be populated in DB before running.
    console.log("\nProcessing ItemEquipment files...");
    const equipmentProcessed = await processItemEquipmentFiles(directoryData);
    console.log(
      `Item:Equipment processing complete: ${equipmentProcessed} files processed`
    );

    console.log("\nAll processing complete. Closing connections...");
  } catch (error) {
    console.error(`An error occurred during processing: ${error.message}`);
  } finally {
    // Close all connections when done
    await closeConnections();
  }
}

// Run the main function
main()
  .catch((error) => {
    console.error("Fatal error:", error);
  })
  .finally(() => {
    closeConnections();
    process.exit(1);
  });
