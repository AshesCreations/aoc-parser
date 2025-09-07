/**
 * Utility functions for the item parser system.
 */

import fs from "fs";
import path from "path";

let buyableGuids = null;

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
  const cleaned = subFolders.replace(/^[/\\]+/, "");
  const filePath = path.join(baseFilePath, cleaned, jsonName);
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(data);
    return jsonData;
  } catch (error) {
    console.error(`Error processing Json file ${filePath}: ${error.message}`);
    return {};
  }
}

/**
 * Load an item JSON by GUID, trying both Item_<guid>.json and
 * ItemRecord_<guid>.json filenames.
 * @param {string} baseFilePath - Base directory path
 * @param {string} subFolders - Subfolder path relative to base
 * @param {string} guid - Item GUID
 * @returns {object} Parsed JSON object or empty object on failure
 */
function getItemJson(baseFilePath, subFolders, guid) {
  const cleaned = subFolders.replace(/^[/\\]+/, "");
  const names = [`Item_${guid}.json`, `ItemRecord_${guid}.json`];
  for (const name of names) {
    const filePath = path.join(baseFilePath, cleaned, name);

    if (!fs.existsSync(filePath)) {
      continue; // try next filename
    }

    try {
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.warn(`Failed to parse ${filePath}: ${err.message}`);
      return {};
    }
  }

  // No matching file found; return empty object without logging an error
  return {};
}

/**
 * Look up the vendor cost for an item if available.
 * @param {string} baseFilePath - Base directory for data files
 * @param {string} guid - Item GUID
 * @returns {object} { buyPrice, sellPrice } or { buyPrice: null, sellPrice: null } if not sold by vendors
 */
function getVendorCost(baseFilePath, guid) {
  const itemData = getItemJson(baseFilePath, "/Item/Item", guid);
  const vendorId = itemData?.vendorValueId?.guid;
  if (!vendorId) return { buyPrice: null, sellPrice: null };

  const vendorData = getJson(
    baseFilePath,
    "/Item/ItemVendorValue",
    `ItemVendorValue_${vendorId}.json`
  );
  const buyPrice = vendorData?.baseValue;
  if (typeof buyPrice === "number") {
    return { buyPrice, sellPrice: buyPrice / 0.6666 };
  }
  return { buyPrice: null, sellPrice: null };
}

/**
 * Load all buyable item GUIDs from VendorInventoryDef files
 * @param {string} baseFilePath - Base file path for data files
 * @returns {Set<string>} Set of buyable item GUIDs
 */
function loadBuyableItemGuids(baseFilePath) {
  const buyableGuids = new Set();
  const vendorInventoryPath = path.join(baseFilePath, "Vendors", "VendorInventoryDef");
  if (!fs.existsSync(vendorInventoryPath)) return buyableGuids;
  const files = fs.readdirSync(vendorInventoryPath);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(vendorInventoryPath, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data.listings) {
        for (const listing of data.listings) {
          if (listing.itemId && listing.itemId.guid) {
            buyableGuids.add(listing.itemId.guid);
          }
        }
      }
    } catch (e) {
      // ignore errors
    }
  }
  return buyableGuids;
}

/**
 * Calculate the correct vendor cost for reagent items based on rarity and game pricing modifiers
 * @param {string} baseFilePath - Base file path for data files
 * @param {string} guid - Item GUID
 * @returns {object} { buyPrice, sellPrice } or { buyPrice: null, sellPrice: null } if not applicable
 */
function getReagentVendorCost(baseFilePath, guid) {
  const itemData = getItemJson(baseFilePath, "/Item/Item", guid);

  const vendorId = itemData?.vendorValueId?.guid;
  const baseVendorValueId = itemData?.baseVendorValueId?.guid;

  // Load buyable GUIDs if not already loaded
  if (!buyableGuids) buyableGuids = loadBuyableItemGuids(baseFilePath);

  // If the item has neither an item-specific vendor entry nor a base group, it's not listed
  if (!vendorId && !baseVendorValueId) return { buyPrice: null, sellPrice: null };

  // If the item has an explicit ItemVendorValue entry, prefer that value
  if (vendorId) {
    const vendorData = getJson(
      baseFilePath,
      "/Item/ItemVendorValue",
      `ItemVendorValue_${vendorId}.json`
    );
    const buyPrice = vendorData?.baseValue;
    if (typeof buyPrice === "number") {
      return { buyPrice, sellPrice: buyPrice / 0.6666 };
    }
    // If vendor exists but has no baseValue, fall through to group logic (if present)
  }

  // If this item uses the reagent vendor value ID, use rarity mapping
  if (baseVendorValueId === "6064634138915307520") {
    if (!buyableGuids.has(guid)) return { buyPrice: null, sellPrice: null };
    const rarityToSell = {
      "Common": 45,
      "Uncommon": 1153,
      "Rare": 6530,
      "Epic": 50697,
      "Legendary": 248872,
      "Artifact": 746616,
    };
    const rarityMin = itemData?.rarityMin;
    if (!rarityMin || !rarityToSell[rarityMin]) {
      return { buyPrice: null, sellPrice: null };
    }
    const sellPrice = rarityToSell[rarityMin];
    const buyPrice = Math.round(sellPrice * 0.6666);
    return { buyPrice, sellPrice };
  }

  // Otherwise if there's a BaseItemValue group, evaluate its expression
  if (baseVendorValueId === "6064632294712541188") {
    if (!buyableGuids.has(guid)) return { buyPrice: null, sellPrice: null };
    // Hardcode evaluation for Resource group (sell price)
    const level = itemData.level;
    const rarity = itemData.rarityMin;
    const rarityMultipliers = {
      "Common": 0.9,
      "Uncommon": 23.06,
      "Rare": 130.6,
      "Heroic": 4,
      "Epic": 1013.94,
      "Legendary": 4977.44,
      "Artifact": 14932.32
    };
    const multiplier = rarityMultipliers[rarity] || 1;
    let baseValue = 0;
    if (level >= 1 && level < 10) baseValue = 50;
    else if (level >= 10 && level < 20) baseValue = 200;
    else if (level >= 20 && level < 30) baseValue = 500;
    const tags = itemData.gameplayTags?.gameplayTags || [];
    const isProcessed = tags.some(t => t.tagName === "Item.Resource.Processed");
    let slotMod = 1.0;
    if (isProcessed) slotMod = 1.3;
    const itemBaseValue = baseValue * multiplier;
    const sellPrice = itemBaseValue * slotMod;
    const buyPrice = Math.round(sellPrice * 0.6666);
    // Resource group items are buyable
    return { buyPrice, sellPrice: Math.round(sellPrice) };
  }

  // For other groups, not buyable
  return { buyPrice: null, sellPrice: null };
}

/**
 * Extract the last quoted value from a string
 * @param {string} text - Text to extract from
 * @returns {string} - Extracted value or empty string
 */
function extractLastQuotedValue(text) {
  if (!text || typeof text !== "string") return "";

  // Try to parse NSLOCTEXT("pkg", "id", "value") format
  const nsLoc = text.match(/NSLOCTEXT\([^,]*,[^,]*,\s*"((?:\\"|[^"])+)"\)/);
  let extracted = nsLoc ? nsLoc[1] : null;

  if (!extracted) {
    // Fallback: grab the last quoted string, supporting escaped quotes
    const matches = text.match(/"((?:\\"|[^"])+)"(?=[^"]*$)/);
    extracted = matches ? matches[1] : text;
  }

  // Unescape any embedded quotes then strip slashes
  return extracted.replace(/\\"/g, '"').replace(/[\/\\]/g, "");
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
 * Parse a stat modifier expression, resolving GetTerm and GetStat calls.
 * @param {string} expression - Raw expression string
 * @param {Array} valueInputTerms - Optional term overrides
 * @param {Object} statIdToName - Mapping of stat guids to names
 * @param {string} dataDir - Base directory for JSON lookups
 * @returns {string} Parsed expression
 */
function parseValueExpression(
  expression,
  valueInputTerms = [],
  statIdToName = {},
  dataDir = ""
) {
  if (!expression) return "";

  // Resolve EvalE($#type:id$) references to the equation expression
  expression = expression.replace(/EvalE\(\$#\d+:(\d+)\$\)/g, (m, id) => {
    let eq = getJson(dataDir, "/Stats/StatEquationType", `StatEquationType_${id}.json`);
    if (!eq || Object.keys(eq).length === 0) {
      eq = getJson(dataDir, "/Stats/StatEquationType", `StatEquationTypeRecord_${id}.json`);
    }
    return eq.equation?.expression || "";
  });

  // Resolve EvalFormula($#type:id$) to the referenced equation result
  expression = expression.replace(/EvalFormula\(\$#\d+:(\d+)\$\)/g, (m, id) => {
    let formula = getJson(
      dataDir,
      "/Stats/StatFormulaType",
      `StatFormulaType_${id}.json`
    );
    if (!formula || Object.keys(formula).length === 0) {
      formula = getJson(
        dataDir,
        "/Stats/StatFormulaType",
        `StatFormulaTypeRecord_${id}.json`
      );
    }
    const eqGuid = formula.equationId?.guid;
    if (!eqGuid) return "";
    let eq = getJson(
      dataDir,
      "/Stats/StatEquationType",
      `StatEquationType_${eqGuid}.json`
    );
    if (!eq || Object.keys(eq).length === 0) {
      eq = getJson(
        dataDir,
        "/Stats/StatEquationType",
        `StatEquationTypeRecord_${eqGuid}.json`
      );
    }
    let expr = parseValueExpression(
      eq.equation?.expression || "",
      formula.inputTerms,
      statIdToName,
      dataDir
    );
    const sanitized = expr.replace(/[^0-9+\-*/().\s]/g, "");
    if (sanitized.trim()) {
      try {
        // eslint-disable-next-line no-new-func
        const val = Function(`return (${sanitized});`)();
        if (!Number.isNaN(val)) return String(val);
      } catch {
        /* ignore */
      }
    }
    return expr;
  });

  // Map term guid -> value from valueInputTerms
  const termMap = {};
  if (Array.isArray(valueInputTerms)) {
    for (const term of valueInputTerms) {
      const guid = term.termId?.guid;
      if (!guid) continue;
      let val = term.value?.expression || "";
      // Recursively resolve nested EvalE calls
      val = parseValueExpression(val, [], statIdToName, dataDir);
      termMap[guid] = val;
    }
  }

  // Replace GetTerm references
  expression = expression.replace(/GetTerm\(\$#\d+:(\d+)\$\)/g, (m, id) => {
    if (termMap[id] !== undefined) return termMap[id];
    let term = getJson(dataDir, "/Stats/Term", `Term_${id}.json`);
    if (!term || Object.keys(term).length === 0) {
      term = getJson(dataDir, "/Stats/Term", `TermRecord_${id}.json`);
    }
    return term.defaultValue?.expression || "";
  });

  // Replace GetStat/ConsumedItemStat references with stat names
  expression = expression.replace(
    /(GetStat\([^,]*,\s*\$#\d+:(\d+)\$\))|(GetConsumedItemStat\(\$#\d+:(\d+)\$\))/g,
    (m, s1, id1, s2, id2) => {
      const guid = id1 || id2;
      return statIdToName[guid] || guid;
    }
  );

  return expression;
}

/**
 * Extracts a numeric coefficient from expressions like "Ceil(0.15*Strength)".
 * Returns the original expression if no coefficient is found.
 * @param {string} expression - Expression to parse
 * @returns {string} Parsed numeric value or original expression
 */
function extractCoefficient(expression) {
  if (!expression) return "";
  let expr = expression.trim();
  if (expr.startsWith("Ceil(") && expr.endsWith(")")) {
    expr = expr.slice(5, -1);
  } else if (expr.startsWith("Floor(") && expr.endsWith(")")) {
    expr = expr.slice(6, -1);
  }

  const numOnly = /^-?\d*\.?\d+$/;
  if (numOnly.test(expr)) return expr;

  let match = expr.match(/([-+]?\d*\.?\d+)\s*[*x]\s*[A-Za-z_]+/);
  if (match) return match[1];

  match = expr.match(/[A-Za-z_]+\s*[*x]\s*([-+]?\d*\.?\d+)/);
  if (match) return match[1];

  return expression;
}

/**
 * Format numeric values to avoid floating point artifacts.
 * Whole numbers have no decimal places, fractional values keep up to 2 decimals.
 * @param {number} value - The numeric value to format
 * @returns {string} Formatted number as a string
 */
function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  const rounded = Number(num.toFixed(2));
  return rounded.toString();
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
  getItemJson,
  getVendorCost,
  getReagentVendorCost,
  checkForUndefinedValues,
  logMissingIcon,
  createEmptyStatsObject,
  extractExpressionId,
  parseValueExpression,
  formatTime,
  formatNumber,
  extractCoefficient,
};
