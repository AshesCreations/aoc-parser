/**
 * Enchantment definition processor module for parsing game enchantment definition data.
 */

import fs from "fs";
import path from "path";
import { saveEnchantmentDefToDatabase } from "../db/operations.js";

/**
 * Processes a single JSON file containing enchantment definition data
 * @param {string} filePath - Path to the JSON file
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processEnchantmentDefFile(filePath) {
  try {
    const rawData = await fs.promises.readFile(filePath, "utf8");
    const jsonData = JSON.parse(rawData);

    // Create new object structure
    const processedObject = {
      id: jsonData.guid,
      name: jsonData.name || "",
      levels: [],
    };

    // Process each definition
    if (jsonData.enchantmentLevelDefsIds) {
      for (const level in jsonData.enchantmentLevelDefsIds) {
        processedObject.levels.push(
          jsonData.enchantmentLevelDefsIds[level].guid
        );
      }
    }

    return processedObject;
  } catch (error) {
    const fileName = path.basename(filePath);
    console.error(
      `Error processing enchantment definition file ${fileName}:`,
      error.message
    );
    return null;
  }
}

/**
 * Processes all enchantment definition in the specified directory and saves to database
 * @param {string} directoryPath - Path to the directory containing JSON files
 * @returns {Promise<number>} Number of enchantment definition files processed successfully
 */
async function processEnchantmentDefFiles(directoryPath) {
  try {
    // Read all files in the directory
    const files = await fs.promises.readdir(directoryPath);

    // Filter for JSON files only
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );

    if (jsonFiles.length === 0) {
      console.log(
        "No JSON files found in the enchantment definition directory."
      );
      return 0;
    }

    console.log(
      `Found ${jsonFiles.length} enchantment definition files to process`
    );
    let successCount = 0;

    // Process each JSON file
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      const processedData = await processEnchantmentDefFile(filePath);

      if (processedData !== null) {
        // Save to database
        await saveEnchantmentDefToDatabase(processedData);
        successCount++;
      }
    }

    return successCount;
  } catch (error) {
    console.error(
      "Error processing enchantment definition directory:",
      error.message
    );
    return 0;
  }
}
export { processEnchantmentDefFiles };
