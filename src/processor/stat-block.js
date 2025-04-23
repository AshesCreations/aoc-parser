/**
 * Stat processor module for parsing game stat data.
 */

import fs from "fs";
import path from "path";
import { saveStatToDatabase } from "../db/operations.js";
import { createEmptyStatsObject } from "../utils.js";

/**
 * Processes stat data for a specific rarity
 * @param {Object} stats - The stats object to add to
 * @param {string} rarity - The rarity level (e.g., 'common', 'rare')
 * @param {string} statType - The stat type ('primary' or 'core')
 * @param {string} statId - The ID of the stat
 * @param {string} statName - The name of the stat
 * @param {Object} statData - The stat data containing min/max values
 */
function processStatForRarity(
  stats,
  rarity,
  statType,
  statId,
  statName,
  statData
) {
  const minKey = `${rarity}Min`;
  const maxKey = `${rarity}Max`;

  if (statData.hasOwnProperty(minKey) && statData.hasOwnProperty(maxKey)) {
    stats[rarity][statType].push({
      id: statId,
      name: statName,
      min: statData[minKey],
      max: statData[maxKey],
    });
  }
}

/**
 * Processes a single JSON file containing item stat block data
 * @param {string} filePath - Path to the JSON file
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processStatFile(filePath, statIdToName) {
  try {
    const rawData = await fs.promises.readFile(filePath, "utf8");
    const jsonData = JSON.parse(rawData);

    // Create new object structure with empty arrays for each rarity and stat type
    const processedObject = {
      id: jsonData.guid,
      ...createEmptyStatsObject(),
    };

    // Process stats based on statArchetype
    if (jsonData.stats && jsonData.statArchetype) {
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
          processStatForRarity(
            processedObject,
            rarity,
            statType,
            statId,
            statName,
            statData
          );
        });
      }
      if (jsonData.stats["6064629444242636800"]) {
        processedObject.durability = jsonData.stats["6064629444242636800"];
      }
    }

    return processedObject;
  } catch (error) {
    const fileName = path.basename(filePath);
    console.error(`Error: Processing stat file ${fileName}:`, error.message);
    return null;
  }
}

/**
 * Processes all stat block files in the specified directory and saves to database
 * @param {string} directoryPath - Path to the directory containing JSON files
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Promise<number>} Number of stat blocks processed successfully
 */
async function processStatBlockFiles(directoryPath, statIdToName) {
  try {
    // Read all files in the directory
    const files = await fs.promises.readdir(directoryPath);

    // Filter for JSON files only
    const jsonFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".json"
    );

    if (jsonFiles.length === 0) {
      console.log("No JSON files found in the directory.");
      return 0;
    }

    console.log(`Found ${jsonFiles.length} stat block files to process`);
    let successCount = 0;

    // Process each JSON file
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      const processedData = await processStatFile(filePath, statIdToName);

      if (processedData !== null) {
        // Save to database
        await saveStatToDatabase(processedData);
        successCount++;
      }
    }

    return successCount;
  } catch (error) {
    console.error("Error processing stat block directory:", error.message);
    return 0;
  }
}

export { processStatBlockFiles };
