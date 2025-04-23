/**
 * Database operations module for the item parser system.
 */

import { pool } from "./config.js";

/**
 * Function to save an item recipe to the PostgreSQL database
 * @param {Object} item - Item object to save
 * @returns {Promise} - Promise that resolves when the item is saved
 */
async function saveItemRecipeToDatabase(item) {
  const client = await pool.connect();
  try {
    // Use the pg module's native array support with type casting
    const query = `
      INSERT INTO "DatabaseItemRecipes" (
        id, name, description, type, tag, icon, "rarityMin", "rarityMax", level, "statsId",
        "learnableRecipeIds", "rewardId", layout, "typeDescription"
      ) VALUES (
        $1, $2, $3::text[], $4, $5::text[], $6, $7, $8, $9, $10, $11, $12::text[], $13, $14
      ) ON CONFLICT (id) DO UPDATE SET
        name = $2, description = $3::text[], type = $4, tag = $5::text[], icon = $6, 
        "rarityMin" = $7, "rarityMax" = $8, level = $9, "statsId" = $10,
        "learnableRecipeIds" = $11, "rewardId" = $12::text[], layout = $13, "typeDescription" = $14
    `;

    const values = [
      item.id,
      item.name,
      item.description || [],
      item.type,
      item.tag || [],
      item.icon,
      item.rarityMin,
      item.rarityMax,
      item.level,
      item.statsId,
      item.learnableRecipeIds,
      item.rewardId || [],
      item.layout || "itemRecipe",
      item.typeDescription || "",
    ];

    await client.query(query, values);
  } catch (error) {
    console.error(`Error saving item to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save stat data to the PostgreSQL database
 * @param {Object} statData - Stat data object to save
 * @returns {Promise} - Promise that resolves when the stat data is saved
 */
async function saveStatToDatabase(statData) {
  const client = await pool.connect();
  try {
    // Insert into DatabaseStats table
    const query = `
      INSERT INTO "DatabaseStats" (
        id, common, uncommon, rare, heroic, epic, legendary, artifact, durability
      ) VALUES (
        $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb
      ) ON CONFLICT (id) DO UPDATE SET
        common = $2::jsonb,
        uncommon = $3::jsonb,
        rare = $4::jsonb,
        heroic = $5::jsonb,
        epic = $6::jsonb,
        legendary = $7::jsonb,
        artifact = $8::jsonb,
        durability = $9::jsonb
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

    await client.query(query, values);
  } catch (error) {
    console.error(`Error saving stat data to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save set bonus data to the PostgreSQL database
 * @param {Object} setBonusData - Set bonus data object to save
 * @returns {Promise} - Promise that resolves when the set bonus data is saved
 */
async function saveSetBonusToDatabase(setBonusData) {
  const client = await pool.connect();
  try {
    // Insert into DatabaseSetBonuses table
    const query = `
      INSERT INTO "DatabaseSetBonuses" (
        id, name, "setEffects"
      ) VALUES (
        $1, $2, $3::jsonb
      ) ON CONFLICT (id) DO UPDATE SET
        name = $2,
        "setEffects" = $3::jsonb
    `;

    // Convert setEffects array to JSON string
    const values = [
      setBonusData.id,
      setBonusData.name,
      JSON.stringify(setBonusData.setEffects || []),
    ];

    await client.query(query, values);
  } catch (error) {
    console.error(`Error saving set bonus data to database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Function to save enchantment definition data to the PostgreSQL database
 * @param {Object} enchantmentDefData - Enchantment definition data object to save
 * @returns {Promise} - Promise that resolves when the enchantment definition data is saved
 */
async function saveEnchantmentDefToDatabase(enchantmentDefData) {
  const client = await pool.connect();
  try {
    // Insert into DatabaseEnchantmentDef table
    const query = `
      INSERT INTO "DatabaseEnchantmentDef" (
        id, name, levels
      ) VALUES (
        $1, $2, $3::text[]
      ) ON CONFLICT (id) DO UPDATE SET
        name = $2,
        levels = $3::text[]
    `;

    const values = [
      enchantmentDefData.id,
      enchantmentDefData.name,
      enchantmentDefData.levels || [],
    ];

    await client.query(query, values);
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
 * Function to save enchantment level data to the PostgreSQL database
 * @param {Object} enchantmentLevelData - Enchantment level data object to save
 * @returns {Promise} - Promise that resolves when the enchantment level data is saved
 */
async function saveEnchantmentLevelToDatabase(enchantmentLevelData) {
  const client = await pool.connect();
  try {
    // Insert into DatabaseEnchantmentLevel table
    const query = `
      INSERT INTO "DatabaseEnchantmentLevel" (
        id, name, "primary", core, cost, success, failure, loss, "all", "break"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) ON CONFLICT (id) DO UPDATE SET
        name = $2,
        "primary" = $3,
        core = $4,
        cost = $5,
        success = $6,
        failure = $7,
        loss = $8,
        "all" = $9,
        "break" = $10
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

    await client.query(query, values);
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
 * Function to save an recipe to the PostgreSQL database
 * @param {Object} item - Item object to save
 * @returns {Promise} - Promise that resolves when the item is saved
 */
async function saveRecipeToDatabase(item) {
  const client = await pool.connect();
  try {
    // Use the pg module's native array support with type casting
    const query = `
      INSERT INTO "DatabaseRecipes" (
        id, name, profession, certification, learnable, "overrideName", overrides, tags,
        fuel, "baseDuration", "rewardId", "primaryResourceCosts", "generalResourceCost",
        "qualityFormula", "craftingCurrencyCostId", "rewardItem", layout
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::text[], $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16::text[], $17
      ) ON CONFLICT (id) DO UPDATE SET
        name = $2, profession = $3, certification = $4, learnable = $5, "overrideName" = $6,
        overrides = $7, tags = $8, fuel= $9, "baseDuration" = $10, "rewardId" = $11, "primaryResourceCosts" = $12,
        "generalResourceCost" = $13, "qualityFormula" = $14, "craftingCurrencyCostId" = $15, "rewardItem" = $16,
        layout = $17
    `;

    const values = [
      item.id,
      item.name,
      item.profession,
      item.certification,
      item.learnable,
      item.overrideName,
      JSON.stringify(item.overrides || []),
      item.tags || [],
      item.fuel,
      item.baseDuration,
      item.rewardId,
      JSON.stringify(item.primaryResourceCosts || []),
      JSON.stringify(item.generalResourceCost || []),
      item.qualityFormula,
      item.craftingCurrencyCostId,
      item.rewardItem || [],
      item.layout || "recipe",
    ];

    await client.query(query, values);
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

  const client = await pool.connect();
  try {
    // Use a LATERAL JOIN with unnest to properly expand arrays
    const query = `
      SELECT r.id, u.item_id
      FROM "DatabaseItemRecipes" r
      CROSS JOIN LATERAL unnest(r."rewardId") AS u(item_id)
      WHERE u.item_id = ANY($1)
    `;

    const result = await client.query(query, [itemIds]);

    // Create a map of itemId -> recipeIds
    const recipeMap = {};

    // Initialize all requested IDs with empty arrays
    itemIds.forEach((id) => {
      recipeMap[id] = [];
    });

    // Populate the map with the results
    result.rows.forEach((row) => {
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

  const client = await pool.connect();
  try {
    // Begin transaction
    await client.query("BEGIN");

    // Prepare the query
    const query = `
      INSERT INTO "DatabaseEquipment" (
        id, name, "typeDescription", description, type, subtype, tag, icon, "rarityMin", "rarityMax", 
        "statsId", level, grade, "itemRecipeId", layout
      ) VALUES ($1, $2, $3, $4::text[], $5, $6, $7::text[], $8, $9, $10, $11, $12, $13, $14::text[], $15)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        "typeDescription" = EXCLUDED."typeDescription",
        description = EXCLUDED.description,
        type = EXCLUDED.type,
        subtype = EXCLUDED.subtype,
        tag = EXCLUDED.tag,
        icon = EXCLUDED.icon,
        "rarityMin" = EXCLUDED."rarityMin",
        "rarityMax" = EXCLUDED."rarityMax",
        "statsId" = EXCLUDED."statsId",
        level = EXCLUDED.level,
        grade = EXCLUDED.grade,
        "itemRecipeId" = EXCLUDED."itemRecipeId",
        layout = EXCLUDED.layout
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
          item.description || [],
          item.type,
          item.subType,
          item.tag || [],
          item.icon,
          item.rarityMin,
          item.rarityMax,
          item.statsId,
          item.level,
          item.grade,
          item.itemRecipeId || [],
          item.layout || "equipment",
        ];
        return client.query(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.query("COMMIT");

    console.log(`Successfully saved ${items.length} items in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.query("ROLLBACK");
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

  const client = await pool.connect();
  try {
    // Begin transaction
    await client.query("BEGIN");

    // Prepare the query
    const query = `
      INSERT INTO "DatabaseGear" (
        id, name, "typeDescription", description, type, subtype, tag, icon, "rarityMin", "rarityMax", 
        slots, "statsId", "setBonusIds", level, grade, "enchantmentId", "deconstructionRecipeId",
        "itemRecipeId", layout
      ) VALUES ($1, $2, $3, $4::text[], $5, $6, $7::text[], $8, $9, $10, $11::text[], $12, $13::text[], $14, $15,
        $16, $17, $18::text[], $19)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        "typeDescription" = EXCLUDED."typeDescription",
        description = EXCLUDED.description,
        type = EXCLUDED.type,
        subtype = EXCLUDED.subtype,
        tag = EXCLUDED.tag,
        icon = EXCLUDED.icon,
        "rarityMin" = EXCLUDED."rarityMin",
        "rarityMax" = EXCLUDED."rarityMax",
        slots = EXCLUDED.slots,
        "statsId" = EXCLUDED."statsId",
        "setBonusIds" = EXCLUDED."setBonusIds",
        level = EXCLUDED.level,
        grade = EXCLUDED.grade,
        "enchantmentId" = EXCLUDED."enchantmentId",
        "deconstructionRecipeId" = EXCLUDED."deconstructionRecipeId",
        "itemRecipeId" = EXCLUDED."itemRecipeId",
        layout = EXCLUDED.layout
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
          item.description || [],
          item.type,
          item.subType,
          item.tag || [],
          item.icon,
          item.rarityMin,
          item.rarityMax,
          item.slots || [],
          item.statsId,
          item.setBonusIds || [],
          item.level,
          item.grade,
          item.enchantmentId,
          item.deconstructionRecipeId,
          item.itemRecipeId || [],
          item.layout || "gear",
        ];
        return client.query(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.query("COMMIT");

    console.log(`Successfully saved ${items.length} items in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.query("ROLLBACK");
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

  const client = await pool.connect();
  try {
    // Use a LATERAL JOIN with unnest to properly expand arrays
    const query = `
      SELECT r.id, u.item_id
      FROM "DatabaseRecipes" r
      CROSS JOIN LATERAL unnest(r."rewardItem") AS u(item_id)
      WHERE u.item_id = ANY($1)
    `;

    const result = await client.query(query, [itemIds]);

    // Create a map of itemId -> recipeIds
    const recipeMap = {};

    // Initialize all requested IDs with empty arrays
    itemIds.forEach((id) => {
      recipeMap[id] = [];
    });

    // Populate the map with the results
    result.rows.forEach((row) => {
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

  const client = await pool.connect();
  try {
    // Begin transaction
    await client.query("BEGIN");

    // Prepare the query
    const query = `
      INSERT INTO "DatabaseItems" (
        id, name, description, type, tag, icon, "rarityMin", "rarityMax", level, "statsId",
        "itemRecipeId", "recipeId", layout, "typeDescription"
      ) VALUES (
        $1, $2, $3::text[], $4, $5::text[], $6, $7, $8, $9, $10, $11::text[], $12::text[], $13, $14
      ) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        type = EXCLUDED.type,
        tag = EXCLUDED.tag,
        icon = EXCLUDED.icon,
        "rarityMin" = EXCLUDED."rarityMin",
        "rarityMax" = EXCLUDED."rarityMax",
        level = EXCLUDED.level,
        "statsId" = EXCLUDED."statsId",
        "itemRecipeId" = EXCLUDED."itemRecipeId",
        "recipeId" = EXCLUDED."recipeId",
        layout = EXCLUDED.layout,
        "typeDescription" = EXCLUDED."typeDescription"
    `;

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const values = [
          item.id,
          item.name,
          item.description || [],
          item.type,
          item.tag || [],
          item.icon,
          item.rarityMin,
          item.rarityMax,
          item.level,
          item.statsId,
          item.itemRecipeId || [],
          item.recipeId || [],
          item.layout || "item",
          item.typeDescription || "",
        ];
        return client.query(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.query("COMMIT");

    console.log(`Successfully saved ${items.length} items in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.query("ROLLBACK");
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
