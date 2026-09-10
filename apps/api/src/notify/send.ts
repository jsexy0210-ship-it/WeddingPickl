import {
  NOTIFICATION_CAP_EXEMPT_KINDS,
  NOTIFICATION_EVENT_POLICY,
  NOTIFICATION_TIMEZONE,
  NOTIFICATION_TOPICS_ALWAYS,
  isCappedNotification,
  reachedDailyCap,
  type NotificationEvent,
  type NotificationKind,
  type NotificationTopic,
  type NotificationVariant,
} from '@weddingpick/domain';
import type { Pool } from 'pg';

import type { Push, PushMessage } from '../push/port';
import { sendAlimtalk, type AlimtalkRecord } from './alimtalk/deliver';
import type { Alimtalk } from './alimtalk/port';

/**
 * 사용자에게 알림을 보낸다. 최종통합정책 v2.0 36번 · 핸드오프 v3.22 SPEC 13.12.
 *
 * **알림함이 먼저고 푸시가 나중이다.** 푸시를 못 받는 기기에서도 결과를 볼 수
 * 있어야 하므로, 알림함에 남기는 것이 본체다.
 *
 * **스위치를 여기서 본다.** 끌 수 있게 만들어놓고 보내는 쪽이 그 값을 안 보면
 * 그 스위치는 장식이다. 보내는 곳이 여럿이므로 조건을 각자 적게 두지 않고,
 * 이 함수 하나가 지킨다.
 *
 * **하루 한도도 여기서 본다**(13.12 «하루 최대 2건. 일정 알림은 예외»). 보내는
 * 쪽마다 세면 일정 워커와 가격 워커가 서로 모른 채 각각 두 건씩 보낸다.
 */

export type Deliverable = {
  userId: string;
  kind: NotificationKind;
  /**
   * 왜 보내는가. 하루 한도와 «진행 중 업종만» 규칙이 이 값을 본다.
   *
   * 비우면 `other`다 — 주제를 모르는 알림은 한도에 센다. 모르는 것을 예외로
   * 두면 예외가 기본이 된다.
   */
  topic?: NotificationTopic;
  title: string;
  body: string;
  targetId?: string | null;
  /** 같은 알림을 두 번 보내지 않기 위한 열쇠. 한 번만 일어나는 일은 비워둔다. */
  dedupeKey?: string | null;
  /**
   * 가격 변동 알림인가.
   *
   * 서비스 알림과 따로 끈다(v2.0 37번) — 자료 확인 결과는 받고 싶지만 가격
   * 알림은 시끄러운 사람이 있다.
   */
  priceChange?: boolean;
  /**
   * 서비스 필수 알림인가. 하루 한도를 세지 않는다.
   *
   * 배우자 초대 · 인증 결과 · 계정 변경 · 당첨 안내처럼 **사용자가 반드시 확인해야
   * 하는 것**만 여기 해당한다(notification-event.ts의 여섯 이벤트). 당첨 안내가
   * «오늘은 두 건 다 썼어요»로 사라지면 그 사람은 지급받을 방법을 모른다.
   */
  essential?: boolean;
};

export type DeliveryResult = {
  /** 알림함에 새로 남은 것. 이미 같은 열쇠가 있었으면 0이다. */
  stored: number;
  /** 푸시가 닿은 기기 수. 스위치를 끈 사람에게는 0이다. */
  pushed: number;
  /** 같은 열쇠가 이미 있어 건너뛴 것. */
  skipped: number;
  /** 오늘 한도(2건)가 차서 보내지 않은 것. 내일 다시 볼 일이 있으면 그때 간다. */
  capped: number;
};

type Settings = { push_enabled: boolean; price_change_enabled: boolean };

/**
 * 오늘 이 사람에게 간 한도 대상 알림 수.
 *
 * 하루는 사용자가 사는 곳(Asia/Seoul) 기준이다 — UTC로 세면 저녁 9시에 날이
 * 바뀌어 한도가 두 번 열린다.
 *
 * `topic`이 NULL인 옛 알림도 센다. 예외인 종류(제보 결과 · 배우자)만 빼고 다 센다.
 */
export async function sentTodayCount(pool: Pool, userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
     FROM structured.notifications
     WHERE user_id = $1
       AND (created_at AT TIME ZONE $4)::date = (now() AT TIME ZONE $4)::date
       AND NOT (kind::text = ANY($2::text[]))
       AND (topic IS NULL OR NOT (topic = ANY($3::text[])))`,
    [userId, [...NOTIFICATION_CAP_EXEMPT_KINDS], [...NOTIFICATION_TOPICS_ALWAYS], NOTIFICATION_TIMEZONE]
  );

  return Number(rows[0]?.count ?? 0);
}

export async function deliver(
  deps: { pool: Pool; push: Push },
  items: readonly Deliverable[]
): Promise<DeliveryResult> {
  const result: DeliveryResult = { stored: 0, pushed: 0, skipped: 0, capped: 0 };

  for (const item of items) {
    const topic = item.topic ?? 'other';

    /*
     * 하루 최대 2건(13.12). 일정 · 제보 결과 · 배우자는 세지 않는다.
     *
     * 중복 열쇠를 한도보다 먼저 본다 — 이미 보낸 알림은 «건너뜀»이지 «한도에
     * 막힘»이 아니다. 순서를 바꾸면 한도가 찬 날 워커가 돌 때마다 이미 보낸
     * 알림이 capped로 세여 숫자가 거짓이 된다.
     */
    if (!item.essential && isCappedNotification({ kind: item.kind, topic })) {
      const alreadySent = item.dedupeKey
        ? await deps.pool.query(
            `SELECT 1 FROM structured.notifications WHERE user_id = $1 AND dedupe_key = $2`,
            [item.userId, item.dedupeKey]
          )
        : null;

      if (alreadySent && alreadySent.rows.length > 0) {
        result.skipped += 1;
        continue;
      }

      if (reachedDailyCap(await sentTodayCount(deps.pool, item.userId))) {
        result.capped += 1;
        continue;
      }
    }

    /*
     * 알림함에는 스위치와 무관하게 남긴다.
     *
     * 스위치는 **밀어서 알려줄지**를 정하는 값이지, 결과를 감추는 값이 아니다.
     * 알림을 껐다고 자료 확인 결과가 사라지면, 그 사람은 결과를 영영 모른다.
     */
    const { rows } = await deps.pool.query<{ id: string }>(
      `INSERT INTO structured.notifications (user_id, kind, topic, title, body, target_id, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        item.userId,
        item.kind,
        topic,
        item.title,
        item.body,
        item.targetId ?? null,
        item.dedupeKey ?? null,
      ]
    );

    if (rows.length === 0) {
      // 이미 보낸 알림이다. 푸시도 다시 쏘지 않는다.
      result.skipped += 1;
      continue;
    }

    result.stored += 1;

    const settings = await deps.pool.query<Settings>(
      `SELECT coalesce(s.push_enabled, true) AS push_enabled,
              coalesce(s.price_change_enabled, true) AS price_change_enabled
       FROM structured.users u
       LEFT JOIN structured.notification_settings s ON s.user_id = u.id
       WHERE u.id = $1`,
      [item.userId]
    );

    const found = settings.rows[0];
    const pushEnabled = found?.push_enabled ?? true;
    const priceEnabled = found?.price_change_enabled ?? true;

    if (!pushEnabled || (item.priceChange && !priceEnabled)) continue;

    const { rows: tokens } = await deps.pool.query<{ token: string }>(
      `SELECT token FROM structured.device_tokens
       WHERE user_id = $1 AND disabled_at IS NULL`,
      [item.userId]
    );

    if (tokens.length === 0) continue;

    const messages: PushMessage[] = tokens.map(({ token }) => ({
      token,
      title: item.title,
      body: item.body,
    }));

    const outcomes = await deps.push.send(messages);

    result.pushed += outcomes.filter((outcome) => outcome.delivered).length;
  }

  return result;
}

/**
 * 이벤트 하나를 알림함 · 푸시 · 알림톡으로 보낸다. 사용자 오더(2026-09-09).
 *
 * **부르는 쪽은 이벤트 이름만 안다.** 템플릿 번호도, 카카오 API도, 어느 채널로
 * 나가는지도 모른다 — 채널 정책이 바뀔 때 기능 코드를 열지 않기 위해서다.
 *
 * 알림톡이 안 나가도 알림함과 푸시는 나간다. 곁가지가 본줄기를 끊지 않는다.
 */
export type NotificationRequest = {
  event: NotificationEvent;
  /** 결과에 따라 문안이 갈리는 이벤트(인증 결과)에만 필요하다. */
  variant?: NotificationVariant;
  userId: string;
  /**
   * 알림함에 남길 문구.
   *
   * 화면 문구라 부르는 쪽이 `spec/strings.ko.json`에서 가져와 넣는다 — 알림톡
   * 문안(spec/alimtalk.templates.json)과 정본이 다르다.
   */
  inbox: { title: string; body: string; targetId?: string | null };
  /** 알림톡 템플릿 변수. 승인 전이거나 보낼 수 없으면 쓰이지 않는다. */
  variables?: Readonly<Record<string, string>>;
  /** 무엇에 대한 알림인지 나타내는 열쇠. 알림함과 알림톡이 같은 값을 쓴다. */
  dedupeKey?: string | null;
};

export async function sendNotification(
  deps: { pool: Pool; push: Push; alimtalk?: Alimtalk | null; env?: NodeJS.ProcessEnv },
  request: NotificationRequest
): Promise<{ delivery: DeliveryResult; alimtalk: AlimtalkRecord }> {
  const policy = NOTIFICATION_EVENT_POLICY[request.event];

  const delivery = await deliver(deps, [
    {
      userId: request.userId,
      kind: policy.kind,
      topic: policy.topic,
      essential: policy.essential,
      title: request.inbox.title,
      body: request.inbox.body,
      targetId: request.inbox.targetId ?? null,
      dedupeKey: request.dedupeKey ?? null,
    },
  ]);

  /*
   * 알림함에 새로 남지 않았으면 알림톡도 보내지 않는다.
   *
   * 이미 보낸 알림이라는 뜻이다. 막는 곳을 한 군데로 두면 «알림함에는 없는데
   * 알림톡은 두 번 온» 상태가 생기지 않는다.
   */
  if (delivery.stored === 0) {
    return { delivery, alimtalk: { status: 'duplicate' } };
  }

  try {
    const alimtalk = await sendAlimtalk(deps, {
      event: request.event,
      variant: request.variant,
      userId: request.userId,
      variables: request.variables ?? {},
      dedupeKey: request.dedupeKey ?? null,
    });

    return { delivery, alimtalk };
  } catch {
    /*
     * 알림톡이 터져도 부르는 쪽을 막지 않는다. 알림함에는 이미 남았고, 사용자는
     * 앱에서 결과를 볼 수 있다. 예외 내용을 여기서 찍지 않는 이유는 수신번호가
     * 섞여 들어올 수 있어서다.
     */
    return { delivery, alimtalk: { status: 'failed', reason: 'error' } };
  }
}
