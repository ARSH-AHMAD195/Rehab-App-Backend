/**
 * The hospital's "High-calorie, High-protein Diet for Cancer Patients" chart,
 * as transcribed in the client's change request (Nov 2026, section 5.1).
 *
 * - Calories and protein are PER MEAL SLOT, as on the chart; the chart gives
 *   no value per food option.
 * - OPTION items are the "or" alternatives; ADDON items are the "+" add-ons.
 * - Quantities are kept exactly as supplied (katori, glass, plate...).
 * - The printed chart is in Hindi. `hi` stays null until the client supplies
 *   approved translations; the app falls back to English.
 *
 * To check with the dietitian (client note): the breakfast row's
 * option-to-quantity mapping, and the daily total - the seven slots add up to
 * 2207 kcal while the chart says 2206; the target keeps the chart's 2206.
 */

export const OPTION_KINDS = { OPTION: 'OPTION', ADDON: 'ADDON' } as const;
export type OptionKind = (typeof OPTION_KINDS)[keyof typeof OPTION_KINDS];

export interface Text {
  en: string;
  hi: string | null;
}

export interface FoodOption {
  code: string;
  label: Text;
  quantity: string;
  kind: OptionKind;
}

export interface MealSlot {
  code: string;
  label: Text;
  /** Local time window, e.g. "06:00-07:00", for showing and for reminders. */
  window: string;
  kcal: number;
  proteinG: number;
  options: FoodOption[];
}

export interface DietTargets {
  kcal: number;
  proteinG: number;
}

const en = (text: string): Text => ({ en: text, hi: null });
const opt = (code: string, label: string, quantity: string, kind: OptionKind = 'OPTION'): FoodOption => ({
  code,
  label: en(label),
  quantity,
  kind,
});

export const DEFAULT_DIET_TYPE = 'HIGH_CALORIE_HIGH_PROTEIN';
export const DEFAULT_DIET_LABEL = en('High-calorie, High-protein Diet for Cancer Patients');
export const DEFAULT_TARGETS: DietTargets = { kcal: 2206, proteinG: 82.4 };

export const DEFAULT_DIET_SLOTS: MealSlot[] = [
  {
    code: 'BEFORE_BREAKFAST',
    label: en('Before breakfast'),
    window: '06:00-07:00',
    kcal: 183,
    proteinG: 4.2,
    options: [
      opt('TEA', 'Tea / green tea / black tea (no sugar)', '½ cup'),
      opt('LEMON_WATER', 'Lemon water (no sugar)', '1 glass'),
      opt('BANANA_MAKHANA_CHANA', 'Banana / roasted makhana / roasted chana', '1 / 1 katori', 'ADDON'),
    ],
  },
  {
    code: 'BREAKFAST',
    label: en('Breakfast'),
    window: '07:30-08:00',
    kcal: 460,
    proteinG: 22.3,
    options: [
      opt('POHA_DALIYA_UPMA', 'Poha / daliya / upma / bhagar (with vegetables)', '1 katori'),
      opt('MILK_DALIYA', 'Milk daliya (daliya / jau / bhagar / sevaiyan)', '1 katori'),
      opt('CHILLA', 'Besan chilla / moong dal chilla', '2-3'),
      opt('IDLI_SAMBAR', 'Idli + sambar', '2 + 1 katori'),
      opt('TOAST_PANEER_OMELETTE', 'Toasted bread + roasted paneer / omelette', '2 slices + 50 g / 2 eggs'),
      opt('ROTI_SABZI', 'Roti + seasonal sabzi / paneer / soyabean', '2 + 1 katori'),
      opt('EGGS_PANEER', 'Boiled eggs / paneer', '2 / 20-25 g', 'ADDON'),
      opt('MILK', 'Milk (boiled)', '1 glass', 'ADDON'),
    ],
  },
  {
    code: 'MID_MORNING',
    label: en('Mid-morning'),
    window: '10:00-10:30',
    kcal: 86,
    proteinG: 3.4,
    options: [
      opt('FRUIT', 'Banana / seasonal fruit / orange (fresh, washed)', '2 / 100-150 g'),
      opt('SPROUTS', 'Black chana / moong / sprout salad (boiled or steamed)', '1 katori'),
      opt('ROASTED_SNACK', 'Chana / peanuts / murmura / chivda (roasted)', '1 katori'),
    ],
  },
  {
    code: 'LUNCH',
    label: en('Lunch'),
    window: '12:30-13:30',
    kcal: 711,
    proteinG: 24.7,
    options: [
      opt(
        'ROTI_RICE',
        'Roti (atta / sattu / bajra / jowar / ragi / multigrain / missi) + boiled rice / pulao (soyabean / sabzi)',
        '3 + 1 katori',
      ),
      opt('KHICHDI_DALIYA', 'Vegetable khichdi / vegetable daliya + seasonal / green leafy sabzi', '1 plate + 1 katori'),
      opt('VEGETABLES', 'Seasonal vegetables / green leafy / mixed veg', '2 katori', 'ADDON'),
      opt('DAL_CURD', 'Dal (dal / rajma / chhole / lobia) / kadhi / paneer / soyabean / sambar + curd (packaged)', '1 katori + 80 g', 'ADDON'),
    ],
  },
  {
    code: 'EVENING_SNACK',
    label: en('Evening snack'),
    window: '16:00-17:00',
    kcal: 82,
    proteinG: 4.9,
    options: [
      opt('TEA_ROASTED', 'Green tea / black tea + chana / peanuts / dry fruits (roasted)', '½ cup + ½ katori'),
      opt('SABUDANA_KHICHDI', 'Sabudana / bajra khichdi', '1 katori'),
      opt('KHEER_SHAKE', 'Ragi kheer / sevaiyan kheer / milk or fruit shake', '1 katori'),
      opt('SOUP', 'Home-made soup (tomato / corn) / dal soup', '1 katori'),
      opt('FRUIT', 'Seasonal fruit (fresh, washed)', '2 / 100-150 g'),
    ],
  },
  {
    code: 'DINNER',
    label: en('Dinner'),
    window: '19:30-20:00',
    kcal: 598,
    proteinG: 18.4,
    options: [
      opt('ROTI_RICE', 'Roti + boiled rice', '2 + 1 katori'),
      opt('KHICHDI_DALIYA', 'Dal khichdi / vegetable daliya + seasonal / green leafy sabzi', '1 plate + 2 katori'),
      opt('SABZI_PROTEIN', 'Seasonal sabzi + dal / soyabean / egg curry / chicken curry', '2 katori + 1 katori', 'ADDON'),
    ],
  },
  {
    code: 'AFTER_DINNER',
    label: en('After dinner'),
    window: '20:30-21:00',
    kcal: 87,
    proteinG: 4.5,
    options: [opt('MILK', 'Milk (boiled, no sugar)', '1 cup')],
  },
];
