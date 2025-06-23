/**
 * Database configuration module for connecting to a local MySQL server.
 */
import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";

let pool = null;

export async function setupConnection() {
  if (pool) {
    return pool;
  }
  pool = mysql.createPool({
    host: process.env.DATABASE_HOST || "localhost",
    port: process.env.DATABASE_PORT || 3306,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    connectionLimit: 10,
  });
  const connection = await pool.getConnection();
  await connection.ping();
  connection.release();
  console.log("Connected to MySQL database");
  return pool;
}

export async function initDatabase() {
  if (!pool) {
    await setupConnection();
  }
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseItems (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        layout TEXT,
        typeDescription TEXT,
        description JSON,
        type TEXT,
        tag JSON,
        icon TEXT,
        rarityMin TEXT,
        rarityMax TEXT,
        level INT,
        statsId TEXT,
        itemRecipeId JSON,
        recipeId JSON,
        lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(
      "ALTER TABLE `DatabaseItems` ADD COLUMN IF NOT EXISTS `lastModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseItemRecipes (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        typeDescription TEXT,
        layout TEXT,
        description JSON,
        type TEXT,
        tag JSON,
        icon TEXT,
        rarityMin TEXT,
        rarityMax TEXT,
        level INT,
        statsId TEXT,
        learnableRecipeIds TEXT,
        rewardId JSON,
        lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(
      "ALTER TABLE `DatabaseItemRecipes` ADD COLUMN IF NOT EXISTS `lastModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );
    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseStats (
        id VARCHAR(255) PRIMARY KEY,
        common JSON,
        uncommon JSON,
        rare JSON,
        heroic JSON,
        epic JSON,
        legendary JSON,
        artifact JSON,
        durability JSON
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseSetBonuses (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        setEffects JSON
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseEnchantmentDef (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        levels JSON
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseEnchantmentLevel (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        \`primary\` DOUBLE,
        core DOUBLE,
        cost INT,
        success DOUBLE,
        failure DOUBLE,
        loss DOUBLE,
        \`all\` DOUBLE,
        \`break\` DOUBLE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseRecipes (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        layout TEXT,
        profession TEXT,
        certification TEXT,
        learnable TEXT,
        overrideName TEXT,
        overrides JSON,
        tags JSON,
        fuel INT,
        baseDuration INT,
        rewardId TEXT,
        primaryResourceCosts JSON,
        generalResourceCost JSON,
        qualityFormula TEXT,
        craftingCurrencyCostId TEXT,
        rewardItem JSON,
        lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(
      "ALTER TABLE `DatabaseRecipes` ADD COLUMN IF NOT EXISTS `lastModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseEquipment (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        layout TEXT,
        typeDescription TEXT,
        description JSON,
        type TEXT,
        subtype TEXT,
        tag JSON,
        icon TEXT,
        rarityMin TEXT,
        rarityMax TEXT,
        statsId TEXT,
        level INT,
        grade TEXT,
        itemRecipeId JSON,
        lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(
      "ALTER TABLE `DatabaseEquipment` ADD COLUMN IF NOT EXISTS `lastModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseGear (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        layout TEXT,
        typeDescription TEXT,
        description JSON,
        type TEXT,
        subtype TEXT,
        tag JSON,
        icon TEXT,
        rarityMin TEXT,
        rarityMax TEXT,
        slots JSON,
        statsId TEXT,
        setBonusIds JSON,
        level INT,
        grade TEXT,
        enchantmentId TEXT,
        deconstructionRecipeId TEXT,
        itemRecipeId JSON,
        lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(
      "ALTER TABLE `DatabaseGear` ADD COLUMN IF NOT EXISTS `lastModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    console.log("Database tables initialized");
  } finally {
    conn.release();
  }
}

export async function closeConnections() {
  if (pool) {
    await pool.end();
    console.log("Database connection closed");
  }
}

export { pool };
