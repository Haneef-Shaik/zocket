
# Dashboard Agent — Production Design

## 1. Overview

The Dashboard Agent provides a natural-language interface over marketing and advertising performance data. A user asks a business question in plain language, and the system determines whether the question can be answered from the available data, constructs an analytical plan, executes deterministic calculations against trusted data, validates the result, and returns a concise finding together with an appropriate visualization and evidence of how the result was produced.

The core design principle is:

> **The LLM is responsible for interpreting the user's intent and selecting an analysis strategy. It is not the source of truth for numerical results.**

The system therefore separates probabilistic reasoning from deterministic data access and computation.

The production system is designed for a few hundred teams with strict tenant isolation, reproducible answers, observable execution, controlled costs, and the ability to detect regressions when prompts, models, semantic definitions, or data change.

The supplied exercise contains four CSV datasets covering daily advertising performance, campaigns, creatives, and FX rates. The raw advertising data contains spend and revenue in campaign currency, while daily FX rates provide conversion to USD.

---

## 2. Design Principles

### 2.1 Numbers come from the data layer

The LLM must never invent or independently calculate business metrics when deterministic computation is possible.

For example:

```text
Revenue / Spend = ROAS
```

should be calculated by the analytics layer rather than by asking the model to perform arithmetic.

### 2.2 Business definitions are centralized

Definitions such as ROAS, revenue, spend, conversion rate, and currency normalization belong in a semantic/metrics layer.

The model selects from those definitions; it does not redefine them.

### 2.3 Raw data and analytical models are separated

Raw source data remains immutable. A canonical analytical model provides a stable interface for queries and hides repeated joins, currency conversion, and other business logic from the agent.

### 2.4 The system must be able to say "I don't know"

If the available data cannot support an answer, the system should explicitly state that limitation rather than produce a plausible answer.

### 2.5 Every answer should be reproducible

A numerical answer should be traceable to:

```text
Question
→ interpretation
→ query plan
→ compiled query
→ data version
→ deterministic calculation
→ result
→ final explanation
```

### 2.6 Minimize the LLM's authority

Anything related to security, authorization, tenant isolation, metric definitions, numerical calculations, and data validation remains outside the model's control.

---

## 3. Production Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                         PRESENTATION                             │
│                                                                  │
│ Chat UI │ Dashboard │ Charts │ Tables │ Evidence │ Exports      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         API / APPLICATION                        │
│                                                                  │
│ Authentication │ Tenant Context │ Authorization │ Rate Limits    │
│ Conversation Management │ Request Validation                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      AGENT ORCHESTRATOR                          │
│                                                                  │
│ Intent Understanding │ Answerability │ Planning │ Tool Selection │
└───────────────┬───────────────────────────────┬──────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────┐       ┌──────────────────────────────┐
│     Semantic Layer       │       │      Knowledge Layer         │
│                          │       │                              │
│ Metrics                  │       │ Metric definitions           │
│ Dimensions               │       │ Business terminology         │
│ Relationships            │       │ Documentation / methodology  │
│ Business rules           │       │                              │
└─────────────┬────────────┘       └──────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    TYPED QUERY / ANALYSIS PLAN                   │
│                                                                  │
│ Metric │ Dimensions │ Filters │ Time Range │ Comparison │ Intent │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    QUERY VALIDATION / COMPILER                   │
│                                                                  │
│ Authorization │ Schema validation │ Metric validation            │
│ Tenant scoping │ Query safety │ SQL generation                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                       ANALYTICS SERVICE                          │
│                                                                  │
│ SQL Execution │ Metric Calculation │ Data Quality │ Aggregation  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     ANALYTICAL WAREHOUSE                         │
│                                                                  │
│ Canonical tables / views │ Historical data │ Tenant isolation    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    RESULT VALIDATION                             │
│                                                                  │
│ Completeness │ Type checks │ Business invariants │ Anomalies     │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                RESPONSE / VISUALIZATION LAYER                    │
│                                                                  │
│ Verified Result → Chart Specification → Chart Rendering          │
│ Verified Result → LLM Explanation → Finding                      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         USER RESPONSE                            │
│                                                                  │
│ Finding │ Chart │ Supporting Data │ Methodology │ Evidence       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. End-to-End Request Path

Consider:

> "What did we spend by channel over the last eight weeks?"

### Step 1 — Authentication and tenant context

The API authenticates the user and establishes:

```text
user_id
tenant_id
permissions
conversation_id
```

The tenant identity comes from the authenticated request context. It is never supplied or selected by the LLM.

### Step 2 — Agent interpretation

The agent interprets the question:

```text
Intent:
spend_by_channel

Metric:
spend

Dimension:
channel

Time:
last 8 weeks

Currency:
USD
```

The model may resolve natural-language concepts such as "last eight weeks" or "by channel", but only against the available semantic model.

### Step 3 — Answerability check

Before execution, the system checks:

- Does the metric exist?
- Does the requested dimension exist?
- Is the required time range available?
- Is the required data available?
- Does the user have access?
- Are required joins and transformations defined?

If any required capability is unavailable, the system returns an explicit limitation.

### Step 4 — Typed analytical plan

The model produces a structured representation rather than directly controlling the database.

Example:

```json
{
  "metric": "spend_usd",
  "group_by": ["channel"],
  "time_range": {
    "type": "relative",
    "value": 8,
    "unit": "weeks"
  }
}
```

### Step 5 — Validation

The application validates the plan against the semantic model.

The model cannot introduce:

- arbitrary metrics
- unauthorized dimensions
- unknown tables
- unsupported calculations
- another tenant's identifiers

### Step 6 — Query compilation

The validated plan is converted into SQL by deterministic application code.

The compiler owns:

- table selection
- joins
- tenant filters
- metric expressions
- currency conversion
- aggregation
- query limits

### Step 7 — Query execution

The analytics service executes the query against the analytical warehouse.

The LLM is not sent the raw dataset. Only the aggregated result required for answering the question is returned.

### Step 8 — Result validation

The result is checked for:

- expected schema
- correct data types
- missing data
- unexpected nulls
- business invariants
- data freshness
- calculation validity

### Step 9 — Visualization

The system creates a structured chart specification from the verified result:

```json
{
  "type": "bar",
  "x": "channel",
  "y": "spend_usd"
}
```

A deterministic rendering service then produces the chart.

### Step 10 — Explanation

The LLM receives the verified result and relevant provenance and produces the written finding.

It does not receive authority to change the numbers.

### Step 11 — Response

The user receives:

```text
Finding

[Chart]

Supporting data

How this was calculated

Source / provenance
```

---

## 5. Fixed vs. Model-Decided Responsibilities

The primary rule is:

> **The model can decide what the user means and which supported analysis is appropriate; deterministic services decide anything affecting correctness, security, or business definitions.**

| Responsibility | Owner |
|---|---|
| Interpret natural language | LLM |
| Resolve supported business terminology | LLM + semantic layer |
| Select metric | LLM, constrained by semantic layer |
| Select dimensions | LLM, constrained by semantic layer |
| Select time range | LLM, validated by application |
| Determine answerability | Application + semantic layer |
| Tenant identity | Application |
| Authorization | Application |
| Metric definitions | Semantic layer |
| Currency conversion | Analytics layer |
| SQL compilation | Application |
| SQL safety | Application |
| Data access | Analytics service |
| Arithmetic | Analytics service |
| Aggregation | Database |
| Data quality validation | Application |
| Chart selection | LLM within supported chart types |
| Chart rendering | Deterministic renderer |
| Written explanation | LLM |
| Provenance | Application |

This boundary prevents the model from becoming the authority over data correctness.

---

## 6. Data Architecture

The production system should not be built around CSV files.

CSV is an ingestion format for the exercise. In production, source data should flow through an ingestion and transformation pipeline.

```text
External Sources
      │
      ▼
   Ingestion
      │
      ▼
 Raw Data Storage
      │
      ▼
 Transform / Validate
      │
      ▼
 Canonical Data Model
      │
      ▼
 Analytical Warehouse
      │
      ├───────────────┐
      ▼               ▼
 Semantic Layer    Data Quality
      │
      ▼
 Analytics Service
```

The raw source data should remain available for audit/reprocessing, while the agent should query curated analytical tables or views.

### Canonical analytical model

A canonical model can expose a logical dataset such as:

```text
campaign_daily_performance
```

containing:

```text
date
campaign_id
campaign_name
creative_id
channel
objective

impressions
clicks
conversions

currency
spend
revenue

fx_rate
spend_usd
revenue_usd
```

The underlying raw data contains campaign, creative, daily performance, and FX information.

This canonical layer prevents every query from having to independently reconstruct the same joins and transformations.

---

## 7. Semantic and Metrics Layer

The semantic layer is a critical trust boundary.

It defines what the business means by a metric.

Example:

```yaml
metrics:

  spend_usd:
    source: ad_performance_daily
    expression: spend * daily_fx_rate
    aggregation: sum
    unit: USD

  revenue_usd:
    source: ad_performance_daily
    expression: revenue * daily_fx_rate
    aggregation: sum
    unit: USD

  conversions:
    source: ad_performance_daily
    expression: conversions
    aggregation: sum

  roas:
    expression: revenue_usd / spend_usd
    unit: ratio
```

It also defines:

```text
Dimensions
Relationships
Allowed filters
Time semantics
Currency rules
Data availability
Business terminology
```

The LLM can select:

```text
spend_usd
```

but cannot redefine it.

This is particularly important because the provided data stores spend and revenue in campaign currency and provides daily FX rates separately.

---

## 8. Query Strategy

There are three possible approaches.

### Option A — LLM generates arbitrary SQL

```text
Question
→ LLM
→ SQL
→ Database
```

Advantages:

- simple
- flexible
- quick to build

Risks:

- hallucinated columns
- incorrect joins
- incorrect aggregations
- incorrect metric definitions
- SQL security concerns
- difficult validation

### Option B — LLM generates a typed analytical plan

```text
Question
→ LLM
→ Typed Query Plan
→ Validator
→ SQL Compiler
→ Database
```

Advantages:

- strongly constrained
- easier to validate
- reproducible
- business definitions remain centralized
- safer for multi-tenancy

Cost:

- requires a semantic layer and query compiler

### Production decision

Use **Option B**.

The LLM should express *what analysis is required*, not directly own the mechanics of accessing the database.

For the initial MVP, constrained SQL generation can be used to reduce implementation time, but the production architecture should move toward a typed semantic query interface.

---

## 9. Agent Architecture

A single orchestrator is preferable to multiple independent agents.

```text
                  Analytics Agent
                        │
        ┌───────────────┼────────────────┐
        │               │                │
        ▼               ▼                ▼
  Semantic Tool    Analysis Tool    Knowledge Tool
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                 Result Validation
```

A multi-agent architecture would introduce additional:

- latency
- token cost
- state management
- debugging complexity
- failure modes

without inherently improving numerical correctness.

The system's hard problem is controlled analytical execution rather than coordination between autonomous agents.

A future architecture could split the planner, analyst, and explanation responsibilities if scale or domain complexity requires it, but this is not the default.

---

## 10. Trust, Correctness and Grounding

The system uses several independent trust barriers.

```text
LLM
 │
 ▼
Structured Analysis Plan
 │
 ▼
Semantic Validation
 │
 ▼
Authorization
 │
 ▼
Query Compiler
 │
 ▼
Database
 │
 ▼
Deterministic Calculation
 │
 ▼
Result Validation
 │
 ▼
Provenance
 │
 ▼
LLM Explanation
```

### Numerical correctness

Numerical claims are always generated from executed queries or deterministic calculations.

The LLM cannot substitute its own value.

For example:

```text
Database:
revenue_usd = 12,540,000
spend_usd   = 10,200,000

Analytics layer:
ROAS = 1.2294

LLM:
"ROAS was approximately 1.23x."
```

The model is only verbalizing the verified result.

### Result validation

The analytics service should check:

- schema
- types
- nullability
- missing dates
- duplicate records
- expected relationships
- business invariants
- metric-specific sanity checks

For example, where applicable:

```text
clicks <= impressions
conversions <= clicks
```

### Data quality failures

A query can succeed technically while producing an unreliable business result.

For example:

```text
Missing FX rate
Missing day
Unexpected duplicate
Incomplete ingestion
```

These should result in a warning, degraded-confidence response, or refusal depending on severity.

---

## 11. Provenance and Reproducibility

Every analytical request should generate a provenance record.

Example:

```json
{
  "request_id": "req_123",
  "tenant_id": "tenant_456",
  "data_version": "2026-09-04",
  "semantic_model_version": "v12",
  "query_plan": {},
  "compiled_query": "...",
  "source_tables": [
    "campaign_daily_performance"
  ],
  "filters": {},
  "calculation_version": "v3",
  "model": "model-name",
  "prompt_version": "analytics-v8"
}
```

This enables an answer to be reproduced after the fact.

The user-facing response should expose an appropriate subset:

```text
How this was calculated
Source data
Date range
Filters
Metric definition
Query / transformation
```

while internal tracing retains the full execution record.

---

## 12. Handling Unanswerable Questions

Answerability is a first-class system state.

Possible states:

```text
ANSWERABLE
INSUFFICIENT_DATA
AMBIGUOUS
DATA_QUALITY_FAILURE
PERMISSION_DENIED
```

The system should first determine whether the required evidence exists.

For example:

> "How does our spend compare to our competitors?"

If no competitor data is present, the system should not infer or fabricate competitor values.

The appropriate response is:

```text
I can't answer this from the available data.

The current dataset contains our campaign performance,
but does not contain competitor spend data.
```

This is preferable to an answer that sounds reasonable but is unsupported.

The assignment explicitly includes a competitor-spend question and asks the system to handle questions that cannot be answered from available data.

---

## 13. Multi-Tenant Isolation

The production system targets a few hundred teams, so tenant isolation must be enforced outside the LLM.

The request flow is:

```text
Authenticated User
       │
       ▼
Identity / Authorization
       │
       ▼
tenant_id
       │
       ▼
Query Service
       │
       ▼
Tenant-scoped Data Access
       │
       ▼
Warehouse
```

The tenant identifier must never depend on a model-generated SQL predicate.

Depending on the warehouse, isolation could be implemented using:

- row-level security
- tenant-scoped schemas
- separate datasets
- service-level authorization
- combinations of these

### Non-obvious leakage points

Tenant isolation must also cover:

```text
Query result cache
LLM context
Conversation history
Semantic context cache
Vector store
Generated charts
Exports
Logs
Traces
Error messages
Background jobs
Temporary files
```

For example, a cache key should include tenant identity:

```text
cache_key =
tenant_id
+
semantic_model_version
+
query_hash
```

rather than only:

```text
query_hash
```

---

## 14. Cost and Latency

The target described in the assignment is approximately:

```text
500 users
× 20 questions/day
= 10,000 questions/day
≈ 300,000 questions/month
```

The dominant variable cost is expected to be model inference rather than analytical SQL execution.

The system should therefore minimize unnecessary model work.

### Cost strategy

```text
Question
   │
   ▼
Can it be answered from cache?
   │
   ├── Yes → return verified cached result
   │
   └── No
        │
        ▼
Lightweight routing/planning
        │
        ▼
Deterministic analytics
        │
        ▼
LLM explanation
```

Optimization priorities:

1. Cache repeated analytical queries.
2. Keep aggregation inside the database.
3. Never send complete datasets to the LLM unnecessarily.
4. Use smaller models for straightforward routing/planning.
5. Reserve expensive reasoning for ambiguous or complex questions.
6. Cache semantic metadata.
7. Cache immutable historical query results where safe.

Latency should be decomposed into:

```text
API latency
+
LLM planning latency
+
query latency
+
validation latency
+
chart generation
+
LLM explanation latency
```

This makes optimization measurable rather than speculative.

---

## 15. Change Safety and Evaluation

Prompt and model changes should be treated as production changes.

A request should be reproducible using:

```text
model version
prompt version
semantic model version
query compiler version
calculation version
data version
```

### Golden evaluation set

Maintain a version-controlled collection of representative questions:

```text
question
expected intent
expected query semantics
expected result
expected answerability
```

For example:

```text
Q1:
What did we spend by channel over the last eight weeks?

Q2:
Which campaign generated the most revenue this quarter?

Q3:
How does our spend compare to our competitors?
```

The evaluation should test:

```text
Intent accuracy
Query-plan accuracy
Numerical accuracy
Abstention accuracy
Grounding/provenance
```

A prompt change should not be promoted merely because the output sounds better.

Example:

```text
Prompt v7
Golden-set accuracy: 94%

Prompt v8
Golden-set accuracy: 89%
```

Prompt v8 should be rejected or investigated.

This provides an objective mechanism for determining whether a reported regression is real. The assignment specifically calls for a mechanism to evaluate changes to prompts and determine whether answers have become worse.

---

## 16. Observability

Every request should produce structured telemetry.

```text
Request
 │
 ├── request_id
 ├── tenant_id
 ├── model
 ├── prompt_version
 ├── semantic_version
 ├── query_plan
 ├── query_hash
 ├── query_latency
 ├── model_latency
 ├── token usage
 ├── cost
 ├── validation result
 ├── answerability state
 └── final result
```

Key production metrics:

```text
p50/p95/p99 latency
LLM latency
database latency
tool failure rate
query failure rate
validation failure rate
abstention rate
cost per request
cost per tenant
answer accuracy
user feedback
```

This also provides the evidence required to investigate incorrect answers.

---

## 17. Security

The LLM should operate with the minimum possible authority.

The model should not have:

```text
direct database credentials
write access
administrative permissions
tenant-selection authority
arbitrary network access
```

The preferred architecture is:

```text
LLM
 ↓
Controlled tool
 ↓
Validated request
 ↓
Authorized service
 ↓
Read-only analytics access
```

Database credentials remain within the backend analytics service.

Generated SQL should be restricted to safe analytical operations.

---

## 18. Visualization Architecture

Visualization should be treated as a deterministic rendering problem.

The model may recommend:

```json
{
  "type": "line",
  "x": "date",
  "y": "conversions"
}
```

but the application validates the chart specification and renders the chart.

Supported chart types can initially be limited to:

```text
bar
line
area
table
```

This prevents the LLM from generating arbitrary executable visualization code.

The chart is generated from the same verified result used for the written finding, ensuring that the visual and textual answer cannot silently diverge.

---

## 19. Caching

Caching should exist at multiple levels.

### Semantic cache

Cache:

```text
metric definitions
dimension definitions
schema metadata
```

### Query-result cache

Cache deterministic results using:

```text
tenant
+
query hash
+
data version
+
semantic version
```

### Conversation cache

Conversation context may be cached for user experience, but must remain tenant-scoped.

Caching should never bypass authorization or result freshness requirements.

---

## 20. Failure Modes

| Failure | Response |
|---|---|
| Unknown metric | Explain unsupported metric |
| Missing data | Explain missing evidence |
| Ambiguous question | Ask clarification |
| Missing FX rate | Flag data-quality issue |
| Query validation failure | Do not execute |
| Database failure | Return service error |
| Result validation failure | Do not present unsupported result |
| Unauthorized tenant access | Reject request |
| Model hallucination | Prevent through structured output and validation |
| Chart generation failure | Return verified table/finding without chart |
| LLM unavailable | Where possible, return deterministic data/query output |

The important property is **fail closed for correctness and security**.

---

## 21. Production Technology Choices

The exact vendors can vary; the architectural interfaces are more important.

A representative implementation could use:

```text
Frontend
    React / Next.js

API
    FastAPI

Agent orchestration
    Application-owned orchestration
    + structured LLM output

Semantic layer
    Version-controlled metric definitions

Analytics
    SQL-based analytical service

Warehouse
    Snowflake / BigQuery / ClickHouse / equivalent

Raw storage
    Object storage

Cache
    Redis

Observability
    OpenTelemetry + metrics/logging/tracing platform

Evaluation
    Version-controlled golden dataset
    + automated evaluation runner
```

For the exercise dataset, DuckDB is a suitable local implementation of the analytical interface, but production should not depend on CSV files.

I would avoid introducing an agent framework unless it materially improves the implementation. A simple application-owned orchestration loop provides more control and makes the trust boundary explicit.

---

## 22. V1 Cuts and Their Cost

The production design deliberately does not require every possible capability in the first product version.

### Excluded from V1

#### Fully autonomous multi-agent workflows

Not necessary for the core analytical problem.

**Future cost:** More sophisticated orchestration may require redesigning interfaces between planning and execution.

#### Arbitrary SQL

The production design prefers a typed analytical plan.

**Future cost:** Supporting arbitrary analytical questions may require extending the semantic/query language.

#### Real-time streaming analytics

Initial product can operate on periodically refreshed analytical data.

**Future cost:** Moving to real-time data requires freshness guarantees, incremental processing, and more complex consistency semantics.

#### Advanced predictive analytics

Forecasting and causal inference are different analytical problems from descriptive dashboard questions.

**Future cost:** Additional statistical models, validation, and confidence semantics.

#### Fully autonomous recommendations

Recommendations such as "turn this campaign off" require business policy, risk tolerance, and potentially experimentation data.

**Future cost:** A recommendation framework with explicit policies and human approval.

#### Complex cross-source knowledge retrieval

Documentation/RAG can be added for methodology and business context.

**Future cost:** Maintaining synchronization between business documentation and metric definitions.

These cuts intentionally keep the initial system focused on trusted descriptive analytics while leaving clear extension points.

---

## 23. Key Architectural Decisions

| Decision | Choice | Reason |
|---|---|---|
| Raw CSV as production data source | No | CSV is an ingestion format, not the analytical system |
| Analytical database | Yes | Deterministic, scalable analytical execution |
| Semantic layer | Yes | Centralizes business definitions |
| LLM directly owns calculations | No | Numerical trust |
| LLM directly controls DB | No | Security and correctness |
| Free-form SQL | Limited in MVP | Useful for speed, but constrained in production |
| Typed query plan | Production | Validation and reproducibility |
| Multiple agents | No by default | Adds complexity without solving the core trust problem |
| RAG for numerical answers | No | Structured analytics is more appropriate |
| RAG for definitions/docs | Yes, when needed | Useful for contextual knowledge |
| LLM-generated charts | Specification only | Rendering should be deterministic |
| Provenance | Required | Reproducibility and debugging |
| Automated evaluation | Required | Prevent regressions |
| Tenant enforcement | Application/data layer | Must not depend on model behavior |

---

## 24. Production Request Example

For:

> "Which campaign should we turn off?"

The system should not simply ask the LLM for a recommendation.

Instead:

```text
User Question
      │
      ▼
Interpretation:
"Identify underperforming campaigns"
      │
      ▼
Semantic Model:
Spend + Revenue + ROAS + Conversions
      │
      ▼
Business Policy:
Candidate requires sufficient spend/data
      │
      ▼
Deterministic Analysis
      │
      ▼
Campaign metrics
      │
      ▼
Ranking / candidate selection
      │
      ▼
Result validation
      │
      ▼
LLM explanation
```

The final answer should distinguish between:

```text
Observed fact:
Campaign X has the lowest ROAS.

Derived recommendation:
Campaign X is the strongest candidate for review.
```

It should not turn a statistical observation into an unconditional business action without an explicit policy.

---

## 25. Summary

The production Dashboard Agent should be designed as a **trusted analytics system with an LLM interface**, rather than as a chatbot that happens to query data.

The core architecture is:

```text
Natural Language
      ↓
LLM Interpretation
      ↓
Semantic Layer
      ↓
Typed Analytical Plan
      ↓
Validation + Authorization
      ↓
Query Compiler
      ↓
Analytical Warehouse
      ↓
Deterministic Calculation
      ↓
Result Validation
      ↓
Provenance
      ↓
Chart + LLM Explanation
      ↓
User
```

The fundamental trust boundary is:

> **The model determines what should be analyzed; deterministic systems determine what the data says.**

This architecture provides a clear path from the supplied four-CSV exercise to a production multi-tenant system while preserving the properties the assignment is primarily evaluating: coherent architectural tradeoffs, numerical correctness, grounding, honest handling of unavailable information, operational safety, and controlled scope. The assignment explicitly weights architecture/tradeoffs and correctness/trust most heavily, at 30 points each.
