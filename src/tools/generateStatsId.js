/**
 * Stand alone tool to parse the stat blocks files.
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
const statNameIdPath = path.join(__dirname, "../json/stats-id.json");

const directoryBase = process.env.GAME_FILES_PATH;
const folderPath =
  directoryBase + "/AOC/Content/DesignData/Data/Stats/StatTypeDef";

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
    const guidToDisplayNameMap = {};

    // Process each JSON file
    jsonFiles.forEach((file) => {
      const filePath = path.join(folderPath, file);
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        const jsonData = JSON.parse(fileContent);

        // Check if the required fields exist
        if (jsonData.guid && jsonData.displayName) {
          // Extract the inner text from the last set of double quotes in displayName
          const displayName = extractInnerText(jsonData.displayName);

          // Add to mapping
          guidToDisplayNameMap[jsonData.guid] = displayName;
        }
      } catch (fileError) {
        console.error(`Error processing file ${file}: ${fileError.message}`);
      }
    });

    // Write the mapping to output file
    const outputContent = JSON.stringify(guidToDisplayNameMap, null, 2);
    fs.writeFileSync(outputFile, outputContent);

    console.log(
      `Successfully processed ${
        Object.keys(guidToDisplayNameMap).length
      } entries`
    );
    console.log(`Output written to ${outputFile}`);
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}

/**
 * Extracts the inner text from the last set of double quotes in a string
 * and removes any backslashes
 * @param {string} text - The display name string to process
 * @returns {string} - Processed display name
 */
function extractInnerText(text) {
  // Find the last set of double quotes in the string
  const matches = text.match(/"([^"]*)"(?![^"]*")/);

  if (matches && matches[1]) {
    // Remove any backslashes from the extracted text
    return matches[1].replace(/\\/g, "");
  }

  // If no match found, return the original text
  return text;
}

processJsonFiles(folderPath, statNameIdPath);
