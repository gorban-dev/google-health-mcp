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

export interface FoodServing {
  amount?: number;
  foodMeasurementUnit: string;
  foodMeasurementUnitDisplayName?: string;
  foodMeasurementUnitDisplayNamePlural?: string;
  multiplier?: number;
}

export interface Food {
  displayName?: string;
  brand?: string;
  accessLevel?: string;
  languageCode?: string;
  energyAvg?: EnergyQuantity;
  energyFromFat?: EnergyQuantity;
  totalFat?: WeightQuantity;
  totalCarbohydrate?: WeightQuantity;
  nutrients?: NutrientQuantity[];
  defaultServing?: FoodServing;
  servings?: FoodServing[];
}

export interface SessionTimeInterval {
  startTime: string;
  endTime: string;
  startUtcOffset: string;
  endUtcOffset: string;
  civilStartTime?: { date?: CivilDate; time?: unknown };
  civilEndTime?: { date?: CivilDate; time?: unknown };
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

export interface MetricsSummary {
  caloriesKcal?: number;
  distanceMillimeters?: number;
  elevationGainMillimeters?: number;
  steps?: string;
  averageHeartRateBeatsPerMinute?: string;
}

export interface Exercise {
  displayName?: string;
  exerciseType?: string;
  /** Duration excluding pauses, e.g. "3600s". */
  activeDuration?: string;
  interval?: SessionTimeInterval;
  metricsSummary?: MetricsSummary;
  notes?: string;
}

export interface SleepSummary {
  minutesAsleep?: string;
  minutesAwake?: string;
  minutesInSleepPeriod?: string;
  minutesToFallAsleep?: string;
}

export interface DailyRestingHeartRate {
  date?: CivilDate;
  beatsPerMinute?: string;
}

export interface ObservationSampleTime {
  physicalTime: string;
  utcOffset: string;
}

export interface Weight {
  sampleTime: ObservationSampleTime;
  weightGrams: number;
  notes?: string;
}

export interface BodyFat {
  sampleTime: ObservationSampleTime;
  percentage: number;
}

export interface DataPoint {
  name?: string;
  nutritionLog?: NutritionLog;
  food?: Food;
  hydrationLog?: HydrationLog;
  exercise?: Exercise;
  dailyRestingHeartRate?: DailyRestingHeartRate;
  weight?: Weight;
  bodyFat?: BodyFat;
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

export interface EnergyQuantityRollup {
  kcalSum?: number;
}

export interface WeightQuantityRollup {
  gramsSum?: number;
}

export interface NutritionLogRollupValue {
  energy?: EnergyQuantityRollup;
  totalFat?: WeightQuantityRollup;
  totalCarbohydrate?: WeightQuantityRollup;
  nutrients?: Array<{ nutrient?: string; quantity?: WeightQuantityRollup }>;
}

export interface HydrationLogRollupValue {
  amountConsumed?: { millilitersSum?: number };
}

export interface WeightRollupValue {
  weightGramsAvg?: number;
}

export interface BodyFatRollupValue {
  bodyFatPercentageAvg?: number;
}

export interface HeartRateRollupValue {
  beatsPerMinuteMin?: number;
  beatsPerMinuteAvg?: number;
  beatsPerMinuteMax?: number;
}

export interface ActiveMinutesRollupValue {
  activeMinutesRollupByActivityLevel?: Array<{
    activityLevel?: "ACTIVITY_LEVEL_UNSPECIFIED" | "LIGHT" | "MODERATE" | "VIGOROUS";
    activeMinutesSum?: string;
  }>;
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
