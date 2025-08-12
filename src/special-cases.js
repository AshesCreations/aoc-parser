// Special case handlers for ability and effect descriptions
// Each entry returns an object with optional name and description overrides

function wrapKeywords(text, keywords) {
  if (!text) return text;
  for (const k of keywords) {
    const re = new RegExp(`\\b${k}\\b`, 'g');
    text = text.replace(re, `[${k}]`);
  }
  return text;
}

function replaceRangeWithMin(text) {
  if (!text) return text;
  return text.replace(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/g, '$1');
}

function replaceRangeWithMax(text) {
  if (!text) return text;
  return text.replace(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/g, '$2');
}

function convertMultiplier(text) {
  if (!text) return text;
  return text.replace(/(\d+(?:\.\d+)?)% (Damage|Healing) Multiplier/g, (_, n, type) => {
    const num = parseFloat(n);
    if (Number.isNaN(num)) return `${n}% ${type} Multiplier`;
    const val = num > 1 ? (num - 1) * 100 : num;
    const formatted = Number.isInteger(val) ? val : val.toFixed(2);
    return `${formatted}% ${type} Multiplier`;
  });
}

function formatLovely(text) {
  if (!text) return text;
  let out = text.replace(/}/g, '');
  out = out.replace(/\{skill:[^:]+:[^:]+:\s*([^:]+):\s*([^}]+)\}/g, '\n[$1]: $2');
  return out;
}

const handlers = {
  Glee: (name, desc) => ({ description: replaceRangeWithMin(desc) }),
  Pep: (name, desc) => ({ description: replaceRangeWithMin(desc) }),
  Resonance: (name, desc) => ({ description: convertMultiplier(desc) }),
  Solace: (name, desc) => ({ description: replaceRangeWithMax(desc) }),
  'Staggered Effect': () => ({
    description:
      '-25% Disable Evasion for 6 seconds. Duration can be extended up to 15 seconds by subsequent applications.',
  }),
  Shield: (name, desc) => ({ description: convertMultiplier(desc) }),
  'Maddening Dance': (name, desc) => ({
    description: desc
      ? desc.replace(/([0-9]+(?:\.\d+)?)%/g, (_, n) => `${Math.round(parseFloat(n))}%`)
      : desc,
  }),
  Disarmed: () => ({ description: 'Cannot use weapons for 4 seconds.' }),
  'Menacing Melody': (name, desc) => ({ description: replaceRangeWithMin(desc) }),
  'Cathartic Melody': (name, desc) => ({ description: replaceRangeWithMin(desc) }),
  'Cheerful Melody': (name, desc) => ({ description: replaceRangeWithMin(desc) }),
  'Pensive Melody': () => ({
    description: "Restores mana based on caster's magical power every 2 seconds",
  }),
  'Epic Melody': () => ({ description: '10% Movement Speed and 100% Stamina Regeneration' }),
  'Hymn of the Mind': () => ({ description: "Target ally gains mana based on caster's attributes" }),
  'Hymn of the Mind (AoE)': () => ({
    description: 'Up to 4 allies in front of you gain mana based on caster\'s attributes',
  }),
  'Lovely Serenade': (name, desc) => ({ description: formatLovely(desc) }),
  Chilled: () => ({
    description:
      'Movement speed reduced by 50% per stack. Lasts 6 seconds. Duration can be extended up to 15 seconds by subsequent applications.',
  }),
  'Battle Cry': (name, desc) => ({ description: wrapKeywords(desc, ['Riled', 'Shaken']) }),
  'Reinvigorating Berserk': (name, desc) => ({ description: wrapKeywords(desc, ['Exert']) }),
  'Indomitable Spirit': () => ({
    description: '20% Healing Received, 20% Max Health. Lasts 15 seconds.',
  }),
  'Oppressive Reflect': (name, desc) => ({ description: wrapKeywords(desc, ['Reflect']) }),
  'Refreshing Reflect': (name, desc) => ({ description: wrapKeywords(desc, ['Reflect']) }),
  'Supernatural Grit': (name, desc) => ({ description: wrapKeywords(desc, ['Grit']) }),
  'Forceful Tremors': (name, desc) => ({ description: wrapKeywords(desc, ['Snare']) }),
  Taunt: (name, desc) => ({ description: wrapKeywords(desc, ['Humiliation']) }),
  Protect: (name, desc) => ({ description: wrapKeywords(desc, ['Protect']) }),
  "Death's Mark": (name, desc) => ({ name: "Death's Mark", description: desc }),
  Doublestrike: () => ({
    description:
      'Strike again with the last used melee ability from this list:\nStab\nLacerate\nThump',
  }),
  Throw: (name, desc) => ({
    description: desc
      ? desc.replace(/bounces? up to \d+/i, 'bounces up to 5')
      : 'Throw bounces up to 5 times to other nearby enemies dealing lesser damage with each bounce.',
  }),
  'Soothing Shadows': () => ({
    description: "Healing for Health based on Caster's attributes every 1 second. Lasts 6 seconds.",
  }),
  'Off Balance': () => ({ description: 'Cannot move or rotate for 3 seconds.' }),
  Silenced: () => ({ description: 'Cannot use abilities. Lasts 4 seconds.' }),
  'Prismatic Beam': (name, desc) => ({
    description: desc
      ? desc.replace(/Each hit drains.*$/i, 'Each hit drains from the target to the caster.')
      : 'Each hit drains from the target to the caster.',
  }),
  Firebolt: () => ({
    description: 'Hurl a bolt of fire toward your target, dealing damage and applying [Burning].',
  }),
  Mage_Firebolt: () => ({
    description: 'Hurl a bolt of fire toward your target, dealing damage and applying [Burning].',
  }),
};

function applySpecialCase(name, description) {
  const handler = handlers[name];
  if (!handler) return { name, description };
  const result = handler(name, description) || {};
  return {
    name: result.name !== undefined ? result.name : name,
    description:
      result.description !== undefined ? result.description : description
  };
}

export { applySpecialCase };
