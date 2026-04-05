# Concierge Platform

A simplified concierge orchestration platform inspired by GoGoGrandparent.

**Core idea:** Accept a user request via phone → interpret it → dispatch to an external provider → track execution → reconcile final outcome.

## Services

| Service | Port | Responsibility |
|---|---|---|
| api-service | 4000 | Entry point, job creation, idempotency |
| worker-service | — | Queue consumer, provider execution, retries |
| webhook-service | 4001 | Provider callbacks, reconciliation |
| ivr-service | 4002 | Twilio IVR, intent mapping |

## Tech Stack

- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express
- **ORM**: Prisma 5 + MySQL
- **Queue**: BullMQ (local) / AWS SQS (production)
- **Telephony**: Twilio
- **Infrastructure**: Docker Compose (local) / EC2 + RDS (production)

## High Level Design
```mermaid
flowchart TD

  subgraph CALLER["Entry Layer"]
    A([Senior Caller - Any phone])
    B[Twilio - Phone Number + DTMF]
    C[ngrok tunnel - dev only]
  end

  subgraph IVR["IVR Service"]
    D[POST /ivr/voice - greeting + menu]
    E[POST /ivr/menu - digit handler]
    F{Intent mapping\n1=ride 2=food\n7=grocery 0=operator}
  end

  subgraph API["API Service"]
    G[POST /jobs - create job]
    H{Idempotency check\nSELECT by idempotency_key}
    H_EXIT([Return existing job\nno reprocessing])
    I[(MySQL - RDS\njobs table\nwebhook_events table)]
    J[GET /jobs/:id - poll status]
  end

  subgraph QUEUE["Queue Layer\nat-least-once delivery\nall consumers are idempotent"]
    K[SQS main queue - BullMQ local]
    L[SQS DLQ - dead letter queue]
  end

  subgraph WORKER["Worker Service"]
    M[Consume message]
    N[Load job from DB]
    GUARD{status = completed\nor failed?}
    GUARD_EXIT([Exit - idempotency guard])
    O{Atomic claim\nUPDATE SET status=in_progress\nclaimed_by=workerId\nclaimed_at=NOW\nWHERE status=pending}
    O_EXIT([Exit - another worker owns it])
    ERR_CLASS{isRetryable\nerror?}
    P[Call provider API\npass idempotency_key\nto provider]
    Q{Response?}
    R[Mark completed\nUPDATE WHERE status=in_progress\npersist provider_job_id]
    S{attempts_count\n< max_attempts?}
    T[Increment attempts\nlog last_error]
    T_NONRETRY[Mark failed immediately\nno retry - non-retryable error]
    U[Mark failed\nsend to DLQ]
  end

  subgraph RECONCILE["Reconciliation - Scheduled Job\ncron scans every N minutes"]
    RC_SCAN[Find jobs WHERE\nstatus=in_progress\nAND claimed_at < NOW - timeout]
    RC_QUERY[Query provider - READ ONLY\nno new side effects]
    RC_FIX[Correct DB state\nstrict transition enforcement]
    RC_RECLAIM[Reset to pending\nfor retry if provider unaware]
  end

  subgraph PROVIDERS["External Providers"]
    V[Uber sim - mock ride API\naccepts idempotency_key]
    W[DoorDash sim - mock delivery API\naccepts idempotency_key]
  end

  subgraph WEBHOOK["Webhook Service"]
    X[POST /webhooks/provider\nreceive callback]
    Y{Verify HMAC\nsignature}
    Y_REJECT([Reject 400\nlog security violation\nDO NOT send to DLQ])
    DEDUP{event_id in\nwebhook_events table?}
    DEDUP_EXIT([Exit - duplicate webhook])
    DEDUP_STORE[INSERT event_id\ninto webhook_events]
    Z[Find job by provider_job_id]
    AA[Update status\nUPDATE WHERE status=in_progress\nstrict transition enforcement]
    AB{DB state matches\nprovider state?}
    AB_QUERY[Query provider - READ ONLY]
    AB_FIX[Correct DB state]
    EMIT[Emit job_completed event]
  end

  subgraph NOTIFY["Notification Service\ndecoupled - consumes event"]
    AC[Twilio SMS\nstatus to caller_phone]
  end

  A -->|calls| B
  B <-->|webhook tunnel| C
  B -->|POST /ivr/voice| D
  D -->|TwiML response| B
  B -->|digit pressed| E
  E --> F
  F -->|structured intent\ncaller_phone\ncall_sid| G

  G --> H
  H -->|duplicate found| H_EXIT
  H -->|new job - insert| I
  I -->|publish jobId + type + provider| K
  G -->|jobId returned| E
  E -->|TwiML confirm| B
  B -->|SMS ack to caller| A

  J -->|reads current status| I

  K -->|deliver message| M
  M --> N
  N --> GUARD
  GUARD -->|yes - terminal state| GUARD_EXIT
  GUARD -->|no - continue| O
  O -->|claim failed - race lost| O_EXIT
  O -->|claimed successfully| P
  P --> V
  P --> W
  V -->|sync response| Q
  W -->|sync response| Q
  Q -->|success| R
  R --> I
  R --> EMIT
  Q -->|failure| ERR_CLASS
  ERR_CLASS -->|retryable - network 5xx| S
  ERR_CLASS -->|non-retryable - 4xx business rule| T_NONRETRY
  T_NONRETRY --> I
  T_NONRETRY --> L
  S -->|yes - BullMQ throw\nSQS no-ack| T
  T -->|queue redelivers with backoff| K
  S -->|no - attempts exhausted| U
  U --> I
  U --> L

  RC_SCAN -->|stale claimed jobs found| RC_QUERY
  RC_QUERY -->|provider unaware of job| RC_RECLAIM
  RC_QUERY -->|provider has result| RC_FIX
  RC_RECLAIM --> I
  RC_FIX --> I
  I -.->|scheduled scan| RC_SCAN

  V -->|async callback| X
  W -->|async callback| X
  X --> Y
  Y -->|invalid signature| Y_REJECT
  Y -->|valid| DEDUP
  DEDUP -->|already seen| DEDUP_EXIT
  DEDUP -->|new event| DEDUP_STORE
  DEDUP_STORE --> Z
  Z --> AA
  AA --> I
  AA --> AB
  AB -->|state matches| EMIT
  AB -->|mismatch| AB_QUERY
  AB_QUERY --> AB_FIX
  AB_FIX --> I
  AB_FIX --> EMIT

  EMIT -->|job_completed or job_failed event| AC
  AC -->|SMS - ride confirmed or failed| A
```

## Local Development

### Prerequisites

- Node.js 20
- Docker + Docker Compose
- WSL (Windows) or Linux/Mac

### Setup
```bash
git clone git@github.com:danlewismuriuki/concierge-platform.git
cd concierge-platform
npm install
cp .env.example .env
# Edit .env with your values
docker-compose up -d
cd shared/db && npx prisma migrate dev && cd ../..
npm run dev:api
```

### Environment Variables

Copy `.env.example` to `.env`. Twilio and AWS keys are only needed for IVR and production deployment.

| Variable | Required now | Used for |
|---|---|---|
| DATABASE_URL | yes | Prisma + MySQL |
| PORT | yes | API service port |
| REDIS_HOST / REDIS_PORT | next step | BullMQ queue |
| WORKER_ID / MAX_JOB_ATTEMPTS | next step | Worker service |
| TWILIO_* | IVR step | Phone calls |
| AWS_* | production only | SQS + EC2 |

## Architecture Decisions

- **Idempotency at three layers** — API (idempotency_key), worker (state guard), DB (atomic UPDATE WHERE status=pending)
- **At-least-once delivery** — SQS/BullMQ delivers at least once so all consumers are idempotent by design
- **Error classification** — retryable (network, 5xx) vs non-retryable (4xx, validation) before incrementing attempts
- **Reconciliation** — scheduled job corrects DB state for stale jobs where webhooks were lost
- **Webhook deduplication** — event_id stored in webhook_events table survives restarts
- **Atomic worker claim** — UPDATE WHERE status=pending with claimed_by + claimed_at prevents race conditions
