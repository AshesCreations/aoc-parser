# Requirements

- node.js
- FModel
- MySQL database access

# Instructions

## use FModel to extract the JSON files from the following folders

- /AOC/Content/DesignData/Data/Item/Item
- /AOC/Content/DesignData/Data/Item/ItemStatBlock
- /AOC/Content/DesignData/Data/Item/SetBonus
- /AOC/Content/DesignData/Data/Stats/StatTypeDef \*\*\*parsed to one .json

- /AOC/Content/DesignData/Data/Abilities/AoCAbility
- /AOC/Content/DesignData/Data/Abilities/AbilityHit
- /AOC/Content/DesignData/Data/Effects/Effect
- /AOC/Content/DesignData/Data/Stats/StatEquationType
- /AOC/Content/DesignData/Data/Stats/StatFormulaType

- /AOC/Content/DesignData/Data/Crafting/CraftingRecipeDef
- /AOC/Content/DesignData/Data/Character/CharacterProfessions \*\*\*parsed to one .json
- /AOC/Content/DesignData/Data/Leveling/CertificationLevel \*\*\*parsed to one .json
- /AOC/Content/DesignData/Data/Reward/RewardTable \*\*\*parsed to one .json

- /AOC/Content/DesignData/Data/Enchantment/EnchantmentItemDef <= not really needed atm
- /AOC/Content/DesignData/Data/Enchantment/EnchantmentLevelDef <= not really needed atm

- /AOC/Content/DesignData/Data/Item/QualityCurveId <= not really needed atm

- best practices
- make sure file path is clear of old data. An empty location is best.
- name outer folder with patch version.

## create a .env file

Rename templateENV to .env and file all empty variables.

### example from C:/Users/Danie/Desktop/FMODEL/exports/AOC/Content/DesignData/Data/Item/Item";

> GAME_FILES_PATH = "C:/Users/Danie/Desktop/FMODEL/exports"

## run "npm install"

- this will add the javascript modules

## run "npm run parser-stats"

- this will create the file that has all the id to name for the stats
- only needed if stats-id.json is not provided.

## run "npm run parser-rewards"

- this will create the file that has all the id arrays for items.
- WARNING: UPDATE EACH TIME BEFORE RUNNING PARSER.

## run "npm run parser"

- this will run the main program

## NOTES

- Equipments includes "inventoryFilterType" of ["Armor", "Weapon", "Equipment"].
- Icons are consider missing if not in "/Game/UI/Icons/"

# TODO

- add revision information to database

- manage images

  - only move used icons
  - add icons outside of Icons folder

- add: batch operations
  - enchantment-def
  - enchantment-level
  - itemRecipe
  - recipe
  - set-bonus // can skip
  - stat-blocks
