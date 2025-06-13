/**
 * Database operations module for the item parser system.
 */

import { pool } from "./config.js";

/**
 * Function to save an item recipe to the MySQL database
 * @param {Object} item - Item object to save
 * @returns {Promise} - Promise that resolves when the item is saved
 */
async function saveItemRecipeToDatabase(item) {
  const client = await pool.getConnection();
  try {
    const query = `
      INSERT INTO \`DatabaseItemRecipes\` (
        id, name, description, type, tag, icon, \`rarityMin\`, \`rarityMax\`, level, \`statsId\`,
        \`learnableRecipeIds\`, \`rewardId\`, layout, \`typeDescription\`
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        description = VALUES(description),
        type = VALUES(type),
        tag = VALUES(tag),
        icon = VALUES(icon),
        \`rarityMin\` = VALUES(\`rarityMin\`),
        \`rarityMax\` = VALUES(\`rarityMax\`),
        level = VALUES(level),
        \`statsId\` = VALUES(\`statsId\`),
        \`learnableRecipeIds\` = VALUES(\`learnableRecipeIds\`),
        \`rewardId\` = VALUES(\`rewardId\`),
        layout = VALUES(layout),
        \`typeDescription\` = VALUES(\`typeDescription\`)
    `;

    const values = [
      item.id,
      item.name,
      JSON.stringify(item.description || []),
      item.type,
      JSON.stringify(item.tag || []),
      item.icon,
      item.rarityMin,
      item.rarityMax,
      item.level,
      item.statsId,
      item.learnableRecipeIds,
      JSON.stringify(item.rewardId || []),
      item.layout || "itemRecipe",
      item.typeDescription || "",
    ];

    await client.execute(query, values);
  } catch (error) {
    console.error(`Error saving item to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save stat data to the MySQL database
 * @param {Object} statData - Stat data object to save
 * @returns {Promise} - Promise that resolves when the stat data is saved
 */
async function saveStatToDatabase(statData) {
  const client = await pool.getConnection();
  try {
    // Insert into DatabaseStats table
    const query = `
      INSERT INTO \`DatabaseStats\` (
        id, common, uncommon, rare, heroic, epic, legendary, artifact, durability
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        common = VALUES(common),
        uncommon = VALUES(uncommon),
        rare = VALUES(rare),
        heroic = VALUES(heroic),
        epic = VALUES(epic),
        legendary = VALUES(legendary),
        artifact = VALUES(artifact),
        durability = VALUES(durability)
    `;

    // Convert each rarity object to JSON string
    const values = [
      statData.id,
      JSON.stringify(statData.common || {}),
      JSON.stringify(statData.uncommon || {}),
      JSON.stringify(statData.rare || {}),
      JSON.stringify(statData.heroic || {}),
      JSON.stringify(statData.epic || {}),
      JSON.stringify(statData.legendary || {}),
      JSON.stringify(statData.artifact || {}),
      JSON.stringify(statData.durability || {}),
    ];

    await client.execute(query, values);
  } catch (error) {
    console.error(`Error saving stat data to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save set bonus data to the MySQL database
 * @param {Object} setBonusData - Set bonus data object to save
 * @returns {Promise} - Promise that resolves when the set bonus data is saved
 */
async function saveSetBonusToDatabase(setBonusData) {
  const client = await pool.getConnection();
  try {
    // Insert into DatabaseSetBonuses table
    const query = `
      INSERT INTO \`DatabaseSetBonuses\` (
        id, name, \`setEffects\`
      ) VALUES (
        ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        \`setEffects\` = VALUES(\`setEffects\`)
    `;

    // Convert setEffects array to JSON string
    const values = [
      setBonusData.id,
      setBonusData.name,
      JSON.stringify(setBonusData.setEffects || []),
    ];

    await client.execute(query, values);
  } catch (error) {
    console.error(`Error saving set bonus data to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save enchantment definition data to the MySQL database
 * @param {Object} enchantmentDefData - Enchantment definition data object to save
 * @returns {Promise} - Promise that resolves when the enchantment definition data is saved
 */
async function saveEnchantmentDefToDatabase(enchantmentDefData) {
  const client = await pool.getConnection();
  try {
    // Insert into DatabaseEnchantmentDef table
    const query = `
      INSERT INTO \`DatabaseEnchantmentDef\` (
        id, name, levels
      ) VALUES (
        ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        levels = VALUES(levels)
    `;

    const values = [
      enchantmentDefData.id,
      enchantmentDefData.name,
      enchantmentDefData.levels || [],
    ];

    await client.execute(query, values);
  } catch (error) {
    console.error(
      `Error saving enchantment definition data to database: ${error.message}`
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save enchantment level data to the MySQL database
 * @param {Object} enchantmentLevelData - Enchantment level data object to save
 * @returns {Promise} - Promise that resolves when the enchantment level data is saved
 */
async function saveEnchantmentLevelToDatabase(enchantmentLevelData) {
  const client = await pool.getConnection();
  try {
    // Insert into DatabaseEnchantmentLevel table
    const query = `
      INSERT INTO \`DatabaseEnchantmentLevel\` (
        id, name, \`primary\`, core, cost, success, failure, loss, \`all\`, \`break\`
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        \`primary\` = VALUES(\`primary\`),
        core = VALUES(core),
        cost = VALUES(cost),
        success = VALUES(success),
        failure = VALUES(failure),
        loss = VALUES(loss),
        \`all\` = VALUES(\`all\`),
        \`break\` = VALUES(\`break\`)
    `;

    const values = [
      enchantmentLevelData.id,
      enchantmentLevelData.name,
      enchantmentLevelData.primary,
      enchantmentLevelData.core,
      enchantmentLevelData.cost,
      enchantmentLevelData.success,
      enchantmentLevelData.failure,
      enchantmentLevelData.loss,
      enchantmentLevelData.all,
      enchantmentLevelData.break,
    ];

    await client.execute(query, values);
  } catch (error) {
    console.error(
      `Error saving enchantment level data to database: ${error.message}`
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save an recipe to the MySQL database
 * @param {Object} item - Item object to save
 * @returns {Promise} - Promise that resolves when the item is saved
 */
async function saveRecipeToDatabase(item) {
  const client = await pool.getConnection();
  try {
    // Values are stored as JSON strings for MySQL
    const query = `
      INSERT INTO \`DatabaseRecipes\` (
        id, name, profession, certification, learnable, \`overrideName\`, overrides, tags,
        fuel, \`baseDuration\`, \`rewardId\`, \`primaryResourceCosts\`, \`generalResourceCost\`,
        \`qualityFormula\`, \`craftingCurrencyCostId\`, \`rewardItem\`, layout
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        profession = VALUES(profession),
        certification = VALUES(certification),
        learnable = VALUES(learnable),
        \`overrideName\` = VALUES(\`overrideName\`),
        overrides = VALUES(overrides),
        tags = VALUES(tags),
        fuel = VALUES(fuel),
        \`baseDuration\` = VALUES(\`baseDuration\`),
        \`rewardId\` = VALUES(\`rewardId\`),
        \`primaryResourceCosts\` = VALUES(\`primaryResourceCosts\`),
        \`generalResourceCost\` = VALUES(\`generalResourceCost\`),
        \`qualityFormula\` = VALUES(\`qualityFormula\`),
        \`craftingCurrencyCostId\` = VALUES(\`craftingCurrencyCostId\`),
        \`rewardItem\` = VALUES(\`rewardItem\`),
        layout = VALUES(layout)
    `;

    const values = [
      item.id,
      item.name,
      item.profession,
      item.certification,
      item.learnable,
      item.overrideName,
      JSON.stringify(item.overrides || []),
      JSON.stringify(item.tags || []),
      item.fuel,
      item.baseDuration,
      item.rewardId,
      JSON.stringify(item.primaryResourceCosts || []),
      JSON.stringify(item.generalResourceCost || []),
      item.qualityFormula,
      item.craftingCurrencyCostId,
      JSON.stringify(item.rewardItem || []),
      item.layout || "recipe",
    ];

    await client.execute(query, values);
  } catch (error) {
    console.error(`Error saving recipe to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Batch version of findItemRecipes to get recipes for multiple items at once
 * @param {string[]} itemIds - Array of item IDs to find recipes for
 * @returns {Object} Map of itemId to array of recipe IDs
 */
async function batchFindItemRecipes(itemIds) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  const client = await pool.getConnection();
  try {
    const query = `
      SELECT r.id, jt.item_id
      FROM \`DatabaseItemRecipes\` r
      JOIN JSON_TABLE(r.rewardId, '$[*]' COLUMNS(item_id VARCHAR(255) PATH '$')) as jt
      WHERE jt.item_id IN (?)
    `;

    const [rows] = await client.execute(query, [itemIds]);

    // Create a map of itemId -> recipeIds
    const recipeMap = {};

    // Initialize all requested IDs with empty arrays
    itemIds.forEach((id) => {
      recipeMap[id] = [];
    });

    // Populate the map with the results
    rows.forEach((row) => {
      if (row.item_id && recipeMap[row.item_id]) {
        recipeMap[row.item_id].push(row.id);
      }
    });

    return recipeMap;
  } catch (error) {
    console.error(`Error batch finding item recipes: ${error.message}`);
    return {};
  } finally {
    client.release();
  }
}

/**
 * Batch version of saveItemGearToDatabase to save multiple items at once
 * @param {Array} items - Array of item objects to save
 */
async function batchSaveEquipmentToDatabase(items) {
  if (!items || items.length === 0) {
    return;
  }

  const client = await pool.getConnection();
  try {
    // Begin transaction
    await client.execute("BEGIN");

    // Prepare the query
    const query = `
      INSERT INTO \`DatabaseEquipment\` (
        id, name, \`typeDescription\`, description, type, subtype, tag, icon, \`rarityMin\`, \`rarityMax\`,
        \`statsId\`, level, grade, \`itemRecipeId\`, layout
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        \`typeDescription\` = VALUES(\`typeDescription\`),
        description = VALUES(description),
        type = VALUES(type),
        subtype = VALUES(subtype),
        tag = VALUES(tag),
        icon = VALUES(icon),
        \`rarityMin\` = VALUES(\`rarityMin\`),
        \`rarityMax\` = VALUES(\`rarityMax\`),
        \`statsId\` = VALUES(\`statsId\`),
        level = VALUES(level),
        grade = VALUES(grade),
        \`itemRecipeId\` = VALUES(\`itemRecipeId\`),
        layout = VALUES(layout)
    `;

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const values = [
          item.id,
          item.name,
          item.typeDescription,
          JSON.stringify(item.description || []),
          item.type,
          item.subType,
          JSON.stringify(item.tag || []),
          item.icon,
          item.rarityMin,
          item.rarityMax,
          item.statsId,
          item.level,
          item.grade,
          JSON.stringify(item.itemRecipeId || []),
          item.layout || "equipment",
        ];
        return client.execute(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.execute("COMMIT");

    console.log(`Successfully saved ${items.length} items in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.execute("ROLLBACK");
    console.error(`Error in batch save operation: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Batch version of saveItemGearToDatabase to save multiple items at once
 * @param {Array} items - Array of item objects to save
 */
async function batchSaveGearToDatabase(items) {
  if (!items || items.length === 0) {
    return;
  }

  const client = await pool.getConnection();
  try {
    // Begin transaction
    await client.execute("BEGIN");

    // Prepare the query
    const query = `
      INSERT INTO \`DatabaseGear\` (
        id, name, \`typeDescription\`, description, type, subtype, tag, icon, \`rarityMin\`, \`rarityMax\`,
        slots, \`statsId\`, \`setBonusIds\`, level, grade, \`enchantmentId\`, \`deconstructionRecipeId\`,
        \`itemRecipeId\`, layout
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        \`typeDescription\` = VALUES(\`typeDescription\`),
        description = VALUES(description),
        type = VALUES(type),
        subtype = VALUES(subtype),
        tag = VALUES(tag),
        icon = VALUES(icon),
        \`rarityMin\` = VALUES(\`rarityMin\`),
        \`rarityMax\` = VALUES(\`rarityMax\`),
        slots = VALUES(slots),
        \`statsId\` = VALUES(\`statsId\`),
        \`setBonusIds\` = VALUES(\`setBonusIds\`),
        level = VALUES(level),
        grade = VALUES(grade),
        \`enchantmentId\` = VALUES(\`enchantmentId\`),
        \`deconstructionRecipeId\` = VALUES(\`deconstructionRecipeId\`),
        \`itemRecipeId\` = VALUES(\`itemRecipeId\`),
        layout = VALUES(layout)
    `;

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const values = [
          item.id,
          item.name,
          item.typeDescription,
          JSON.stringify(item.description || []),
          item.type,
          item.subType,
          JSON.stringify(item.tag || []),
          item.icon,
          item.rarityMin,
          item.rarityMax,
          JSON.stringify(item.slots || []),
          item.statsId,
          JSON.stringify(item.setBonusIds || []),
          item.level,
          item.grade,
          item.enchantmentId,
          item.deconstructionRecipeId,
          JSON.stringify(item.itemRecipeId || []),
          item.layout || "gear",
        ];
        return client.execute(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.execute("COMMIT");

    console.log(`Successfully saved ${items.length} items in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.execute("ROLLBACK");
    console.error(`Error in batch save operation: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Batch version of findRecipes to get recipes for multiple items at once
 * @param {string[]} itemIds - Array of item IDs to find recipes for
 * @returns {Object} Map of itemId to array of recipe IDs
 */
async function batchFindRecipes(itemIds) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  const client = await pool.getConnection();
  try {
    const query = `
      SELECT r.id, jt.item_id
      FROM \`DatabaseRecipes\` r
      JOIN JSON_TABLE(r.rewardItem, '$[*]' COLUMNS(item_id VARCHAR(255) PATH '$')) as jt
      WHERE jt.item_id IN (?)
    `;

    const [rows] = await client.execute(query, [itemIds]);

    // Create a map of itemId -> recipeIds
    const recipeMap = {};

    // Initialize all requested IDs with empty arrays
    itemIds.forEach((id) => {
      recipeMap[id] = [];
    });

    // Populate the map with the results
    rows.forEach((row) => {
      if (row.item_id && recipeMap[row.item_id]) {
        recipeMap[row.item_id].push(row.id);
      }
    });

    return recipeMap;
  } catch (error) {
    console.error(`Error batch finding recipes: ${error.message}`);
    return {};
  } finally {
    client.release();
  }
}

/**
 * Batch version of saveItemToDatabase to save multiple items at once
 * @param {Array} items - Array of item objects to save
 */
async function batchSaveItemsToDatabase(items) {
  if (!items || items.length === 0) {
    return;
  }

  const client = await pool.getConnection();
  try {
    // Begin transaction
    await client.execute("BEGIN");

    // Prepare the query
    const query = `
      INSERT INTO \`DatabaseItems\` (
        id, name, description, type, tag, icon, \`rarityMin\`, \`rarityMax\`, level, \`statsId\`,
        \`itemRecipeId\`, \`recipeId\`, layout, \`typeDescription\`
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        description = VALUES(description),
        type = VALUES(type),
        tag = VALUES(tag),
        icon = VALUES(icon),
        \`rarityMin\` = VALUES(\`rarityMin\`),
        \`rarityMax\` = VALUES(\`rarityMax\`),
        level = VALUES(level),
        \`statsId\` = VALUES(\`statsId\`),
        \`itemRecipeId\` = VALUES(\`itemRecipeId\`),
        \`recipeId\` = VALUES(\`recipeId\`),
        layout = VALUES(layout),
        \`typeDescription\` = VALUES(\`typeDescription\`)
    `;

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const values = [
          item.id,
          item.name,
          JSON.stringify(item.description || []),
          item.type,
          JSON.stringify(item.tag || []),
          item.icon,
          item.rarityMin,
          item.rarityMax,
          item.level,
          item.statsId,
          JSON.stringify(item.itemRecipeId || []),
          JSON.stringify(item.recipeId || []),
          item.layout || "item",
          item.typeDescription || "",
        ];
        return client.execute(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.execute("COMMIT");

    console.log(`Successfully saved ${items.length} items in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.execute("ROLLBACK");
    console.error(`Error in batch save operation: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

export {
  saveItemRecipeToDatabase,
  saveStatToDatabase,
  saveSetBonusToDatabase,
  saveEnchantmentDefToDatabase,
  saveEnchantmentLevelToDatabase,
  saveRecipeToDatabase,
  batchSaveEquipmentToDatabase,
  batchSaveGearToDatabase,
  batchFindItemRecipes,
  batchFindRecipes,
  batchSaveItemsToDatabase,
};
