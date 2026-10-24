-- Full database schema. Every statement is idempotent, so `npm run script scripts/db-migrate.ts`
-- can run any number of times. The migration splits this file on semicolons at line ends,
-- so keep semicolons out of comments and string literals.

-- Merchants and their fixed limits
create table if not exists merchants (
  id text primary key,                         -- 'demo' or a Whop biz_ id
  name text not null,
  whop_account_id text,
  mode text not null default 'demo',           -- demo | sandbox | live
  max_refund_cents int not null default 10000,
  max_daily_refund_cents int not null default 30000,
  created_at timestamptz not null default now()
);

-- A merchant's refund policy. Versions are frozen: the executor re-checks the hash.
create table if not exists policies (
  id serial primary key,
  merchant_id text not null references merchants(id),
  version int not null,
  text text not null,
  sha256 text not null,
  frozen_at timestamptz not null default now(),
  unique (merchant_id, version)
);

-- A refund request and everything needed to decide it
create table if not exists cases (
  id text primary key,
  merchant_id text references merchants(id),
  policy_id int references policies(id),
  set_name text not null,                      -- dev | eval | gold | live | demo
  whop_payment_id text,                        -- live and sandbox cases only
  product text,
  amount_cents int,
  purchased_at timestamptz,
  requested_at timestamptz,
  facts jsonb not null,                        -- the full case card as shown to deciders and reviewers
  customer_statement text,
  merchant_statement text,
  expected jsonb,                              -- gold cases only
  hidden jsonb,                                -- designer notes for prepared cases, never shown to deciders
  status text not null default 'new',          -- new | decided | appealed | in_review | resolved | out_of_scope
  created_at timestamptz not null default now()
);
create index if not exists cases_set_name_idx on cases (set_name);

-- One decision per case and agent version
create table if not exists decisions (
  id serial primary key,
  case_id text not null references cases(id),
  agent_version text not null,                 -- v1 | v2
  decision text not null,                      -- approve | deny | out_of_scope
  clauses text[],
  reason text,
  votes jsonb,
  dissent jsonb,
  policy_sha256 text,
  notes_version text,
  meta jsonb,                                  -- token usage, latency, model
  created_at timestamptz not null default now(),
  unique (case_id, agent_version)
);

-- Evidence gathered for a case
create table if not exists evidence (
  id serial primary key,
  case_id text references cases(id),
  kind text not null,                          -- solari_check | exa_terms | customer_upload
  summary text,
  url text,
  http_status int,
  screenshot_url text,
  captured_at timestamptz not null default now(),
  raw jsonb
);
create index if not exists evidence_case_id_idx on evidence (case_id);

-- Requests for human reviewers
create table if not exists terac_jobs (
  id serial primary key,
  purpose text not null,                       -- eval_round | live_review
  request_id text,
  opportunity_id text,
  num_participants int,
  quoted_cents_per_participant int,
  status text not null,                        -- quoted | launched | paused | completed | refused_budget
  meta jsonb,
  created_at timestamptz not null default now()
);

-- One row per reviewer and case. Raw page events stay in task_responses.
create table if not exists reviews (
  id serial primary key,
  case_id text not null references cases(id),
  terac_submission_id text not null,
  task_id text,
  decision text not null,                      -- approve | deny | need_more_evidence
  reason text,
  confidence int,
  is_gold boolean not null default false,
  gold_passed boolean,
  seconds_spent int,
  created_at timestamptz not null default now(),
  unique (case_id, terac_submission_id)
);

-- Refund executions. At most one per case.
create table if not exists executions (
  id serial primary key,
  case_id text unique references cases(id),
  idempotency_key text unique not null,
  whop_payment_id text,
  whop_refund_id text,
  amount_cents int,
  environment text,                            -- sandbox | live
  status text not null,                        -- blocked | submitted | succeeded | failed
  block_reason text,
  created_at timestamptz not null default now()
);

-- Work queue for the worker
create table if not exists jobs (
  id serial primary key,
  kind text not null,                          -- provision | evidence | review | aggregate | execute | learn
  case_id text,
  payload jsonb,
  status text not null default 'queued',       -- queued | running | done | failed
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  last_error text,
  locked_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jobs_status_run_after_idx on jobs (status, run_after);

-- Interpretation notes learned from development cases. The policy text never changes.
create table if not exists agent_notes (
  id serial primary key,
  version text not null,                       -- v2
  notes text not null,
  examples jsonb,
  source_case_ids text[],                      -- all must be development cases
  created_at timestamptz not null default now()
);

-- Purchase links for each offer in each Whop environment
create table if not exists offers (
  sku text not null,                           -- pilot | review_pack
  env text not null,                           -- live | sandbox
  checkout_config_id text not null,
  purchase_url text not null,
  price_cents int not null,
  created_at timestamptz not null default now(),
  primary key (sku, env)
);

-- Existing tables: verified, de-duplicated webhook events
alter table webhook_events add column if not exists webhook_id text;
alter table webhook_events add column if not exists env text;
alter table webhook_events add column if not exists verified boolean default false;
create unique index if not exists webhook_events_webhook_id_key on webhook_events (webhook_id);

-- Existing tables: sandbox ledger rows never count as revenue
alter table ledger add column if not exists env text default 'live';
