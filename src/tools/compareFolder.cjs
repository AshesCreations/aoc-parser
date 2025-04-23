const fs = require("fs");
const path = require("path");

// Usage example - replace these paths with your actual directory paths
const baseDir = "C:/Users/Danie/Desktop/FModel/";
const fileDir = "/AOC/Content/DesignData/Data/Item/Item";
const oldRev = "vAOC-CL-334632";
const newRev = "ptr-4-22";
const directory1 = baseDir + oldRev + fileDir;
const directory2 = baseDir + newRev + fileDir;
const outputPath = path.join(baseDir, `comparison_${oldRev}_to_${newRev}.txt`);

// List of keys to ignore during comparison
const IGNORE_KEYS = [
  "itemExpirationTimeType",
  "deconstructable",
  "deconstructionRecipeId",
  "deconstructionRequiresCraftingCertification",
  "deconstructionConsumableDefId",
  "relicId",
  "siegeRecordId",
  "treasureHuntId",
  "displayIcon",
  "resourceDisplayIcon",
  "temperingConsumableDefId",
  "activationExperienceRewardsIds",
];

/**
 * Recursively gets all file paths in a directory and its subdirectories
 * @param {string} dirPath - Path to the directory
 * @param {Array} arrayOfFiles - Array to store file paths
 * @returns {Array} - Array of file paths
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);

    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else if (path.extname(file) === ".json") {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}

/**
 * Extracts the value inside the last set of double quotes and removes all slashes and backslashes
 * @param {string} text - Input text like NSLOCTEXT("", "242F5A014C5A6AFED54D1BA89C0FBC4C", "Bottle of Last Breath")
 * @returns {string} - Extracted and cleaned value, e.g., "Bottle of Last Breath"
 */
function extractLastQuotedValue(text) {
  if (!text || typeof text !== "string") return "";

  // Match content inside the last pair of double quotes
  const matches = text.match(/"([^"]*)"(?=[^"]*$)/);
  const extractedText = matches ? matches[1] : text;

  // Remove all forward slashes and backslashes
  return extractedText.replace(/[\/\\]/g, "");
}

/**
 * Gets the itemName from a JSON file, extracts the value inside the last set of double quotes
 * and removes forward slashes and backslashes
 * @param {string} filePath - Path to the JSON file
 * @returns {string} - Extracted and cleaned itemName value
 */
function getItemNameFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(fileContent);

    if (jsonData && jsonData.itemName) {
      return extractLastQuotedValue(jsonData.itemName);
    }
    return "No itemName found";
  } catch (error) {
    return `Error reading file: ${error.message}`;
  }
}

/**
 * Reads a JSON file and returns its parsed content
 * @param {string} filePath - Path to the JSON file
 * @returns {Object|null} - Parsed JSON data or null if there was an error
 */
function readJsonFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error reading file ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Compares two JSON objects and returns differences, ignoring specified keys
 * @param {Object} json1 - First JSON object
 * @param {Object} json2 - Second JSON object
 * @param {Array} ignoreKeys - Array of keys to ignore during comparison
 * @returns {Object} - Object containing the differences
 */
function compareJsonObjects(json1, json2, ignoreKeys = IGNORE_KEYS) {
  const differences = {};

  // Check all properties in json1
  for (const key in json1) {
    // Skip ignored keys
    if (ignoreKeys.includes(key)) {
      continue;
    }

    // Skip if the property doesn't exist in json2
    if (!(key in json2)) {
      differences[key] = {
        oldValue: json1[key],
        newValue: "Property removed",
      };
      continue;
    }

    // Compare values
    if (JSON.stringify(json1[key]) !== JSON.stringify(json2[key])) {
      differences[key] = {
        oldValue: json1[key],
        newValue: json2[key],
      };
    }
  }

  // Check for properties in json2 that don't exist in json1
  for (const key in json2) {
    // Skip ignored keys
    if (ignoreKeys.includes(key)) {
      continue;
    }

    if (!(key in json1)) {
      differences[key] = {
        oldValue: "Property added",
        newValue: json2[key],
      };
    }
  }

  return differences;
}

/**
 * Compares two directories and finds files that are unique to each directory
 * and files that have changed
 * @param {string} dir1 - Path to the first directory
 * @param {string} dir2 - Path to the second directory
 * @param {Array} ignoreKeys - Array of keys to ignore during comparison
 * @returns {Object} - Object containing unique files in each directory with their itemNames
 * and files that have changed
 */
function compareDirectories(dir1, dir2, ignoreKeys = IGNORE_KEYS) {
  if (!fs.existsSync(dir1)) {
    throw new Error(`Directory does not exist: ${dir1}`);
  }

  if (!fs.existsSync(dir2)) {
    throw new Error(`Directory does not exist: ${dir2}`);
  }

  // Get all .json files from both directories
  const files1 = getAllFiles(dir1);
  const files2 = getAllFiles(dir2);

  // Create maps of filenames to full paths for easier lookup
  const fileMap1 = new Map();
  const fileMap2 = new Map();

  files1.forEach((file) => fileMap1.set(path.basename(file), file));
  files2.forEach((file) => fileMap2.set(path.basename(file), file));

  // Find unique files in each directory
  const uniqueToDir1 = [];
  const uniqueToDir2 = [];
  const changedFiles = [];

  // Find files in dir1 but not in dir2
  for (const [fileName, filePath] of fileMap1.entries()) {
    if (!fileMap2.has(fileName)) {
      const itemName = getItemNameFromFile(filePath);
      uniqueToDir1.push({ fileName, itemName });
    } else {
      // File exists in both directories, check for changes
      const json1 = readJsonFile(filePath);
      const json2 = readJsonFile(fileMap2.get(fileName));

      if (json1 && json2) {
        const differences = compareJsonObjects(json1, json2, ignoreKeys);
        if (Object.keys(differences).length > 0) {
          const itemName = getItemNameFromFile(filePath);
          changedFiles.push({
            fileName,
            itemName,
            differences,
          });
        }
      }
    }
  }

  // Find files in dir2 but not in dir1
  for (const [fileName, filePath] of fileMap2.entries()) {
    if (!fileMap1.has(fileName)) {
      const itemName = getItemNameFromFile(filePath);
      uniqueToDir2.push({ fileName, itemName });
    }
  }

  return {
    uniqueToDir1,
    uniqueToDir2,
    changedFiles,
  };
}

/**
 * Formats differences for display in the console
 * @param {Object} differences - Object containing the differences
 * @returns {string} - Formatted string representation of the differences
 */
function formatDifferences(differences) {
  let result = "";

  for (const key in differences) {
    const { oldValue, newValue } = differences[key];
    // Format the values for better readability
    const oldValueStr =
      typeof oldValue === "object" ? JSON.stringify(oldValue) : oldValue;
    const newValueStr =
      typeof newValue === "object" ? JSON.stringify(newValue) : newValue;

    result += `\n    ${key}: ${oldValueStr} => ${newValueStr}`;
  }

  return result;
}

/**
 * Saves output to a file
 * @param {string} content - Content to save
 * @param {string} outputPath - Path to save the file
 */
function saveToFile(content, outputPath) {
  try {
    fs.writeFileSync(outputPath, content, "utf8");
    console.log(`\nOutput saved to: ${outputPath}`);
  } catch (error) {
    console.error(`Error saving output to file: ${error.message}`);
  }
}

/**
 * Main function to execute the comparison
 * @param {string} dir1 - Path to the first directory
 * @param {string} dir2 - Path to the second directory
 * @param {string} outputPath - Path to save the output file
 * @param {Array} ignoreKeys - Array of keys to ignore during comparison
 */
function main(dir1, dir2, outputPath, ignoreKeys = IGNORE_KEYS) {
  try {
    const result = compareDirectories(dir1, dir2, ignoreKeys);

    // Build output content
    let outputContent = `Comparing revision ${oldRev} to ${newRev}\n\n`;

    // Add ignored keys to the output
    if (ignoreKeys.length > 0) {
      outputContent += "Ignored keys during comparison:\n";
      ignoreKeys.forEach((key) => {
        outputContent += `- ${key}\n`;
      });
      outputContent += "\n";
    }

    outputContent += "=== New Files (in dir2 but not in dir1) ===\n";
    if (result.uniqueToDir2.length === 0) {
      outputContent += "No new files found.\n";
    } else {
      result.uniqueToDir2.forEach((file) => {
        outputContent += `${file.fileName} - "${file.itemName}"\n`;
      });
    }

    outputContent += "\n=== Files only in dir1 ===\n";
    if (result.uniqueToDir1.length === 0) {
      outputContent += "No unique files found in dir1.\n";
    } else {
      result.uniqueToDir1.forEach((file) => {
        outputContent += `${file.fileName} - "${file.itemName}"\n`;
      });
    }

    outputContent += "\n=== Changed Files ===\n";
    if (result.changedFiles.length === 0) {
      outputContent += "No changed files found.\n";
    } else {
      result.changedFiles.forEach((file) => {
        outputContent += `${file.fileName} - "${file.itemName}"\n`;
        outputContent += `  Changes: ${formatDifferences(file.differences)}\n`;
      });
    }

    // Print to console
    console.log(outputContent);

    // Save to file
    if (outputPath) {
      saveToFile(outputContent, outputPath);
    }
  } catch (error) {
    const errorMessage = `Error: ${error.message}`;
    console.error(errorMessage);

    if (outputPath) {
      saveToFile(errorMessage, outputPath);
    }
  }
}

main(directory1, directory2, outputPath);
