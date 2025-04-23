/**
 * Stand alone tool to parse the reward table files.
 * returns file id and reward id to one JSON file.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
dotenv.config();

// Get current filename and directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const statNameIdPath = path.join(__dirname, "../json/reward-id.json");

const directoryBase = process.env.GAME_FILES_PATH;
const folderPath =
  directoryBase + "/AOC/Content/DesignData/Data/Reward/RewardTable";
/**
 * Processes JSON files and extracts guid and displayName mappings
 * @param {string} folderPath - Path to the folder containing JSON files
 * @param {string} outputFile - Path to the output file
 */
function processJsonFiles(folderPath, outputFile) {
  try {
    // Check if folder exists
    if (!fs.existsSync(folderPath)) {
      console.error(`Folder ${folderPath} does not exist`);
      return;
    }

    // Read all files in the folder
    const files = fs.readdirSync(folderPath);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    if (jsonFiles.length === 0) {
      console.log("No JSON files found in the folder");
      return;
    }

    // Object to store guid -> displayName mappings
    const rewardTableIdToItemIdMap = {};

    // Process each JSON file
    jsonFiles.forEach((file) => {
      const filePath = path.join(folderPath, file);
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        const jsonData = JSON.parse(fileContent);

        // Check if the required fields exist
        const rewardList =
          jsonData?.rewardDefContainers?.[0]?.rewards?.[0]?.itemRewards;
        if (jsonData.guid && rewardList) {
          // Extract each item reward id
          let rewardData = [];
          for (const item of rewardList) {
            rewardData.push(item.item?.itemId?.guid);
          }

          // Add to mapping
          rewardTableIdToItemIdMap[jsonData.guid] = rewardData;
        }
      } catch (fileError) {
        console.error(`Error processing file ${file}: ${fileError.message}`);
      }
    });

    // Write the mapping to output file
    const outputContent = JSON.stringify(rewardTableIdToItemIdMap, null, 2);
    fs.writeFileSync(outputFile, outputContent);

    console.log(
      `Successfully processed ${
        Object.keys(rewardTableIdToItemIdMap).length
      } entries`
    );
    console.log(`Output written to ${outputFile}`);
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}

processJsonFiles(folderPath, statNameIdPath);
