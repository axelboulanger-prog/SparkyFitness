// Single source of truth for the external food providers the app can
// search, imported from, and refresh against.
//
// This list is intentionally code-level, not derived from the
// `external_provider_types` table: every entry here requires a hand-written
// `case` in `SparkyFitnessServer/services/externalFoodSearchService.ts#searchProviderFoods`.
// Adding a food-category row to the database does NOT make it searchable, so
// deriving from the table would advertise providers that fail at call time.
//
// Legacy `nutritionix` is excluded: it still appears on older food rows but
// has no active backend import/search path.
export const FOOD_PROVIDER_TYPES = [
  'openfoodfacts',
  'usda',
  'fatsecret',
  'mealie',
  'tandoor',
  'yazio',
  'norish',
  'swissfood',
  'canadian-nutrient-file',
] as const;

export type FoodProviderType = (typeof FOOD_PROVIDER_TYPES)[number];
