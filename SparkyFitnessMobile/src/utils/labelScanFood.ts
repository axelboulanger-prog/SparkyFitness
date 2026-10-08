import type { FoodFormData } from '../components/FoodForm';
import type { LabelScanResult } from '../services/api/externalFoodSearchApi';
import { toFormString } from '../types/foodInfo';

/** The food form's starting values for a scanned nutrition label. */
export function labelScanToInitialFood(
  result: LabelScanResult
): Partial<FoodFormData> {
  return {
    name: result.name || '',
    brand: result.brand || '',
    servingSize: String(result.serving_size ?? ''),
    servingUnit: result.serving_unit || 'g',
    calories: String(result.calories ?? ''),
    protein: String(result.protein ?? ''),
    carbs: String(result.carbs ?? ''),
    fat: String(result.fat ?? ''),
    fiber: toFormString(result.fiber),
    saturatedFat: toFormString(result.saturated_fat),
    transFat: toFormString(result.trans_fat),
    sodium: toFormString(result.sodium),
    sugars: toFormString(result.sugars),
    cholesterol: toFormString(result.cholesterol),
    potassium: toFormString(result.potassium),
    calcium: toFormString(result.calcium),
    iron: toFormString(result.iron),
    caffeineMg: toFormString(result.caffeine_mg),
    waterMl: toFormString(result.water_ml),
    alcoholG: toFormString(result.alcohol_g),
    vitaminA: toFormString(result.vitamin_a),
    vitaminC: toFormString(result.vitamin_c),
  };
}
