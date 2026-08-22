"""
OptiCab Fare Prediction Model
==============================
Run this locally once you have ~500+ rows in opticab-fare-actuals.

Requirements:
    pip install boto3 pandas scikit-learn lightgbm onnxmltools skl2onnx numpy

Usage:
    AWS_REGION=us-east-1 python train_fare_model.py

Output:
    ml/models/fare_model.onnx        — deploy this to your backend
    ml/models/fare_model_stats.json  — accuracy + filter report
"""

import json
import os
import sys
import boto3
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import lightgbm as lgb

# ─── Config ───────────────────────────────────────────────────────────────────

AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
TABLE_NAME  = 'opticab-fare-actuals'
MODEL_DIR   = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODEL_DIR, exist_ok=True)

PROVIDERS = ['Grab', 'TADA', 'Gojek', 'Ryde', 'ComfortDelGro']

FEATURES = [
    'distanceKm',
    'durationMin',
    'hour',
    'dayOfWeek',
    'wasRaining',
    'nearbyTaxis',
    'provider_encoded',
    'isPeakMorning',
    'isPeakEvening',
    'isLateNight',
    'isWeekend',
]

# ─── 1. Fetch data from DynamoDB ──────────────────────────────────────────────

def fetch_all_actuals():
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(TABLE_NAME)

    items = []
    response = table.scan()
    items.extend(response['Items'])

    while 'LastEvaluatedKey' in response:
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response['Items'])

    print(f"Fetched {len(items)} raw rows from DynamoDB.")
    return items

# ─── 2. Preprocess ────────────────────────────────────────────────────────────

def preprocess(items):
    df = pd.DataFrame(items)
    initial_count = len(df)
    filter_log = {}

    # Cast types
    df['actualFare']   = pd.to_numeric(df['actualFare'],   errors='coerce')
    df['estimatedFare']= pd.to_numeric(df.get('estimatedFare', pd.Series(dtype=float)), errors='coerce')
    df['distanceKm']   = pd.to_numeric(df['distanceKm'],   errors='coerce')
    df['durationMin']  = pd.to_numeric(df['durationMin'],  errors='coerce')
    df['hour']         = pd.to_numeric(df['hour'],         errors='coerce').fillna(12)
    df['dayOfWeek']    = pd.to_numeric(df['dayOfWeek'],    errors='coerce').fillna(1)
    df['nearbyTaxis']  = pd.to_numeric(df['nearbyTaxis'],  errors='coerce').fillna(15)
    df['wasRaining']   = df['wasRaining'].map(
        {True: 1, False: 0, 'true': 1, 'false': 0, 1: 1, 0: 0}
    ).fillna(0).astype(int)

    # Fill missing duration from distance (assume 30 km/h average)
    mask = df['durationMin'].isna() & df['distanceKm'].notna()
    df.loc[mask, 'durationMin'] = (df.loc[mask, 'distanceKm'] / 30 * 60).round()

    # ── Filter 1: Drop rows missing critical fields ───────────────────────────
    before = len(df)
    df = df.dropna(subset=['actualFare', 'provider', 'distanceKm'])
    filter_log['missing_fields'] = before - len(df)

    # ── Filter 2: Hard absolute bounds ───────────────────────────────────────
    # $5 floor (Singapore minimum across all providers)
    # $120 ceiling (airport + midnight surcharge worst case)
    before = len(df)
    df = df[(df['actualFare'] >= 5.0) & (df['actualFare'] <= 120.0)]
    filter_log['absolute_bounds'] = before - len(df)

    # ── Filter 3: Distance-based upper bound ─────────────────────────────────
    # Max realistic: distanceKm * $4.50 + $8 (covers all surcharges)
    # Min realistic: distanceKm * $0.50 + $4 (very short trips with booking fee)
    before = len(df)
    max_expected = df['distanceKm'] * 4.5 + 8
    min_expected = df['distanceKm'] * 0.5 + 4
    df = df[(df['actualFare'] <= max_expected) & (df['actualFare'] >= min_expected)]
    filter_log['distance_bounds'] = before - len(df)

    # ── Filter 4: Estimate cross-check ───────────────────────────────────────
    # If we have an OptiCab estimate, the reported fare should be within
    # 0.3x–3.0x of it. Catches typos like "125" instead of "12.5".
    before = len(df)
    has_estimate = df['estimatedFare'].notna() & (df['estimatedFare'] > 0)
    ratio = df.loc[has_estimate, 'actualFare'] / df.loc[has_estimate, 'estimatedFare']
    bad_ratio = has_estimate & ((ratio < 0.3) | (ratio > 3.0))
    df = df[~bad_ratio]
    filter_log['estimate_crosscheck'] = before - len(df)

    # ── Filter 5: Per-provider z-score outlier removal ───────────────────────
    # Remove rows where actualFare is more than 3 standard deviations
    # from the mean for that provider. Requires at least 10 rows per provider.
    before = len(df)
    def zscore_filter(group):
        if len(group) < 10:
            return group  # not enough data to compute meaningful stats
        mean = group['actualFare'].mean()
        std  = group['actualFare'].std()
        if std == 0:
            return group
        return group[np.abs(group['actualFare'] - mean) <= 3 * std]

    df = df.groupby('provider', group_keys=False).apply(zscore_filter).reset_index(drop=True)
    filter_log['zscore_outliers'] = before - len(df)

    # ── Filter 6: Median consensus per distance bucket + provider ─────────────
    # Group similar trips (same provider, similar distance, same time-of-day peak)
    # and drop rows more than $5 away from the group median.
    # Only applies when a group has at least 5 members.
    before = len(df)
    df['distanceBin']   = (df['distanceKm'] // 2) * 2   # 2km buckets
    df['isPeakEvening'] = ((df['hour'] >= 17) & (df['hour'] < 20)).astype(int)

    def median_consensus_filter(group):
        if len(group) < 5:
            return group
        median = group['actualFare'].median()
        return group[np.abs(group['actualFare'] - median) <= 5.0]

    df = df.groupby(
        ['provider', 'distanceBin', 'isPeakEvening'], group_keys=False
    ).apply(median_consensus_filter).reset_index(drop=True)
    filter_log['median_consensus'] = before - len(df)

    # ── Encode provider ───────────────────────────────────────────────────────
    le = LabelEncoder()
    le.fit(PROVIDERS)
    df['provider_encoded'] = le.transform(
        df['provider'].where(df['provider'].isin(PROVIDERS), 'Grab')
    )

    # ── Time features ─────────────────────────────────────────────────────────
    df['isPeakMorning'] = ((df['hour'] >= 7)  & (df['hour'] < 9)).astype(int)
    df['isPeakEvening'] = ((df['hour'] >= 17) & (df['hour'] < 20)).astype(int)
    df['isLateNight']   = ((df['hour'] >= 23) | (df['hour'] < 1)).astype(int)
    df['isWeekend']     = df['dayOfWeek'].isin([0, 6]).astype(int)

    # ── Summary ───────────────────────────────────────────────────────────────
    total_removed = initial_count - len(df)
    print(f"\nData quality report:")
    print(f"  Raw rows:              {initial_count}")
    for reason, count in filter_log.items():
        if count > 0:
            print(f"  Removed ({reason:<22}): {count}")
    print(f"  Clean rows for training: {len(df)}  ({100*len(df)/initial_count:.1f}% retained)")
    print(f"\nProvider distribution after filtering:")
    print(df['provider'].value_counts().to_string())

    return df, le, filter_log

# ─── 3. Train ─────────────────────────────────────────────────────────────────

def train(df):
    X = df[FEATURES].astype(float)
    y = df['actualFare'].astype(float)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    model = lgb.LGBMRegressor(
        n_estimators=300,
        learning_rate=0.05,
        max_depth=6,
        num_leaves=31,
        min_child_samples=10,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[
            lgb.early_stopping(50, verbose=False),
            lgb.log_evaluation(50),
        ],
    )

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2  = r2_score(y_test, y_pred)

    print(f"\nModel performance on test set:")
    print(f"  MAE = ${mae:.2f}  (average prediction error in dollars)")
    print(f"  R²  = {r2:.3f}   (1.0 = perfect fit)")

    # Per-provider MAE breakdown
    test_df = X_test.copy()
    test_df['actual']    = y_test.values
    test_df['predicted'] = y_pred
    print(f"\nPer-provider MAE:")
    for enc, name in enumerate(PROVIDERS):
        subset = test_df[test_df['provider_encoded'] == enc]
        if len(subset) > 0:
            p_mae = mean_absolute_error(subset['actual'], subset['predicted'])
            print(f"  {name:<16} MAE=${p_mae:.2f}  (n={len(subset)})")

    importance = pd.Series(
        model.feature_importances_, index=FEATURES
    ).sort_values(ascending=False)
    print(f"\nFeature importance:\n{importance.to_string()}")

    stats = {
        'mae':                round(float(mae), 4),
        'r2':                 round(float(r2), 4),
        'train_rows':         len(X_train),
        'test_rows':          len(X_test),
        'feature_importance': importance.round(4).to_dict(),
    }

    return model, stats

# ─── 4. Export to ONNX ────────────────────────────────────────────────────────

def export_onnx(model, stats, filter_log):
    """
    Exports model to ONNX format so Node.js (onnxruntime-node) can run
    inference in Vercel serverless functions without a Python runtime.
    """
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType
        import onnx

        initial_type = [('float_input', FloatTensorType([None, len(FEATURES)]))]
        onnx_model = convert_sklearn(model, initial_types=initial_type, target_opset=12)

        onnx_path = os.path.join(MODEL_DIR, 'fare_model.onnx')
        with open(onnx_path, 'wb') as f:
            f.write(onnx_model.SerializeToString())
        print(f"\nONNX model saved → {onnx_path}")

    except Exception as e:
        print(f"\nONNX export failed: {e}")
        print("Saving LightGBM native model instead (.txt)...")
        txt_path = os.path.join(MODEL_DIR, 'fare_model.txt')
        model.booster_.save_model(txt_path)
        print(f"LightGBM model saved → {txt_path}")

    # Always save stats + filter log
    stats['filter_log'] = filter_log
    stats_path = os.path.join(MODEL_DIR, 'fare_model_stats.json')
    with open(stats_path, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"Stats saved → {stats_path}")

# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    items = fetch_all_actuals()

    if len(items) < 100:
        print(f"\nOnly {len(items)} rows collected so far.")
        print("Need at least 100 to train meaningfully (500+ recommended).")
        print("Keep collecting feedback via the app and run this again later.")
        sys.exit(0)

    df, le, filter_log = preprocess(items)

    if len(df) < 50:
        print(f"\nOnly {len(df)} rows remain after filtering — too few to train reliably.")
        print("This may mean data quality is very low, or filtering thresholds are too strict.")
        sys.exit(0)

    model, stats = train(df)
    export_onnx(model, stats, filter_log)

    print("\nDone. Next step: load fare_model.onnx in fares.js using onnxruntime-node.")
