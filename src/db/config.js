/**
 * Database configuration module for connecting to a local MySQL server.
 */
import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";

async function ensureLastModifiedColumn(conn, table) {
  const [rows] = await conn.query(
    `SHOW COLUMNS FROM \`${table}\` LIKE 'lastModified'`
  );
  if (rows.length === 0) {
    await conn.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`lastModified\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
    );
  }
}

async function ensureColumnExists(conn, table, columnName, columnType) {
  const [rows] = await conn.query(
    `SHOW COLUMNS FROM \`${table}\` LIKE '${columnName}'`
  );
  if (rows.length === 0) {
    await conn.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${columnName}\` ${columnType}`
    );
  }
}

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
    await ensureLastModifiedColumn(conn, 'DatabaseItems');

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
    await ensureLastModifiedColumn(conn, 'DatabaseItemRecipes');
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
        durability JSON,
      lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await ensureLastModifiedColumn(conn, 'DatabaseStats');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseSetBonuses (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        setEffects JSON,
      lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await ensureLastModifiedColumn(conn, 'DatabaseSetBonuses');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS DatabaseEnchantmentDef (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT,
        levels JSON,
      lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await ensureLastModifiedColumn(conn, 'DatabaseEnchantmentDef');

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
        \`break\` DOUBLE,
      lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await ensureLastModifiedColumn(conn, 'DatabaseEnchantmentLevel');

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
    await ensureLastModifiedColumn(conn, 'DatabaseRecipes');

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
    await ensureLastModifiedColumn(conn, 'DatabaseEquipment');

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
        craftingRecipes JSON,
      lastModified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await ensureLastModifiedColumn(conn, 'DatabaseGear');
    await ensureColumnExists(conn, 'DatabaseGear', 'craftingRecipes', 'JSON');

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
