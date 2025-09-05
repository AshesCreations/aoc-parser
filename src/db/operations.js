/**
 * Database operations module for the item parser system.
 */

import { pool } from "./config.js";

async function ensureLastModifiedColumn(client, table) {
  try {
    const checkQuery = `SHOW COLUMNS FROM \`${table}\` LIKE 'lastModified'`;
    const [rows] = await client.query(checkQuery);
    if (rows.length === 0) {
      const alterQuery = `ALTER TABLE \`${table}\` ADD COLUMN \`lastModified\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`;
      await client.query(alterQuery);
    }
  } catch (err) {
    // Ignore errors, e.g., insufficient permissions
  }
}

async function ensureColumn(client, table, columnName, columnType) {
  try {
    const checkQuery = `SHOW COLUMNS FROM \`${table}\` LIKE ?`;
    const [rows] = await client.query(checkQuery, [columnName]);
    if (rows.length === 0) {
      const alterQuery = `ALTER TABLE \`${table}\` ADD COLUMN \`${columnName}\` ${columnType}`;
      await client.query(alterQuery);
    }
  } catch (err) {
    // Ignore errors such as insufficient permissions
  }
}

/**
 * Function to save an item recipe to the MySQL database
 * @param {Object} item - Item object to save
 * @returns {Promise} - Promise that resolves when the item is saved
 */
async function saveItemRecipeToDatabase(item) {
  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabaseItemRecipes');
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
        \`typeDescription\` = VALUES(\`typeDescription\`),
        lastModified = CURRENT_TIMESTAMP
    `;

    const values = [
      item.id,
      item.name,
      JSON.stringify(item.description || []),
      item.type ?? null,
      JSON.stringify(item.tag || []),
      item.icon ?? null,
      item.rarityMin ?? null,
      item.rarityMax ?? null,
      item.level ?? null,
      item.statsId ?? null,
      JSON.stringify(item.learnableRecipeIds || []),
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
    await ensureLastModifiedColumn(client, 'DatabaseStats');
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
        durability = VALUES(durability),
        lastModified = CURRENT_TIMESTAMP
    `;

    // Convert each rarity object to JSON string
    const values = [
      statData.id ?? null,
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
    await ensureLastModifiedColumn(client, 'DatabaseSetBonuses');
    await ensureColumn(client, 'DatabaseSetBonuses', 'statBonuses', 'JSON');
    await ensureColumn(client, 'DatabaseSetBonuses', 'effectBonuses', 'JSON');
    // Insert into DatabaseSetBonuses table
    const query = `
      INSERT INTO \`DatabaseSetBonuses\` (
        id, name, \`statBonuses\`, \`effectBonuses\`
      ) VALUES (
        ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        \`statBonuses\` = VALUES(\`statBonuses\`),
        \`effectBonuses\` = VALUES(\`effectBonuses\`),
        lastModified = CURRENT_TIMESTAMP
    `;

    // Convert setEffects array to JSON string
    const values = [
      setBonusData.id ?? null,
      setBonusData.name ?? null,
      JSON.stringify(setBonusData.statBonuses || []),
      JSON.stringify(setBonusData.effectBonuses || []),
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
    await ensureLastModifiedColumn(client, 'DatabaseEnchantmentDef');
    // Insert into DatabaseEnchantmentDef table
    const query = `
      INSERT INTO \`DatabaseEnchantmentDef\` (
        id, name, levels
      ) VALUES (
        ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        levels = VALUES(levels),
        lastModified = CURRENT_TIMESTAMP
    `;

    const values = [
      enchantmentDefData.id ?? null,
      enchantmentDefData.name ?? null,
      JSON.stringify(enchantmentDefData.levels || []),
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
    await ensureLastModifiedColumn(client, 'DatabaseEnchantmentLevel');
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
        \`break\` = VALUES(\`break\`),
        lastModified = CURRENT_TIMESTAMP
    `;

    const values = [
      enchantmentLevelData.id ?? null,
      enchantmentLevelData.name ?? null,
      enchantmentLevelData.primary ?? null,
      enchantmentLevelData.core ?? null,
      enchantmentLevelData.cost ?? null,
      enchantmentLevelData.success ?? null,
      enchantmentLevelData.failure ?? null,
      enchantmentLevelData.loss ?? null,
      enchantmentLevelData.all ?? null,
      enchantmentLevelData.break ?? null,
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
 * Function to save a recipe to the MySQL database
 * @param {Object} item - Item object to save
 * @returns {Promise} - Promise that resolves when the item is saved
 */
async function saveRecipeToDatabase(item) {
  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabaseRecipes');
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
        layout = VALUES(layout),
        lastModified = CURRENT_TIMESTAMP
    `;

    const values = [
      item.id ?? null,
      item.name ?? null,
      item.profession ?? null,
      item.certification ?? null,
      item.learnable ?? null,
      item.overrideName ?? null,
      JSON.stringify(item.overrides || []),
      JSON.stringify(item.tags || []),
      item.fuel ?? null,
      item.baseDuration ?? null,
      item.rewardId ?? null,
      JSON.stringify(item.primaryResourceCosts || []),
      JSON.stringify(item.generalResourceCost || []),
      item.qualityFormula ?? null,
      item.craftingCurrencyCostId ?? null,
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
      JOIN JSON_TABLE(
        COALESCE(r.learnableRecipeIds, '[]'),
        '$[*]' COLUMNS(item_id VARCHAR(255) PATH '$')
      ) as jt
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
        recipeMap[row.item_id].push(row.recipe_item_id);
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
    await ensureLastModifiedColumn(client, 'DatabaseEquipment');
    // Begin transaction
    await client.query("BEGIN");

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
        layout = VALUES(layout),
        lastModified = CURRENT_TIMESTAMP
    `;

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const values = [
          item.id ?? null,
          item.name ?? null,
          item.typeDescription ?? null,
          JSON.stringify(item.description || []),
          item.type ?? null,
          item.subType ?? null,
          JSON.stringify(item.tag || []),
          item.icon ?? null,
          item.rarityMin ?? null,
          item.rarityMax ?? null,
          item.statsId ?? null,
          item.level ?? null,
          item.grade ?? null,
          JSON.stringify(item.itemRecipeId || []),
          item.layout || "equipment",
        ];
        return client.execute(query, values);
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

  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabaseGear');
    await ensureColumn(client, 'DatabaseGear', 'recipeTree', 'JSON');
    await ensureColumn(client, 'DatabaseGear', 'hasDiff', 'BOOLEAN DEFAULT 0');
    await ensureColumn(client, 'DatabaseGear', 'changedDescription', 'TEXT');

    // Fetch existing gear data for diff calculation
    const ids = items.map((i) => i.id);
    const [existingRows] = await client.query(
      `SELECT id, name, typeDescription, description, type, subtype, tag, icon, \
              rarityMin, rarityMax, slots, statsId, setBonusIds, level, grade, \
              enchantmentId, deconstructionRecipeId, itemRecipeId, craftingRecipes, recipeTree, layout \
       FROM \`DatabaseGear\` WHERE id IN (?)`,
      [ids]
    );
    const existingMap = {};
    existingRows.forEach((row) => {
      existingMap[row.id] = row;
    });

    // Begin transaction
    await client.query("BEGIN");

    // Prepare the query with diff columns
    const query = `
      INSERT INTO \`DatabaseGear\` (
        id, name, \`typeDescription\`, description, type, subtype, tag, icon, \`rarityMin\`, \`rarityMax\`,
        slots, \`statsId\`, \`setBonusIds\`, level, grade, \`enchantmentId\`, \`deconstructionRecipeId\`,
        \`itemRecipeId\`, \`craftingRecipes\`, \`recipeTree\`, layout, hasDiff, changedDescription
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
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
        \`craftingRecipes\` = VALUES(\`craftingRecipes\`),
        \`recipeTree\` = VALUES(\`recipeTree\`),
        layout = VALUES(layout),
        hasDiff = VALUES(hasDiff),
        changedDescription = VALUES(changedDescription),
        lastModified = IF(VALUES(hasDiff) = 0, lastModified, CURRENT_TIMESTAMP)
    `;

    const normalize = (val) =>
      val === null || val === undefined
        ? null
        : typeof val === "string"
        ? val
        : JSON.stringify(val);

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const fields = {
          name: item.name ?? null,
          typeDescription: item.typeDescription ?? null,
          description: JSON.stringify(item.description || []),
          type: item.type ?? null,
          subtype: item.subType ?? null,
          tag: JSON.stringify(item.tag || []),
          icon: item.icon ?? null,
          rarityMin: item.rarityMin ?? null,
          rarityMax: item.rarityMax ?? null,
          slots: JSON.stringify(item.slots || []),
          statsId: item.statsId ?? null,
          setBonusIds: JSON.stringify(item.setBonusIds || []),
          level: item.level ?? null,
          grade: item.grade ?? null,
          enchantmentId: item.enchantmentId ?? null,
          deconstructionRecipeId: item.deconstructionRecipeId ?? null,
          itemRecipeId: JSON.stringify(item.itemRecipeId || []),
          craftingRecipes: JSON.stringify(item.craftingRecipes || []),
          recipeTree: JSON.stringify(item.recipeTree || {}),
          layout: item.layout || "gear",
        };

        const existing = existingMap[item.id];
        let hasDiff = true;
        let changedDescription = "New gear item";
        if (existing) {
          const changed = [];
          hasDiff = false;
          for (const [key, newVal] of Object.entries(fields)) {
            const oldVal = normalize(existing[key]);
            if (oldVal !== newVal) {
              hasDiff = true;
              changed.push(key);
            }
          }
          changedDescription = hasDiff
            ? `Updated fields: ${changed.join(', ')}`
            : null;
        }

        const values = [
          item.id ?? null,
          fields.name,
          fields.typeDescription,
          fields.description,
          fields.type,
          fields.subtype,
          fields.tag,
          fields.icon,
          fields.rarityMin,
          fields.rarityMax,
          fields.slots,
          fields.statsId,
          fields.setBonusIds,
          fields.level,
          fields.grade,
          fields.enchantmentId,
          fields.deconstructionRecipeId,
          fields.itemRecipeId,
          fields.craftingRecipes,
          fields.recipeTree,
          fields.layout,
          hasDiff ? 1 : 0,
          changedDescription,
        ];
        return client.execute(query, values);
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
    await ensureLastModifiedColumn(client, 'DatabaseItems');
    // Begin transaction
    await client.query("BEGIN");

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
        \`typeDescription\` = VALUES(\`typeDescription\`),
        lastModified = CURRENT_TIMESTAMP
    `;

    // Create an array of promises for all insert operations
    const batchSize = 100; // Adjust based on your DB performance
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map((item) => {
        const values = [
          item.id ?? null,
          item.name ?? null,
          JSON.stringify(item.description || []),
          item.type ?? null,
          JSON.stringify(item.tag || []),
          item.icon ?? null,
          item.rarityMin ?? null,
          item.rarityMax ?? null,
          item.level ?? null,
          item.statsId ?? null,
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

async function saveLootInfoToDatabase(loot) {
  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabaseLootInfo');
    await ensureColumn(client, 'DatabaseLootInfo', 'itemName', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'worldSpawnLocation', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'zoneCoordinates', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'worldCoordinates', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'sourceType', 'VARCHAR(50)');
    await ensureColumn(client, 'DatabaseLootInfo', 'recipeName', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'tokenName', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'tokenLevel', 'INT');
    await ensureColumn(client, 'DatabaseLootInfo', 'profession', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'certification', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'materials', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'levelBasedChances', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'dropChancePerRoll', 'DECIMAL(10,8)');
    await ensureColumn(client, 'DatabaseLootInfo', 'rolls', 'INT');
    await ensureColumn(client, 'DatabaseLootInfo', 'poolSize', 'INT');
    await ensureColumn(client, 'DatabaseLootInfo', 'rewardTableId', 'VARCHAR(50)');

    const query = `
      INSERT INTO \`DatabaseLootInfo\` (
        id, itemId, itemName, questName, step, npcName, levelMin, levelMax,
        difficulty, zone, worldSpawnLocation, spawnRate, dropChance, zoneCoordinates, worldCoordinates,
        sourceType, recipeName, tokenName, tokenLevel, profession, certification, materials,
        levelBasedChances, dropChancePerRoll, rolls, poolSize, rewardTableId
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        itemName = VALUES(itemName),
        questName = VALUES(questName),
        step = VALUES(step),
        npcName = VALUES(npcName),
        levelMin = VALUES(levelMin),
        levelMax = VALUES(levelMax),
        difficulty = VALUES(difficulty),
        zone = VALUES(zone),
        worldSpawnLocation = VALUES(worldSpawnLocation),
        spawnRate = VALUES(spawnRate),
        dropChance = VALUES(dropChance),
        zoneCoordinates = VALUES(zoneCoordinates),
        worldCoordinates = VALUES(worldCoordinates),
        sourceType = VALUES(sourceType),
        recipeName = VALUES(recipeName),
        tokenName = VALUES(tokenName),
        tokenLevel = VALUES(tokenLevel),
        profession = VALUES(profession),
        certification = VALUES(certification),
        materials = VALUES(materials),
        levelBasedChances = VALUES(levelBasedChances),
        dropChancePerRoll = VALUES(dropChancePerRoll),
        rolls = VALUES(rolls),
        poolSize = VALUES(poolSize),
        rewardTableId = VALUES(rewardTableId),
        lastModified = CURRENT_TIMESTAMP
    `;
    const values = [
      loot.id,
      loot.itemId,
      loot.itemName,
      loot.questName,
      loot.step,
      loot.npcName,
      loot.levelMin ?? null,
      loot.levelMax ?? null,
      loot.difficulty ?? null,
      loot.zone ?? null,
      loot.worldSpawnLocation ?? null,
      loot.spawnRate ?? null,
      loot.dropChance ?? null,
      JSON.stringify(loot.zoneCoordinates || {}),
      JSON.stringify(loot.worldCoordinates || {}),
      loot.sourceType ?? null,
      loot.recipeName ?? null,
      loot.tokenName ?? null,
      loot.tokenLevel ?? null,
      loot.profession ?? null,
      loot.certification ?? null,
      JSON.stringify(loot.materials || []),
      JSON.stringify(loot.levelBasedChances || []),
      loot.dropChancePerRoll ?? null,
      loot.rolls ?? null,
      loot.poolSize ?? null,
      loot.rewardTableId ?? null
    ];
    await client.execute(query, values);
  } finally {
    client.release();
  }
}

/**
 * Batch version of saveLootInfoToDatabase to save multiple loot entries at once
 * @param {Array} lootEntries - Array of loot entry objects to save
 */
async function batchSaveLootInfoToDatabase(lootEntries) {
  if (!lootEntries || lootEntries.length === 0) {
    return;
  }

  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabaseLootInfo');
    await ensureColumn(client, 'DatabaseLootInfo', 'itemName', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'worldSpawnLocation', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'zoneCoordinates', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'worldCoordinates', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'sourceType', 'VARCHAR(50)');
    await ensureColumn(client, 'DatabaseLootInfo', 'recipeName', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'tokenName', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'tokenLevel', 'INT');
    await ensureColumn(client, 'DatabaseLootInfo', 'profession', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'certification', 'TEXT');
    await ensureColumn(client, 'DatabaseLootInfo', 'materials', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'levelBasedChances', 'JSON');
    await ensureColumn(client, 'DatabaseLootInfo', 'dropChancePerRoll', 'DECIMAL(10,8)');
    await ensureColumn(client, 'DatabaseLootInfo', 'rolls', 'INT');
    await ensureColumn(client, 'DatabaseLootInfo', 'poolSize', 'INT');
    await ensureColumn(client, 'DatabaseLootInfo', 'rewardTableId', 'VARCHAR(50)');

    // Begin transaction
    await client.query("BEGIN");

    const query = `
      INSERT INTO \`DatabaseLootInfo\` (
        id, itemId, itemName, questName, step, npcName, levelMin, levelMax,
        difficulty, zone, worldSpawnLocation, spawnRate, dropChance, zoneCoordinates, worldCoordinates,
        sourceType, recipeName, tokenName, tokenLevel, profession, certification, materials,
        levelBasedChances, dropChancePerRoll, rolls, poolSize, rewardTableId
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        itemName = VALUES(itemName),
        questName = VALUES(questName),
        step = VALUES(step),
        npcName = VALUES(npcName),
        levelMin = VALUES(levelMin),
        levelMax = VALUES(levelMax),
        difficulty = VALUES(difficulty),
        zone = VALUES(zone),
        worldSpawnLocation = VALUES(worldSpawnLocation),
        spawnRate = VALUES(spawnRate),
        dropChance = VALUES(dropChance),
        zoneCoordinates = VALUES(zoneCoordinates),
        worldCoordinates = VALUES(worldCoordinates),
        sourceType = VALUES(sourceType),
        recipeName = VALUES(recipeName),
        tokenName = VALUES(tokenName),
        tokenLevel = VALUES(tokenLevel),
        profession = VALUES(profession),
        certification = VALUES(certification),
        materials = VALUES(materials),
        levelBasedChances = VALUES(levelBasedChances),
        dropChancePerRoll = VALUES(dropChancePerRoll),
        rolls = VALUES(rolls),
        poolSize = VALUES(poolSize),
        rewardTableId = VALUES(rewardTableId),
        lastModified = CURRENT_TIMESTAMP
    `;

    // Process in batches of 100 entries
    const batchSize = 100;
    for (let i = 0; i < lootEntries.length; i += batchSize) {
      const batch = lootEntries.slice(i, i + batchSize);
      const promises = batch.map((loot) => {
        const values = [
          loot.id,
          loot.itemId,
          loot.itemName,
          loot.questName,
          loot.step,
          loot.npcName,
          loot.levelMin ?? null,
          loot.levelMax ?? null,
          loot.difficulty ?? null,
          loot.zone ?? null,
          loot.worldSpawnLocation ?? null,
          loot.spawnRate ?? null,
          loot.dropChance ?? null,
          JSON.stringify(loot.zoneCoordinates || {}),
          JSON.stringify(loot.worldCoordinates || {}),
          loot.sourceType ?? null,
          loot.recipeName ?? null,
          loot.tokenName ?? null,
          loot.tokenLevel ?? null,
          loot.profession ?? null,
          loot.certification ?? null,
          JSON.stringify(loot.materials || []),
          JSON.stringify(loot.levelBasedChances || []),
          loot.dropChancePerRoll ?? null,
          loot.rolls ?? null,
          loot.poolSize ?? null,
          loot.rewardTableId ?? null
        ];
        return client.execute(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.query("COMMIT");

    console.log(`Successfully saved ${lootEntries.length} loot entries in batch operation`);
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
 * Batch version of saveMobLootInfoToDatabase to save monster loot entries only
 * @param {Array} mobLootEntries - Array of monster loot entry objects to save
 */
async function batchSaveMobLootInfoToDatabase(mobLootEntries) {
  if (!mobLootEntries || mobLootEntries.length === 0) {
    return;
  }

  const client = await pool.getConnection();
  try {
    // Ensure table exists with proper schema for monster loot only
    await ensureLastModifiedColumn(client, 'DatabaseMobLootInfo');

    // Begin transaction
    await client.query("BEGIN");

    const query = `
      INSERT INTO \`DatabaseMobLootInfo\` (
        id, itemId, itemName, npcName, levelMin, levelMax, difficulty, zone,
        worldSpawnLocation, spawnRate, dropChance, zoneCoordinates, worldCoordinates,
        levelBasedChances, dropChancePerRoll, rolls, poolSize, rewardTableId
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        itemName = VALUES(itemName),
        npcName = VALUES(npcName),
        levelMin = VALUES(levelMin),
        levelMax = VALUES(levelMax),
        difficulty = VALUES(difficulty),
        zone = VALUES(zone),
        worldSpawnLocation = VALUES(worldSpawnLocation),
        spawnRate = VALUES(spawnRate),
        dropChance = VALUES(dropChance),
        zoneCoordinates = VALUES(zoneCoordinates),
        worldCoordinates = VALUES(worldCoordinates),
        levelBasedChances = VALUES(levelBasedChances),
        dropChancePerRoll = VALUES(dropChancePerRoll),
        rolls = VALUES(rolls),
        poolSize = VALUES(poolSize),
        rewardTableId = VALUES(rewardTableId),
        lastModified = CURRENT_TIMESTAMP
    `;

    // Process in batches of 100 entries
    const batchSize = 100;
    for (let i = 0; i < mobLootEntries.length; i += batchSize) {
      const batch = mobLootEntries.slice(i, i + batchSize);
      const promises = batch.map((loot) => {
        const values = [
          loot.id,
          loot.itemId,
          loot.itemName,
          loot.npcName,
          loot.levelMin ?? null,
          loot.levelMax ?? null,
          loot.difficulty ?? null,
          loot.zone ?? null,
          loot.worldSpawnLocation ?? null,
          loot.spawnRate ?? null,
          loot.dropChance ?? null,
          JSON.stringify(loot.zoneCoordinates || {}),
          JSON.stringify(loot.worldCoordinates || {}),
          JSON.stringify(loot.levelBasedChances || []),
          loot.dropChancePerRoll ?? null,
          loot.rolls ?? null,
          loot.poolSize ?? null,
          loot.rewardTableId ?? null
        ];
        return client.execute(query, values);
      });

      // Execute all queries in this batch
      await Promise.all(promises);
    }

    // Commit the transaction
    await client.query("COMMIT");

    console.log(`Successfully saved ${mobLootEntries.length} monster loot entries in batch operation`);
  } catch (error) {
    // Rollback in case of error
    await client.query("ROLLBACK");
    console.error(`Error in batch save operation: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

async function savePlayerStatsToDatabase(playerStats) {
  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabasePlayerStats');
    const attributes = playerStats.attributes || {};
    for (const attr of Object.keys(attributes)) {
      await ensureColumn(client, 'DatabasePlayerStats', attr, 'JSON');
    }
    const columns = ['className', 'class', ...Object.keys(attributes).map(a => `\`${a}\``)];
    const placeholders = columns.map(() => '?').join(', ');
    const updates = columns.slice(1).map(c => `${c} = VALUES(${c})`).join(', ');
    const classValue =
      playerStats.class !== undefined && playerStats.class !== null
        ? playerStats.class
        : 100;
    const values = [
      playerStats.className,
      classValue,
      ...Object.values(attributes).map(v => JSON.stringify(v)),
    ];
    const query = `INSERT INTO \`DatabasePlayerStats\` (${columns.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}, lastModified = CURRENT_TIMESTAMP`;
    await client.execute(query, values);
  } finally {
    client.release();
  }
}

async function batchSaveSkillTableToDatabase(entries) {
  if (!entries || entries.length === 0) {
    return;
  }

  const client = await pool.getConnection();
  try {
    await ensureLastModifiedColumn(client, 'DatabaseSkillTable');
    await ensureColumn(client, 'DatabaseSkillTable', 'maxRange', 'FLOAT');
    await ensureColumn(client, 'DatabaseSkillTable', 'angle', 'FLOAT');
    await client.query('BEGIN');
    const query = `
      INSERT INTO \`DatabaseSkillTable\` (
        id, tableId, tableName, name, description, type, cooldown, manaCost, maxRank,
        imageUrl, position, requirements, maxRange, angle
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON DUPLICATE KEY UPDATE
        tableId = VALUES(tableId),
        tableName = VALUES(tableName),
        name = VALUES(name),
        description = VALUES(description),
        type = VALUES(type),
        cooldown = VALUES(cooldown),
        manaCost = VALUES(manaCost),
        maxRank = VALUES(maxRank),
        imageUrl = VALUES(imageUrl),
        position = VALUES(position),
        requirements = VALUES(requirements),
        maxRange = VALUES(maxRange),
        angle = VALUES(angle),
        lastModified = CURRENT_TIMESTAMP
    `;
    const batchSize = 100;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const promises = batch.map((e) => {
        const values = [
          e.id ?? null,
          e.tableId ?? null,
          e.tableName ?? null,
          e.name ?? null,
          e.description ?? null,
          e.type ?? null,
          e.cooldown ?? null,
          JSON.stringify(e.manaCost || {}),
          e.maxRank ?? null,
          e.imageUrl ?? null,
          JSON.stringify(e.position || {}),
          JSON.stringify(e.requirements || {}),
          e.maxRange ?? null,
          e.angle ?? null
        ];
        return client.execute(query, values);
      });
      await Promise.all(promises);
    }
    await client.query('COMMIT');
    console.log(`Successfully saved ${entries.length} skill entries in batch operation`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in batch save operation: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

async function batchSaveStatusEffectsToDatabase(entries) {
  if (!entries || entries.length === 0) {
    return;
  }
  const client = await pool.getConnection();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS \`DatabaseStatusEffects\` (
        effectName VARCHAR(255) PRIMARY KEY,
        effectDescription TEXT,
        effectIcon TEXT,
        effectCategory VARCHAR(255),
        effectElement VARCHAR(255),
        effectDuration FLOAT,
        effectDispellable TINYINT(1),
        lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await ensureLastModifiedColumn(client, 'DatabaseStatusEffects');
    await ensureColumn(client, 'DatabaseStatusEffects', 'effectCategory', 'VARCHAR(255)');
    await ensureColumn(client, 'DatabaseStatusEffects', 'effectElement', 'VARCHAR(255)');
    await ensureColumn(client, 'DatabaseStatusEffects', 'effectDuration', 'FLOAT');
    await ensureColumn(client, 'DatabaseStatusEffects', 'effectDispellable', 'TINYINT(1)');
    await client.query('BEGIN');
    const query = `
      INSERT INTO \`DatabaseStatusEffects\` (
        effectName, effectDescription, effectIcon,
        effectCategory, effectElement, effectDuration, effectDispellable
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        effectDescription = VALUES(effectDescription),
        effectIcon = VALUES(effectIcon),
        effectCategory = VALUES(effectCategory),
        effectElement = VALUES(effectElement),
        effectDuration = VALUES(effectDuration),
        effectDispellable = VALUES(effectDispellable),
        lastModified = CURRENT_TIMESTAMP
    `;
    const batchSize = 100;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const promises = batch.map((e) => {
        const values = [
          e.effectName,
          e.effectDescription,
          e.effectIcon,
          e.effectCategory,
          e.effectElement,
          e.effectDuration,
          e.effectDispellable,
        ];
        return client.execute(query, values);
      });
      await Promise.all(promises);
    }
    await client.query('COMMIT');
    console.log(`Successfully saved ${entries.length} status effects in batch operation`);
  } catch (error) {
    await client.query('ROLLBACK');
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
  saveLootInfoToDatabase,
  batchSaveLootInfoToDatabase,
  batchSaveMobLootInfoToDatabase,
  savePlayerStatsToDatabase,
  batchSaveSkillTableToDatabase,
  batchSaveStatusEffectsToDatabase,
};
