using System.Collections.Generic;

namespace AocParser.Models
{
    public class SetBonusCollection
    {
        public List<SetBonus> SetBonuses { get; set; } = new List<SetBonus>();
    }

    public class SetBonus
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public List<StatBonus> StatBonuses { get; set; } = new List<StatBonus>();
        public List<EffectBonus> EffectBonuses { get; set; } = new List<EffectBonus>();
    }

    public class StatBonus
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Count { get; set; }
        public BonusValues Stats { get; set; } = new BonusValues();
    }

    public class BonusValues
    {
        public double Epic { get; set; }
        public double Rare { get; set; }
        public double Common { get; set; }
        public double Heroic { get; set; }
        public double Artifact { get; set; }
        public double Uncommon { get; set; }
        public double Legendary { get; set; }
    }

    public class EffectBonus
    {
        public string Count { get; set; }
        public BonusEffect Effect { get; set; } = new BonusEffect();
        public string MinimumRarity { get; set; }
        public string MaximumRarity { get; set; }
        public int Stacks { get; set; }
    }

    public class BonusEffect
    {
        public string Id { get; set; }
        public string TypeId { get; set; }
        public string Name { get; set; }
        public string Value { get; set; }
    }
}
