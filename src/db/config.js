/**
 * Database configuration module for the item parser system.
 */
import * as dotenv from "dotenv";
dotenv.config();

import pg from "pg";
const { Pool } = pg;
import { Client } from "ssh2";
import net from "net";

// Connection mode (ssh or local)
const CONNECTION_MODE = process.env.CONNECTION_MODE || "ssh";

// SSH tunnel configuration
const sshConfig = {
  host: process.env.SSH_HOST,
  port: process.env.SSH_PORT || 22,
  username: process.env.SSH_USER,
  password: process.env.SSH_PASSWORD,
  // Uncomment and set path if using key-based authentication
  // privateKey: fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH),
};

// PostgreSQL connection configuration
const dbConfig = {
  user: process.env.DATABASE_USER,
  database: process.env.DATABASE_NAME,
  password: process.env.DATABASE_PASSWORD,
  port: process.env.DATABASE_PORT || 5432,
  host: process.env.DATABASE_HOST || "localhost",
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
};

// The pool will be set up based on connection mode
let pool = null;
let sshClient = null;

/**
 * Creates an SSH tunnel and sets up the database connection pool,
 * or creates a direct connection if in local mode
 */
async function setupConnection() {
  // If local connection mode is enabled, set up direct connection
  if (CONNECTION_MODE === "local") {
    return setupLocalConnection();
  }

  // Otherwise, proceed with SSH tunnel
  return setupSSHTunnelConnection();
}

/**
 * Sets up a direct connection to a local PostgreSQL server
 */
async function setupLocalConnection() {
  return new Promise((resolve, reject) => {
    try {
      // Create the connection pool with regular config
      pool = new Pool({
        ...dbConfig,
        // Ensure we're using the correct host for local mode
        host: process.env.LOCAL_DB_HOST || "localhost",
        // Allow overriding the port for local connection
        port: process.env.LOCAL_DB_PORT || process.env.DATABASE_PORT || 5432,
      });

      // Test the connection
      pool.query("SELECT NOW()", (err, res) => {
        if (err) {
          console.error("Local database connection error:", err);
          return reject(err);
        }
        console.log("Connected directly to local database");
        resolve(pool);
      });
    } catch (error) {
      console.error("Error setting up local connection:", error);
      reject(error);
    }
  });
}

/**
 * Sets up connection via SSH tunnel
 */
async function setupSSHTunnelConnection() {
  return new Promise((resolve, reject) => {
    sshClient = new Client();

    sshClient.on("ready", () => {
      console.log("SSH Connection established");

      // Create SSH tunnel
      sshClient.forwardOut(
        "127.0.0.1", // Local bind address
        0, // Local bind port (0 = random available port)
        process.env.DATABASE_HOST || "localhost", // Database host from SSH server perspective
        parseInt(process.env.DATABASE_PORT || 5432), // Database port
        (err, stream) => {
          if (err) {
            console.error("SSH tunnel error:", err);
            return reject(err);
          }

          // Create a local TCP server that will forward connections through the SSH tunnel
          const server = net
            .createServer((socket) => {
              // Connect incoming socket to the SSH stream
              stream.pipe(socket).pipe(stream);
            })
            .listen(0, "127.0.0.1", () => {
              // Get the randomly assigned port
              const { port } = server.address();

              // Configure PostgreSQL pool to use the local server port
              pool = new Pool({
                ...dbConfig,
                host: "127.0.0.1",
                port: port,
              });

              // Test the connection
              pool.query("SELECT NOW()", (err, res) => {
                if (err) {
                  console.error("Database connection error:", err);
                  return reject(err);
                }
                console.log("Database connected successfully via SSH tunnel");
                resolve(pool);
              });
            });

          // Handle server errors
          server.on("error", (err) => {
            console.error("Local server error:", err);
            reject(err);
          });
        }
      );
    });

    sshClient.on("error", (err) => {
      console.error("SSH connection error:", err);
      reject(err);
    });

    // Connect to the SSH server
    sshClient.connect(sshConfig);
  });
}

/**
 * Function to initialize the database tables if they don't exist
 */
async function initDatabase() {
  // Make sure the connection is established first
  if (!pool) {
    await setupConnection();
  }

  const client = await pool.connect();
  try {
    // Create the item table if it doesn't exist
    const createItemsTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseItems" (
        id TEXT PRIMARY KEY,
        name TEXT,
        layout TEXT,
        "typeDescription" TEXT,
        description TEXT[],
        type TEXT,
        tag TEXT[],
        icon TEXT,
        "rarityMin" TEXT,
        "rarityMax" TEXT,
        level INTEGER,
        "statsId" TEXT,
        "itemRecipeId" TEXT[],
        "recipeId" TEXT[]
      )
    `;
    await client.query(createItemsTableQuery);

    // Create the item:recipes table if it doesn't exist
    const createItemRecipesTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseItemRecipes" (
        id TEXT PRIMARY KEY,
        name TEXT,
        "typeDescription" TEXT,
        layout TEXT,
        description TEXT[],
        type TEXT,
        tag TEXT[],
        icon TEXT,
        "rarityMin" TEXT,
        "rarityMax" TEXT,
        level INTEGER,
        "statsId" TEXT,
        "learnableRecipeIds" TEXT,
        "rewardId" TEXT[]
      )
    `;
    await client.query(createItemRecipesTableQuery);

    // Create the stats table if it doesn't exist
    const createStatsTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseStats" (
        id TEXT PRIMARY KEY,
        common JSONB,
        uncommon JSONB,
        rare JSONB,
        heroic JSONB,
        epic JSONB,
        legendary JSONB,
        artifact JSONB,
        durability JSONB
      )
    `;
    await client.query(createStatsTableQuery);

    // Create the set bonuses table if it doesn't exist
    const createSetBonusesTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseSetBonuses" (
        id TEXT PRIMARY KEY,
        name TEXT,
        "setEffects" JSONB
      )
    `;
    await client.query(createSetBonusesTableQuery);

    // Create the enchantment def table if it doesn't exist
    const createEnchantmentDefTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseEnchantmentDef" (
        id TEXT PRIMARY KEY,
        name TEXT,
        levels TEXT[]
      )
    `;
    await client.query(createEnchantmentDefTableQuery);

    // Create the enchantment def table if it doesn't exist
    const createEnchantmentLevelTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseEnchantmentLevel" (
        id TEXT PRIMARY KEY,
        name TEXT,
        "primary" REAL,
        core REAL,
        cost INTEGER,
        success REAL,
        failure REAL,
        loss REAL,
        "all" REAL,
        "break" REAL
      )
    `;
    await client.query(createEnchantmentLevelTableQuery);

    // Create the recipe table if it doesn't exist
    const createRecipeTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseRecipes" (
        id TEXT PRIMARY KEY,
        name TEXT,
        layout TEXT,
        profession TEXT,
        certification TEXT,
        learnable TEXT,
        "overrideName" TEXT,
        overrides JSONB,
        tags TEXT[],
        fuel INTEGER,
        "baseDuration" INTEGER,
        "rewardId" TEXT,
        "primaryResourceCosts" JSONB,
        "generalResourceCost" JSONB,
        "qualityFormula" TEXT,
        "craftingCurrencyCostId" TEXT,
        "rewardItem" TEXT[]
      )
    `;
    await client.query(createRecipeTableQuery);

    // Create the Item:Equipment table if it doesn't exist
    const createEquipmentTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseEquipment" (
        id TEXT PRIMARY KEY,
        name TEXT,
        layout TEXT,
        "typeDescription" TEXT,
        description TEXT[],
        type TEXT,
        subtype TEXT,
        tag TEXT[],
        icon TEXT,
        "rarityMin" TEXT,
        "rarityMax" TEXT,
        "statsId" TEXT,
        level INTEGER,
        grade TEXT,
        "itemRecipeId" TEXT[],
        
        -- Add an index to improve batch operations performance
        CONSTRAINT unique_equipment_id UNIQUE (id)
      )
    `;

    // Add index for faster lookups during batch operations
    const createEquipmentIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_type_description_type ON "DatabaseEquipment" ("typeDescription");
      CREATE INDEX IF NOT EXISTS idx_equipment_subtype ON "DatabaseEquipment" (subtype);
    `;

    await client.query(createEquipmentTableQuery);
    await client.query(createEquipmentIndexQuery);

    // Create the Item:Gear table if it doesn't exist
    const createGearTableQuery = `
      CREATE TABLE IF NOT EXISTS "DatabaseGear" (
        id TEXT PRIMARY KEY,
        name TEXT,
        layout TEXT,
        "typeDescription" TEXT,
        description TEXT[],
        type TEXT,
        subtype TEXT,
        tag TEXT[],
        icon TEXT,
        "rarityMin" TEXT,
        "rarityMax" TEXT,
        slots TEXT[],
        "statsId" TEXT,
        "setBonusIds" TEXT[],
        level INTEGER,
        grade TEXT,
        "enchantmentId" TEXT,
        "deconstructionRecipeId" TEXT,
        "itemRecipeId" TEXT[],
        
        -- Add an index to improve batch operations performance
        CONSTRAINT unique_gear_id UNIQUE (id)
      )
    `;

    // Add index for faster lookups during batch operations
    const createGearIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_gear_type ON "DatabaseGear" (type);
      CREATE INDEX IF NOT EXISTS idx_gear_slots ON "DatabaseGear" USING GIN (slots);
    `;

    await client.query(createGearTableQuery);
    await client.query(createGearIndexQuery);

    console.log("\x1b[36m%s\x1b[0m", "Database tables initialized");
  } catch (error) {
    console.error(`Error initializing database: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

// Function to close connections
async function closeConnections() {
  if (pool) {
    await pool.end();
    console.log("Database connection closed.");
  }
  if (sshClient) {
    sshClient.end();
    console.log("SSH connection closed.");
  }
}

export { pool, initDatabase, setupConnection, closeConnections };
