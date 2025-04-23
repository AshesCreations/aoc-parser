/**
 * Utility functions for the item parser system.
 */

import fs from "fs";
import path from "path";

/**
 * @param {Object} jsonData - The JSON data containing gameplay tags
 * @param {Array<String>} tagsToExclude - Array of tags to exclude
 * @returns {Set<string>} - A Set containing filtered unique tag parts
 */
function extractTagParts(jsonData, tagsToExclude) {
  // Initialize an empty Set to store unique tag parts
  const tagPartsSet = new Set();

  // Convert array to Set for O(1) lookups
  const excludeSet = new Set(tagsToExclude);

  // Process all objects that might contain tag arrays
  const processObject = (obj) => {
    // If the object is null or not an object, return
    if (!obj || typeof obj !== "object") return;

    // Check if the object has gameplayTags array
    if (Array.isArray(obj.gameplayTags)) {
      obj.gameplayTags.forEach((tagObj) => {
        if (tagObj && tagObj.tagName) {
          // Split the tagName by "." and add each part to the Set if not excluded
          tagObj.tagName.split(".").forEach((part) => {
            if (!excludeSet.has(part)) {
              tagPartsSet.add(part);
            }
          });
        }
      });
    }

    // Check if the object has parentTags array
    if (Array.isArray(obj.parentTags)) {
      obj.parentTags.forEach((tagObj) => {
        if (tagObj && tagObj.tagName) {
          // Split the tagName by "." and add each part to the Set if not excluded
          tagObj.tagName.split(".").forEach((part) => {
            if (!excludeSet.has(part)) {
              tagPartsSet.add(part);
            }
          });
        }
      });
    }

    // Recursively process all other properties that are objects
    Object.keys(obj).forEach((key) => {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        processObject(obj[key]);
      }
    });
  };

  // Start processing from the root object
  processObject(jsonData);

  return tagPartsSet;
}

/**
 * Function to filter by inventoryFilterType from a file
 * @param {String} filePath - A String containing the path to the files
 * @param {Array<String>} allowedTypes - Array of item types to filter files
 * @returns {object|null} - The data as a JSON object, or null if no data is available.
 * @throws {Error} - Throws an error if the request fails.
 */
function filterByTypes(filePath, allowedTypes) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(data);

    // Check if inventoryFilterType exists and is in our allowed types
    if (
      jsonData.hasOwnProperty("inventoryFilterType") &&
      allowedTypes.includes(jsonData.inventoryFilterType)
    ) {
      return jsonData;
    } else {
      return {};
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}: ${error.message}`);
    return {};
  }
}

/**
 * Function to load a json file and catch fails
 * @param {String} baseFilePath - A String containing the base path
 * @param {String} subFolders - A String containing additional path information
 * @param {String} jsonName - A String containing the name of the JSON file
 * @returns {object|null} - The data as a JSON object, or null if no data is available.
 * @throws {Error} - Throws an error if the request fails.
 */
function getJson(baseFilePath, subFolders, jsonName) {
  try {
    const filePath = path.join(baseFilePath, subFolders, jsonName);
    const data = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(data);
    return jsonData;
  } catch (error) {
    console.error(`Error processing Json file ${filePath}: ${error.message}`);
    return {};
  }
}

/**
 * Extract the last quoted value from a string
 * @param {string} text - Text to extract from
 * @returns {string} - Extracted value or empty string
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
 * Extract the last quoted value from a string
 * @param {string} text - Text to extract from
 * @returns {string} - Extracted value or empty string
 */
function extractLastValue(text) {
  if (!text || typeof text !== "string") return "";

  // Match content inside the last pair of double quotes
  const matches = text.match(/"([^"]*)"(?=[^"]*$)/);
  const extractedText = matches ? matches[1] : text;

  // Remove all forward slashes and backslashes
  return extractedText;
}

/**
 * Extract the last quoted value from a string
 * @param {string} text - Text to extract from
 * @returns {string} - Extracted value or empty string
 */
function extractDescription(text) {
  if (!text || typeof text !== "string") return [];
  // TODO: Report "LOCTABLE" as missing description for parser
  if (text.includes("LOCTABLE")) return [];
  if (!text.includes("NSLOCTEXT")) return [text];
  // removes the NSLOCTEXT function from the string
  let tempText = text
    .slice(11, -2)
    .replaceAll("<item_emphasis>", "<em>")
    .replaceAll("</>", "</em>");
  // Match content inside the last pair of double quotes
  const matches = tempText.split('", "');
  const extractedText = matches ? matches[2] : text;
  // TODO: Check for "$AbilityDescription$"
  // Creates array from newline delimiter
  const descriptionArray = extractedText.split("\\r\\n");
  const cleanedArray = descriptionArray.map((str) => str.replaceAll("\\", ""));
  return cleanedArray;
}

/**
 * Extract values from an array of objects
 * @param {Array<Object>} arrayOfObjects - Array of objects
 * @param {string} keyToExtract - Key to extract from each object
 * @returns {Array<*>} - Array of extracted values
 */
function extractValues(arrayOfObjects, keyToExtract) {
  if (!Array.isArray(arrayOfObjects)) {
    return []; // Return an empty array if input is not an array
  }

  const extractedValues = [];
  for (const obj of arrayOfObjects) {
    if (
      typeof obj === "object" &&
      obj !== null &&
      obj.hasOwnProperty(keyToExtract)
    ) {
      extractedValues.push(obj[keyToExtract]);
    }
  }
  return extractedValues;
}

/**
 * Function to check for undefined values in an object and log them
 * @param {Object} item - Item object to check
 * @param {String} fileName - Name of the JSON file
 * @param {String} logPath - Path to log file
 * @returns {Boolean} - True if undefined values were found
 */
function checkForUndefinedValues(
  item,
  fileName,
  logPath,
  allowedUndefinedKeys = []
) {
  let hasUndefined = false;
  const undefinedFields = [];

  // Check each property of the item object
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined && !allowedUndefinedKeys.includes(key)) {
      hasUndefined = true;
      undefinedFields.push(key);
    }
  }

  // Log undefined values if found
  if (hasUndefined) {
    const logEntry = `File: ${fileName}\nItem ID: ${
      item.id || "Unknown"
    }\nItem Name: ${item.name || "Unknown"}\nType: ${
      item.type || "Unknown"
    }\nUndefined Fields: ${undefinedFields.join(", ")}\n\n`;
    fs.appendFileSync(logPath, logEntry);
    console.warn(
      `Warning: Item [${item.name || "Unknown"}][${
        item.id || "Unknown"
      }] has undefined values for fields: ${undefinedFields.join(", ")}`
    );
  }

  return hasUndefined;
}

/**
 * Function to log items with missing icons to a file
 * @param {string} id - Item ID
 * @param {string} name - Item name
 * @param {string} type - Item type
 * @param {string} logPath - Path to log file
 */
function logMissingIcon(id, name, type, logPath) {
  const logEntry = `${id} ${name} (${type})\n`;
  fs.appendFileSync(logPath, logEntry);
}

/**
 * Creates an empty rarity structure for item stats
 * @returns {Object} Empty stats structure
 */
function createEmptyStatsObject() {
  const rarities = [
    "common",
    "uncommon",
    "rare",
    "heroic",
    "epic",
    "legendary",
    "artifact",
  ];
  const statsObject = {};

  rarities.forEach((rarity) => {
    statsObject[rarity] = {
      primary: [],
      core: [],
    };
  });

  return statsObject;
}

/**
 * Finds the string between the first ":" and next "$"
 * @param {string} str - Expression
 * @returns {string} Empty stats structure
 */
function extractExpressionId(str) {
  const startIndex = str.indexOf(":");
  if (startIndex === -1) {
    return ""; // Return empty string if ':' is not found
  }

  const endIndex = str.indexOf("$", startIndex + 1);
  if (endIndex === -1) {
    return ""; // Return empty string if '$' is not found after ':'
  }

  return str.substring(startIndex + 1, endIndex);
}

/**
 * Formats a given number of seconds into a human-readable time string
 * @param {string} seconds - Number of seconds
 * @returns {string} A string representing the time in seconds, minutes, or hours
 */
function formatTime(seconds) {
  if (seconds == 1) return "1 second";
  if (seconds == 60) return "1 minute";
  if (seconds == 3600) return "1 hour";

  if (seconds < 60) {
    return seconds + " seconds";
  } else if (seconds < 3600) {
    return seconds / 60 + " minutes";
  } else {
    return seconds / 3600 + " hours";
  }
}

export {
  extractTagParts,
  filterByTypes,
  getJson,
  extractLastQuotedValue,
  extractLastValue,
  extractDescription,
  extractValues,
  checkForUndefinedValues,
  logMissingIcon,
  createEmptyStatsObject,
  extractExpressionId,
  formatTime,
};
