/**
 * Enchantment Level processor module for parsing game set bonus data.
 */

import fs from "fs";
import path from "path";
import { saveEnchantmentLevelToDatabase } from "../db/operations.js";

/**
 * Processes a single JSON file containing enchantment level data
 * @param {string} filePath - Path to the JSON file
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processEnchantmentLevelFile(filePath) {
  try {
    const rawData = await fs.promises.readFile(filePath, "utf8");
    const jsonData = JSON.parse(rawData);

    // Create new object structure
    const processedObject = {
      id: jsonData.guid,
      name: jsonData.name.replace(/_/g, " ") || "",
      primary: jsonData.primaryStatIncrease,
      core: jsonData.secondaryStatIncrease,
      cost: jsonData.goldCost,
      success: jsonData.successChance,
      failure: jsonData.failureChances.fAILURE,
      loss: jsonData.failureChances.fAILURE_LEVEL_LOSS,
      all: jsonData.failureChances.fAILURE_LEVEL_LOSS_ALL,
      break: jsonData.failureChances.fAILURE_BREAK,
    };

    return processedObject;
  } catch (error) {
    const fileName = path.basename(filePath);
    console.error(
      `Error processing enchantment level file ${fileName}:`,
      error.message
    );
    return null;
  }
}

/**
 * Processes all enchantment level in the specified directory and saves to database
 * @param {string} directoryPath - Path to the directory containing JSON files
 * @returns {Promise<number>} Number of enchantment level files processed successfully
 */
async function processEnchantmentLevelFiles(directoryPath) {
  try {
    // Read all files in the directory
    const files = await fs.promises.readdir(directoryPath);

    // Filter for JSON files only
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );

    if (jsonFiles.length === 0) {
      console.log("No JSON files found in the enchantment level directory.");
      return 0;
    }

    console.log(`Found ${jsonFiles.length} enchantment level files to process`);
    let successCount = 0;

    // Process each JSON file
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      const processedData = await processEnchantmentLevelFile(filePath);

      if (processedData !== null) {
        // Save to database
        await saveEnchantmentLevelToDatabase(processedData);
        successCount++;
      }
    }

    return successCount;
  } catch (error) {
    console.error(
      "Error processing enchantment level directory:",
      error.message
    );
    return 0;
  }
}
export { processEnchantmentLevelFiles };
