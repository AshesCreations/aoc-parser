/**
 * Set bonus processor module for parsing game set bonus data.
 */

import fs from "fs";
import path from "path";
import { saveSetBonusToDatabase } from "../db/operations.js";
import {
  extractLastQuotedValue,
  getJson,
  parseValueExpression,
  extractDescription,
  extractCoefficient,
} from "../utils.js";

/**
 * Processes a single JSON file containing set bonus data
 * @param {string} filePath - Path to the JSON file
 * @param {Object} statIdToName - Mapping of stat IDs to names
 * @returns {Object|null} Processed data object or null if processing failed
 */
async function processSetBonusFile(filePath, statIdToName, dataDir) {
  try {
    const rawData = await fs.promises.readFile(filePath, "utf8");
    const jsonData = JSON.parse(rawData);

    // Create new object structure
    const processedObject = {
      id: jsonData.guid,
      name: extractLastQuotedValue(jsonData.setDisplayName) || "",
      statBonuses: [],
      effectBonuses: [],
    };

    // Process each bonus
    if (jsonData.setEffects) {
      for (const count in jsonData.setEffects) {
        const effects = jsonData.setEffects[count]?.statEffects || [];
        for (const bonus of effects) {
          const id = bonus.effectedStat?.guid;
          const name = statIdToName[id] || "";
          const stats = bonus.statEffects;
          processedObject.statBonuses.push({ count, id, name, stats });
        }
      }
    }

    if (jsonData.setStatBonuses) {
      for (const count in jsonData.setStatBonuses) {
        const bonuses = jsonData.setStatBonuses[count]?.statBonuses || [];
        for (const bonus of bonuses) {
          const id = bonus.affectedStat?.guid;
          const name = statIdToName[id] || "";
          const stats = bonus.statBonuses;
          processedObject.statBonuses.push({ count, id, name, stats });
        }
      }
    }

    if (jsonData.setEffectBonuses) {
      for (const count in jsonData.setEffectBonuses) {
        const effects = jsonData.setEffectBonuses[count]?.effectBonuses || [];
        for (const eff of effects) {
          const effectId = eff.effect?.guid;
          if (!effectId) continue;
          let effectData = getJson(
            dataDir,
            "/Effects/Effect",
            `Effect_${effectId}.json`
          );
          if (!effectData || Object.keys(effectData).length === 0) {
            effectData = getJson(
              dataDir,
              "/Effects/Effect",
              `EffectRecord_${effectId}.json`
            );
          }

          const description = extractDescription(
            effectData.effectDescription || ""
          ).join(" \n");

          const statMods = effectData.statModsIds || [];

          if (statMods.length === 0) {
            const effectObj = {
              ...eff.effect,
              name:
                extractLastQuotedValue(effectData.effectName) ||
                eff.effect.name ||
                "",
              description,
            };

            processedObject.effectBonuses.push({
              count,
              effect: effectObj,
              minimumRarity: eff.minimumRarity,
              maximumRarity: eff.maximumRarity,
              stacks: eff.stacks,
            });
            continue;
          }

          for (const mod of statMods) {
            const modId = mod.guid;
            let modData = getJson(
              dataDir,
              "/Effects/StatMod",
              `StatMod_${modId}.json`
            );
            if (!modData || Object.keys(modData).length === 0) {
              modData = getJson(
                dataDir,
                "/Effects/StatMod",
                `StatModRecord_${modId}.json`
              );
            }

            const statId = modData.statRefId?.guid;
            const statName = statIdToName[statId] || "";
            const parsed = parseValueExpression(
              modData.value?.expression || "",
              modData.valueInputTerms || [],
              statIdToName,
              dataDir
            );
            const numericValue = extractCoefficient(parsed);
            const effectObj = {
              ...eff.effect,
              name: statName,
              value: numericValue,
              description,
            };

            processedObject.effectBonuses.push({
              count,
              effect: effectObj,
              minimumRarity: eff.minimumRarity,
              maximumRarity: eff.maximumRarity,
              stacks: eff.stacks,
            });
          }
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

    const dataDir = path.resolve(directoryPath, "..", "..");

    // Process each JSON file
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      const processedData = await processSetBonusFile(
        filePath,
        statIdToName,
        dataDir
      );

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
