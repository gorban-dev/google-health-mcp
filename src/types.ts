// Google Health API v4 wire types (subset used by this server).
// Field shapes verified against https://health.googleapis.com/$discovery/rest?version=v4 (2026-07-24).

export interface EnergyQuantity {
  kcal: number;
  userProvidedUnit?: string;
}

export interface WeightQuantity {
  grams: number;
  userProvidedUnit?: string;
}

export interface VolumeQuantity {
  milliliters: number;
  userProvidedUnit?: string;
}

export type Nutrient =
  | "PROTEIN"
  | "DIETARY_FIBER"
  | "SUGAR"
  | "SODIUM"
  | "SATURATED_FAT"
  | "CAFFEINE"
  | "CHOLESTEROL"
  | "POTASSIUM"
  | "CALCIUM"
  | "IRON";

export interface NutrientQuantity {
  nutrient: Nutrient | string;
  quantity: WeightQuantity;
}

export interface SessionTimeInterval {
  startTime: string;
  endTime: string;
  startUtcOffset: string;
  endUtcOffset: string;
  civilStartTime?: unknown;
  civilEndTime?: unknown;
}

export type MealType =
  | "MEAL_TYPE_UNSPECIFIED"
  | "BEFORE_BREAKFAST"
  | "BREAKFAST"
  | "BEFORE_LUNCH"
  | "LUNCH"
  | "BEFORE_DINNER"
  | "DINNER"
  | "AFTER_DINNER"
  | "SNACK"
  | "ANYTIME";

export interface NutritionLog {
  foodDisplayName?: string;
  food?: string;
  mealType?: MealType;
  energy?: EnergyQuantity;
  energyFromFat?: EnergyQuantity;
  totalFat?: WeightQuantity;
  totalCarbohydrate?: WeightQuantity;
  nutrients?: NutrientQuantity[];
  serving?: { foodMeasurementUnit: string; amount?: number };
  interval: SessionTimeInterval;
}

export interface HydrationLog {
  amountConsumed: VolumeQuantity;
  interval: SessionTimeInterval;
}

export interface DataPoint {
  name?: string;
  nutritionLog?: NutritionLog;
  hydrationLog?: HydrationLog;
  [key: string]: unknown;
}

export interface Operation {
  done?: boolean;
  response?: DataPoint & { "@type"?: string };
  error?: { code: number; message: string };
}

export interface ListDataPointsResponse {
  dataPoints?: DataPoint[];
  nextPageToken?: string;
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface RollupDataPoint {
  civilStartTime?: { date?: CivilDate };
  civilEndTime?: { date?: CivilDate };
  [key: string]: unknown;
}

export interface DailyRollUpResponse {
  rollupDataPoints?: RollupDataPoint[];
  nextPageToken?: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch milliseconds when accessToken expires. */
  expiresAt: number;
  scopes: string[];
}

export interface AppConfig {
  clientId?: string;
  clientSecret?: string;
  /** IANA timezone, e.g. "Asia/Nicosia". Defaults to the system timezone. */
  timezone?: string;
  /** Short scope names without the googlehealth. prefix, e.g. "nutrition.writeonly". */
  scopes?: string[];
}
