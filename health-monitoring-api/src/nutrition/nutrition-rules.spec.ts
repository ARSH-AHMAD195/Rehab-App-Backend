import { DEFAULT_DIET_SLOTS, DEFAULT_TARGETS, MealSlot } from './diet-chart';
import { checkPlan, dayTotals, percentOf, slotIntake } from './nutrition-rules';

describe('nutrition counting', () => {
  it('the chart: 7 slots, protein adds up to the 82.4 g target', () => {
    expect(DEFAULT_DIET_SLOTS).toHaveLength(7);
    const protein = DEFAULT_DIET_SLOTS.reduce((sum, s) => sum + s.proteinG, 0);
    expect(Math.round(protein * 10) / 10).toBe(DEFAULT_TARGETS.proteinG);
    // The slots add up to 2207 kcal; the chart's printed total (and our default target) is 2206.
    expect(DEFAULT_DIET_SLOTS.reduce((sum, s) => sum + s.kcal, 0)).toBe(2207);
    expect(DEFAULT_TARGETS.kcal).toBe(2206);
  });

  it('a slot counts in full once anything in it is ticked, and not at all otherwise', () => {
    const lunch = DEFAULT_DIET_SLOTS.find((s) => s.code === 'LUNCH')!;
    expect(slotIntake(lunch, ['ROTI_RICE'])).toEqual({ kcal: 711, proteinG: 24.7 });
    expect(slotIntake(lunch, ['ROTI_RICE', 'DAL_CURD', 'VEGETABLES'])).toEqual({ kcal: 711, proteinG: 24.7 });
    expect(slotIntake(lunch, [])).toEqual({ kcal: 0, proteinG: 0 });
  });

  it('adds the eaten slots for the day', () => {
    expect(
      dayTotals([
        { optionCodes: ['POHA_DALIYA_UPMA'], kcal: 460, proteinG: 22.3 },
        { optionCodes: ['ROTI_RICE'], kcal: 711, proteinG: 24.7 },
        { optionCodes: [], kcal: 0, proteinG: 0 },
      ]),
    ).toEqual({ kcal: 1171, proteinG: 47, slotsEaten: 2 });
    expect(dayTotals([])).toEqual({ kcal: 0, proteinG: 0, slotsEaten: 0 });
  });

  it('percent of target, rounded', () => {
    expect(percentOf(1654, 2206)).toBe(75);
    expect(percentOf(0, 2206)).toBe(0);
    expect(percentOf(100, 0)).toBeNull();
  });

  describe('checking a doctor edit', () => {
    const slot = (over: Partial<MealSlot> = {}): MealSlot => ({
      code: 'LUNCH',
      label: { en: 'Lunch', hi: null },
      window: '12:30-13:30',
      kcal: 700,
      proteinG: 25,
      options: [{ code: 'A', label: { en: 'A', hi: null }, quantity: '1', kind: 'OPTION' }],
      ...over,
    });

    it('accepts the default chart and sensible targets', () => {
      expect(checkPlan(DEFAULT_DIET_SLOTS, DEFAULT_TARGETS)).toEqual([]);
    });

    it.each([
      ['a slot code twice', [slot(), slot()], undefined, 'slots[1].code'],
      ['an option code twice', [slot({ options: [...slot().options, ...slot().options] })], undefined, 'slots[0].options[1].code'],
      ['only add-ons', [slot({ options: [{ code: 'A', label: { en: 'A', hi: null }, quantity: '1', kind: 'ADDON' }] })], undefined, 'slots[0].options'],
      ['negative calories', [slot({ kcal: -1 })], undefined, 'slots[0].kcal'],
      ['a tiny calorie target', undefined, { kcal: 100, proteinG: 80 }, 'targets.kcal'],
      ['a huge protein target', undefined, { kcal: 2000, proteinG: 400 }, 'targets.proteinG'],
    ] as [string, MealSlot[] | undefined, { kcal: number; proteinG: number } | undefined, string][])('rejects %s', (_label, slots, targets, field) => {
      expect(checkPlan(slots, targets).map((d) => d.field)).toContain(field);
    });
  });
});
