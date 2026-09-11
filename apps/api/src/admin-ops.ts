import type { Pool, PoolClient } from 'pg';
import { DISCLOSURE_THRESHOLDS } from '@weddingpick/domain';

import { withTransaction } from './db';
import { newEventId, recordDecision } from './decisions';
import { ApiError, notFound } from './errors';

/**
 * 관리자 콘솔 «운영 · 시스템» 계열이 실제로 하는 일.
 *
 * 화면 여덟 개가 부르던 주소는 서버에 없었다. 단추는 `BACKEND_PENDING`으로 잠겨
 * 있었고, 잠근 채로 만들지 않아 「메뉴는 많은데 되는 게 없다」가 됐다.
 *
 * **계약은 화면이 정한다.** `apps/mobile/src/app/admin/`의 `apiFetch(` 자리가
 * 무엇을 보내고 무엇을 받는지 이미 적어 뒀고, 여기서는 그것을 따라간다 —
 * 서버가 편한 모양으로 화면을 고치지 않는다.
 *
 * 되돌릴 수 없는 조작은 셋을 지킨다: 사유를 받고 · 감사 기록을 남기고 ·
 * 두 단계를 거친다. 앞의 둘은 `structured.decisions`가, 마지막은 0130의
 * CHECK가 지킨다.
 */

type Queryable = Pool | PoolClient;

/**
 * 화면이 사유를 보내지 않을 때 적는 말.
 *
 * 스키마가 사유를 NOT NULL로 받는다. 빈 문자열을 넣어 통과시키지 않는다 —
 * 그러면 제약은 살아 있는데 기록은 비고, 나중에 「왜 눌렀나」를 물어볼 곳이 없다.
 * 적어도 «어디서 눌렸는지»는 남는다.
 */
const CONSOLE_REASON = '관리자 콘솔에서 처리';

const reasonOf = (given: string | undefined): string => {
  const trimmed = given?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : CONSOLE_REASON;
};

/** 사람이 읽는 이름. 계정 id를 화면으로 흘리지 않는다. */
const OPERATOR_LABEL = '운영자';

// ───────────────────────────────────────────────────────────────────────────
// 정책 규칙 (WP-ADM-051)
// ───────────────────────────────────────────────────────────────────────────

export type PolicyKind = 'number' | 'percentage' | 'boolean' | 'string';

/*
 * 실제 공개 판정은 도메인 상수를 쓴다. 관리자 DB 값만 바꿔 적용됐다고 표시하지 않는다.
 *
 * **Map으로 둔다.** 객체 리터럴이면 `values['__proto__']`가 `Object.prototype`을 주고
 * `values['toString']`이 함수를 준다 — 둘 다 `undefined`가 아니라서, 있지도 않은 키가
 * 「공개 기준」으로 읽힌다. 조회 쪽에서는 그 함수가 그대로 문자열이 되어 값 자리에
 * 실린다. 키를 밖에서 받는 자리라 프로토타입 사슬을 아예 끊는다.
 */
const PUBLIC_STAGE_VALUES = new Map<string, number>([
  ['public_stage.stage1_min', DISCLOSURE_THRESHOLDS.limited],
  ['public_stage.stage2_min', DISCLOSURE_THRESHOLDS.normal],
  ['public_stage.stage3_min', DISCLOSURE_THRESHOLDS.detailed],
]);
const PUBLIC_STAGE_READ_ONLY = '실제 공개 기준과 연결되기 전까지 조회만 할 수 있어요.';

export type PolicyItem = {
  id: string;
  key: string;
  label: string;
  description: string;
  category: string;
  type: PolicyKind;
  value: string;
  defaultValue: string;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  readOnlyReason: string | null;
};

type PolicyRow = {
  id: string;
  key: string;
  label: string;
  description: string;
  category: string;
  kind: PolicyKind;
  value: string;
  default_value: string;
  last_changed_at: Date | null;
  changed_by_name: string | null;
};

const POLICY_COLUMNS = `
  p.id, p.key, p.label, p.description, p.category, p.kind, p.value,
  p.default_value, p.last_changed_at,
  coalesce(u.display_name, CASE WHEN p.last_changed_by IS NULL THEN NULL ELSE '${OPERATOR_LABEL}' END) AS changed_by_name
`;

const toPolicyItem = (row: PolicyRow): PolicyItem => ({
  id: row.id,
  key: row.key,
  label: row.label,
  description: row.description,
  category: row.category,
  type: row.kind,
  value: String(PUBLIC_STAGE_VALUES.get(row.key) ?? row.value),
  defaultValue: String(PUBLIC_STAGE_VALUES.get(row.key) ?? row.default_value),
  lastChangedAt: row.last_changed_at?.toISOString() ?? null,
  lastChangedBy: row.changed_by_name,
  readOnlyReason: PUBLIC_STAGE_VALUES.has(row.key) ? PUBLIC_STAGE_READ_ONLY : null,
});

export async function policyRules(db: Queryable): Promise<{ policies: PolicyItem[] }> {
  const { rows } = await db.query<PolicyRow>(
    `SELECT ${POLICY_COLUMNS}
     FROM structured.policy_rules p
     LEFT JOIN structured.users u ON u.id = p.last_changed_by
     ORDER BY p.category, p.label`
  );

  return { policies: rows.map(toPolicyItem) };
}

/** 한 줄 읽기. 서버 코드가 기준값을 물을 때 쓴다. */
export async function policyNumber(db: Queryable, id: string, fallback: number): Promise<number> {
  const { rows } = await db.query<{ value: string }>(
    'SELECT value FROM structured.policy_rules WHERE id = $1',
    [id]
  );

  const parsed = Number(rows[0]?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 값이 그 종류에 맞는가.
 *
 * 화면이 자유 입력을 준다. `number` 칸에 «곧»이 들어오면 그 값을 읽는 코드가
 * 조용히 NaN을 쓰게 되고, 그 NaN은 공개 기준을 통째로 무너뜨린다.
 */
function assertPolicyValue(kind: PolicyKind, value: string): void {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ApiError('invalid_request', '값이 비어 있습니다.');
  }

  if (kind === 'number' || kind === 'percentage') {
    const parsed = Number(trimmed);

    if (!Number.isFinite(parsed)) {
      throw new ApiError('invalid_request', '숫자를 넣어주세요.');
    }

    if (kind === 'percentage' && (parsed < 0 || parsed > 1)) {
      throw new ApiError('invalid_request', '비율은 0과 1 사이여야 합니다.');
    }

    if (kind === 'number' && parsed < 0) {
      throw new ApiError('invalid_request', '0보다 작을 수 없습니다.');
    }
  }

  if (kind === 'boolean' && trimmed !== 'true' && trimmed !== 'false') {
    throw new ApiError('invalid_request', 'true 또는 false를 넣어주세요.');
  }
}

/**
 * 기준값을 고친다.
 *
 * 고친 값마다 되돌릴 자리를 하나 만든다(`structured.rollback_targets`). 정책
 * 변경은 사용자 화면이 바로 바뀌는 조작이라, 되돌리는 길이 없으면 고치기 전에
 * 손이 멈춘다 — 그러면 이 화면이 있는 이유가 없어진다.
 */
export async function setPolicyRules(
  pool: Pool,
  changes: { key: string; value: string }[],
  by: string
): Promise<{ changed: number }> {
  if (changes.length === 0) {
    throw new ApiError('invalid_request', '바꿀 값이 없습니다.');
  }

  const seen = new Set<string>();
  for (const change of changes) {
    if (PUBLIC_STAGE_VALUES.has(change.key)) {
      throw new ApiError('invalid_request', PUBLIC_STAGE_READ_ONLY);
    }
    if (seen.has(change.key)) {
      throw new ApiError('invalid_request', '같은 규칙이 두 번 들어왔습니다.');
    }
    seen.add(change.key);
  }

  /*
   * **한 트랜잭션이다.** 화면이 여러 줄을 한 번에 저장하는데(`policy-engine.tsx`가
   * 고친 것을 `draft`에 모아 «변경 사항 저장» 한 번으로 보낸다), 중간에 하나가
   * 실패하고 앞의 것만 남으면 어느 것이 적용됐는지 화면과 표가 갈라진다.
   */
  return withTransaction(pool, async (client) => {
    // 키 순서로 잠근다. 두 요청이 같은 두 줄을 반대 순서로 잡으면 서로 기다린다.
    const keys = [...seen].sort();

    const { rows } = await client.query<{
      id: string;
      key: string;
      kind: PolicyKind;
      value: string;
      label: string;
    }>(
      `SELECT id, key, kind, value, label FROM structured.policy_rules
       WHERE key = ANY($1::text[]) ORDER BY key FOR UPDATE`,
      [keys]
    );

    const byKey = new Map(rows.map((row) => [row.key, row]));

    let changed = 0;

    for (const change of changes) {
      const found = byKey.get(change.key);
      if (!found) throw notFound('정책 규칙');

      assertPolicyValue(found.kind, change.value);

      const next = change.value.trim();

      // 같은 값은 조용히 넘긴다. 여러 줄을 한 번에 보내는 자리라 하나가 안 바뀌었다고
      // 나머지를 되돌릴 이유가 없다.
      if (next === found.value) continue;

      await client.query(
        `UPDATE structured.policy_rules
         SET value = $2, last_changed_at = now(), last_changed_by = $3::uuid
         WHERE id = $1`,
        [found.id, next, by]
      );

      await client.query(
        `INSERT INTO structured.rollback_targets
           (name, kind, deployed_by, policy_rule_id, previous_value)
         VALUES ($1, 'policy', $2::uuid, $3, $4)`,
        [`정책 · ${found.label}`, by, found.id, found.value]
      );

      await recordDecision(client, {
        eventId: newEventId(),
        workflow: 'policy_engine',
        step: 'set',
        subjectKind: 'policy_rule',
        // 정책 규칙 id는 uuid가 아니라 사람이 읽는 text다. subject_id는 uuid만 받는다.
        subjectId: null,
        decider: { kind: 'human', userId: by },
        decision: 'changed',
        reasonCode: 'policy_edited',
        // 가리키기만 한다. 바뀐 값 자체는 policy_rules에 있고 이 로그에 복사하지 않는다.
        evidence: [],
      });

      changed++;
    }

    if (changed === 0) {
      throw new ApiError('invalid_request', '지금 값과 같습니다.');
    }

    return { changed };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 자동화 상태 (WP-ADM-040)
// ───────────────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'healthy' | 'degraded' | 'down' | 'recovering';

export type Workflow = {
  id: string;
  name: string;
  status: WorkflowStatus;
  successRate: number;
  execToday: number;
  retryCount: number;
  dlqSize: number;
  lastRecoveredAt: string | null;
  selfHealEnabled: boolean;
};

export type AutomationData = {
  overall: { healthyCount: number; degradedCount: number; downCount: number };
  workflows: Workflow[];
};

/**
 * 워크플로별 상태.
 *
 * 실행 통계를 따로 세어 저장하지 않는다 — `structured.decisions`가 이미 줄마다
 * workflow · execution_status · retry_count를 적고 있다. 두 벌로 세면 언젠가
 * 갈라지고, 갈라진 뒤에는 어느 쪽이 사실인지 알 수 없다.
 */
export async function automationStatus(db: Queryable): Promise<AutomationData> {
  const [degradedAt, downAt, dlqAlert] = await Promise.all([
    policyNumber(db, 'automation.success_rate_degraded', 0.95),
    policyNumber(db, 'automation.success_rate_down', 0.8),
    policyNumber(db, 'automation.dlq_alert_size', 10),
  ]);

  const { rows } = await db.query<{
    id: string;
    name: string;
    self_heal_enabled: boolean;
    last_recovered_at: Date | null;
    exec_today: string;
    settled: string;
    succeeded: string;
    retries: string;
    dlq: string;
    pending: string;
  }>(
    `SELECT w.id, w.name, w.self_heal_enabled, w.last_recovered_at,
            count(d.id) FILTER (WHERE d.created_at >= date_trunc('day', now())) AS exec_today,
            count(d.id) FILTER (WHERE d.execution_status IN ('succeeded', 'failed')) AS settled,
            count(d.id) FILTER (WHERE d.execution_status = 'succeeded') AS succeeded,
            coalesce(sum(d.retry_count), 0) AS retries,
            count(d.id) FILTER (
              WHERE d.execution_status = 'failed' AND d.dlq_drained_at IS NULL
            ) AS dlq,
            count(d.id) FILTER (WHERE d.execution_status = 'pending') AS pending
     FROM structured.automation_workflows w
     LEFT JOIN structured.decisions d ON d.workflow = w.id
     GROUP BY w.id, w.name, w.self_heal_enabled, w.last_recovered_at
     ORDER BY w.name`
  );

  const workflows = rows.map((row): Workflow => {
    const settled = Number(row.settled);
    const dlqSize = Number(row.dlq);
    const pending = Number(row.pending);

    /*
     * 아직 한 번도 돌지 않은 워크플로는 «정상»이다. 0/0을 0%로 읽으면 새로
     * 붙인 워크플로가 전부 «중단»으로 뜨고, 그러면 배너가 늘 빨개서 아무도
     * 배너를 보지 않게 된다.
     */
    const successRate = settled === 0 ? 1 : Number(row.succeeded) / settled;

    const status: WorkflowStatus =
      // 사람이 복구를 눌러 다시 줄에 선 것이 있으면 그것부터 말한다.
      pending > 0 && row.last_recovered_at !== null
        ? 'recovering'
        : successRate < downAt
          ? 'down'
          : successRate < degradedAt || dlqSize > dlqAlert
            ? 'degraded'
            : 'healthy';

    return {
      id: row.id,
      name: row.name,
      status,
      successRate,
      execToday: Number(row.exec_today),
      retryCount: Number(row.retries),
      dlqSize,
      lastRecoveredAt: row.last_recovered_at?.toISOString() ?? null,
      selfHealEnabled: row.self_heal_enabled,
    };
  });

  return {
    overall: {
      healthyCount: workflows.filter((w) => w.status === 'healthy').length,
      degradedCount: workflows.filter((w) => w.status === 'degraded').length,
      downCount: workflows.filter((w) => w.status === 'down').length,
    },
    workflows,
  };
}

async function findWorkflow(client: PoolClient, id: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM structured.automation_workflows WHERE id = $1 FOR UPDATE',
    [id]
  );

  const found = rows[0];
  if (!found) throw notFound('워크플로');

  return found.id;
}

/**
 * 실패한 줄을 다시 줄 세운다.
 *
 * **지우지 않는다.** `failed`를 `pending`으로 되돌려 `open_decisions`(운영자가
 * 이미 보는 대기 목록)에 다시 뜨게 한다. 여기서 사라지면 실패한 일이 처리된
 * 것과 잊힌 것이 구분되지 않는다.
 */
export async function recoverWorkflow(
  pool: Pool,
  id: string,
  by: string,
  reason: string | undefined
): Promise<{ requeued: number }> {
  return withTransaction(pool, async (client) => {
    await findWorkflow(client, id);

    const { rowCount } = await client.query(
      `UPDATE structured.decisions
       SET execution_status = 'pending', updated_at = now()
       WHERE workflow = $1
         AND execution_status = 'failed'
         AND dlq_drained_at IS NULL`,
      [id]
    );

    const requeued = rowCount ?? 0;

    if (requeued === 0) {
      throw new ApiError('invalid_request', '되돌릴 실패 건이 없습니다.');
    }

    await client.query(
      `UPDATE structured.automation_workflows
       SET last_recovered_at = now(), last_recovered_by = $2::uuid
       WHERE id = $1`,
      [id, by]
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: id,
      step: 'recover',
      subjectKind: 'automation_workflow',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      decision: reasonOf(reason),
      reasonCode: 'workflow_recovered',
      evidence: [],
    });

    return { requeued };
  });
}

/**
 * Dead-letter queue를 비운다.
 *
 * 줄을 지우는 것이 아니라 «사람이 보고 넘어갔다»를 적는다. 지우면 무엇이
 * 실패했었는지가 같이 사라지고, 그건 감사 기록을 지우는 것이다.
 */
export async function drainDlq(
  pool: Pool,
  id: string,
  by: string,
  reason: string | undefined
): Promise<{ drained: number }> {
  return withTransaction(pool, async (client) => {
    await findWorkflow(client, id);

    const { rowCount } = await client.query(
      `UPDATE structured.decisions
       SET dlq_drained_at = now(), dlq_drained_by = $2::uuid, updated_at = now()
       WHERE workflow = $1
         AND execution_status = 'failed'
         AND dlq_drained_at IS NULL`,
      [id, by]
    );

    const drained = rowCount ?? 0;

    if (drained === 0) {
      throw new ApiError('invalid_request', '비울 실패 건이 없습니다.');
    }

    await client.query(
      `UPDATE structured.automation_workflows
       SET last_drained_at = now(), last_drained_by = $2::uuid
       WHERE id = $1`,
      [id, by]
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: id,
      step: 'drain_dlq',
      subjectKind: 'automation_workflow',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      decision: reasonOf(reason),
      reasonCode: 'dlq_drained',
      evidence: [],
    });

    return { drained };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 롤백 (WP-ADM-042)
// ───────────────────────────────────────────────────────────────────────────

export type RollbackStatus =
  | 'stable'
  | 'anomaly_detected'
  | 'rolling_back'
  | 'rolled_back'
  | 'pending_approval';

export type RollbackItem = {
  id: string;
  name: string;
  type: 'deploy' | 'policy';
  deployedAt: string;
  deployedBy: string;
  status: RollbackStatus;
  anomalyMetric: string | null;
  anomalyValue: string | null;
  threshold: string | null;
  requiresApproval: boolean;
  autoRollbackEnabled: boolean;
};

type RollbackRow = {
  id: string;
  name: string;
  kind: 'deploy' | 'policy';
  deployed_at: Date;
  deployed_by_name: string | null;
  policy_rule_id: string | null;
  approved_at: Date | null;
  triggered_at: Date | null;
  settled: string;
  failed: string;
};

/*
 * 배포 시각 이후의 실패율을 함께 센다.
 *
 * 「이상 감지」를 줄에 저장하지 않는 이유가 여기 있다 — 저장하면 감지기와 표가
 * 갈라진다. 볼 때마다 실제 기록을 세면 갈라질 자리가 없다.
 */
const ROLLBACK_COLUMNS = `
  r.id, r.name, r.kind, r.deployed_at, r.policy_rule_id,
  r.approved_at, r.triggered_at,
  coalesce(u.display_name, '${OPERATOR_LABEL}') AS deployed_by_name,
  stat.settled, stat.failed
`;

/*
 * 두 수를 한 번에 센다. 줄마다 부속질의를 두 번 돌리면 표가 길어질수록
 * `structured.decisions`를 두 배로 훑는다 — 0130이 `decisions (created_at DESC)`
 * 색인을 같이 넣는 것도 이 구간 때문이다.
 */
const ROLLBACK_STATS = `
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE d.execution_status IN ('succeeded', 'failed')) AS settled,
           count(*) FILTER (WHERE d.execution_status = 'failed') AS failed
    FROM structured.decisions d
    WHERE d.created_at >= r.deployed_at
  ) stat ON true
`;

const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

function toRollbackItem(row: RollbackRow, downAt: number): RollbackItem {
  const settled = Number(row.settled);
  const failureRate = settled === 0 ? 0 : Number(row.failed) / settled;
  /** 성공률 기준을 실패율로 뒤집어 쓴다. 기준이 하나뿐이면 두 화면이 어긋나지 않는다. */
  const failureLimit = 1 - downAt;
  const anomalous = settled > 0 && failureRate > failureLimit;

  const status: RollbackStatus = row.triggered_at
    ? // 정책 롤백은 실행이 곧 복구다. 배포는 이 서버가 되돌릴 수 없어 요청까지만 남는다.
      row.kind === 'policy'
      ? 'rolled_back'
      : 'rolling_back'
    : anomalous
      ? row.approved_at
        ? 'anomaly_detected'
        : 'pending_approval'
      : 'stable';

  return {
    id: row.id,
    name: row.name,
    type: row.kind,
    deployedAt: row.deployed_at.toISOString(),
    deployedBy: row.deployed_by_name ?? OPERATOR_LABEL,
    status,
    anomalyMetric: anomalous ? '결정 실패율' : null,
    anomalyValue: anomalous ? percent(failureRate) : null,
    threshold: anomalous ? percent(failureLimit) : null,
    /*
     * **승인이 남았는가**를 뜻한다. 화면은 이 값이 false일 때만 «즉시 롤백»을
     * 그리므로, 승인 전에는 실행 단추가 아예 없다 — 두 단계가 화면에서도 두
     * 단계로 보인다.
     */
    requiresApproval: row.approved_at === null,
    /*
     * **이 서버가 실제로 되돌릴 수 있는가.** 정책 값은 되돌린다. 배포는 되돌릴
     * 수단이 여기 없어 요청만 기록된다.
     *
     * 화면(`rollback.tsx` `revertable()`)이 이 값과 `requiresApproval`을 함께 보고
     * «되돌리기 가능/불가»를 그린다 — 승인 전에는 «불가», 승인 뒤 정책 변경만
     * «가능»이 된다. 사람 승인 없이 도는 길은 여전히 없다.
     */
    autoRollbackEnabled: row.kind === 'policy',
  };
}

export async function rollbackTargets(db: Queryable): Promise<{ items: RollbackItem[] }> {
  const downAt = await policyNumber(db, 'automation.success_rate_down', 0.8);

  const { rows } = await db.query<RollbackRow>(
    `SELECT ${ROLLBACK_COLUMNS}
     FROM structured.rollback_targets r
     LEFT JOIN structured.users u ON u.id = r.deployed_by
     ${ROLLBACK_STATS}
     ORDER BY r.deployed_at DESC
     LIMIT 200`
  );

  return { items: rows.map((row) => toRollbackItem(row, downAt)) };
}

async function lockRollback(
  client: PoolClient,
  id: string
): Promise<{ approved_at: Date | null; triggered_at: Date | null; kind: 'deploy' | 'policy'; policy_rule_id: string | null; previous_value: string | null; name: string }> {
  const { rows } = await client.query<{
    approved_at: Date | null;
    triggered_at: Date | null;
    kind: 'deploy' | 'policy';
    policy_rule_id: string | null;
    previous_value: string | null;
    name: string;
  }>(
    `SELECT approved_at, triggered_at, kind, policy_rule_id, previous_value, name
     FROM structured.rollback_targets WHERE id = $1 FOR UPDATE`,
    [id]
  );

  const found = rows[0];
  if (!found) throw notFound('롤백 대상');

  return found;
}

/** 첫 단계. 승인만 한다 — 여기서 아무것도 되돌아가지 않는다. */
export async function approveRollback(
  pool: Pool,
  id: string,
  by: string,
  reason: string | undefined
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const found = await lockRollback(client, id);

    if (found.approved_at) {
      throw new ApiError('invalid_request', '이미 승인된 롤백입니다.');
    }

    await client.query(
      `UPDATE structured.rollback_targets
       SET approved_at = now(), approved_by = $2::uuid, approval_reason = $3, updated_at = now()
       WHERE id = $1`,
      [id, by, reasonOf(reason)]
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'rollback',
      step: 'approve',
      subjectKind: 'rollback_target',
      subjectId: id,
      decider: { kind: 'human', userId: by },
      decision: 'approved',
      reasonCode: 'rollback_approved',
      evidence: [{ kind: 'rollback_target', id }],
    });
  });
}

/**
 * 둘째 단계. 승인된 것만 실행한다.
 *
 * **승인과 실행을 한 번에 도는 길을 만들지 않는다.** 여기서 막고, 0130의
 * `trigger_follows_approval`이 한 번 더 막는다 — 라우트는 한 줄 고치면 뚫리고
 * 그 한 줄은 리뷰에서 눈에 띄지 않는다.
 */
export async function triggerRollback(
  pool: Pool,
  id: string,
  by: string,
  reason: string | undefined
): Promise<{ restored: boolean }> {
  return withTransaction(pool, async (client) => {
    const found = await lockRollback(client, id);

    if (!found.approved_at) {
      throw new ApiError('invalid_request', '승인되지 않은 롤백은 실행할 수 없습니다.');
    }

    if (found.triggered_at) {
      throw new ApiError('invalid_request', '이미 실행된 롤백입니다.');
    }

    await client.query(
      `UPDATE structured.rollback_targets
       SET triggered_at = now(), triggered_by = $2::uuid, trigger_reason = $3, updated_at = now()
       WHERE id = $1`,
      [id, by, reasonOf(reason)]
    );

    /*
     * 정책 변경은 이 서버가 실제로 되돌린다. 배포는 되돌릴 수단이 여기 없어
     * 요청만 남는다 — 「롤백했다」고 적고 아무것도 바뀌지 않는 것보다,
     * 화면에 «롤백 중»으로 남아 사람이 이어받는 편이 낫다.
     */
    const restored = found.kind === 'policy';

    if (restored) {
      await client.query(
        `UPDATE structured.policy_rules
         SET value = $2, last_changed_at = now(), last_changed_by = $3::uuid
         WHERE id = $1`,
        [found.policy_rule_id, found.previous_value, by]
      );
    }

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'rollback',
      step: 'trigger',
      subjectKind: 'rollback_target',
      subjectId: id,
      decider: { kind: 'human', userId: by },
      decision: restored ? 'rolled_back' : 'rolling_back',
      reasonCode: 'rollback_triggered',
      evidence: [{ kind: 'rollback_target', id }],
    });

    return { restored };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 약관 · 방침 (WP-ADM-036)
// ───────────────────────────────────────────────────────────────────────────

export type DocType = 'terms' | 'privacy' | 'marketing';

const DOC_LABEL: Record<DocType, string> = {
  terms: '이용약관',
  privacy: '개인정보처리방침',
  marketing: '마케팅 정보 수신 동의',
};

/*
 * `in`을 쓰지 않는다. `'toString' in DOC_LABEL`은 참이라 주소에 아무 프로토타입
 * 이름이나 넣으면 문서로 통과하고, 그 뒤 `DOC_LABEL[doc]`은 이름 대신 함수를 준다.
 * 지금은 뒤에서 바로 막혀 드러나지 않지만, 편집·공개가 열리는 날 그 길이 열린다.
 */
export const isDocType = (value: string): value is DocType => Object.hasOwn(DOC_LABEL, value);

export type TermsClause = { id: string; articleNumber: string; title: string; body: string };
export type TermsVersion = { version: string; publishedAt: string | null; isDraft: boolean };
export type TermsDoc = {
  type: DocType;
  label: string;
  currentVersion: string;
  latestDraftVersion: string | null;
  publishedAt: string | null;
  versions: TermsVersion[];
  clauses: TermsClause[];
};

/** 아직 아무 판도 없는 문서. 「없음」을 그대로 보인다 — 0판을 지어내지 않는다. */
const NO_VERSION = '없음';

export async function termsDocuments(db: Queryable): Promise<{ documents: TermsDoc[] }> {
  const { rows: versions } = await db.query<{
    id: string;
    doc: DocType;
    version: string;
    published_at: Date | null;
  }>(
    `SELECT id, doc, version, published_at
     FROM structured.terms_versions
     ORDER BY doc, created_at DESC`
  );

  const { rows: clauses } = await db.query<{
    id: string;
    version_id: string;
    article_number: string;
    title: string;
    body: string;
  }>(
    `SELECT id, version_id, article_number, title, body
     FROM structured.terms_clauses
     ORDER BY version_id, position`
  );

  const documents = (Object.keys(DOC_LABEL) as DocType[]).map((doc): TermsDoc => {
    const mine = versions.filter((v) => v.doc === doc);
    const published = mine.filter((v) => v.published_at !== null);
    const draft = mine.find((v) => v.published_at === null);
    const current = published[0] ?? null;

    /*
     * 조문은 **고칠 수 있는 판**의 것을 보인다. 초안이 있으면 초안, 없으면
     * 공개된 최신 판이다. 초안이 있는데 공개판을 보이면, 편집 화면이 고칠 수
     * 없는 글을 띄우게 된다.
     */
    const showing = draft ?? current;

    return {
      type: doc,
      label: DOC_LABEL[doc],
      currentVersion: current?.version ?? NO_VERSION,
      latestDraftVersion: draft?.version ?? null,
      publishedAt: current?.published_at?.toISOString() ?? null,
      versions: mine.map((v) => ({
        version: v.version,
        publishedAt: v.published_at?.toISOString() ?? null,
        isDraft: v.published_at === null,
      })),
      clauses: showing
        ? clauses
            .filter((c) => c.version_id === showing.id)
            .map((c) => ({
              id: c.id,
              articleNumber: c.article_number,
              title: c.title,
              body: c.body,
            }))
        : [],
    };
  });

  return { documents };
}

/**
 * 조문 하나를 고친다.
 *
 * 공개된 판은 고칠 수 없다 — 사용자가 동의한 글이 나중에 바뀌면 무엇에
 * 동의했는지가 사라진다. 여기서 막고 0130의 트리거가 한 번 더 막는다.
 */
export async function editTermsClause(
  pool: Pool,
  doc: DocType,
  clauseId: string,
  body: string,
  by: string
): Promise<void> {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    throw new ApiError('invalid_request', '조문 내용이 비어 있습니다.');
  }

  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ published_at: Date | null; doc: DocType }>(
      `SELECT v.published_at, v.doc
       FROM structured.terms_clauses c
       JOIN structured.terms_versions v ON v.id = c.version_id
       WHERE c.id = $1`,
      [clauseId]
    );

    const found = rows[0];
    if (!found || found.doc !== doc) throw notFound('조문');

    if (found.published_at !== null) {
      throw new ApiError('invalid_request', '공개된 판의 조문은 고칠 수 없습니다. 새 초안을 만들어주세요.');
    }

    await client.query('UPDATE structured.terms_clauses SET body = $2 WHERE id = $1', [
      clauseId,
      trimmed,
    ]);

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'terms',
      step: 'edit_clause',
      subjectKind: 'terms_clause',
      subjectId: clauseId,
      decider: { kind: 'human', userId: by },
      decision: 'edited',
      reasonCode: 'clause_edited',
      evidence: [{ kind: 'terms_clause', id: clauseId }],
    });
  });
}

/**
 * 초안을 공개한다.
 *
 * 공개한 판은 얼어붙고, 이어서 고칠 수 있도록 **조문을 복사한 새 초안**을 만든다.
 * 새 초안을 같이 만들지 않으면 공개 직후 그 문서는 편집할 수 없는 상태가 되고,
 * 다음 사람이 공개된 판을 고치려다 트리거에 막힌다.
 */
export async function publishTerms(
  pool: Pool,
  doc: DocType,
  by: string,
  reason: string | undefined
): Promise<{ version: string; nextDraft: string }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string; version: string }>(
      `SELECT id, version FROM structured.terms_versions
       WHERE doc = $1::terms_doc_kind AND published_at IS NULL
       FOR UPDATE`,
      [doc]
    );

    const draft = rows[0];
    if (!draft) throw new ApiError('invalid_request', '공개할 초안이 없습니다.');

    await client.query(
      `UPDATE structured.terms_versions
       SET published_at = now(), published_by = $2::uuid
       WHERE id = $1`,
      [draft.id, by]
    );

    const nextDraft = nextVersion(draft.version);

    const { rows: created } = await client.query<{ id: string }>(
      `INSERT INTO structured.terms_versions (doc, version)
       VALUES ($1::terms_doc_kind, $2)
       RETURNING id`,
      [doc, nextDraft]
    );

    await client.query(
      `INSERT INTO structured.terms_clauses (version_id, article_number, title, body, position)
       SELECT $2::uuid, article_number, title, body, position
       FROM structured.terms_clauses
       WHERE version_id = $1::uuid`,
      [draft.id, created[0]!.id]
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'terms',
      step: 'publish',
      subjectKind: 'terms_version',
      subjectId: draft.id,
      decider: { kind: 'human', userId: by },
      decision: reasonOf(reason),
      reasonCode: 'terms_published',
      evidence: [{ kind: 'terms_version', id: draft.id }],
    });

    return { version: draft.version, nextDraft };
  });
}

/** `v1.3` → `v1.4`. 모양이 다르면 뒤에 하나를 붙여 겹치지 않게만 한다. */
export function nextVersion(version: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(version.trim());

  if (!match) return `${version}-next`;

  return `v${match[1]}.${Number(match[2]) + 1}`;
}

// ───────────────────────────────────────────────────────────────────────────
// 광고 집행 (WP-ADM-033)
// ───────────────────────────────────────────────────────────────────────────

export type AdStatus = 'active' | 'paused' | 'expired' | 'pending';

export type AdItem = {
  id: string;
  vendorName: string;
  plan: 'LIGHT' | 'STANDARD' | 'PREMIUM';
  slot: string;
  startDate: string;
  endDate: string;
  status: AdStatus;
  impressions: number;
  clicks: number;
  ctr: number;
  picks: number;
  conversionRate: number;
  monthlyFee: string;
  promoApplied: boolean;
};

/** v3.10 §2. 상품 등급별 월 광고비. */
const TIER_FEE: Record<'light' | 'standard' | 'premium', number> = {
  light: 30_000,
  standard: 70_000,
  premium: 150_000,
};

/** 지면 이름. `ad_surface`(0042)의 세 갈래. */
const SURFACE_LABEL: Record<string, string> = {
  vendor_detail: '업체 상세',
  search: '검색',
  region_category: '지역·업종',
};

export async function adPlacements(db: Queryable): Promise<{ items: AdItem[]; totalRevenue: string }> {
  const { rows } = await db.query<{
    id: string;
    vendor_name: string;
    tier: 'light' | 'standard' | 'premium';
    surface: string;
    starts_on: Date;
    ends_on: Date;
    paused_at: Date | null;
  }>(
    `SELECT p.id, v.name AS vendor_name, p.tier, p.surface,
            p.starts_on, p.ends_on, p.paused_at
     FROM ads.placements p
     JOIN structured.vendors v ON v.id = p.vendor_id
     ORDER BY p.starts_on DESC
     LIMIT 500`
  );

  const today = new Date().toISOString().slice(0, 10);
  const day = (value: Date): string => value.toISOString().slice(0, 10);

  const items = rows.map((row): AdItem => {
    const startDate = day(row.starts_on);
    const endDate = day(row.ends_on);

    const status: AdStatus =
      row.paused_at !== null
        ? 'paused'
        : endDate < today
          ? 'expired'
          : startDate > today
            ? 'pending'
            : 'active';

    return {
      id: row.id,
      vendorName: row.vendor_name,
      plan: row.tier.toUpperCase() as AdItem['plan'],
      slot: SURFACE_LABEL[row.surface] ?? row.surface,
      startDate,
      endDate,
      status,
      /*
       * 노출·클릭·Pick을 세는 표가 아직 없다. **0으로 지어내지 않고 0으로
       * 「측정값 없음」을 말한다** — 이 자리에 그럴듯한 숫자를 넣으면 광고주에게
       * 보낼 수 없는 수치가 화면에 남고, 누군가 그것을 옮겨 적는다.
       */
      impressions: 0,
      clicks: 0,
      ctr: 0,
      picks: 0,
      conversionRate: 0,
      monthlyFee: `${TIER_FEE[row.tier].toLocaleString('ko-KR')}원`,
      promoApplied: false,
    };
  });

  const revenue = rows
    .filter((row) => row.paused_at === null && day(row.ends_on) >= today)
    .reduce((sum, row) => sum + TIER_FEE[row.tier], 0);

  return { items, totalRevenue: `${revenue.toLocaleString('ko-KR')}원` };
}

/**
 * 집행을 멈추거나 다시 켠다.
 *
 * 기간(starts_on · ends_on)은 손대지 않는다 — 그건 돈이 오간 약속이고, 멈추려고
 * 그것을 고치면 다시 켤 때 원래 기간이 무엇이었는지 알 수 없다.
 */
export async function setAdStatus(
  pool: Pool,
  id: string,
  status: 'active' | 'paused',
  by: string,
  reason: string | undefined
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ paused_at: Date | null }>(
      'SELECT paused_at FROM ads.placements WHERE id = $1 FOR UPDATE',
      [id]
    );

    const found = rows[0];
    if (!found) throw notFound('광고');

    const wantPaused = status === 'paused';

    if (wantPaused === (found.paused_at !== null)) {
      throw new ApiError('invalid_request', '이미 그 상태입니다.');
    }

    await client.query(
      wantPaused
        ? `UPDATE ads.placements
           SET paused_at = now(), paused_by = $2::uuid, pause_reason = $3 WHERE id = $1`
        : `UPDATE ads.placements
           SET paused_at = NULL, paused_by = NULL, pause_reason = NULL WHERE id = $1`,
      wantPaused ? [id, by, reasonOf(reason)] : [id]
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'ad_placement',
      step: 'set_status',
      subjectKind: 'ad_placement',
      subjectId: id,
      decider: { kind: 'human', userId: by },
      decision: status,
      reasonCode: wantPaused ? 'ad_paused' : 'ad_resumed',
      evidence: [{ kind: 'ad_placement', id }],
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 광고 실운영 전환 게이트 (WP-ADM-034)
// ───────────────────────────────────────────────────────────────────────────

export type GateStepStatus = 'done' | 'in_progress' | 'pending' | 'blocked';

/** `ads.launch_reports.analyst`(0043)의 두 갈래. 각각 따로 낸다 — 합치지 않는다. */
const ANALYSTS = ['gpt', 'claude'] as const;

export type GateStep = {
  id: string;
  label: string;
  description: string;
  status: GateStepStatus;
  completedAt: string | null;
  detail: string | null;
  requiresAction: boolean;
};

export type AdsGateData = {
  currentPhase: number;
  steps: GateStep[];
  /** 승인 단추를 그릴지. 승인이 아직 안 됐고 보고서가 다 있을 때만 참이다. */
  readyForProduction: boolean;
  /** 지금 광고가 나가는 상태인가. */
  activated: boolean;
  /** 켜기 단추를 그릴지. 승인은 끝났는데 아직 안 켠 상태다. */
  canActivate: boolean;
  blockers: string[];
};

/**
 * 실운영 전환이 어디까지 왔는가.
 *
 * 단계를 저장하지 않고 실제 기록에서 읽는다 — 광고 자리 · 분석 보고서 ·
 * 승인 기록이 이미 각각의 표에 있다. 저장한 단계는 사실과 갈라진다.
 */
export async function adsGate(db: Queryable): Promise<AdsGateData> {
  const [{ rows: placements }, { rows: reports }, { rows: gate }] = await Promise.all([
    db.query<{ total: string }>('SELECT count(*) AS total FROM ads.placements'),
    db.query<{ analyst: 'gpt' | 'claude'; submitted_at: Date }>(
      'SELECT analyst, min(submitted_at) AS submitted_at FROM ads.launch_reports GROUP BY analyst'
    ),
    db.query<{ approved_at: Date | null; activated: boolean; activated_at: Date | null }>(
      'SELECT approved_at, activated, activated_at FROM ads.production_gate WHERE id = true'
    ),
  ]);

  const placed = Number(placements[0]?.total ?? '0');
  const analysts = new Set(reports.map((r) => r.analyst));
  const approvedAt = gate[0]?.approved_at ?? null;
  const activated = gate[0]?.activated ?? false;

  const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;
  const analystAt = (who: (typeof ANALYSTS)[number]): Date | null =>
    reports.find((r) => r.analyst === who)?.submitted_at ?? null;

  const bothAnalyzed = ANALYSTS.every((who) => analysts.has(who));

  const steps: GateStep[] = [
    {
      id: 'test_open',
      label: '테스트 전체 오픈',
      description: '모든 상품 등급을 테스트로 열어 자리를 판매합니다',
      status: placed > 0 ? 'done' : 'in_progress',
      completedAt: null,
      detail: placed > 0 ? `광고 자리 ${placed}건` : '아직 판매된 자리가 없어요',
      requiresAction: false,
    },
    {
      id: 'collect',
      label: '데이터 축적',
      description: '분석에 쓸 집행 기록을 모읍니다',
      status: placed > 0 ? 'in_progress' : 'pending',
      completedAt: null,
      /*
       * 노출·클릭을 세는 표가 아직 없다. 「모으는 중」이라고 적지 않는다 —
       * 모으고 있지 않다.
       */
      detail: '노출·클릭 집계는 아직 준비되지 않았어요',
      requiresAction: false,
    },
    /*
     * 분석자 두 갈래를 한 자리에서 만든다. 이름은 `ads.launch_reports.analyst`
     * 값에서 그대로 온다 — 화면에 적을 이름을 코드에 따로 두면 표와 갈라진다.
     *
     * **두 결론을 합치지 않는다**(0043). 한 줄로 묶으면 어느 쪽이 무엇을 봤는지
     * 사라지고, 사용자가 결정할 재료가 없어진다.
     */
    ...ANALYSTS.map((who): GateStep => ({
      id: `analysis_${who}`,
      label: `${who.toUpperCase()} 독립 분석`,
      description: '단독으로 판정합니다. 다른 분석과 결론을 합치지 않아요',
      status: analysts.has(who) ? 'done' : 'pending',
      completedAt: iso(analystAt(who)),
      detail: null,
      requiresAction: false,
    })),
    {
      id: 'reports',
      label: '보고서 제출',
      description: '두 분석이 각각 보고서를 냅니다',
      status: bothAnalyzed ? 'done' : 'pending',
      completedAt: null,
      detail: `제출 ${analysts.size}건 · 필요 2건`,
      requiresAction: false,
    },
    {
      id: 'decision',
      label: '최종 결정',
      description: '사람이 실운영 전환을 확정합니다. AI가 이 단추를 누를 수 없어요',
      status: approvedAt ? 'done' : bothAnalyzed ? 'in_progress' : 'pending',
      completedAt: iso(approvedAt),
      detail: approvedAt ? '승인됨' : '두 보고서가 모두 필요해요',
      requiresAction: bothAnalyzed && !approvedAt,
    },
    {
      id: 'production',
      label: '실운영 오픈',
      description: '승인과 별개로 한 번 더 켜야 광고가 나갑니다',
      /*
       * **승인해도 여기는 저절로 열리지 않는다.** 승인과 전환은 다른 일이고,
       * 켜는 것은 사람이 따로 누른다(`activateAdsGate`).
       *
       * 2026-09-11 대표 지시로 켜는 길이 생겼다(그 전에는 길 자체가 없어
       * `blocked`였다). 이제 승인이 끝났으면 «켤 수 있음»이다.
       */
      status: activated ? 'done' : approvedAt ? 'in_progress' : 'pending',
      completedAt: iso(gate[0]?.activated_at ?? null),
      detail: activated
        ? null
        : approvedAt
          ? '켜면 광고가 나갑니다'
          : '승인 먼저예요',
      requiresAction: Boolean(approvedAt) && !activated,
    },
  ];

  /*
   * **막고 있는 것만 적는다.** 「켜면 나갑니다」는 안내이지 차단이 아닌데 여기
   * 넣었더니 화면이 「차단 요인: 켜면 광고가 나갑니다」로 읽혔다(2026-09-11 캡처).
   * 켤 수 있다는 사실은 `canActivate`와 그 카드가 따로 말한다.
   */
  const blockers: string[] = [];
  if (!bothAnalyzed) blockers.push('독립 분석 보고서 2건이 필요해요');

  return {
    currentPhase: steps.filter((s) => s.status === 'done').length,
    steps,
    /** 승인이 남았을 때만 단추를 그린다. 이미 승인됐으면 다시 누를 자리가 없다. */
    readyForProduction: bothAnalyzed && !approvedAt,
    /** 켜짐 여부와 켤 수 있는지. 화면이 단추를 어느 쪽으로 그릴지 정한다. */
    activated,
    canActivate: Boolean(approvedAt) && !activated,
    blockers,
  };
}

/**
 * 실운영 전환을 승인한다.
 *
 * **승인은 전환이 아니다.** `activated`는 그대로 false다 — 이 판에 그것을 켜는
 * 길이 없다. 광고 실운영 전환은 대표 오더 대기 상태이고, 단추 하나가 그 오더를
 * 대신하지 않는다.
 */
export async function approveAdsGate(
  pool: Pool,
  by: string,
  reason: string | undefined
): Promise<{ activated: false }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ approved_at: Date | null }>(
      'SELECT approved_at FROM ads.production_gate WHERE id = true FOR UPDATE'
    );

    const found = rows[0];
    if (!found) throw notFound('실운영 관문');

    if (found.approved_at) {
      throw new ApiError('invalid_request', '이미 승인됐습니다.');
    }

    const { rows: ready } = await client.query<{ analysts: string }>(
      'SELECT count(DISTINCT analyst) AS analysts FROM ads.launch_reports'
    );

    if (Number(ready[0]?.analysts ?? '0') < 2) {
      throw new ApiError('invalid_request', '독립 분석 보고서 2건이 필요합니다.');
    }

    await client.query(
      `UPDATE ads.production_gate
       SET approved_at = now(), approved_by = $1::uuid, approval_reason = $2
       WHERE id = true`,
      [by, reasonOf(reason)]
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'ads_production_gate',
      step: 'approve',
      subjectKind: 'ads_production_gate',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      decision: 'approved',
      reasonCode: 'ads_gate_approved',
      evidence: [],
    });

    return { activated: false };
  });
}

/**
 * 실운영 전환을 **켠다**.
 *
 * 2026-09-11 대표 지시 — 「광고도 진행해. 단, 관리자에서 내가 컨트롤할 수 있어야
 * 한다」. 그 전까지 `activated`를 켜는 길이 코드에 없었고(승인까지만 있었다),
 * 그래서 광고 자리를 아무리 만들어도 화면에는 한 장도 나가지 않았다.
 *
 * **이 함수를 사람만 부른다.** 관리자 화면의 단추가 유일한 입구이고, 자동화·
 * 배치·스케줄러가 이것을 부르는 자리를 만들지 않는다 — 「AI가 멋대로 광고
 * 스위치를 올리는 일 금지」가 표의 `decided_by`와 여기까지 와야 뜻이 있다.
 *
 * 승인 없이는 켜지지 않는다. 표의 `activation_follows_approval`이 막고 있어
 * 여기서 한 번 더 보는 것은 **사람에게 이유를 말해 주기 위해서**다 — 제약이
 * 던지는 오류는 왜 막혔는지 알려주지 않는다.
 */
export async function activateAdsGate(
  pool: Pool,
  by: string,
  reason: string | undefined
): Promise<{ activated: true; activatedAt: string }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ approved_at: Date | null; activated: boolean }>(
      'SELECT approved_at, activated FROM ads.production_gate WHERE id = true FOR UPDATE'
    );

    const found = rows[0];
    if (!found) throw notFound('실운영 관문');

    if (!found.approved_at) {
      throw new ApiError('invalid_request', '먼저 승인해야 켤 수 있습니다.');
    }

    if (found.activated) {
      throw new ApiError('invalid_request', '이미 켜져 있습니다.');
    }

    const { rows: updated } = await client.query<{ activated_at: Date }>(
      `UPDATE ads.production_gate
       SET activated = true, activated_at = now()
       WHERE id = true
       RETURNING activated_at`
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'ads_production_gate',
      step: 'activate',
      subjectKind: 'ads_production_gate',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      /* 사람이 적은 사유가 여기 남는다 — 이 표의 관례다(위 recordDecision 호출들과 같다). */
      decision: reasonOf(reason),
      reasonCode: 'ads_gate_activated',
      evidence: [],
    });

    return { activated: true, activatedAt: updated[0]!.activated_at.toISOString() };
  });
}

/**
 * 실운영 전환을 **끈다**.
 *
 * 켜는 길만 만들면 그것은 컨트롤이 아니다. 되돌릴 수 없는 단추를 관리자에 두면
 * 누르기 전에 망설이게 되고, 망설이면 확인해야 할 것을 확인하지 못한다.
 *
 * **승인은 지우지 않는다.** 껐다 켜는 것과 승인을 무르는 것은 다른 일이고, 승인
 * 기록은 누가 언제 왜 열기로 했는지를 남기는 자리다 — 끌 때마다 지우면 그 기록이
 * 사라진다.
 */
export async function deactivateAdsGate(
  pool: Pool,
  by: string,
  reason: string | undefined
): Promise<{ activated: false }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ activated: boolean }>(
      'SELECT activated FROM ads.production_gate WHERE id = true FOR UPDATE'
    );

    const found = rows[0];
    if (!found) throw notFound('실운영 관문');

    if (!found.activated) {
      throw new ApiError('invalid_request', '이미 꺼져 있습니다.');
    }

    await client.query(
      'UPDATE ads.production_gate SET activated = false, activated_at = NULL WHERE id = true'
    );

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'ads_production_gate',
      step: 'deactivate',
      subjectKind: 'ads_production_gate',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      decision: reasonOf(reason),
      reasonCode: 'ads_gate_deactivated',
      evidence: [],
    });

    return { activated: false };
  });
}

/**
 * 광고 상품(등급)별 현재 상태.
 *
 * **검색 화면이 실제로 보는 스위치가 이것이다**(`apps/api/src/routes/vendors.ts`가
 * `ads.tier_state`를 `state = 'live'`로 건다). 전체 관문(`production_gate`)과 다른
 * 자리다 — 관문이 열려 있어도 등급이 `test`면 그 등급의 광고는 안 나간다.
 *
 * 결정이 없는 등급은 `test`다(뷰 `ads.tier_state`). 아무것도 안 정한 상품이
 * 실운영으로 시작하지 않는다.
 */
export type AdTierState = {
  tier: string;
  state: 'test' | 'live' | 'withheld' | 'retired';
  decidedAt: string | null;
  /** 자리가 몇 개 팔렸는지. 끄기 전에 무엇이 내려가는지 보여준다. */
  placements: number;
};

export async function adTierStates(db: Queryable): Promise<AdTierState[]> {
  const { rows } = await db.query<{
    tier: string;
    state: AdTierState['state'];
    decided_at: Date | null;
    placements: string;
  }>(
    `SELECT t.tier, t.state, t.decided_at,
            (SELECT count(*) FROM ads.active_placements p WHERE p.tier = t.tier) AS placements
     FROM ads.tier_state t
     ORDER BY t.tier`
  );

  return rows.map((row) => ({
    tier: row.tier,
    state: row.state,
    decidedAt: row.decided_at?.toISOString() ?? null,
    placements: Number(row.placements),
  }));
}

/**
 * 등급 하나의 실운영 상태를 정한다.
 *
 * `test`는 받지 않는다 — 표의 `decision_is_not_test`가 막는다. 시작 상태이지
 * 결정이 아니기 때문이고, 되돌리려면 결정을 **지운다**(`clearAdTierDecision`).
 *
 * `decided_by`가 NOT NULL이라 **사람 없이 실운영이 될 수 없다**(0043). 그 칸을
 * 채우는 값은 지금 로그인한 관리자이고, 자동화가 부를 자리를 만들지 않는다.
 */
export async function decideAdTier(
  pool: Pool,
  input: { tier: string; state: 'live' | 'withheld' | 'retired'; note?: string },
  by: string
): Promise<AdTierState[]> {
  return withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO ads.launch_decisions (tier, state, decided_by, note)
       VALUES ($1::ad_tier, $2::ad_launch_state, $3::uuid, $4)
       ON CONFLICT (tier) DO UPDATE
         SET state = EXCLUDED.state,
             decided_at = now(),
             decided_by = EXCLUDED.decided_by,
             note = EXCLUDED.note`,
      [input.tier, input.state, by, input.note?.trim() || null]
    );

    if (!rowCount) throw notFound('광고 상품');

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'ads_launch',
      step: 'decide',
      subjectKind: 'ad_tier',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      decision: reasonOf(input.note),
      reasonCode: `ad_tier_${input.state}`,
      evidence: [],
    });

    return adTierStates(client);
  });
}

/**
 * 등급의 결정을 지워 테스트로 되돌린다.
 *
 * 끄는 길이 없으면 컨트롤이 아니다. `state`에 `test`를 적을 수 없으므로
 * (표의 `decision_is_not_test`) 되돌리는 방법은 결정을 지우는 것뿐이다 —
 * 뷰가 결정 없는 등급을 `test`로 계산한다.
 */
export async function clearAdTierDecision(
  pool: Pool,
  tier: string,
  by: string
): Promise<AdTierState[]> {
  return withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM ads.launch_decisions WHERE tier = $1::ad_tier',
      [tier]
    );

    if (!rowCount) throw new ApiError('invalid_request', '이미 테스트 상태입니다.');

    await recordDecision(client, {
      eventId: newEventId(),
      workflow: 'ads_launch',
      step: 'clear',
      subjectKind: 'ad_tier',
      subjectId: null,
      decider: { kind: 'human', userId: by },
      decision: CONSOLE_REASON,
      reasonCode: 'ad_tier_test',
      evidence: [],
    });

    return adTierStates(client);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 캠페인 · 보상 (WP-ADM-031)
// ───────────────────────────────────────────────────────────────────────────

export type CampaignItem = {
  id: string;
  type: 'mission' | 'referral' | 'promo_cert' | 'grant';
  userId: string;
  description: string;
  amount: string | null;
  payoutStatus: 'pending' | 'paid' | 'failed' | 'blocked';
  abuseFlag: boolean;
  createdAt: string;
};

/**
 * 지급 대상 목록.
 *
 * **예산 칸은 채우지 않는다.** 캠페인 예산을 담는 표가 없고, 없는 것을 0으로
 * 적으면 「예산 0원」이 사실처럼 읽힌다. 화면은 값이 없으면 «아직 없음»을 그리도록
 * 이미 만들어져 있다(`toCampaignData`).
 */
export async function campaignGrants(db: Queryable): Promise<{ items: CampaignItem[] }> {
  const { rows } = await db.query<{
    id: string;
    kind: 'referral' | 'promotion';
    user_id: string;
    amount_krw: number;
    status: 'earned' | 'held' | 'paid' | 'blocked';
    reason_code: string;
    created_at: Date;
  }>(
    `SELECT id, kind, user_id, amount_krw, status, reason_code, created_at
     FROM structured.reward_grants
     ORDER BY created_at DESC
     LIMIT 500`
  );

  const items = rows.map((row): CampaignItem => {
    /** 화면의 갈래로 옮긴다. 홍보 인증은 «홍보인증», 초대는 «친구초대». */
    const type = row.kind === 'referral' ? 'referral' : 'promo_cert';

    return {
      id: row.id,
      type,
      userId: row.user_id,
      description: row.reason_code,
      amount: `${row.amount_krw.toLocaleString('ko-KR')}원`,
      /*
       * `held`는 사람 손을 기다리는 상태다. 화면의 «대기»와 같은 자리이므로
       * 둘을 pending으로 모은다 — 화면에 `held` 칸이 없어서 그대로 보내면
       * 라벨이 비어 나온다.
       */
      payoutStatus: row.status === 'earned' || row.status === 'held' ? 'pending' : row.status,
      /** 사람이 잡아둔 것(`held`)이 화면의 «의심»이다. */
      abuseFlag: row.status === 'held',
      createdAt: row.created_at.toISOString(),
    };
  });

  return { items };
}

// ───────────────────────────────────────────────────────────────────────────
// 감사 기록 (WP-ADM-052)
// ───────────────────────────────────────────────────────────────────────────

export type AuditEvent = {
  eventId: string;
  source: string;
  confidence: number;
  decision: 'approved' | 'rejected' | 'escalated' | 'skipped';
  reasonCode: string;
  evidence: string[];
  createdAt: string;
  actorId: string | null;
  actorType: 'ai' | 'human' | 'system';
  targetType: string;
  targetId: string;
};

export type AuditLogData = {
  items: AuditEvent[];
  total: number;
  hasMore: boolean;
  cursor: string | null;
};

const AUDIT_PAGE = 50;

/**
 * 결정 한 줄이 화면의 «승인/거부/에스컬레이션/스킵» 중 어디인가.
 *
 * `structured.decisions.decision`은 자유 문자열이다(워크플로마다 말이 다르다).
 * 화면은 네 갈래만 그린다 — 모르는 말을 그중 하나로 우겨 넣지 않고, 실행
 * 상태에서 읽는다. 실패한 결정은 사람에게 넘어간 것이므로 «에스컬레이션»이다.
 */
function toDecisionBucket(
  decision: string,
  execution: string
): AuditEvent['decision'] {
  if (execution === 'failed') return 'escalated';
  if (execution === 'pending') return 'escalated';
  if (execution === 'rolled_back') return 'skipped';

  const word = decision.toLowerCase();
  if (['approved', 'approve', 'paid', 'published', 'restored', 'accepted'].includes(word)) {
    return 'approved';
  }
  if (['rejected', 'reject', 'blocked', 'removed', 'denied'].includes(word)) {
    return 'rejected';
  }

  return 'skipped';
}

const ACTOR_TYPE: Record<string, AuditEvent['actorType']> = {
  human: 'human',
  model: 'ai',
  rule: 'system',
};

/**
 * 감사 기록.
 *
 * 화면이 `?q=`로 검색어 하나만 보낸다. 예전 서버는 `?workflow=`와 `?cursor=`를
 * 읽고 `nextCursor`를 돌려줬는데 화면은 `cursor`를 읽는다 — 어느 쪽도 서로를
 * 만나지 못했다. **화면이 부르는 대로 맞춘다.**
 */
export async function auditLog(
  db: Queryable,
  query: { q?: string; cursor?: string }
): Promise<AuditLogData> {
  const params: unknown[] = [];
  const clauses: string[] = [];

  const q = query.q?.trim();

  if (q) {
    params.push(`%${q}%`);
    /*
     * 워크플로 · 단계 · 대상 갈래 · 사유 코드에서 찾는다. 근거(evidence_refs)는
     * 가리키기만 하는 값이라 찾을 말이 없다.
     */
    clauses.push(
      `(workflow ILIKE $${params.length} OR step ILIKE $${params.length}
        OR subject_kind ILIKE $${params.length} OR reason_code ILIKE $${params.length}
        OR decision ILIKE $${params.length})`
    );
  }

  if (query.cursor) {
    params.push(query.cursor);
    clauses.push(`created_at < $${params.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  params.push(AUDIT_PAGE + 1);

  const { rows } = await db.query<{
    id: string;
    event_id: string;
    workflow: string;
    step: string;
    subject_kind: string;
    subject_id: string | null;
    decider: string;
    actor_user_id: string | null;
    confidence: string | null;
    decision: string;
    reason_code: string;
    evidence_refs: { kind: string; id: string }[];
    source: string | null;
    execution_status: string;
    created_at: Date;
  }>(
    `SELECT id, event_id, workflow, step, subject_kind, subject_id,
            decider, actor_user_id, confidence::text, decision, reason_code,
            evidence_refs, source, execution_status, created_at
     FROM structured.decisions
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const { rows: counted } = await db.query<{ total: string }>(
    `SELECT count(*) AS total FROM structured.decisions ${where}`,
    // 마지막은 LIMIT 값이라 세는 질의에는 넘기지 않는다.
    params.slice(0, -1)
  );

  const hasMore = rows.length > AUDIT_PAGE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE) : rows;

  return {
    items: page.map((row): AuditEvent => ({
      eventId: row.event_id,
      source: row.source ?? row.workflow,
      confidence: row.confidence !== null ? Number(row.confidence) : 0,
      decision: toDecisionBucket(row.decision, row.execution_status),
      reasonCode: row.reason_code,
      evidence: (row.evidence_refs ?? []).map((ref) => `${ref.kind}:${ref.id}`),
      createdAt: row.created_at.toISOString(),
      actorId: row.actor_user_id,
      actorType: ACTOR_TYPE[row.decider] ?? 'system',
      targetType: row.subject_kind,
      targetId: row.subject_id ?? row.step,
    })),
    total: Number(counted[0]?.total ?? '0'),
    hasMore,
    cursor: hasMore ? page[page.length - 1]!.created_at.toISOString() : null,
  };
}
