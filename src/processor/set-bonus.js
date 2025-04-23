/**
 * Set bonus processor module for parsing game set bonus data.
 */

import fs from "fs";
import path from "path";
import { saveSetBonusToDatabase } from "../db/operations.js";
import { extractLastQuotedValue } from "../utils.js";

/**
 * Processes a single JSON file containing set bonus data
 * @param {string} filePath - Path to the JSON file
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processSetBonusFile(filePath, statIdToName) {
  try {
    const rawData = await fs.promises.readFile(filePath, "utf8");
    const jsonData = JSON.parse(rawData);

    // Create new object structure
    const processedObject = {
      id: jsonData.guid,
      name: extractLastQuotedValue(jsonData.setDisplayName) || "",
      setEffects: [],
    };

    // Process each bonus
    if (jsonData.setEffects) {
      for (const setBonus in jsonData.setEffects) {
        for (const stat in jsonData.setEffects[setBonus].statEffects) {
          const id =
            jsonData.setEffects[setBonus].statEffects[stat].effectedStat.guid;
          const name = statIdToName[id] || "";
          const stats =
            jsonData.setEffects[setBonus].statEffects[stat].statEffects;
          processedObject.setEffects.push({ count: setBonus, id, name, stats });
        }
      }
    }

    return processedObject;
  } catch (error) {
    const fileName = path.basename(filePath);
    console.error(
      `Error processing set bonus file ${fileName}:`,
      error.message
    );
    return null;
  }
}

/**
 * Processes all set bonus files in the specified directory and saves to database
 * @param {string} directoryPath - Path to the directory containing JSON files
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Promise<number>} Number of set bonus files processed successfully
 */
async function processSetBonusFiles(directoryPath, statIdToName) {
  try {
    // Read all files in the directory
    const files = await fs.promises.readdir(directoryPath);

    // Filter for JSON files only
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );

    if (jsonFiles.length === 0) {
      console.log("No JSON files found in the set bonus directory.");
      return 0;
    }

    console.log(`Found ${jsonFiles.length} set bonus files to process`);
    let successCount = 0;

    // Process each JSON file
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      const processedData = await processSetBonusFile(filePath, statIdToName);

      if (processedData !== null) {
        // Save to database
        await saveSetBonusToDatabase(processedData);
        successCount++;
      }
    }

    return successCount;
  } catch (error) {
    console.error("Error processing set bonus directory:", error.message);
    return 0;
  }
}

export { processSetBonusFiles };
