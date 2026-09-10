/**
 * 알림톡 한 건을 보낸다.
 *
 * **여기가 유일한 문이다.** 기능 코드는 `sendNotification`만 부르고, 그 아래에서
 * 이 함수가 «보낼 수 있는가»를 전부 확인한다. 확인이 여러 곳에 흩어지면 언젠가
 * 한 곳이 빠뜨리고, 빠뜨린 그 한 곳으로 승인 안 된 알림톡이 나간다.
 */

import {
  channelsFor,
  missingVariables,
  templateIdFor,
  type NotificationEvent,
  type NotificationVariant,
} from '@weddingpick/domain';
import type { Pool } from 'pg';

import type { Alimtalk } from './port';
import { findTemplate } from './templates';

/** 다시 시도하는 횟수. 한 번이면 충분하고, 그 이상은 청구서만 늘린다. */
const MAX_RETRIES = 1;

export type AlimtalkRecord = {
  status: 'sent' | 'failed' | 'skipped' | 'duplicate';
  /** 건너뛰거나 실패한 이유. 보낸 경우에는 없다. */
  reason?: string;
};

export type AlimtalkDeps = {
  pool: Pool;
  /**
   * 발송 구현. 대행사가 정해지기 전에는 없다(`undefined`).
   *
   * 없으면 보내지 않고 «no_provider»로 남긴다 — 없는 준비물을 있는 것처럼 다루지
   * 않는다.
   */
  alimtalk?: Alimtalk | null;
  env?: NodeJS.ProcessEnv;
};

export type AlimtalkInput = {
  event: NotificationEvent;
  variant?: NotificationVariant;
  userId: string;
  variables: Readonly<Record<string, string>>;
  /** 알림함과 같은 열쇠를 쓴다. 같은 열쇠로는 한 번만 나간다. */
  dedupeKey?: string | null;
};

/**
 * 실제로 사람에게 나가도 되는 환경인가.
 *
 * **이 문이 승인 플래그보다 앞에 온다**(사용자 지시). 개발·테스트에서 승인된
 * 템플릿을 들고 있어도 나가지 않는다 — 시험 삼아 돌린 워커가 진짜 사람의
 * 전화기를 울리는 일은 되돌릴 수 없다.
 */
function isSendableEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

/** 이 사람에게 보낼 번호를 아는가. 없으면 알림톡을 건너뛴다 — 문자로 대신 보내지 않는다. */
async function findRecipient(pool: Pool, userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ mobile: string | null }>(
    `SELECT mobile FROM identity.identities
     WHERE user_id = $1 AND mobile IS NOT NULL
     ORDER BY last_login_at DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );

  return rows[0]?.mobile ?? null;
}

async function record(
  pool: Pool,
  row: {
    userId: string;
    event: string;
    templateId: string;
    status: 'queued' | 'skipped';
    skipReason?: string;
    dedupeKey?: string | null;
  }
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO structured.alimtalk_deliveries
       (user_id, event_type, template_id, status, skip_reason, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, dedupe_key)
       WHERE dedupe_key IS NOT NULL AND status <> 'skipped' DO NOTHING
     RETURNING id`,
    [row.userId, row.event, row.templateId, row.status, row.skipReason ?? null, row.dedupeKey ?? null]
  );

  return rows[0]?.id ?? null;
}

export async function sendAlimtalk(
  deps: AlimtalkDeps,
  input: AlimtalkInput
): Promise<AlimtalkRecord> {
  const env = deps.env ?? process.env;
  const templateId = templateIdFor(input.event, input.variant);
  const template = findTemplate(templateId);

  const providerReady = Boolean(deps.alimtalk) && isSendableEnvironment(env);
  const recipient = providerReady ? await findRecipient(deps.pool, input.userId) : null;

  const channels = channelsFor(input.event, {
    templateApproved: template.approved,
    providerReady,
    hasRecipient: recipient !== null,
  });

  if (!channels.includes('alimtalk')) {
    const reason = !isSendableEnvironment(env)
      ? 'non_production'
      : !deps.alimtalk
        ? 'no_provider'
        : !template.approved
          ? 'not_approved'
          : 'no_recipient';

    await record(deps.pool, {
      userId: input.userId,
      event: input.event,
      templateId,
      status: 'skipped',
      skipReason: reason,
      dedupeKey: input.dedupeKey ?? null,
    });

    return { status: 'skipped', reason };
  }

  /*
   * 변수 검증은 자리를 잡기 전에 한다. 값이 빈 알림톡은 승인된 문안과 다른 글이라
   * 보내면 안 되고, 보내지 않을 것을 위해 열쇠를 먹어버리면 값을 채워 다시 부를
   * 수도 없다.
   */
  const missing = missingVariables(template, input.variables);

  if (missing.length > 0) {
    await record(deps.pool, {
      userId: input.userId,
      event: input.event,
      templateId,
      status: 'skipped',
      skipReason: 'missing_variables',
      dedupeKey: input.dedupeKey ?? null,
    });

    return { status: 'skipped', reason: 'missing_variables' };
  }

  const id = await record(deps.pool, {
    userId: input.userId,
    event: input.event,
    templateId,
    status: 'queued',
    dedupeKey: input.dedupeKey ?? null,
  });

  // 같은 열쇠로 이미 한 번 시도했다. 건당 과금이라 두 번 보내지 않는다.
  if (!id) return { status: 'duplicate' };

  let attempt = 0;
  let failureCode = 'unknown';

  while (attempt <= MAX_RETRIES) {
    const outcome = await deps.alimtalk!.send({
      to: recipient!,
      templateId,
      variables: input.variables,
    });

    if (outcome.delivered) {
      await deps.pool.query(
        `UPDATE structured.alimtalk_deliveries
         SET status = 'sent', sent_at = now(), provider_message_id = $2, retry_count = $3
         WHERE id = $1`,
        [id, outcome.providerMessageId, attempt]
      );

      return { status: 'sent' };
    }

    failureCode = outcome.failureCode;

    if (!outcome.retriable) break;

    attempt += 1;
  }

  await deps.pool.query(
    `UPDATE structured.alimtalk_deliveries
     SET status = 'failed', failure_code = $2, retry_count = $3
     WHERE id = $1`,
    [id, failureCode, Math.min(attempt, MAX_RETRIES)]
  );

  return { status: 'failed', reason: failureCode };
}
