import { processComprehensiveLoot } from './src/processor/loot-comprehensive.js';

console.log('🔍 Starting debug run...');

// Override the database function to just log data instead
async function debugRun() {
    // Temporarily set a flag to prevent database saves
    process.env.DEBUG_MODE = 'true';
    
    const result = await processComprehensiveLoot();
    console.log(`Debug run completed: ${result} entries would be saved`);
}

debugRun().catch(console.error);
