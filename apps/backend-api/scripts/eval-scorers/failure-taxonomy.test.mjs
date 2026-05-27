import assert from "node:assert/strict";
import test from "node:test";

import { summarizeFailureTaxonomy } from "./failure-taxonomy.mjs";

test("retains wrong_chunk and adds within-source subtype for same-collection distractor failures", () => {
  const summary = summarizeFailureTaxonomy([
    {
      id: "same-collection-case",
      bucket: "same_collection_distractor",
      failures: ["reranker_top:unrelated-chunk"],
    },
  ]);

  assert.equal(summary.classes.retrieval_quality, 1);
  assert.equal(summary.subtypes.wrong_chunk, 1);
  assert.equal(summary.subtypes.wrong_chunk_within_correct_source, 1);
  assert.deepEqual(summary.byBucketSubtypes.same_collection_distractor, {
    wrong_chunk: 1,
    wrong_chunk_within_correct_source: 1,
  });
  assert.deepEqual(summary.blockers, []);
});

test("does not refine wrong_chunk failures outside the same-collection guard bucket", () => {
  const summary = summarizeFailureTaxonomy([
    {
      id: "existing-case",
      bucket: "reranker_adversarial",
      failures: ["reranker_top:unrelated-chunk"],
    },
  ]);

  assert.equal(summary.subtypes.wrong_chunk, 1);
  assert.equal(summary.subtypes.wrong_chunk_within_correct_source, undefined);
});

test("classifies retrieval diagnostics expectation gaps as retrieval-quality coverage failures", () => {
  const summary = summarizeFailureTaxonomy([
    {
      id: "coverage-case",
      bucket: "same_domain_wrong_topic",
      failures: ["expectTrace.retrievalDiagnostics.coverageStatus expected \"complete\", got undefined"],
    },
  ]);

  assert.equal(summary.classes.retrieval_quality, 1);
  assert.equal(summary.subtypes.diagnostics_coverage, 1);
});

test("classifies evidence demand coverage gaps as structured evidence type gaps", () => {
  const summary = summarizeFailureTaxonomy([
    {
      id: "evidence-demand-coverage-case",
      bucket: "retrieval_evidence_type",
      failures: [
        'expectTrace.retrievalDiagnostics.candidatePool.evidenceDemandCoverage.deduped.status expected "covered", got "missing"',
      ],
    },
  ]);

  assert.equal(summary.classes.retrieval_quality, 1);
  assert.equal(summary.subtypes.wrong_evidence_type, 1);
  assert.equal(summary.subtypes.structured_evidence_coverage_gap, 1);
  assert.deepEqual(summary.byBucketSubtypes.retrieval_evidence_type, {
    wrong_evidence_type: 1,
    structured_evidence_coverage_gap: 1,
  });
});
