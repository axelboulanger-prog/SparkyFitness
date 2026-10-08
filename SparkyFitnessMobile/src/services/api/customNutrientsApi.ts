import { apiFetch } from './apiClient';

/** Mirrors the `user_custom_nutrients` table shape returned by GET /api/custom-nutrients. */
export interface UserCustomNutrient {
  id: string;
  name: string;
  unit: string;
}

/**
 * Fetches the current user's custom nutrient definitions.
 * GET /api/custom-nutrients
 */
export const fetchCustomNutrients = (): Promise<UserCustomNutrient[]> =>
  apiFetch<UserCustomNutrient[]>({
    endpoint: '/api/custom-nutrients',
    serviceName: 'Custom Nutrients API',
    operation: 'fetch custom nutrients',
  });

/** One requested catalog nutrient and where its amount is stored. */
export interface ResolvedCatalogNutrient {
  catalogId: string;
  /** The custom nutrient's actual name, which can pre-date the catalog. */
  name: string;
  /** Set when the nutrient is a built-in column rather than a custom one. */
  fixedField?: string;
}

/**
 * Finds or creates the user's custom nutrient for each catalog id.
 * POST /api/custom-nutrients/from-catalog
 */
export const ensureCatalogNutrients = (
  catalogIds: string[]
): Promise<{ resolved: ResolvedCatalogNutrient[] }> =>
  apiFetch<{ resolved: ResolvedCatalogNutrient[] }>({
    endpoint: '/api/custom-nutrients/from-catalog',
    serviceName: 'Custom Nutrients API',
    operation: 'create catalog nutrients',
    method: 'POST',
    body: { catalogIds },
  });
