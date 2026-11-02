import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPARISON_MODELS,
  DEFAULT_COMPARISON_MODEL,
  modelEvidence,
  requireComparisonModel,
} from '../src/comparison-model.mjs';

test('exports exact supported models and legacy default', () => {
  assert.equal(DEFAULT_COMPARISON_MODEL, 'muse-spark-1.3');
  assert.deepEqual(COMPARISON_MODELS, [
    { id: 'muse-spark-1.3', label: 'Spark 1.3' },
    { id: 'muse-wonder-1.0', label: 'Wonder 1.0' },
  ]);
  assert.equal(requireComparisonModel(), 'muse-spark-1.3');
  assert.equal(requireComparisonModel(undefined), 'muse-spark-1.3');
  assert.equal(requireComparisonModel('muse-spark-1.3'), 'muse-spark-1.3');
  assert.equal(requireComparisonModel('muse-wonder-1.0'), 'muse-wonder-1.0');
});

test('rejects contributor, arbitrary, and non-string model values', () => {
  const rejected = [
    null,
    '',
    ' ',
    'muse-spark-1.2',
    'muse-wonder-1',
    'MUSE-SPARK-1.3',
    ' muse-spark-1.3',
    'muse-spark-1.3 ',
    'contributor-model',
    'contributor/muse-spark-1.3',
    'arbitrary-model-id',
    0,
    1,
    true,
    {},
    { id: 'muse-spark-1.3' },
    [],
    ['muse-spark-1.3'],
  ];

  for (const value of rejected) {
    assert.throws(() => requireComparisonModel(value), {
      name: 'Error',
      message: 'comparison_model_invalid',
    });
    assert.throws(() => modelEvidence(value, []), {
      name: 'Error',
      message: 'comparison_model_invalid',
    });
  }
});

test('model options are immutable', () => {
  assert.equal(Object.isFrozen(COMPARISON_MODELS), true);
  assert.ok(COMPARISON_MODELS.every((model) => Object.isFrozen(model)));
  assert.throws(() => {
    COMPARISON_MODELS.push({ id: 'arbitrary-model-id', label: 'Arbitrary' });
  }, TypeError);
  assert.throws(() => {
    COMPARISON_MODELS[0].id = 'arbitrary-model-id';
  }, TypeError);
  assert.deepEqual(COMPARISON_MODELS, [
    { id: 'muse-spark-1.3', label: 'Spark 1.3' },
    { id: 'muse-wonder-1.0', label: 'Wonder 1.0' },
  ]);
});

test('reports not_observed when there are no observations', () => {
  assert.deepEqual(modelEvidence('muse-spark-1.3'), {
    requested_model: 'muse-spark-1.3',
    observed_models: [],
    requests_observed: 0,
    unidentified_requests: 0,
    status: 'not_observed',
  });
  assert.deepEqual(modelEvidence('muse-wonder-1.0', []), {
    requested_model: 'muse-wonder-1.0',
    observed_models: [],
    requests_observed: 0,
    unidentified_requests: 0,
    status: 'not_observed',
  });
});

test('reports observed for exact matches and deduplicates in encounter order', () => {
  assert.deepEqual(
    modelEvidence('muse-wonder-1.0', [
      'muse-wonder-1.0',
      'muse-wonder-1.0',
    ]),
    {
      requested_model: 'muse-wonder-1.0',
      observed_models: ['muse-wonder-1.0'],
      requests_observed: 2,
      unidentified_requests: 0,
      status: 'observed',
    },
  );
});

test('reports partial when only unknown or matching plus unknown values occur', () => {
  assert.deepEqual(modelEvidence('muse-spark-1.3', ['unknown-provider-model']), {
    requested_model: 'muse-spark-1.3',
    observed_models: [],
    requests_observed: 1,
    unidentified_requests: 1,
    status: 'partial',
  });
  assert.deepEqual(
    modelEvidence('muse-spark-1.3', [
      'muse-spark-1.3',
      'unknown-provider-model',
      null,
      { model: 'muse-spark-1.3' },
      42,
    ]),
    {
      requested_model: 'muse-spark-1.3',
      observed_models: ['muse-spark-1.3'],
      requests_observed: 5,
      unidentified_requests: 4,
      status: 'partial',
    },
  );
});

test('reports mismatch and gives known mismatch precedence over partial', () => {
  assert.deepEqual(
    modelEvidence('muse-spark-1.3', [
      'muse-wonder-1.0',
      'muse-spark-1.3',
      'muse-wonder-1.0',
    ]),
    {
      requested_model: 'muse-spark-1.3',
      observed_models: ['muse-wonder-1.0', 'muse-spark-1.3'],
      requests_observed: 3,
      unidentified_requests: 0,
      status: 'mismatch',
    },
  );
  assert.equal(
    modelEvidence('muse-spark-1.3', [
      'unknown-provider-model',
      'muse-wonder-1.0',
    ]).status,
    'mismatch',
  );
});

test('never returns unknown raw model, path, or credential strings', () => {
  const unknownValues = [
    'unknown-provider-model-secret',
    '/private/path/model',
    'credential-value',
  ];
  const result = modelEvidence('muse-spark-1.3', unknownValues);
  const serialized = JSON.stringify(result);

  for (const value of unknownValues) {
    assert.equal(serialized.includes(value), false);
  }
  assert.deepEqual(result, {
    requested_model: 'muse-spark-1.3',
    observed_models: [],
    requests_observed: 3,
    unidentified_requests: 3,
    status: 'partial',
  });
});

test('enforces bounded array observations', () => {
  const atLimit = Array(8192).fill('muse-spark-1.3');
  assert.equal(modelEvidence('muse-spark-1.3', atLimit).requests_observed, 8192);
  assert.equal(modelEvidence('muse-spark-1.3', atLimit).status, 'observed');

  for (const observations of [
    Array(8193).fill('muse-spark-1.3'),
    null,
    'muse-spark-1.3',
    {},
    8192,
  ]) {
    assert.throws(() => modelEvidence('muse-spark-1.3', observations), {
      name: 'Error',
      message: 'comparison_model_evidence_invalid',
    });
  }
});
