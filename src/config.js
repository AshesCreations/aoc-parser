/**
 * Configuration module for the item parser system.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import path from "path";
import { fileURLToPath } from "url";
import statIdToName from "./json/stats-id.json" with { type: "json" };
import professionIdToName from "./json/profession-id.json" with { type: "json" };
import certificationIdToName from "./json/certification-id.json" with { type: "json" };
import rewardTableIdToItemRewardId from "./json/reward-id.json" with { type: "json" };

// Get current filename and directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory containing the JSON files
const directoryBase = process.env.GAME_FILES_PATH;
const directoryItems = directoryBase + "/AOC/Content/DesignData/Data/Item/Item";
const directoryStats = directoryBase + "/AOC/Content/DesignData/Data/Item/ItemStatBlock";
const directorySetBonus = directoryBase + "/AOC/Content/DesignData/Data/Item/SetBonus";
const directoryEnchantmentDef = directoryBase + "/AOC/Content/DesignData/Data/Enchantment/EnchantmentItemDef";
const directoryEnchantmentLevel = directoryBase + "/AOC/Content/DesignData/Data/Enchantment/EnchantmentLevelDef";
const directoryData = directoryBase + "/AOC/Content/DesignData/Data";

// Item types to filter by
const itemTypes = ["All", "Consumable", "Material","Misc","Quest"];
// Tags to exclude from final database entry
const tagsToExclude = ["Item", "item", "Slot", "Gear", "Armor", "Weapon"];
// Log file path for items with missing icons
const logFilePath = path.join(__dirname, "logs", "issues-icons.log");
// Log file path for undefined values
const undefinedLogPath = path.join(__dirname, "logs", "issues-values.log");

export {
  directoryItems,
  directoryStats,
  directorySetBonus,
  directoryEnchantmentDef,
  directoryEnchantmentLevel,
  directoryData,
  statIdToName,
  professionIdToName,
  certificationIdToName,
  rewardTableIdToItemRewardId,
  itemTypes,
  tagsToExclude,
  logFilePath,
  undefinedLogPath,
};
